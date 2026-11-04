package com.hospitos.lab;

import com.hospitos.lab.LabDtos.LabOrder;
import com.hospitos.lab.LabDtos.LabTest;
import com.hospitos.lab.LabDtos.Param;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
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
public class LabRepository {
  /** The hospital's local time, used for the order date and time shown on screens and reports. */
  static final ZoneId IST = ZoneId.of("Asia/Kolkata");
  private static final DateTimeFormatter HM = DateTimeFormatter.ofPattern("HH:mm");
  private final JdbcClient db;
  public LabRepository(JdbcClient db) { this.db = db; }

  // ---------- catalogue ----------

  public List<LabTest> tests(boolean includeInactive) {
    var params = new HashMap<String, List<Param>>();
    db.sql("select * from lab_test_param order by test_id, position")
        .query((r, i) -> Map.entry(r.getString("test_id"), new Param(r.getString("name"), r.getString("unit"), r.getBigDecimal("low"),
            r.getBigDecimal("high"), r.getBigDecimal("crit_low"), r.getBigDecimal("crit_high")))).list()
        .forEach(e -> params.computeIfAbsent(e.getKey(), k -> new ArrayList<>()).add(e.getValue()));
    var profiles = new HashMap<String, List<String>>();
    db.sql("select * from lab_test_profile order by profile_id, position")
        .query((r, i) -> Map.entry(r.getString("profile_id"), r.getString("member_id"))).list()
        .forEach(e -> profiles.computeIfAbsent(e.getKey(), k -> new ArrayList<>()).add(e.getValue()));
    return db.sql("select * from lab_test where (:all or active) order by id").param("all", includeInactive)
        .query((r, i) -> new LabTest(r.getString("id"), r.getString("code"), r.getString("name"), r.getString("category"),
            r.getString("sample"), r.getBigDecimal("price"), r.getInt("tat_hours"), params.getOrDefault(r.getString("id"), List.of()),
            profiles.get(r.getString("id")))).list();
  }

  public Map<String, LabTest> testMap() {
    var out = new LinkedHashMap<String, LabTest>();
    tests(true).forEach(t -> out.put(t.id(), t));
    return out;
  }

  // ---------- orders ----------

  public String nextOrderId() { return String.format("LO%05d", db.sql("select nextval('lab_order_seq')").query(Long.class).single()); }
  public String nextSampleId() { return String.format("SMP%06d", db.sql("select nextval('lab_sample_seq')").query(Long.class).single()); }

  public void insertOrder(String id, String branchId, String patientId, String doctorId, String priority, UUID by, String comments) {
    db.sql("""
        insert into lab_order (id, branch_id, patient_id, doctor_id, priority, ordered_by, comments)
        values (?, ?, ?, ?, ?, ?, ?)""").params(id, branchId, patientId, doctorId, priority, by, comments).update();
  }

  public void insertOrderTest(String orderId, String testId, int position, BigDecimal price) {
    db.sql("insert into lab_order_test (order_id, test_id, position, price) values (?, ?, ?, ?)")
        .params(orderId, testId, position, price).update();
  }

  public void setInvoice(String orderId, UUID invoiceId, String number) {
    db.sql("update lab_order set billed = true, invoice_id = ?, invoice_number = ? where id = ?").params(invoiceId, number, orderId).update();
  }

  private static final String SELECT = """
      select o.*, p.name as patient_name, d.name as doctor_name,
        (select array_agg(t.test_id order by t.position) from lab_order_test t where t.order_id = o.id) as test_ids
      from lab_order o join patient p on p.id = o.patient_id left join doctor d on d.id = o.doctor_id
      """;

  private record Row(String id, String branchId, String patientId, String patientName, String doctorId, String doctorName,
                     List<String> testIds, OffsetDateTime orderedAt, String status, String priority, String sampleId,
                     OffsetDateTime collectedAt, String collectedBy, String verifiedBy, OffsetDateTime verifiedAt, boolean billed,
                     UUID invoiceId, String invoiceNumber, String comments, int version) {}

