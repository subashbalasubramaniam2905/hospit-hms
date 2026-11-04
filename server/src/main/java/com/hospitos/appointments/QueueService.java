package com.hospitos.appointments;

import com.hospitos.appointments.Directory.DoctorInfo;
import com.hospitos.appointments.Dtos.AppointmentView;
import com.hospitos.appointments.Dtos.HistoryItem;
import com.hospitos.appointments.Dtos.QueuePatch;
import com.hospitos.appointments.Dtos.QueueView;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The live OPD queue: who is in the hospital today and which step of the journey they are at. */
@Service
public class QueueService {

    private static final DateTimeFormatter HM = DateTimeFormatter.ofPattern("HH:mm");

    private final JdbcClient db;
    private final Directory dir;
    private final QueueTokens tokens;
    private final Clock clock;

    public QueueService(JdbcClient db, Directory dir, QueueTokens tokens, Clock clock) {
        this.db = db;
        this.dir = dir;
        this.tokens = tokens;
        this.clock = clock;
    }

    private LocalDate today() {
        return LocalDate.now(clock);
    }

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }

    /** Everyone in the day's queue who hasn't left, with their journey so far. */
    public List<QueueView> list(String branch, LocalDate day) {
        LocalDate d = day == null ? today() : day;
        String[] branches = dir.scope(branch).toArray(String[]::new);
        List<Row> rows = db.sql("""
                select * from queue_entry
                 where (cardinality(cast(:b as text[])) = 0 or branch_id = any(cast(:b as text[])))
                   and visit_date = :d and state <> 'Left' order by arrived_at, id""")
                .param("b", branches).param("d", d).query(QueueService::row).list();
        if (rows.isEmpty()) return List.of();
        Long[] ids = rows.stream().map(Row::id).toArray(Long[]::new);
        Map<Long, List<HistoryItem>> hist = db.sql("""
                select queue_entry_id, from_step, at from queue_event
                 where queue_entry_id = any(cast(:ids as bigint[])) and from_step is not null order by at, id""")
                .param("ids", ids)
                .query((rs, i) -> Map.entry(rs.getLong(1), new HistoryItem(rs.getInt(2), hm(rs.getObject(3, OffsetDateTime.class)))))
                .list().stream()
                .collect(Collectors.groupingBy(Map.Entry::getKey, Collectors.mapping(Map.Entry::getValue, Collectors.toList())));
        return rows.stream().map(r -> view(r, hist.getOrDefault(r.id, List.of()))).toList();
    }

    public QueueView get(long id) {
        Row r = find(id, false);
        return view(r, history(r.id));
    }

    boolean hasLiveEntry(String appointmentId) {
        return db.sql("select count(*) from queue_entry where appointment_id = :a and state <> 'Left'").param("a", appointmentId)
                .query(Integer.class).single() > 0;
    }

    /**
     * Puts a checked-in appointment into the queue at Billing, issuing a token if it has none.
     * Calling it again for a patient already in the queue returns their entry unchanged.
     */
    @Transactional
    public QueueView checkIn(AppointmentView a, String branchId) {
        Optional<Row> existing = db.sql("select * from queue_entry where appointment_id = :a for update").param("a", a.id())
                .query(QueueService::row).optional();
        if (existing.isPresent() && !"Left".equals(existing.get().state)) return view(existing.get(), history(existing.get().id));
        if (!a.date().equals(today())) throw Errors.conflict("Only today's appointments can be checked in.");
        String token = a.token();
        if (token == null) {
            token = tokens.next(branchId, a.deptId(), today());
            db.sql("update appointment set token = :t, updated_at = now() where id = :id").param("t", token).param("id", a.id()).update();
        }
        long id;
        if (existing.isPresent()) {
            // Came back after being marked as left: rejoin at Billing with the same token.
            id = existing.get().id;
            db.sql("update queue_entry set state = 'Active', step = 1, step_since = :now, arrived_at = :now where id = :id")
                    .param("now", now()).param("id", id).update();
        } else {
            id = db.sql("""
                    insert into queue_entry (branch_id, visit_date, token, appointment_id, patient_id, doctor_id, dept_id, step, step_since, arrived_at)
                    values (:b, :d, :t, :a, :p, :doc, :dept, 1, :now, :now) returning id""")
                    .param("now", now())
                    .param("b", branchId).param("d", today()).param("t", token).param("a", a.id()).param("p", a.patientId())
                    .param("doc", a.doctorId()).param("dept", a.deptId()).query(Long.class).single();
        }
        event(id, Journey.REGISTRATION, Journey.BILLING, "Checked in");
        db.sql("update appointment set status = 'Arrived', updated_at = now() where id = :id and status in ('Scheduled','Confirmed','No-show')")
                .param("id", a.id()).update();
        dir.audit(branchId, "Checked in", "Queue", String.valueOf(id), dir.patientName(a.patientId()).orElse(a.patientId()) + " joined the queue as " + token);
        return get(id);
    }

    /** Moves a patient to the next step, or to a chosen one, and keeps the appointment status in step. */
    @Transactional
    public QueueView move(long id, Integer step) {
        Row r = find(id, true);
        if ("Left".equals(r.state)) throw Errors.conflict("Token " + r.token + " has left the queue.");
        int to = step == null ? Math.min(Journey.DISCHARGE, r.step + 1) : step;
        if (!Journey.valid(to)) throw Errors.bad("Step must be 0 to 6.");
        if (to == r.step) return view(r, history(r.id));
        db.sql("update queue_entry set step = :s, step_since = :now, state = :state where id = :id")
                .param("now", now()).param("s", to).param("state", to == Journey.DISCHARGE ? "Done" : "Active").param("id", r.id).update();
        event(r.id, r.step, to, null);
        if (r.appointmentId != null) syncAppointment(r.appointmentId, r.step, to);
        dir.audit(r.branchId, "Moved", "Queue", String.valueOf(r.id), r.token + ": " + Journey.name(r.step) + " to " + Journey.name(to));
        return get(id);
    }

    /** Calls the next patient waiting at triage: emergencies first, then priority, then longest wait. */
    @Transactional
    public Optional<QueueView> callNext(String branch, String deptId, String doctorId) {
        String[] branches = dir.scope(branch).toArray(String[]::new);
        Optional<Row> next = db.sql("""
                select * from queue_entry
                 where (cardinality(cast(:b as text[])) = 0 or branch_id = any(cast(:b as text[])))
                   and visit_date = :d and state = 'Active' and step = 2
                   and (cast(:dept as text) is null or dept_id = :dept) and (cast(:doc as text) is null or doctor_id = :doc)
                 order by emergency desc, priority desc, step_since, id
                 limit 1 for update skip locked""")
                .param("b", branches).param("d", today())
                .param("dept", AppointmentService.blankToNull(deptId)).param("doc", AppointmentService.blankToNull(doctorId))
                .query(QueueService::row).optional();
        return next.map(r -> move(r.id, Journey.CONSULTATION));
    }

    @Transactional
    public QueueView patch(long id, QueuePatch p) {
        Row r = find(id, true);
        if ("Left".equals(r.state)) throw Errors.conflict("Token " + r.token + " has left the queue.");
        if (p.priority() != null && p.priority() != r.priority) {
            db.sql("update queue_entry set priority = :v where id = :id").param("v", p.priority()).param("id", r.id).update();
            event(r.id, null, null, p.priority() ? "Marked priority" : "Priority removed");
        }
        if (p.emergency() != null && p.emergency() != r.emergency) {
            db.sql("update queue_entry set emergency = :v where id = :id").param("v", p.emergency()).param("id", r.id).update();
            event(r.id, null, null, p.emergency() ? "Marked emergency" : "Emergency removed");
        }
        if (p.doctorId() != null && !p.doctorId().equals(r.doctorId)) {
            DoctorInfo d = dir.doctor(p.doctorId()).filter(x -> x.branchId().equals(r.branchId))
                    .orElseThrow(() -> Errors.notFound("Doctor " + p.doctorId() + " in this branch"));
            if ("On leave".equalsIgnoreCase(d.status())) throw Errors.conflict(d.name() + " is on leave today.");
            db.sql("update queue_entry set doctor_id = :doc, dept_id = :dept where id = :id")
                    .param("doc", d.id()).param("dept", d.deptId()).param("id", r.id).update();
            if (r.appointmentId != null) {
                db.sql("update appointment set doctor_id = :doc, dept_id = :dept, room = :room, updated_at = now() where id = :id")
                        .param("doc", d.id()).param("dept", d.deptId()).param("room", d.room()).param("id", r.appointmentId).update();
            }
            event(r.id, null, null, "Reassigned to " + d.name());
        }
        if (p.priority() != null || p.emergency() != null || p.doctorId() != null) {
            dir.audit(r.branchId, "Updated", "Queue", String.valueOf(r.id), r.token + ": " + describe(p));
        }
        return get(id);
    }

    private static String describe(QueuePatch p) {
        StringBuilder b = new StringBuilder();
        if (p.priority() != null) b.append("priority=").append(p.priority()).append(' ');
        if (p.emergency() != null) b.append("emergency=").append(p.emergency()).append(' ');
        if (p.doctorId() != null) b.append("doctor=").append(p.doctorId());
        return b.toString().trim();
    }

    /** The patient left without being seen. Their appointment becomes a no-show. */
    @Transactional
    public void left(long id) {
        Row r = find(id, true);
        if ("Left".equals(r.state)) return;
        markLeft(r);
        if (r.appointmentId != null) {
            db.sql("update appointment set status = 'No-show', updated_at = now() where id = :id and status not in ('Completed','Cancelled')")
                    .param("id", r.appointmentId).update();
        }
        dir.audit(r.branchId, "Updated", "Queue", String.valueOf(r.id), r.token + ": left without being seen");
    }

    /** Called when an appointment is cancelled or marked no-show from the calendar. */
    void leaveFor(String appointmentId) {
        db.sql("select * from queue_entry where appointment_id = :a and state <> 'Left' for update").param("a", appointmentId)
                .query(QueueService::row).optional().ifPresent(this::markLeft);
    }

    private void markLeft(Row r) {
        db.sql("update queue_entry set state = 'Left' where id = :id").param("id", r.id).update();
        event(r.id, null, null, "Left the queue");
    }

    private void syncAppointment(String apptId, int from, int to) {
        String status;
        if (to <= Journey.BILLING) status = "Arrived";
        else if (to == Journey.TRIAGE) status = "Waiting";
        else if (to == Journey.CONSULTATION) status = "In consultation";
        else if (from <= Journey.CONSULTATION) status = "Completed";
        else return; // moving between lab, pharmacy and discharge doesn't change the appointment
        db.sql("update appointment set status = :s, updated_at = now() where id = :id and status not in ('Cancelled','No-show')")
                .param("s", status).param("id", apptId).update();
    }

    private void event(long entryId, Integer from, Integer to, String note) {
        db.sql("insert into queue_event (queue_entry_id, from_step, to_step, note, by_user, at) values (:e, :f, :t, :n, :u, :now)")
                .param("now", now()).param("e", entryId).param("f", from).param("t", to).param("n", note).param("u", dir.userId()).update();
    }

    private List<HistoryItem> history(long entryId) {
        return db.sql("select from_step, at from queue_event where queue_entry_id = :e and from_step is not null order by at, id")
                .param("e", entryId).query((rs, i) -> new HistoryItem(rs.getInt(1), hm(rs.getObject(2, OffsetDateTime.class)))).list();
    }

    private Row find(long id, boolean forUpdate) {
        Optional<Row> r = db.sql("select * from queue_entry where id = :id" + (forUpdate ? " for update" : ""))
                .param("id", id).query(QueueService::row).optional();
        if (r.isEmpty() || !dir.canSee(r.get().branchId)) throw Errors.notFound("Queue entry " + id);
        return r.get();
    }

    private String hm(OffsetDateTime t) {
        return t.atZoneSameInstant(clock.getZone()).format(HM);
    }

    private QueueView view(Row r, List<HistoryItem> history) {
        long since = Math.max(0, Duration.between(r.stepSince, now()).toMinutes());
        return new QueueView(r.id, r.token, r.patientId, r.doctorId, r.deptId, r.step, since, hm(r.arrivedAt), r.priority, r.emergency,
                r.appointmentId, history);
    }

    private record Row(long id, String branchId, String token, String appointmentId, String patientId, String doctorId, String deptId,
                       int step, OffsetDateTime stepSince, OffsetDateTime arrivedAt, boolean priority, boolean emergency, String state) {}

    private static Row row(ResultSet rs, int i) throws SQLException {
        return new Row(rs.getLong("id"), rs.getString("branch_id"), rs.getString("token"), rs.getString("appointment_id"),
                rs.getString("patient_id"), rs.getString("doctor_id"), rs.getString("dept_id"), rs.getInt("step"),
                rs.getObject("step_since", OffsetDateTime.class), rs.getObject("arrived_at", OffsetDateTime.class), rs.getBoolean("priority"),
                rs.getBoolean("emergency"), rs.getString("state"));
    }
}
