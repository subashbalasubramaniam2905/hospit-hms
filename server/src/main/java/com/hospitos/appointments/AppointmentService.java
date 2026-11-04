package com.hospitos.appointments;

import com.hospitos.appointments.Directory.DoctorInfo;
import com.hospitos.appointments.Dtos.AppointmentView;
import com.hospitos.appointments.Dtos.BookRequest;
import com.hospitos.appointments.Dtos.BookResult;
import com.hospitos.appointments.Dtos.SlotDay;
import com.hospitos.appointments.Dtos.SlotView;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AppointmentService {

    static final DateTimeFormatter HM = DateTimeFormatter.ofPattern("HH:mm");
    /** Bookings further ahead than this are almost always a typo in the year. */
    static final int MAX_DAYS_AHEAD = 366;
    private static final Map<String, DayOfWeek> DAYS = Map.of("Mon", DayOfWeek.MONDAY, "Tue", DayOfWeek.TUESDAY, "Wed",
            DayOfWeek.WEDNESDAY, "Thu", DayOfWeek.THURSDAY, "Fri", DayOfWeek.FRIDAY, "Sat", DayOfWeek.SATURDAY, "Sun", DayOfWeek.SUNDAY);

    private final JdbcClient db;
    private final Directory dir;
    private final QueueTokens tokens;
    private final QueueService queue;
    private final Clock clock;

    public AppointmentService(JdbcClient db, Directory dir, QueueTokens tokens, QueueService queue, Clock clock) {
        this.db = db;
        this.dir = dir;
        this.tokens = tokens;
        this.queue = queue;
        this.clock = clock;
    }

    LocalDate today() {
        return LocalDate.now(clock);
    }

    // ---------------------------------------------------------------- reads

    public List<AppointmentView> list(String branch, LocalDate from, LocalDate to, String doctorId, String patientId, String status) {
        if (to.isBefore(from)) throw Errors.bad("The end date is before the start date.");
        if (from.plusDays(400).isBefore(to)) throw Errors.bad("Ask for at most 400 days at a time.");
        List<String> scope = dir.scope(branch);
        return db.sql("""
                select appointment.*, (select name from patient where patient.id = appointment.patient_id) as patient_name from appointment
                 where (cardinality(cast(:branches as text[])) = 0 or branch_id = any(cast(:branches as text[])))
                   and appt_date between :from and :to
                   and (cast(:doctor as text) is null or doctor_id = :doctor)
                   and (cast(:patient as text) is null or patient_id = :patient)
                   and (cast(:status as text) is null or status = :status)
                 order by appt_date, start_time, id""")
                .param("branches", scope.toArray(String[]::new)).param("from", from).param("to", to)
                .param("doctor", blankToNull(doctorId)).param("patient", blankToNull(patientId)).param("status", blankToNull(status))
                .query(AppointmentService::map).list();
    }

    public AppointmentView get(String id) {
        Optional<Row> r = db.sql("select appointment.*, (select name from patient where patient.id = appointment.patient_id) as patient_name from appointment where id = :id").param("id", id).query(AppointmentService::row).optional();
        if (r.isEmpty() || !dir.canSee(r.get().branchId)) throw Errors.notFound("Appointment " + id);
        return r.get().view;
    }

    private Row lock(String id) {
        Optional<Row> r = db.sql("select appointment.*, (select name from patient where patient.id = appointment.patient_id) as patient_name from appointment where id = :id for update").param("id", id).query(AppointmentService::row).optional();
        if (r.isEmpty() || !dir.canSee(r.get().branchId)) throw Errors.notFound("Appointment " + id);
        return r.get();
    }

    public SlotDay slots(String doctorId, LocalDate date, Integer duration) {
        DoctorInfo d = doctor(doctorId);
        SlotRules rules = rules(d, date);
        int len = duration != null ? duration : d.slotMin();
        if (len < 5 || len > 240) throw Errors.bad("Duration must be between 5 and 240 minutes.");
        List<SlotView> grid = rules.grid(len).stream().map(s -> new SlotView(s.time(), s.ok(), s.reason())).toList();
        return new SlotDay(d.id(), date, d.slotMin(), d.start().format(HM), d.end().format(HM), rules.dayBlock().orElse(null), grid);
    }

    public Dtos.CheckResult check(String doctorId, LocalDate date, String time, int duration, String ignoreId) {
        SlotRules.Check c = rules(doctor(doctorId), date).check(parseTime(time), duration, ignoreId);
        return new Dtos.CheckResult(c.ok(), c.reason());
    }

    // ---------------------------------------------------------------- writes

    @Transactional
    public BookResult book(BookRequest r) {
        DoctorInfo d = doctor(r.doctorId());
        String patientName = patient(r.patientId());
        if (r.date().isAfter(today().plusDays(MAX_DAYS_AHEAD))) throw Errors.bad("Bookings can be made up to a year ahead.");
        LocalTime t = parseTime(r.time());
        lockDoctorDay(d.id(), r.date());
        SlotRules.Check c = rules(d, r.date()).check(t, r.duration());
        if (!c.ok()) throw Errors.conflict(c.reason());

        String type = r.type() == null ? "New consultation" : r.type();
        String recurring = r.recurring() == null || r.recurring().equals("None") ? null : r.recurring();
        String seriesId = recurring == null ? null : "SR" + nextNo();
        AppointmentView first = insert(d, r.patientId(), r.date(), t, r.duration(), type, "Scheduled", r.notes(), recurring, seriesId);
        dir.audit(d.branchId(), "Created", "Appointment", first.id(), patientName + " with " + d.name() + " on " + first.date() + " " + first.time());

        List<AppointmentView> repeats = new ArrayList<>();
        List<String> skipped = new ArrayList<>();
        if (recurring != null) {
            for (int k = 1; k <= 3; k++) {
                LocalDate next = switch (recurring) {
                    case "Weekly" -> r.date().plusWeeks(k);
                    case "Every 2 weeks" -> r.date().plusWeeks(2L * k);
                    default -> r.date().plusMonths(k);
                };
                lockDoctorDay(d.id(), next);
                SlotRules.Check rc = rules(d, next).check(t, r.duration());
                if (rc.ok()) repeats.add(insert(d, r.patientId(), next, t, r.duration(), type, "Scheduled", r.notes(), recurring, seriesId));
                else skipped.add(next + ": " + rc.reason());
            }
            if (!repeats.isEmpty()) dir.audit(d.branchId(), "Created", "Appointment series", seriesId, repeats.size() + " repeat visits (" + recurring + ")");
        }
        return new BookResult(first, repeats, skipped);
    }

    @Transactional
    public AppointmentView setStatus(String id, String statusLabel) {
        ApptStatus next;
        try {
            next = ApptStatus.of(statusLabel);
        } catch (IllegalArgumentException e) {
            throw Errors.bad(e.getMessage());
        }
        Row row = lock(id);
        AppointmentView a = row.view;
        ApptStatus cur = ApptStatus.of(a.status());
        if (cur == next) return a;
        if (!cur.canMoveTo(next)) throw Errors.conflict("An appointment that is " + cur.label() + " can't be marked " + next.label() + ".");
        if (next.onSite() && !a.date().equals(today())) throw Errors.conflict("Only today's appointments can be checked in.");
        if (next.onSite()) {
            // Arriving puts the patient in the queue at Billing; Waiting and In consultation move them along it,
            // which also keeps this appointment's status in step.
            Dtos.QueueView q = queue.checkIn(a, row.branchId);
            if (next == ApptStatus.WAITING) queue.move(q.id(), Journey.TRIAGE);
            if (next == ApptStatus.IN_CONSULTATION) queue.move(q.id(), Journey.CONSULTATION);
        } else {
            db.sql("update appointment set status = :s, updated_at = now() where id = :id").param("s", next.label()).param("id", id).update();
            if (next == ApptStatus.CANCELLED || next == ApptStatus.NO_SHOW) queue.leaveFor(id);
        }
        dir.audit(row.branchId, "Updated", "Appointment", id, dir.patientName(a.patientId()).orElse(a.patientId()) + " marked " + next.label());
        return get(id);
    }

    @Transactional
    public AppointmentView reschedule(String id, LocalDate date, String time) {
        AppointmentView a = lock(id).view;
        ApptStatus cur = ApptStatus.of(a.status());
        if (cur != ApptStatus.SCHEDULED && cur != ApptStatus.CONFIRMED) {
            throw Errors.conflict("Only scheduled or confirmed appointments can be moved. This one is " + cur.label() + ".");
        }
        if (date.isAfter(today().plusDays(MAX_DAYS_AHEAD))) throw Errors.bad("Bookings can be made up to a year ahead.");
        DoctorInfo d = doctor(a.doctorId());
        LocalTime t = parseTime(time);
        lockDoctorDay(d.id(), date);
        SlotRules.Check c = rules(d, date).check(t, a.duration(), id);
        if (!c.ok()) throw Errors.conflict(c.reason());
        String token = date.equals(a.date()) ? a.token() : (date.equals(today()) ? tokens.next(d.branchId(), d.deptId(), date) : null);
        try {
            db.sql("""
                    update appointment set appt_date = :date, start_time = :time, status = 'Scheduled', token = :token,
                           reminder_sent = false, updated_at = now() where id = :id""")
                    .param("date", date).param("time", t).param("token", token).param("id", id).update();
        } catch (DataIntegrityViolationException e) {
            throw Errors.conflict(d.name() + " was just booked at that time. Pick another slot.");
        }
        dir.audit(d.branchId(), "Updated", "Appointment", id, "Moved from " + a.date() + " " + a.time() + " to " + date + " " + t.format(HM));
        return get(id);
    }

    @Transactional
    public AppointmentView markReminderSent(String id) {
        Row row = lock(id);
        AppointmentView a = row.view;
        if (ApptStatus.CLOSED.contains(ApptStatus.of(a.status()))) throw Errors.conflict("This appointment is already " + a.status() + ".");
        db.sql("update appointment set reminder_sent = true, updated_at = now() where id = :id").param("id", id).update();
        dir.audit(row.branchId, "Sent", "Appointment reminder", id, "Reminder for " + a.date() + " " + a.time());
        return get(id);
    }

    /** Books a walk-in for now and puts the patient straight into the queue with a token. */
    @Transactional
    public Dtos.WalkInResult walkIn(Dtos.WalkInRequest r) {
        DoctorInfo d = doctor(r.doctorId());
        String name = patient(r.patientId());
        if (onLeaveToday(d)) throw Errors.conflict(d.name() + " is on leave today.");
        LocalTime start = LocalTime.now(clock).withSecond(0).withNano(0);
        int len = d.slotMin();
        if (start.plusMinutes(len).isBefore(start)) start = LocalTime.of(23, 59).minusMinutes(len); // just before midnight
        AppointmentView a = insert(d, r.patientId(), today(), start, len, "Walk-in", "Arrived", null, null, null);
        Dtos.QueueView q = queue.checkIn(a, d.branchId());
        if (r.priority() || r.emergency()) q = queue.patch(q.id(), new Dtos.QueuePatch(r.priority(), r.emergency(), null));
        dir.audit(d.branchId(), "Created", "Walk-in", a.id(), name + " with " + d.name() + ", token " + q.token());
        return new Dtos.WalkInResult(get(a.id()), q);
    }

    // ---------------------------------------------------------------- doctor leave

    public List<Dtos.LeaveView> leaves(String doctorId, LocalDate from, LocalDate to) {
        doctor(doctorId);
        return db.sql("select doctor_id, leave_date, reason from doctor_leave where doctor_id = :d and leave_date between :f and :t order by leave_date")
                .param("d", doctorId).param("f", from).param("t", to)
                .query((rs, i) -> new Dtos.LeaveView(rs.getString(1), rs.getObject(2, LocalDate.class), rs.getString(3))).list();
    }

    /** Marks a day off. Bookings already on that day are kept and returned so the desk can move them. */
    @Transactional
    public List<AppointmentView> addLeave(Dtos.LeaveRequest r) {
        DoctorInfo d = doctor(r.doctorId());
        if (r.date().isBefore(today())) throw Errors.bad("Leave can't be added for a past day.");
        db.sql("""
                insert into doctor_leave (doctor_id, leave_date, reason, created_by) values (:d, :date, :reason, :by)
                on conflict (doctor_id, leave_date) do update set reason = excluded.reason""")
                .param("d", d.id()).param("date", r.date()).param("reason", r.reason() == null ? "" : r.reason().trim())
                .param("by", dir.userId()).update();
        dir.audit(d.branchId(), "Created", "Doctor leave", d.id(), d.name() + " on " + r.date());
        return db.sql("select appointment.*, (select name from patient where patient.id = appointment.patient_id) as patient_name from appointment where doctor_id = :d and appt_date = :date and status in ('Scheduled','Confirmed') order by start_time")
                .param("d", d.id()).param("date", r.date()).query(AppointmentService::map).list();
    }

    @Transactional
    public void removeLeave(String doctorId, LocalDate date) {
        DoctorInfo d = doctor(doctorId);
        int n = db.sql("delete from doctor_leave where doctor_id = :d and leave_date = :date").param("d", d.id()).param("date", date).update();
        if (n == 0) throw Errors.notFound("Leave on " + date);
        dir.audit(d.branchId(), "Deleted", "Doctor leave", d.id(), d.name() + " on " + date);
    }

    // ---------------------------------------------------------------- helpers

    private AppointmentView insert(DoctorInfo d, String patientId, LocalDate date, LocalTime t, int duration, String type,
                                   String status, String notes, String recurring, String seriesId) {
        String id = "AP" + nextNo();
        String token = date.equals(today()) ? tokens.next(d.branchId(), d.deptId(), date) : null;
        try {
            db.sql("""
                    insert into appointment (id, branch_id, patient_id, doctor_id, dept_id, appt_date, start_time, duration_min,
                                             type, status, room, token, notes, recurring, series_id, created_by)
                    values (:id, :branch, :patient, :doctor, :dept, :date, :time, :dur, :type, :status, :room, :token, :notes,
                            :recurring, :series, :by)""")
                    .param("id", id).param("branch", d.branchId()).param("patient", patientId).param("doctor", d.id())
                    .param("dept", d.deptId()).param("date", date).param("time", t).param("dur", duration).param("type", type)
                    .param("status", status).param("room", d.room()).param("token", token).param("notes", blankToNull(notes))
                    .param("recurring", recurring).param("series", seriesId).param("by", dir.userId())
                    .update();
        } catch (DataIntegrityViolationException e) {
            // The exclusion constraint caught a booking that slipped past the check above.
            throw Errors.conflict(d.name() + " was just booked at " + t.format(HM) + ". Pick another slot.");
        }
        return db.sql("select appointment.*, (select name from patient where patient.id = appointment.patient_id) as patient_name from appointment where id = :id").param("id", id).query(AppointmentService::map).single();
    }

    /** Serialises bookings for one doctor-day so check-then-insert can't race. */
    private void lockDoctorDay(String doctorId, LocalDate date) {
        db.sql("select pg_advisory_xact_lock(hashtext(:k))").param("k", "appt:" + doctorId + ":" + date).query().singleRow();
    }

    private long nextNo() {
        return db.sql("select nextval('appointment_no_seq')").query(Long.class).single();
    }

    DoctorInfo doctor(String doctorId) {
        return dir.doctor(doctorId).filter(d -> dir.canSee(d.branchId())).orElseThrow(() -> Errors.notFound("Doctor " + doctorId));
    }

    private String patient(String patientId) {
        return dir.patientName(patientId).orElseThrow(() -> Errors.notFound("Patient " + patientId));
    }

    private boolean onLeaveToday(DoctorInfo d) {
        return "On leave".equalsIgnoreCase(d.status()) || leave(d.id(), today()).isPresent();
    }

    private Optional<String> leave(String doctorId, LocalDate date) {
        return db.sql("select reason from doctor_leave where doctor_id = :d and leave_date = :date")
                .param("d", doctorId).param("date", date).query(String.class).optional();
    }

    SlotRules rules(DoctorInfo d, LocalDate date) {
        List<SlotRules.Schedule> week = d.days().stream().map(DAYS::get).filter(x -> x != null)
                .map(day -> new SlotRules.Schedule(day, d.start(), d.end(), d.slotMin(), d.breakStart(), d.breakEnd())).toList();
        Optional<String> leave = leave(d.id(), date);
        if (leave.isEmpty() && date.equals(today()) && "On leave".equalsIgnoreCase(d.status())) leave = Optional.of("");
        List<SlotRules.Booked> booked = db.sql("""
                select a.id, coalesce(p.name, 'another patient') as name, a.start_time, a.duration_min
                  from appointment a left join patient p on p.id = a.patient_id
                 where a.doctor_id = :d and a.appt_date = :date and a.status not in ('Cancelled','No-show') and a.type <> 'Walk-in'""")
                .param("d", d.id()).param("date", date)
                .query((rs, i) -> new SlotRules.Booked(rs.getString("id"), rs.getString("name"), rs.getObject("start_time", LocalTime.class),
                        rs.getInt("duration_min")))
                .list();
        return new SlotRules(d.name(), date, week, leave, booked, LocalDateTime.now(clock));
    }

    static LocalTime parseTime(String time) {
        try {
            return LocalTime.parse(time, HM);
        } catch (RuntimeException e) {
            throw Errors.bad("Time must be HH:mm.");
        }
    }

    static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    private record Row(String branchId, AppointmentView view) {}

    private static Row row(ResultSet rs, int i) throws SQLException {
        return new Row(rs.getString("branch_id"), map(rs, i));
    }

    static AppointmentView map(ResultSet rs, int i) throws SQLException {
        return new AppointmentView(rs.getString("id"), rs.getString("patient_id"), rs.getString("patient_name"), rs.getString("doctor_id"), rs.getString("dept_id"),
                rs.getObject("appt_date", LocalDate.class), rs.getObject("start_time", LocalTime.class).format(HM), rs.getInt("duration_min"),
                rs.getString("type"), rs.getString("status"), rs.getString("room"), rs.getString("token"), rs.getString("notes"),
                rs.getString("recurring"), rs.getBoolean("reminder_sent"));
    }
}
