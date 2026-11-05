package com.hospitos.ipd;

import com.hospitos.ipd.IpdDtos.Admission;
import com.hospitos.ipd.IpdDtos.Bed;
import com.hospitos.ipd.IpdDtos.Charge;
import com.hospitos.ipd.IpdDtos.Deposit;
import com.hospitos.ipd.IpdDtos.Io;
import com.hospitos.ipd.IpdDtos.Mar;
import com.hospitos.ipd.IpdDtos.Note;
import com.hospitos.ipd.IpdDtos.Obs;
import com.hospitos.ipd.IpdDtos.Ward;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class IpdRepository {
  private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
  private static final DateTimeFormatter HM = DateTimeFormatter.ofPattern("HH:mm");
  private final JdbcClient db;
  private final ZoneId zone;
  private final java.time.Clock clock;
  public IpdRepository(JdbcClient db, java.time.Clock clock) { this.db = db; this.clock = clock; this.zone = clock.getZone(); }

  String stamp(OffsetDateTime t) { return t == null ? null : t.atZoneSameInstant(zone).format(STAMP); }
  private String hm(OffsetDateTime t) { return t.atZoneSameInstant(zone).format(HM); }

  // ---------- wards and beds ----------

  private static Ward ward(ResultSet r) throws SQLException {
    return new Ward(r.getString("id"), r.getString("branch_id"), r.getString("name"), r.getString("type"), r.getString("floor"),
        r.getBigDecimal("rate"), r.getBoolean("active"));
  }

  public List<Ward> wards(String branchId, boolean includeInactive) {
    return db.sql("select * from ward where branch_id = ? and (? or active) order by position, name").params(branchId, includeInactive)
        .query((r, i) -> ward(r)).list();
  }

  public Optional<Ward> ward(String id) { return db.sql("select * from ward where id = ?").param(id).query((r, i) -> ward(r)).optional(); }

  public int nextWardPosition(String branchId) {
    return db.sql("select coalesce(max(position), 0) + 1 from ward where branch_id = ?").param(branchId).query(Integer.class).single();
  }

  public String nextWardId(String branchId) {
    int n = db.sql("select count(*) + 1 from ward where branch_id = ?").param(branchId).query(Integer.class).single();
    while (ward(branchId + "-W" + n).isPresent()) n++;
    return branchId + "-W" + n;
  }

  public void insertWard(String id, String branchId, String name, String type, String floor, BigDecimal rate, int position) {
    db.sql("insert into ward (id, branch_id, name, type, floor, rate, position) values (?, ?, ?, ?, ?, ?, ?)")
        .params(id, branchId, name, type, floor, rate, position).update();
  }

  public void updateWard(String id, String name, String type, String floor, BigDecimal rate, boolean active) {
    db.sql("update ward set name = ?, type = ?, floor = ?, rate = ?, active = ? where id = ?").params(name, type, floor, rate, active, id).update();
  }

  private static final String BED_SELECT = "select b.*, w.branch_id from bed b join ward w on w.id = b.ward_id ";

  private static Bed bed(ResultSet r) throws SQLException {
    return new Bed(r.getString("id"), r.getString("ward_id"), r.getString("branch_id"), r.getString("label"), r.getString("status"),
        r.getString("admission_id"), r.getBoolean("active"));
  }

  public List<Bed> beds(String branchId) {
    return db.sql(BED_SELECT + "where w.branch_id = ? and w.active and b.active order by w.position, b.position, b.label").param(branchId)
        .query((r, i) -> bed(r)).list();
  }

  public Optional<Bed> bed(String id) { return db.sql(BED_SELECT + "where b.id = ?").param(id).query((r, i) -> bed(r)).optional(); }

  public Optional<Bed> bedForUpdate(String id) {
    return db.sql(BED_SELECT + "where b.id = ? for update of b").param(id).query((r, i) -> bed(r)).optional();
  }

  public String insertBed(String wardId, String label) {
    int n = db.sql("select count(*) + 1 from bed where ward_id = ?").param(wardId).query(Integer.class).single();
    while (bed(wardId + "-B" + n).isPresent()) n++;
    String id = wardId + "-B" + n;
    db.sql("insert into bed (id, ward_id, label, position) values (?, ?, ?, ?)").params(id, wardId, label, n).update();
    return id;
  }

  public boolean labelTaken(String branchId, String label) {
    return db.sql("select count(*) > 0 from bed b join ward w on w.id = b.ward_id where w.branch_id = ? and lower(b.label) = lower(?)")
        .params(branchId, label).query(Boolean.class).single();
  }

  /** Changes a free bed's status. False when the bed is occupied. */
  public boolean setFreeBedStatus(String bedId, String status) {
    return db.sql("update bed set status = ? where id = ? and admission_id is null").params(status, bedId).update() == 1;
  }

  /** Puts the admission in the bed if it is available or reserved. False when someone else took it. */
  public boolean occupy(String bedId, String admissionId) {
    return db.sql("update bed set status = 'Occupied', admission_id = ? where id = ? and active and status in ('Available','Reserved')")
        .params(admissionId, bedId).update() == 1;
  }

  /** Empties the bed and sends it for cleaning. */
  public void vacate(String bedId, String admissionId) {
    db.sql("update bed set status = 'Cleaning', admission_id = null where id = ? and admission_id = ?").params(bedId, admissionId).update();
  }

  // ---------- admissions ----------

  public String nextAdmissionId() { return String.format("IPD-%05d", db.sql("select nextval('admission_seq')").query(Long.class).single()); }
  public String nextReceipt(String prefix) {
    return String.format("%s-%06d", prefix, db.sql("select nextval('ipd_receipt_seq')").query(Long.class).single());
  }

  public void insertAdmission(String id, String branchId, String patientId, String doctorId, String deptId, String bedId, String type,
                              String reason, String diagnosis, LocalDate expected, OffsetDateTime at, UUID by, String erCaseId) {
    db.sql("""
        insert into admission (id, branch_id, patient_id, doctor_id, dept_id, bed_id, type, reason, diagnosis, expected_discharge,
          admitted_at, admitted_by, er_case_id)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
        .params(id, branchId, patientId, doctorId, deptId, bedId, type, reason, diagnosis, expected, at, by, erCaseId).update();
  }

  public boolean hasOpenAdmission(String patientId) {
    return db.sql("select count(*) > 0 from admission where patient_id = ? and status <> 'Discharged'").param(patientId).query(Boolean.class).single();
  }

  /** Header fields the service needs to check before changing an admission. */
  public record Head(String id, String branchId, String patientId, String patientName, String doctorId, String bedId, String type,
                     String status, OffsetDateTime admittedAt, LocalDate expectedDischarge, String diagnosis, int version) {}

  private static Head head(ResultSet r) throws SQLException {
    return new Head(r.getString("id"), r.getString("branch_id"), r.getString("patient_id"), r.getString("patient_name"),
        r.getString("doctor_id"), r.getString("bed_id"), r.getString("type"), r.getString("status"),
        r.getObject("admitted_at", OffsetDateTime.class), r.getObject("expected_discharge", LocalDate.class), r.getString("diagnosis"),
        r.getInt("version"));
  }

  public Optional<Head> head(String id, boolean lock) {
    return db.sql("select a.*, p.name as patient_name from admission a join patient p on p.id = a.patient_id where a.id = ?"
            + (lock ? " for update of a" : "")).param(id).query((r, i) -> head(r)).optional();
  }

  public void setBed(String admissionId, String bedId) {
    db.sql("update admission set bed_id = ?, version = version + 1 where id = ?").params(bedId, admissionId).update();
  }

  public void setStatus(String admissionId, String status) {
    db.sql("update admission set status = ?, version = version + 1 where id = ?").params(status, admissionId).update();
  }

  public void setClaim(String admissionId, UUID claimId) {
    db.sql("update admission set claim_id = ? where id = ?").params(claimId, admissionId).update();
  }

  public boolean update(String id, String diagnosis, LocalDate expected, int version) {
    return db.sql("""
        update admission set diagnosis = coalesce(?, diagnosis), expected_discharge = coalesce(?, expected_discharge), version = version + 1
        where id = ? and version = ? and status <> 'Discharged'""").params(diagnosis, expected, id, version).update() == 1;
  }

  public void discharge(String id, OffsetDateTime at, UUID by, String byName, String summary, List<String> checklist, UUID invoiceId,
                        String invoiceNumber) {
    db.sql("""
        update admission set status = 'Discharged', discharged_at = ?, discharged_by = ?, discharged_by_name = ?, discharge_summary = ?,
          discharge_checklist = ?, invoice_id = ?, invoice_number = ?, version = version + 1 where id = ?""")
        .params(at, by, byName, summary, checklist.toArray(String[]::new), invoiceId, invoiceNumber, id).update();
  }

  // ---------- bed stays ----------

  public void openStay(String admissionId, String bedId, OffsetDateTime at) {
    db.sql("""
        insert into bed_stay (admission_id, bed_id, ward_id, ward_name, rate, from_at)
        select ?, b.id, w.id, w.name, w.rate, ? from bed b join ward w on w.id = b.ward_id where b.id = ?""")
        .params(admissionId, at, bedId).update();
  }

  public void closeStay(String admissionId, OffsetDateTime at) {
    db.sql("update bed_stay set to_at = ? where admission_id = ? and to_at is null").params(at, admissionId).update();
  }

  public List<RoomDays.Stay> stays(String admissionId) {
    return db.sql("select ward_name, rate, from_at from bed_stay where admission_id = ? order by from_at").param(admissionId)
        .query((r, i) -> new RoomDays.Stay(r.getString("ward_name"), r.getBigDecimal("rate"), r.getObject("from_at", OffsetDateTime.class).toInstant()))
        .list();
  }

  // ---------- records ----------

  public void insertNote(String admissionId, String type, String text, String author, UUID authorId, OffsetDateTime at) {
    db.sql("insert into ipd_note (admission_id, type, text, author, author_id, at) values (?, ?, ?, ?, ?, ?)")
        .params(admissionId, type, text, author, authorId, at).update();
  }

  public int countNotes(String admissionId, String type) {
    return db.sql("select count(*) from ipd_note where admission_id = ? and type = ?").params(admissionId, type).query(Integer.class).single();
  }

  public void insertCarePlan(String admissionId, String text, String by, OffsetDateTime at) {
    db.sql("insert into ipd_care_plan (admission_id, text, added_by, at) values (?, ?, ?, ?)").params(admissionId, text, by, at).update();
  }

  public UUID insertMar(String admissionId, String med, String dose, String route, LocalDate date, String time, String by, UUID byId,
                        OffsetDateTime at) {
    return db.sql("""
        insert into ipd_mar (admission_id, med, dose, route, date, time, ordered_by, ordered_by_id, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?) returning id""").params(admissionId, med, dose, route, date, time, by, byId, at)
        .query(UUID.class).single();
  }

  /** Records a dose as given, held or missed. False when it was not due (already recorded) or belongs to another admission. */
  public boolean setMar(UUID marId, String admissionId, String status, String by, UUID byId, OffsetDateTime at, String note) {
    return db.sql("""
        update ipd_mar set status = ?, done_by = ?, done_by_id = ?, done_at = ?, note = ?
        where id = ? and admission_id = ? and status = 'Due'""").params(status, by, byId, at, note, marId, admissionId).update() == 1;
  }

  public Optional<String> marMed(UUID marId, String admissionId) {
    return db.sql("select med from ipd_mar where id = ? and admission_id = ?").params(marId, admissionId).query(String.class).optional();
  }

  public void insertObs(String admissionId, OffsetDateTime at, String bp, int hr, BigDecimal temp, int spo2, int rr, int pain, int news,
                        String by, UUID byId) {
    db.sql("""
        insert into ipd_obs (admission_id, at, bp, hr, temp, spo2, rr, pain, news, by_name, by_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
        .params(admissionId, at, bp, hr, temp, spo2, rr, pain, news, by, byId).update();
  }

  public void insertIo(String admissionId, OffsetDateTime at, String kind, String type, int ml, String by, UUID byId) {
    db.sql("insert into ipd_io (admission_id, at, kind, type, ml, by_name, by_id) values (?, ?, ?, ?, ?, ?, ?)")
        .params(admissionId, at, kind, type, ml, by, byId).update();
  }

  public void insertDeposit(String admissionId, String kind, String receiptNo, BigDecimal amount, String mode, String reference,
                            String by, UUID byId, OffsetDateTime at) {
    db.sql("""
        insert into ipd_deposit (admission_id, kind, receipt_no, amount, mode, reference, by_name, by_id, at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)""").params(admissionId, kind, receiptNo, amount, mode, reference, by, byId, at).update();
  }

  /** Deposits received minus refunds and amounts adjusted against the final bill. */
  public BigDecimal depositBalance(String admissionId) {
    return db.sql("""
        select coalesce(sum(case when kind = 'DEPOSIT' then amount else -amount end), 0) from ipd_deposit where admission_id = ?""")
        .param(admissionId).query(BigDecimal.class).single();
  }

  public BigDecimal deposited(String admissionId) {
    return db.sql("select coalesce(sum(amount), 0) from ipd_deposit where admission_id = ? and kind = 'DEPOSIT'")
        .param(admissionId).query(BigDecimal.class).single();
  }

  public UUID insertCharge(String admissionId, String tariffCode, String description, String category, BigDecimal qty, BigDecimal rate,
                           String by, UUID byId, OffsetDateTime at) {
    return db.sql("""
        insert into ipd_charge (admission_id, tariff_code, description, category, qty, rate, by_name, by_id, at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?) returning id""").params(admissionId, tariffCode, description, category, qty, rate, by, byId, at)
        .query(UUID.class).single();
  }

  public boolean cancelCharge(UUID chargeId, String admissionId) {
    return db.sql("update ipd_charge set cancelled = true where id = ? and admission_id = ? and not cancelled")
        .params(chargeId, admissionId).update() == 1;
  }

  public List<Charge> charges(String admissionId) {
    return db.sql("select * from ipd_charge where admission_id = ? and not cancelled order by at, seq").param(admissionId)
        .query((r, i) -> charge(r)).list();
  }

  private static Charge charge(ResultSet r) throws SQLException {
    return new Charge((UUID) r.getObject("id"), r.getString("tariff_code"), r.getString("description"), r.getString("category"),
        r.getBigDecimal("qty"), r.getBigDecimal("rate"), r.getString("by_name"), r.getObject("at", OffsetDateTime.class));
  }

  // ---------- reading admissions ----------

  private static final String SELECT = """
      select a.*, p.name as patient_name, d.name as doctor_name, b.label as bed_label, w.id as ward_id, w.name as ward_name
      from admission a join patient p on p.id = a.patient_id join doctor d on d.id = a.doctor_id
        join bed b on b.id = a.bed_id join ward w on w.id = b.ward_id
      """;

  /**
   * Admissions matching the filter, newest first. {@code clinical} false leaves the clinical lists empty; {@code recentOnly}
   * limits notes and observations to the latest few (enough for ward lists) instead of the whole stay.
   */
  public List<Admission> search(List<String> branches, String status, String patientId, int limit, boolean clinical, boolean recentOnly) {
    String where = " where (cast(:all as boolean) or a.branch_id in (:branches))"
        + switch (status) {
          case "current" -> " and a.status <> 'Discharged'";
          case "discharged" -> " and a.status = 'Discharged'";
          default -> "";
        }
        + " and (cast(:pid as text) is null or a.patient_id = :pid)";
    var heads = db.sql(SELECT + where + " order by a.admitted_at desc limit :lim")
        .param("all", branches == null).param("branches", branches == null ? List.of("") : branches)
        .param("pid", patientId).param("lim", limit).query((r, i) -> new Row(r)).list();
    return assemble(heads, clinical, recentOnly);
  }

  public Optional<Admission> admission(String id, boolean clinical) {
    var heads = db.sql(SELECT + " where a.id = :id").param("id", id).query((r, i) -> new Row(r)).list();
    var out = assemble(heads, clinical, false);
    return out.isEmpty() ? Optional.empty() : Optional.of(out.get(0));
  }

  /** One admission row with its columns read eagerly (a ResultSet cannot be kept). */
  private final class Row {
    final String id, branchId, patientId, patientName, doctorId, doctorName, deptId, bedId, bedLabel, wardId, wardName, reason, diagnosis,
        type, status, summary, dischargedBy, erCaseId, invoiceNumber;
    final OffsetDateTime admittedAt, dischargedAt;
    final LocalDate expected;
    final List<String> checklist;
    final UUID claimId, invoiceId;
    final int version;
    Row(ResultSet r) throws SQLException {
      id = r.getString("id"); branchId = r.getString("branch_id"); patientId = r.getString("patient_id"); patientName = r.getString("patient_name");
      doctorId = r.getString("doctor_id"); doctorName = r.getString("doctor_name"); deptId = r.getString("dept_id"); bedId = r.getString("bed_id");
      bedLabel = r.getString("bed_label"); wardId = r.getString("ward_id"); wardName = r.getString("ward_name"); reason = r.getString("reason");
      diagnosis = r.getString("diagnosis"); type = r.getString("type"); status = r.getString("status"); summary = r.getString("discharge_summary");
      dischargedBy = r.getString("discharged_by_name"); erCaseId = r.getString("er_case_id"); invoiceNumber = r.getString("invoice_number");
      admittedAt = r.getObject("admitted_at", OffsetDateTime.class); dischargedAt = r.getObject("discharged_at", OffsetDateTime.class);
      expected = r.getObject("expected_discharge", LocalDate.class);
      var arr = r.getArray("discharge_checklist");
      checklist = arr == null ? List.of() : Arrays.asList((String[]) arr.getArray());
      claimId = (UUID) r.getObject("claim_id"); invoiceId = (UUID) r.getObject("invoice_id"); version = r.getInt("version");
    }
  }

  private <T> Map<String, List<T>> byAdmission(String sql, List<String> ids, Function<ResultSet, T> map) {
    var out = new HashMap<String, List<T>>();
    var spec = db.sql(sql).param("ids", ids);
    if (sql.contains(":since")) spec = spec.param("since", OffsetDateTime.now(clock).minusHours(24))
        .param("sinceDate", LocalDate.now(clock).minusDays(7));
    spec.query((r, i) -> Map.entry(r.getString("admission_id"), map.apply(r))).list()
        .forEach(e -> out.computeIfAbsent(e.getKey(), k -> new ArrayList<>()).add(e.getValue()));
    return out;
  }

  private interface SqlMapper<T> { T map(ResultSet r) throws SQLException; }
  private static <T> Function<ResultSet, T> m(SqlMapper<T> f) {
    return r -> { try { return f.map(r); } catch (SQLException e) { throw new IllegalStateException(e); } };
  }

  private List<Admission> assemble(List<Row> rows, boolean clinical, boolean recentOnly) {
    if (rows.isEmpty()) return List.of();
    var ids = rows.stream().map(r -> r.id).toList();
    String recent = recentOnly ? " where rn <= 20" : "";
    Map<String, List<Note>> notes = Map.of();
    Map<String, List<Mar>> mar = Map.of();
    Map<String, List<Io>> io = Map.of();
    Map<String, List<Obs>> obs = Map.of();
    Map<String, List<String>> plan = Map.of();
    if (clinical) {
      notes = byAdmission("select * from (select *, row_number() over (partition by admission_id order by at desc, seq desc) rn from ipd_note"
          + " where admission_id in (:ids)) x" + recent + " order by at desc, seq desc", ids,
          m(r -> new Note((UUID) r.getObject("id"), stamp(r.getObject("at", OffsetDateTime.class)), r.getString("author"), r.getString("type"),
              r.getString("text"))));
      // Doses still due, and everything from the last week.
      mar = byAdmission("select * from ipd_mar where admission_id in (:ids) and (status = 'Due' or date >= :sinceDate)"
          + " order by date, time, seq", ids,
          m(r -> new Mar((UUID) r.getObject("id"), r.getString("med"), r.getString("dose"), r.getString("route"), r.getString("time"),
              r.getObject("date", LocalDate.class), r.getString("status"), r.getString("done_by"), r.getString("ordered_by"), r.getString("note"))));
      io = byAdmission("select * from ipd_io where admission_id in (:ids) and at >= :since order by at, seq", ids,
          m(r -> { var at = r.getObject("at", OffsetDateTime.class);
            return new Io((UUID) r.getObject("id"), hm(at), at, r.getString("kind"), r.getString("type"), r.getInt("ml"), r.getString("by_name")); }));
      obs = byAdmission("select * from (select *, row_number() over (partition by admission_id order by at desc, seq desc) rn from ipd_obs"
          + " where admission_id in (:ids)) x" + recent + " order by at, seq", ids,
          m(r -> { var at = r.getObject("at", OffsetDateTime.class);
            return new Obs((UUID) r.getObject("id"), hm(at), at, r.getString("bp"), r.getInt("hr"), r.getBigDecimal("temp"), r.getInt("spo2"),
                r.getInt("rr"), r.getInt("pain"), r.getInt("news"), r.getString("by_name")); }));
      plan = byAdmission("select * from ipd_care_plan where admission_id in (:ids) order by at, seq", ids, m(r -> r.getString("text")));
    }
    var deposits = byAdmission("select * from ipd_deposit where admission_id in (:ids) order by at, seq", ids,
        m(r -> new Deposit((UUID) r.getObject("id"), r.getString("kind"), r.getString("receipt_no"), r.getBigDecimal("amount"), r.getString("mode"),
            r.getString("reference"), r.getString("by_name"), r.getObject("at", OffsetDateTime.class))));
    var charges = byAdmission("select * from ipd_charge where admission_id in (:ids) and not cancelled order by at, seq", ids, m(IpdRepository::charge));
    var out = new ArrayList<Admission>();
    for (var a : rows) {
      var dep = deposits.getOrDefault(a.id, List.of());
      BigDecimal in = BigDecimal.ZERO, balance = BigDecimal.ZERO;
      for (var d : dep) {
        if (d.kind().equals("DEPOSIT")) { in = in.add(d.amount()); balance = balance.add(d.amount()); }
        else balance = balance.subtract(d.amount());
      }
      out.add(new Admission(a.id, a.branchId, a.patientId, a.patientName, a.doctorId, a.doctorName, a.deptId, a.bedId, a.bedLabel, a.wardId,
          a.wardName, stamp(a.admittedAt), a.reason, a.diagnosis, a.type, a.status, a.expected,
          a.dischargedAt == null ? null : a.dischargedAt.atZoneSameInstant(zone).toLocalDate().toString(),
          clinical ? a.summary : null, a.checklist, a.dischargedBy,
          notes.getOrDefault(a.id, List.of()), mar.getOrDefault(a.id, List.of()), io.getOrDefault(a.id, List.of()),
          obs.getOrDefault(a.id, List.of()), plan.getOrDefault(a.id, List.of()), in, balance, dep, charges.getOrDefault(a.id, List.of()),
          a.erCaseId, a.claimId, a.invoiceId, a.invoiceNumber, a.version));
    }
    return out;
  }

  // ---------- other modules' records ----------

  public record PatientRef(String id, String branchId, String name, String providerId, String policyNo) {}

  public Optional<PatientRef> patient(String id) {
    return db.sql("select id, branch_id, name, insurance ->> 'providerId' as provider, insurance ->> 'policyNo' as policy from patient where id = ?")
        .param(id).query((r, i) -> new PatientRef(r.getString("id"), r.getString("branch_id"), r.getString("name"), r.getString("provider"),
            r.getString("policy"))).optional();
  }

  public boolean insurerActive(String providerId) {
    return db.sql("select count(*) > 0 from billing_insurance_providers where id = ? and active").param(providerId).query(Boolean.class).single();
  }

  public record DoctorRef(String id, String deptId, String name) {}

  public Optional<DoctorRef> doctor(String id) {
    return db.sql("select id, dept_id, name from doctor where id = ? and active").param(id)
        .query((r, i) -> new DoctorRef(r.getString("id"), r.getString("dept_id"), r.getString("name"))).optional();
  }
}
