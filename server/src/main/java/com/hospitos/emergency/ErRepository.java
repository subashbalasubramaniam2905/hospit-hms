package com.hospitos.emergency;

import com.hospitos.emergency.ErDtos.Bay;
import com.hospitos.emergency.ErDtos.ErCase;
import com.hospitos.emergency.ErDtos.Event;
import com.hospitos.emergency.ErDtos.Vitals;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class ErRepository {
  private static final DateTimeFormatter HM = DateTimeFormatter.ofPattern("HH:mm");
  private final JdbcClient db;
  /** Clinic time zone, for the arrival and timeline times shown on screens. */
  private final ZoneId zone;
  public ErRepository(JdbcClient db, Clock clock) { this.db = db; this.zone = clock.getZone(); }

  public record PatientBrief(String id, String name, String branchId) {}

  public Optional<PatientBrief> patient(String id) {
    return db.sql("select id, name, branch_id from patient where id = ?").param(id)
        .query((r, i) -> new PatientBrief(r.getString("id"), r.getString("name"), r.getString("branch_id"))).optional();
  }

  public Optional<String> doctorName(String id) {
    return db.sql("select name from doctor where id = ? and active").param(id).query(String.class).optional();
  }

  public List<Bay> bays(String branchId) {
    return db.sql("""
        select b.name, b.kind, c.id as case_id from er_bay b
        left join er_case c on c.branch_id = b.branch_id and c.bay = b.name and c.closed_at is null
        where b.branch_id = ? and b.active order by b.position""").param(branchId)
        .query((r, i) -> new Bay(r.getString("name"), r.getString("kind"), r.getString("case_id"))).list();
  }

  public boolean bayExists(String branchId, String bay) {
    return db.sql("select count(*) from er_bay where branch_id = ? and name = ? and active").params(branchId, bay).query(Integer.class).single() > 0;
  }

  /** The open case in a bay, other than the given one. */
  public Optional<String> bayTakenBy(String branchId, String bay, String exceptCase) {
    return db.sql("select id from er_case where branch_id = ? and bay = ? and closed_at is null and id <> ?")
        .params(branchId, bay, exceptCase == null ? "" : exceptCase).query(String.class).optional();
  }

  public String nextId() { return "ER-" + db.sql("select nextval('er_case_seq')").query(Long.class).single(); }

  public void insert(String id, String branchId, String patientId, String label, Integer age, String gender, String mode, String triage,
                     String suggested, String complaint, String bay, String doctorId, Vitals v, UUID by) {
    db.sql("""
        insert into er_case (id, branch_id, patient_id, label, age, gender, arrival_mode, triage, suggested_triage, complaint, bay,
          doctor_id, bp, hr, spo2, gcs, temp, created_by)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
        .params(id, branchId, patientId, label, age, gender, mode, triage, suggested, complaint, bay, doctorId,
            v.bp() == null ? "" : v.bp().trim(), v.hr(), v.spo2(), v.gcs(), v.temp(), by).update();
  }

  /** Runs an update on an open case and bumps its version. Returns false when the case is already closed. */
  public boolean updateOpen(String id, String setSql, Object... args) {
    var p = new ArrayList<Object>(List.of(args));
    p.add(id);
    return db.sql("update er_case set " + setSql + ", version = version + 1, updated_at = now() where id = ? and closed_at is null")
        .params(p).update() == 1;
  }

  /** Closes an open case with a final status. */
  public boolean close(String id, String status, String note, String admissionId) {
    return db.sql("""
        update er_case set status = ?, closed_at = now(), disposition_note = ?, admission_id = coalesce(?, admission_id),
          version = version + 1, updated_at = now()
        where id = ? and closed_at is null""").params(status, note, admissionId, id).update() == 1;
  }

  public void setAdmission(String id, String admissionId) {
    db.sql("update er_case set admission_id = ?, version = version + 1, updated_at = now() where id = ?").params(admissionId, id).update();
  }

  public int linkPatient(String id, String patientId, String name) {
    return db.sql("update er_case set patient_id = ?, label = ?, version = version + 1, updated_at = now() where id = ? and patient_id is null")
        .params(patientId, name, id).update();
  }

  public boolean addOrder(String caseId, String name, String by) {
    return db.sql("""
        insert into er_order (case_id, position, name, ordered_by)
        values (?, (select coalesce(max(position), 0) + 1 from er_order where case_id = ?), ?, ?)
        on conflict (case_id, name) do nothing""").params(caseId, caseId, name, by).update() == 1;
  }

  public void event(String caseId, String by, String event) {
    db.sql("insert into er_event (case_id, by_name, event) values (?, ?, ?)").params(caseId, by, event).update();
  }

  // ---------- reads ----------

  private static final String SELECT = """
      select c.*, d.name as doctor_name,
        (select array_agg(o.name order by o.position) from er_order o where o.case_id = c.id) as orders
      from er_case c left join doctor d on d.id = c.doctor_id
      """;

  public Optional<ErCase> find(String id) {
    return withTimeline(db.sql(SELECT + " where c.id = ?").param(id).query(ErRepository::row).list()).stream().findFirst();
  }

  /**
   * Cases of one branch: every open case plus cases closed since the given time (for the "admitted today" count),
   * or one patient's ER visits when patientId is given.
   */
  public List<ErCase> search(String branchId, OffsetDateTime closedSince, String patientId, int limit) {
    if (patientId != null)
      return withTimeline(db.sql(SELECT + " where c.patient_id = ? order by c.arrived_at desc limit ?").params(patientId, limit)
          .query(ErRepository::row).list());
    return withTimeline(db.sql(SELECT + " where c.branch_id = ? and (c.closed_at is null or c.closed_at >= ?) order by c.arrived_at desc limit ?")
        .params(branchId, closedSince, limit).query(ErRepository::row).list());
  }

  private record Row(ErCase c) {}

  private static Row row(ResultSet r, int i) throws SQLException {
    var orders = r.getArray("orders");
    var arrived = r.getObject("arrived_at", OffsetDateTime.class);
    return new Row(new ErCase(r.getString("id"), r.getString("branch_id"), r.getString("patient_id"), r.getString("label"),
        (Integer) r.getObject("age"), r.getString("gender"), null, arrived, r.getString("arrival_mode"), r.getString("triage"),
        r.getString("suggested_triage"), r.getString("complaint"), r.getString("bay"), r.getString("doctor_id"), r.getString("doctor_name"),
        new Vitals(r.getString("bp"), (Integer) r.getObject("hr"), (Integer) r.getObject("spo2"), (Integer) r.getObject("gcs"),
            r.getBigDecimal("temp")),
        r.getString("status"), orders == null ? List.of() : List.of((String[]) orders.getArray()), List.of(), r.getString("admission_id"),
        r.getObject("closed_at", OffsetDateTime.class), r.getString("disposition_note"), r.getInt("version")));
  }

  private List<ErCase> withTimeline(List<Row> rows) {
    if (rows.isEmpty()) return List.of();
    var events = new HashMap<String, List<Event>>();
    db.sql("select case_id, at, by_name, event from er_event where case_id = any(?) order by at, id")
        .param(rows.stream().map(x -> x.c().id()).toArray(String[]::new))
        .query((r, i) -> Map.entry(r.getString("case_id"), new Event(
            r.getObject("at", OffsetDateTime.class).atZoneSameInstant(zone).format(HM), r.getString("by_name"), r.getString("event"))))
        .list().forEach(e -> events.computeIfAbsent(e.getKey(), k -> new ArrayList<>()).add(e.getValue()));
    return rows.stream().map(Row::c).map(c -> new ErCase(c.id(), c.branchId(), c.patientId(), c.label(), c.age(), c.gender(),
        c.arrivedAt().atZoneSameInstant(zone).format(HM), c.arrivedAt(), c.mode(), c.triage(), c.suggestedTriage(), c.complaint(), c.bay(),
        c.doctorId(), c.doctorName(), c.vitals(), c.status(), c.orders(), events.getOrDefault(c.id(), List.of()), c.admissionId(),
        c.closedAt(), c.dispositionNote(), c.version())).toList();
  }
}