  private static Row row(ResultSet r, int i) throws SQLException {
    var ids = r.getArray("test_ids");
    return new Row(r.getString("id"), r.getString("branch_id"), r.getString("patient_id"), r.getString("patient_name"),
        r.getString("doctor_id"), r.getString("doctor_name"), ids == null ? List.of() : List.of((String[]) ids.getArray()),
        r.getObject("ordered_at", OffsetDateTime.class), r.getString("status"), r.getString("priority"), r.getString("sample_id"),
        r.getObject("collected_at", OffsetDateTime.class), r.getString("collected_by"), r.getString("verified_by"),
        r.getObject("verified_at", OffsetDateTime.class), r.getBoolean("billed"), r.getObject("invoice_id", UUID.class),
        r.getString("invoice_number"), r.getString("comments"), r.getInt("version"));
  }

  private List<LabOrder> withResults(List<Row> rows) {
    if (rows.isEmpty()) return List.of();
    var values = new HashMap<String, Map<String, Map<String, BigDecimal>>>();
    var flags = new HashMap<String, Map<String, Map<String, String>>>();
    db.sql("""
        select r.* from lab_result r join lab_order_test t on t.order_id = r.order_id and t.test_id = r.test_id
        where r.order_id = any(?) order by t.position, r.param""")
        .param(rows.stream().map(Row::id).toArray(String[]::new))
        .query((r, i) -> {
          String o = r.getString("order_id"), t = r.getString("test_id"), p = r.getString("param");
          values.computeIfAbsent(o, k -> new LinkedHashMap<>()).computeIfAbsent(t, k -> new LinkedHashMap<>()).put(p, r.getBigDecimal("value"));
          if (!r.getString("flag").isEmpty())
            flags.computeIfAbsent(o, k -> new LinkedHashMap<>()).computeIfAbsent(t, k -> new LinkedHashMap<>()).put(p, r.getString("flag"));
          return 0;
        }).list();
    return rows.stream().map(x -> {
      var at = x.orderedAt().atZoneSameInstant(IST);
      return new LabOrder(x.id(), x.branchId(), x.patientId(), x.patientName(), x.doctorId(), x.doctorName(), x.testIds(),
          at.toLocalDate(), at.format(HM), x.orderedAt(), x.status(), x.priority(), x.sampleId(),
          x.collectedAt() == null ? null : x.collectedAt().atZoneSameInstant(IST).format(HM), x.collectedBy(),
          values.getOrDefault(x.id(), Map.of()), flags.getOrDefault(x.id(), Map.of()), x.verifiedBy(), x.verifiedAt(), x.billed(),
          x.invoiceId(), x.invoiceNumber(), x.comments(), x.version());
    }).toList();
  }

  public Optional<LabOrder> order(String id) {
    return withResults(db.sql(SELECT + " where o.id = ?").param(id).query(LabRepository::row).list()).stream().findFirst();
  }

  public Optional<LabOrder> bySample(String sampleId) {
    return withResults(db.sql(SELECT + " where o.sample_id = ?").param(sampleId).query(LabRepository::row).list()).stream().findFirst();
  }

  /** Lists orders in the given branches (null means every branch), newest first. */
  public List<LabOrder> search(List<String> branches, List<String> statuses, String patientId, String priority, String q,
                               LocalDate from, LocalDate to, int limit) {
    String term = q == null ? "" : q.trim().toLowerCase().replaceAll("[%_\\\\]", "");
    return withResults(db.sql(SELECT + """
        where (:all or o.branch_id = any(:branches))
          and (cardinality(:statuses) = 0 or o.status = any(:statuses))
          and (:patient = '' or o.patient_id = :patient)
          and (:priority = '' or o.priority = :priority)
          and (:term = '' or lower(o.id) like :term || '%' or lower(coalesce(o.sample_id, '')) like :term || '%'
               or lower(p.name) like '%' || :term || '%' or lower(p.id) like :term || '%')
          and (cast(:from as date) is null or (o.ordered_at at time zone 'Asia/Kolkata')::date >= :from)
          and (cast(:to as date) is null or (o.ordered_at at time zone 'Asia/Kolkata')::date <= :to)
        order by o.ordered_at desc, o.id desc limit :limit""")
        .param("all", branches == null).param("branches", branches == null ? new String[0] : branches.toArray(String[]::new))
        .param("statuses", statuses.toArray(String[]::new)).param("patient", patientId == null ? "" : patientId)
        .param("priority", priority == null ? "" : priority).param("term", term).param("from", from).param("to", to)
        .param("limit", limit).query(LabRepository::row).list());
  }

