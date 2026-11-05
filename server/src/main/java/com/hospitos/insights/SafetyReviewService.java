package com.hospitos.insights;

import com.hospitos.audit.AuditService;
import com.hospitos.clinical.safety.DrugLine;
import com.hospitos.clinical.safety.SafetyService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Runs the clinical module's safety screen (allergies, interactions, duplicates) across prescriptions that have been signed in the
 * last 30 days and are not fully dispensed, so pharmacists and doctors can review what was flagged or overridden.
 */
@Service
public class SafetyReviewService {
  private final JdbcClient db;
  private final Scope scope;
  private final SafetyService safety;
  private final AuditService audit;
  public SafetyReviewService(JdbcClient db, Scope scope, SafetyService safety, AuditService audit) {
    this.db = db; this.scope = scope; this.safety = safety; this.audit = audit;
  }

  public record Row(String key, String prescriptionId, String alertCode, String level, String kind, String title, String detail,
                    List<String> medicines, String patientId, String patientName, String doctorId, String doctorName, String status,
                    LocalDate date, String overrideReason) {}
  public record Result(List<Row> alerts, int checked, int patientsWithAllergies, List<Reviewed> reviewed) {}
  public record Reviewed(String prescriptionId, String alertCode, String outcome, String note, String at) {}

  public static final Set<String> OUTCOMES = Set.of("Prescriber contacted, change agreed", "Prescriber confirmed, continue with monitoring",
      "Not relevant for this patient", "Prescription put on hold");

  public Result list(String branch) {
    String[] br = scope.branches(branch);
    LocalDate t = scope.today();
    record Rx(UUID id, String patientId, String patientName, String[] allergies, String doctorId, String doctorName, String status, LocalDate date) {}
    var rxs = db.sql("""
        select x.id, x.patient_id, p.name, p.allergies, x.doctor_id, d.name, x.status, cast(coalesce(x.signed_at, x.created_at) as date)
          from prescription x join patient p on p.id = x.patient_id join doctor d on d.id = x.doctor_id
         where x.status in ('Signed','Sent to pharmacy','Partially dispensed') and x.created_at >= :since and""" + Scope.in("x") + """
         order by x.created_at desc limit 500""")
        .param("since", scope.startOf(t.minusDays(30))).param("br", br)
        .query((rs, n) -> new Rx(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), (String[]) rs.getArray(4).getArray(),
            rs.getString(5), rs.getString(6), rs.getString(7), rs.getObject(8, LocalDate.class))).list();
    Map<UUID, List<DrugLine>> items = new LinkedHashMap<>();
    Map<String, String> overrides = new LinkedHashMap<>(), reviewed = new LinkedHashMap<>();
    if (!rxs.isEmpty()) {
      UUID[] ids = rxs.stream().map(Rx::id).toArray(UUID[]::new);
      db.sql("select prescription_id, name, generic from prescription_item where prescription_id = any(:ids) order by position")
          .param("ids", ids).query(rs -> { items.computeIfAbsent(rs.getObject(1, UUID.class), k -> new ArrayList<>()).add(new DrugLine(rs.getString(2), rs.getString(3))); });
      db.sql("select prescription_id, alert_code, reason from prescription_override where prescription_id = any(:ids)")
          .param("ids", ids).query(rs -> { overrides.put(rs.getString(1) + ":" + rs.getString(2), rs.getString(3)); });
      db.sql("select prescription_id, alert_code from safety_review where prescription_id = any(:ids)")
          .param("ids", ids).query(rs -> { reviewed.put(rs.getString(1) + ":" + rs.getString(2), ""); });
    }
    var rows = new ArrayList<Row>();
    for (Rx rx : rxs) {
      for (var a : safety.check(Arrays.asList(rx.allergies()), items.getOrDefault(rx.id(), List.of()))) {
        String key = rx.id() + ":" + a.code();
        if (reviewed.containsKey(key)) continue;
        rows.add(new Row(key, rx.id().toString(), a.code(), a.level(), a.kind(), a.title(), a.detail(), a.medicines(), rx.patientId(), rx.patientName(),
            rx.doctorId(), rx.doctorName(), rx.status(), rx.date(), overrides.get(key)));
      }
    }
    int allergic = db.sql("select count(*) from patient p where cardinality(allergies) > 0 and " + Scope.in("p")).param("br", br).query(Integer.class).single();
    var done = db.sql("""
        select r.prescription_id, r.alert_code, r.outcome, r.note, to_char(r.reviewed_at, 'YYYY-MM-DD HH24:MI') from safety_review r
          join prescription x on x.id = r.prescription_id where r.reviewed_at >= :since and""" + Scope.in("x") + " order by r.reviewed_at desc limit 20")
        .param("since", scope.startOf(t.minusDays(7))).param("br", br)
        .query((rs, n) -> new Reviewed(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5))).list();
    return new Result(rows, rxs.size(), allergic, done);
  }

  /** Records the outcome of reviewing one alert. Putting a prescription on hold is recorded here; the pharmacy acts on it. */
  @Transactional
  public void review(UUID prescriptionId, String alertCode, String outcome, String note) {
    if (!OUTCOMES.contains(outcome)) throw new ApiException(400, "Unknown outcome");
    var branch = db.sql("select branch_id from prescription where id = :id").param("id", prescriptionId).query(String.class).optional();
    var me = CurrentUser.get();
    if (branch.isEmpty() || !me.canSee(branch.get())) throw new ApiException(404, "Prescription not found");
    int n = db.sql("""
        insert into safety_review (prescription_id, alert_code, outcome, note, reviewed_by) values (:id, :code, :o, :n, :by)
        on conflict (prescription_id, alert_code) do nothing""")
        .param("id", prescriptionId).param("code", alertCode).param("o", outcome).param("n", note == null ? "" : note.trim()).param("by", me.id()).update();
    if (n == 0) throw new ApiException(409, "This alert has already been reviewed");
    audit.logForBranch(branch.get(), "Reviewed", "Safety alert", prescriptionId + ":" + alertCode, outcome + (note == null || note.isBlank() ? "" : " · " + note.trim()));
  }
}
