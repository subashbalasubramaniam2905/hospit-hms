package com.hospitos.portal;

import com.hospitos.appointments.AppointmentService;
import com.hospitos.appointments.Dtos;
import com.hospitos.audit.AuditService;
import com.hospitos.common.ActingAs;
import com.hospitos.common.ApiException;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What a signed-in patient can see and do: their profile, visits, prescriptions, verified lab reports and bills, and booking or
 * cancelling their own appointments. Every call names one of the patients on the signed-in mobile number.
 */
@Service
public class PortalService {
  private final JdbcClient db;
  private final AppointmentService appointments;
  private final AuditService audit;
  private final Clock clock;

  public PortalService(JdbcClient db, AppointmentService appointments, AuditService audit, Clock clock) {
    this.db = db; this.appointments = appointments; this.audit = audit; this.clock = clock;
  }

  public record Profile(String id, String name, LocalDate dob, String gender, String blood, List<String> allergies, List<String> conditions,
                        String branchId, String branchName, String primaryDoctorId, String primaryDoctorName, String insurer, LocalDate followUpDue, String followUpReason) {}
  public record Doctor(String id, String name, String deptId, String deptName, String branchId, String branchName, BigDecimal fee, int slotMin, String qualification) {}
  public record Appointment(String id, LocalDate date, String time, String doctorId, String doctorName, String deptName, String type, String status, String token, String room) {}
  public record Visit(String id, LocalDate date, String doctorName, List<String> diagnoses, String plan, String followUp) {}
  public record RxItem(String name, String strength, String dose, String frequency, String duration, String food, String instructions) {}
  public record Rx(String id, LocalDate date, String doctorName, String status, String diagnosis, String notes, List<RxItem> items) {}
  public record LabResult(String test, String param, BigDecimal value, String unit, BigDecimal low, BigDecimal high, String flag) {}
  public record Lab(String id, LocalDate date, String tests, String status, boolean ready, List<LabResult> results) {}
  public record Bill(String id, String number, LocalDate date, String kind, BigDecimal total, BigDecimal paid, BigDecimal due, String status) {}
  public record Records(List<Visit> visits, List<Rx> prescriptions, List<Lab> labs) {}

  private PatientAuthentication auth() {
    if (SecurityContextHolder.getContext().getAuthentication() instanceof PatientAuthentication p) return p;
    throw new ApiException(401, "Sign in to the patient portal");
  }

  /** The patient the request is about: the one named (if it is on this mobile number) or the first. */
  public String patient(String requested) {
    var a = auth();
    if (requested == null || requested.isBlank()) return a.patientIds().get(0);
    if (!a.patientIds().contains(requested)) throw new ApiException(404, "Patient not found");
    return requested;
  }

  private String branchOf(String patientId) {
    return db.sql("select branch_id from patient where id = :id").param("id", patientId).query(String.class).single();
  }

  private void audit(String patientId, String action, String entity, String detail) {
    audit.write(null, "Patient portal ******" + auth().mobile10().substring(6), "patient", branchOf(patientId), action, entity, patientId, detail);
  }

  public List<Profile> profiles() {
    LocalDate t = LocalDate.now(clock);
    return auth().patientIds().stream().map(id -> db.sql("""
        select p.id, p.name, p.dob, p.gender, p.blood, p.allergies, p.conditions, p.branch_id, b.name, p.primary_doctor_id, d.name,
               (select ip.name from billing_insurance_providers ip where ip.id = p.insurance ->> 'providerId'),
               (select c.follow_up_date from consultation c where c.patient_id = p.id and c.status = 'Completed' and c.follow_up_date >= :t - 30
                  and not exists (select 1 from appointment a where a.patient_id = c.patient_id and a.doctor_id = c.doctor_id and a.created_at >= c.completed_at
                                  and a.status not in ('Cancelled','No-show')) order by c.follow_up_date limit 1),
               (select coalesce(nullif(c.follow_up, ''), 'Review') from consultation c where c.patient_id = p.id and c.status = 'Completed' and c.follow_up_date >= :t - 30
                  and not exists (select 1 from appointment a where a.patient_id = c.patient_id and a.doctor_id = c.doctor_id and a.created_at >= c.completed_at
                                  and a.status not in ('Cancelled','No-show')) order by c.follow_up_date limit 1)
          from patient p join branch b on b.id = p.branch_id left join doctor d on d.id = p.primary_doctor_id where p.id = :id""")
        .param("id", id).param("t", t)
        .query((rs, n) -> new Profile(rs.getString(1), rs.getString(2), rs.getObject(3, LocalDate.class), rs.getString(4), rs.getString(5),
            Arrays.asList((String[]) rs.getArray(6).getArray()), Arrays.asList((String[]) rs.getArray(7).getArray()), rs.getString(8), rs.getString(9),
            rs.getString(10), rs.getString(11), rs.getString(12), rs.getObject(13, LocalDate.class), rs.getString(14))).single()).toList();
  }