  /** Moves an order between statuses. Returns false when it is no longer in one of the expected statuses. */
  public boolean transition(String id, List<String> from, String to, String setSql, Object... args) {
    var p = new ArrayList<Object>();
    p.add(to);
    p.addAll(List.of(args));
    p.add(id);
    p.add(from.toArray(String[]::new));
    return db.sql("update lab_order set status = ?, version = version + 1, updated_at = now()" + (setSql.isEmpty() ? "" : ", " + setSql)
        + " where id = ? and status = any(?)").params(p).update() == 1;
  }

  public boolean saveHeader(String id, int version, String comments, String status, String resultsBy) {
    return db.sql("""
        update lab_order set comments = ?, status = ?, results_at = case when cast(? as text) is null then results_at else now() end,
          results_by = coalesce(cast(? as text), results_by), version = version + 1, updated_at = now()
        where id = ? and version = ?""").params(comments, status, resultsBy, resultsBy, id, version).update() == 1;
  }

  public void putResult(String orderId, String testId, String param, BigDecimal value, String flag) {
    db.sql("""
        insert into lab_result (order_id, test_id, param, value, flag) values (?, ?, ?, ?, ?)
        on conflict (order_id, test_id, param) do update set value = excluded.value, flag = excluded.flag""")
        .params(orderId, testId, param, value, flag).update();
  }

  public void deleteResult(String orderId, String testId, String param) {
    db.sql("delete from lab_result where order_id = ? and test_id = ? and param = ?").params(orderId, testId, param).update();
  }

  /** The patient's most recent verified value for each test parameter, from orders placed before the given time. */
  public Map<String, Map.Entry<BigDecimal, LocalDate>> previous(String patientId, String excludeOrder, OffsetDateTime before) {
    var out = new HashMap<String, Map.Entry<BigDecimal, LocalDate>>();
    db.sql("""
        select distinct on (r.test_id, r.param) r.test_id, r.param, r.value, o.ordered_at
        from lab_result r join lab_order o on o.id = r.order_id
        where o.patient_id = ? and o.id <> ? and o.ordered_at < ? and o.status in ('Verified','Delivered') and r.value is not null
        order by r.test_id, r.param, o.ordered_at desc""").params(patientId, excludeOrder, before)
        .query((r, i) -> {
          out.put(r.getString("test_id") + "|" + r.getString("param"),
              Map.entry(r.getBigDecimal("value"), r.getObject("ordered_at", OffsetDateTime.class).atZoneSameInstant(IST).toLocalDate()));
          return 0;
        }).list();
    return out;
  }

  public record PatientBrief(String id, String name, LocalDate dob, String gender, String mobile, String branchId) {}

  public Optional<PatientBrief> patient(String id) {
    return db.sql("select id, name, dob, gender, mobile, branch_id from patient where id = ?").param(id)
        .query((r, i) -> new PatientBrief(r.getString("id"), r.getString("name"), r.getObject("dob", LocalDate.class),
            r.getString("gender"), r.getString("mobile"), r.getString("branch_id"))).optional();
  }

  public boolean doctorExists(String id) {
    return db.sql("select count(*) from doctor where id = ? and active").param(id).query(Integer.class).single() > 0;
  }
}
