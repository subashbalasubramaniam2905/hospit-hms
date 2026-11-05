package com.hospitos.ot;

import com.hospitos.ot.OtDtos.Event;
import com.hospitos.ot.OtDtos.Surgery;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class OtRepository {
  private static final DateTimeFormatter HM = DateTimeFormatter.ofPattern("HH:mm");
  private final JdbcClient db;
  private final ZoneId zone;
  public OtRepository(JdbcClient db, Clock clock) { this.db = db; this.zone = clock.getZone(); }

  public record PatientBrief(String id, String name, String branchId) {}
  /** A live booking that overlaps the requested slot. */
  public record Clash(String id, String procedure, String room, String surgeonName, LocalDateTime startsAt, int durationMin, boolean sameRoom) {}

  public Optional<PatientBrief> patient(String id) {
    return db.sql("select id, name, branch_id from patient where id = ?").param(id)
        .query((r, i) -> new PatientBrief(r.getString("id"), r.getString("name"), r.getString("branch_id"))).optional();
  }

  public Optional<String> doctorName(String id) {
    return db.sql("select name from doctor where id = ? and active").param(id).query(String.class).optional();
  }

  public List<String> rooms(String branchId) {
    return db.sql("select name from ot_room where branch_id = ? and active order by position").param(branchId).query(String.class).list();
  }

  /** Non-cancelled bookings that overlap [start, end) in the same room, or with the same surgeon in any room of any branch. */
  public List<Clash> clashes(String branchId, String room, String surgeonId, LocalDateTime start, LocalDateTime end, String except) {
    return db.sql("""
        select s.id, s.procedure, s.room, d.name as surgeon, s.starts_at,
          (extract(epoch from s.ends_at - s.starts_at) / 60)::int as dur, (s.branch_id = ? and s.room = ?) as same_room
        from surgery s join doctor d on d.id = s.surgeon_id
        where s.status <> 'Cancelled' and s.id <> ? and s.starts_at < ? and s.ends_at > ?
          and ((s.branch_id = ? and s.room = ?) or s.surgeon_id = ?)
        order by same_room desc, s.starts_at""")
        .params(branchId, room, except == null ? "" : except, end, start, branchId, room, surgeonId)
        .query((r, i) -> new Clash(r.getString("id"), r.getString("procedure"), r.getString("room"), r.getString("surgeon"),
            r.getObject("starts_at", LocalDateTime.class), r.getInt("dur"),
            r.getBoolean("same_room"))).list();
  }

  public String nextId() { return String.format("OT%04d", db.sql("select nextval('surgery_seq')").query(Long.class).single()); }

  public void insert(String id, String branchId, String patientId, String surgeonId, String anaesthetist, String anaesthesia, String room,
                     LocalDateTime start, LocalDateTime end, String procedure, String admissionId, UUID by, List<String> checklist) {
    db.sql("""
        insert into surgery (id, branch_id, patient_id, surgeon_id, anaesthetist, anaesthesia, room, starts_at, ends_at, procedure, admission_id, created_by)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
        .params(id, branchId, patientId, surgeonId, anaesthetist, anaesthesia, room, start, end, procedure, admissionId, by).update();
    int pos = 0;
    for (String item : checklist)
      db.sql("insert into surgery_check (surgery_id, position, item) values (?, ?, ?)").params(id, ++pos, item).update();
  }

  /** Moves a booking from one status to the next only if it is still in the expected one. */
  public boolean transition(String id, String from, String to, String setSql, Object... args) {
    var p = new ArrayList<Object>();
    p.add(to);
    p.addAll(List.of(args));
    p.add(id);
    p.add(from);
    return db.sql("update surgery set status = ?, version = version + 1, updated_at = now()" + (setSql.isEmpty() ? "" : ", " + setSql)
        + " where id = ? and status = ?").params(p).update() == 1;
  }

  public int setCheck(String id, String item, boolean done, String by) {
    db.sql("update surgery set version = version + 1, updated_at = now() where id = ?").param(id).update();
    return db.sql("""
        update surgery_check set done = ?, done_by = case when ? then ? end, done_at = case when ? then now() end
        where surgery_id = ? and item = ?""").params(done, done, by, done, id, item).update();
  }

  public void setNotes(String id, String notes) {
    db.sql("update surgery set post_op_notes = ?, version = version + 1, updated_at = now() where id = ?").params(notes, id).update();
  }

  public void event(String id, String by, String event) {
    db.sql("insert into surgery_event (surgery_id, by_name, event) values (?, ?, ?)").params(id, by, event).update();
  }

  // ---------- reads ----------

  private static final String SELECT = """
      select s.*, p.name as patient_name, p.allergies, d.name as surgeon_name,
        (extract(epoch from s.ends_at - s.starts_at) / 60)::int as duration_min
      from surgery s join patient p on p.id = s.patient_id join doctor d on d.id = s.surgeon_id
      """;

  public Optional<Surgery> find(String id) {
    return assemble(db.sql(SELECT + " where s.id = ?").param(id).query(OtRepository::row).list()).stream().findFirst();
  }

  /** Bookings starting on the given days, in a set of branches (null = every branch), or one patient's when patientId is set. */
  public List<Surgery> search(List<String> branches, LocalDate from, LocalDate to, String patientId) {
    var sql = new StringBuilder(SELECT).append(" where s.starts_at >= ? and s.starts_at < ?");
    var p = new ArrayList<Object>(List.of(from.atStartOfDay(), to.plusDays(1).atStartOfDay()));
    if (branches != null) { sql.append(" and s.branch_id = any(?)"); p.add(branches.toArray(String[]::new)); }
    if (patientId != null) { sql.append(" and s.patient_id = ?"); p.add(patientId); }
    sql.append(" order by s.starts_at, s.room limit 1000");
    return assemble(db.sql(sql.toString()).params(p).query(OtRepository::row).list());
  }

  private record Row(Surgery s) {}

  private static Row row(ResultSet r, int i) throws SQLException {
    var start = r.getObject("starts_at", LocalDateTime.class);
    var allergies = r.getArray("allergies");
    return new Row(new Surgery(r.getString("id"), r.getString("branch_id"), r.getString("patient_id"), r.getString("patient_name"),
        allergies == null ? List.of() : List.of((String[]) allergies.getArray()), r.getString("surgeon_id"), r.getString("surgeon_name"),
        r.getString("anaesthetist"), r.getString("anaesthesia"), r.getString("room"), start.toLocalDate(), start.format(HM),
        r.getInt("duration_min"), r.getString("procedure"), r.getString("status"), Map.of(), r.getString("post_op_notes"),
        r.getString("cancel_reason"), List.of(), r.getString("admission_id"), r.getInt("version")));
  }

  private List<Surgery> assemble(List<Row> rows) {
    if (rows.isEmpty()) return List.of();
    String[] ids = rows.stream().map(x -> x.s().id()).toArray(String[]::new);
    var checks = new HashMap<String, Map<String, Boolean>>();
    db.sql("select surgery_id, item, done from surgery_check where surgery_id = any(?) order by surgery_id, position").param(ids)
        .query((r, i) -> { checks.computeIfAbsent(r.getString("surgery_id"), k -> new LinkedHashMap<>()).put(r.getString("item"), r.getBoolean("done")); return 0; })
        .list();
    var events = new HashMap<String, List<Event>>();
    db.sql("select surgery_id, at, by_name, event from surgery_event where surgery_id = any(?) order by at, id").param(ids)
        .query((r, i) -> Map.entry(r.getString("surgery_id"), new Event(
            r.getObject("at", OffsetDateTime.class).atZoneSameInstant(zone).format(HM), r.getString("by_name"), r.getString("event"))))
        .list().forEach(e -> events.computeIfAbsent(e.getKey(), k -> new ArrayList<>()).add(e.getValue()));
    return rows.stream().map(Row::s).map(s -> new Surgery(s.id(), s.branchId(), s.patientId(), s.patientName(), s.patientAllergies(),
        s.surgeonId(), s.surgeonName(), s.anaesthetist(), s.anaesthesia(), s.room(), s.date(), s.start(), s.durationMin(), s.procedure(),
        s.status(), checks.getOrDefault(s.id(), Map.of()), s.postOpNotes(), s.cancelReason(), events.getOrDefault(s.id(), List.of()),
        s.admissionId(), s.version())).toList();
  }
}