  public List<Doctor> doctors() {
    return db.sql("""
        select d.id, d.name, d.dept_id, dp.name, d.branch_id, b.name, d.fee, d.slot_min, d.qualification
          from doctor d join department dp on dp.id = d.dept_id join branch b on b.id = d.branch_id
         where d.active and b.active order by b.id, dp.name, d.name""")
        .query((rs, n) -> new Doctor(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6),
            rs.getBigDecimal(7), rs.getInt(8), rs.getString(9))).list();
  }

  private String doctorBranch(String doctorId) {
    return db.sql("select branch_id from doctor where id = :id and active").param("id", doctorId).query(String.class).optional()
        .orElseThrow(() -> new ApiException(404, "Doctor not found"));
  }

  /** Free times for a doctor on a day (the patient sees only free or taken, not who booked). */
  public List<String> slots(String patientId, String doctorId, LocalDate date) {
    String p = patient(patientId);
    String db_ = doctorBranch(doctorId);
    var day = ActingAs.run("Patient portal", "patient", List.of(branchOf(p), db_), () -> appointments.slots(doctorId, date, null));
    return day.slots().stream().filter(Dtos.SlotView::ok).map(Dtos.SlotView::time).toList();
  }

  public List<Appointment> appointments(String patientId) {
    String p = patient(patientId);
    return db.sql("""
        select a.id, a.appt_date, to_char(a.start_time, 'HH24:MI'), a.doctor_id, d.name, dp.name, a.type, a.status, a.token, a.room
          from appointment a join doctor d on d.id = a.doctor_id join department dp on dp.id = a.dept_id
         where a.patient_id = :p order by a.appt_date desc, a.start_time desc limit 100""")
        .param("p", p)
        .query((rs, n) -> new Appointment(rs.getString(1), rs.getObject(2, LocalDate.class), rs.getString(3), rs.getString(4), rs.getString(5),
            rs.getString(6), rs.getString(7), rs.getString(8), rs.getString(9), rs.getString(10))).list();
  }

  @Transactional
  public Appointment book(String patientId, String doctorId, LocalDate date, String time, boolean teleconsult) {
    String p = patient(patientId);
    String docBranch = doctorBranch(doctorId);
    if (!date.isAfter(LocalDate.now(clock).minusDays(1))) throw new ApiException(400, "Choose today or a later date");
    int slot = db.sql("select slot_min from doctor where id = :id").param("id", doctorId).query(Integer.class).single();
    var r = ActingAs.run("Patient portal", "patient", List.of(branchOf(p), docBranch), () -> appointments.book(
        new Dtos.BookRequest(p, doctorId, date, time, slot, teleconsult ? "Teleconsult" : "New consultation", "Booked from the patient portal", null)));
    return appointments(p).stream().filter(a -> a.id().equals(r.appointment().id())).findFirst().orElseThrow();
  }

  @Transactional
  public void cancel(String patientId, String appointmentId) {
    String p = patient(patientId);
    record A(String patient, String branch, String status) {}
    var a = db.sql("select patient_id, branch_id, status from appointment where id = :id").param("id", appointmentId)
        .query((rs, n) -> new A(rs.getString(1), rs.getString(2), rs.getString(3))).optional();
    if (a.isEmpty() || !a.get().patient().equals(p)) throw new ApiException(404, "Appointment not found");
    if (!List.of("Scheduled", "Confirmed").contains(a.get().status())) throw new ApiException(409, "Only upcoming appointments can be cancelled online");
    ActingAs.run("Patient portal", "patient", List.of(branchOf(p), a.get().branch()), () -> appointments.setStatus(appointmentId, "Cancelled"));
  }

  public Records records(String patientId) {
    String p = patient(patientId);
    Map<String, List<String>> dx = new LinkedHashMap<>();
    db.sql("select x.consultation_id, x.label from consultation_diagnosis x join consultation c on c.id = x.consultation_id where c.patient_id = :p order by x.position")
        .param("p", p).query(rs -> { dx.computeIfAbsent(rs.getString(1), k -> new ArrayList<>()).add(rs.getString(2)); });
    var visits = db.sql("""
        select c.id, cast(c.completed_at as date), d.name, c.plan, c.follow_up from consultation c join doctor d on d.id = c.doctor_id
         where c.patient_id = :p and c.status = 'Completed' order by c.completed_at desc limit 50""")
        .param("p", p).query((rs, n) -> new Visit(rs.getString(1), rs.getObject(2, LocalDate.class), rs.getString(3),
            dx.getOrDefault(rs.getString(1), List.of()), rs.getString(4), rs.getString(5))).list();

    Map<UUID, List<RxItem>> items = new LinkedHashMap<>();
    db.sql("select i.prescription_id, i.name, i.strength, i.dose, i.frequency, i.duration, i.food, i.instructions from prescription_item i " +
            "join prescription x on x.id = i.prescription_id where x.patient_id = :p and x.status <> 'Draft' order by i.position")
        .param("p", p).query(rs -> { items.computeIfAbsent(rs.getObject(1, UUID.class), k -> new ArrayList<>())
            .add(new RxItem(rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8))); });
    var rx = db.sql("""
        select x.id, cast(coalesce(x.signed_at, x.created_at) as date), d.name, x.status, x.diagnosis, x.notes from prescription x
          join doctor d on d.id = x.doctor_id where x.patient_id = :p and x.status <> 'Draft' order by x.created_at desc limit 50""")
        .param("p", p).query((rs, n) -> new Rx(rs.getString(1), rs.getObject(2, LocalDate.class), rs.getString(3), rs.getString(4), rs.getString(5),
            rs.getString(6), items.getOrDefault(rs.getObject(1, UUID.class), List.of()))).list();

    // Results reach the patient only after the lab has verified them.
    Map<String, List<LabResult>> res = new LinkedHashMap<>();
    db.sql("""
        select r.order_id, t.name, r.param, r.value, tp.unit, tp.low, tp.high, r.flag from lab_result r join lab_order o on o.id = r.order_id
          join lab_test t on t.id = r.test_id left join lab_test_param tp on tp.test_id = r.test_id and tp.name = r.param
          left join lab_order_test ot on ot.order_id = r.order_id and ot.test_id = r.test_id
         where o.patient_id = :p and o.status in ('Verified','Delivered') order by r.order_id, ot.position, tp.position""")
        .param("p", p).query(rs -> { res.computeIfAbsent(rs.getString(1), k -> new ArrayList<>()).add(new LabResult(rs.getString(2), rs.getString(3),
            rs.getBigDecimal(4), rs.getString(5), rs.getBigDecimal(6), rs.getBigDecimal(7), rs.getString(8))); });
    var labs = db.sql("""
        select o.id, cast(o.ordered_at as date), (select string_agg(t.name, ', ' order by ot.position) from lab_order_test ot join lab_test t on t.id = ot.test_id where ot.order_id = o.id),
               o.status from lab_order o where o.patient_id = :p order by o.ordered_at desc limit 50""")
        .param("p", p).query((rs, n) -> {
          boolean ready = List.of("Verified", "Delivered").contains(rs.getString(4));
          return new Lab(rs.getString(1), rs.getObject(2, LocalDate.class), rs.getString(3), ready ? "Ready" : "Processing", ready,
              ready ? res.getOrDefault(rs.getString(1), List.of()) : List.of());
        }).list();
    audit(p, "Viewed", "Patient portal records", visits.size() + " visits, " + rx.size() + " prescriptions, " + labs.size() + " lab orders");
    return new Records(visits, rx, labs);
  }

  public List<Bill> bills(String patientId) {
    String p = patient(patientId);
    return db.sql("""
        select id, number, invoice_date, kind, total, paid - refunded, greatest(total - paid + refunded, 0), status from billing_invoices
         where patient_id = :p and status <> 'CANCELLED' order by invoice_date desc, number desc limit 100""")
        .param("p", p).query((rs, n) -> new Bill(rs.getString(1), rs.getString(2), rs.getObject(3, LocalDate.class), rs.getString(4),
            rs.getBigDecimal(5), rs.getBigDecimal(6), rs.getBigDecimal(7), rs.getString(8))).list();
  }

  @Transactional
  public void feedback(String patientId, int rating, String dept, String comment) {
    String p = patient(patientId);
    if (rating < 1 || rating > 5) throw new ApiException(400, "Rate from 1 to 5 stars");
    db.sql("insert into portal_feedback (patient_id, branch_id, rating, dept, comment) values (:p, :b, :r, :d, :c)")
        .param("p", p).param("b", branchOf(p)).param("r", rating).param("d", dept == null ? "" : dept.trim())
        .param("c", comment == null ? "" : comment.trim().substring(0, Math.min(comment.trim().length(), 2000))).update();
  }
}
