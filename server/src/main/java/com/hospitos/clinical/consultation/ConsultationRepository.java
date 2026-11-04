package com.hospitos.clinical.consultation;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
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
public class ConsultationRepository {
  static final ZoneId IST = ZoneId.of("Asia/Kolkata");
  private final JdbcClient db;
  public ConsultationRepository(JdbcClient db) { this.db = db; }

  private static final String SELECT = """
      select c.*, (select p.id from prescription p where p.consultation_id = c.id) as prescription_id
      from consultation c""";

  public Optional<ConsultationRecord> byId(UUID id) {
    var list = query(SELECT + " where c.id = :id", Map.of("id", id), true);
    return list.stream().findFirst();
  }

  public Optional<UUID> openDraft(String patientId, String doctorId) {
    return db.sql("select id from consultation where patient_id = ? and doctor_id = ? and status = 'Draft'")
        .params(patientId, doctorId).query(UUID.class).optional();
  }

  /** Lists consultations in the given branches (null means every branch). Vitals history is left out of lists. */
  public List<ConsultationRecord> list(List<String> branches, String patientId, String doctorId, String status, LocalDate date,
                                       int limit, int offset) {
    var p = new HashMap<String, Object>();
    p.put("all", branches == null); p.put("branches", branches == null ? new String[0] : branches.toArray(String[]::new));
    p.put("patient", patientId == null ? "" : patientId); p.put("doctor", doctorId == null ? "" : doctorId);
    p.put("status", status == null ? "" : status); p.put("hasDate", date != null); p.put("date", date == null ? LocalDate.now() : date);
    p.put("limit", limit); p.put("offset", offset);
    return query(SELECT + """
         where (:all or c.branch_id = any(:branches)) and (:patient = '' or c.patient_id = :patient)
          and (:doctor = '' or c.doctor_id = :doctor) and (:status = '' or c.status = :status)
          and (not :hasDate or (c.created_at at time zone 'Asia/Kolkata')::date = :date)
        order by c.created_at desc limit :limit offset :offset""", p, false);
  }

  private List<ConsultationRecord> query(String sql, Map<String, ?> params, boolean history) {
    List<UUID> ids = new ArrayList<>();
    // Read heads first, then vitals and diagnoses for all of them in two queries.
    var heads = db.sql(sql).params(params).query((r, i) -> { ids.add(r.getObject("id", UUID.class)); return snapshot(r); }).list();
    if (heads.isEmpty()) return List.of();
    UUID[] arr = ids.toArray(UUID[]::new);
    Map<UUID, List<ConsultationRecord.Vitals>> vitals = new HashMap<>();
    db.sql("select * from consultation_vitals where consultation_id = any(?) order by recorded_at desc, id").param(arr)
        .query((ResultSet r) -> {
          var list = vitals.computeIfAbsent(r.getObject("consultation_id", UUID.class), k -> new ArrayList<>());
          if (history || list.isEmpty()) list.add(vitals(r));
        });
    Map<UUID, List<ConsultationRecord.Diagnosis>> dx = new LinkedHashMap<>();
    db.sql("select * from consultation_diagnosis where consultation_id = any(?) order by position").param(arr)
        .query((ResultSet r) -> {
          dx.computeIfAbsent(r.getObject("consultation_id", UUID.class), k -> new ArrayList<>())
              .add(new ConsultationRecord.Diagnosis(r.getString("code"), r.getString("label")));
        });
    var out = new ArrayList<ConsultationRecord>();
    for (var h : heads) {
      UUID id = (UUID) h.get("id");
      out.add(fromSnapshot(h, vitals.getOrDefault(id, List.of()), dx.getOrDefault(id, List.of())));
    }
    return out;
  }

  private static ConsultationRecord.Vitals vitals(ResultSet r) throws SQLException {
    Integer sys = (Integer) r.getObject("bp_systolic"), dia = (Integer) r.getObject("bp_diastolic");
    return new ConsultationRecord.Vitals(sys == null || dia == null ? "" : sys + "/" + dia, (Integer) r.getObject("heart_rate"),
        r.getBigDecimal("temperature_f"), (Integer) r.getObject("resp_rate"), (Integer) r.getObject("spo2"),
        r.getBigDecimal("height_cm"), r.getBigDecimal("weight_kg"), r.getObject("recorded_at", OffsetDateTime.class).toInstant());
  }

  private static Map<String, Object> snapshot(ResultSet r) throws SQLException {
    var m = new HashMap<String, Object>();
    var md = r.getMetaData();
    for (int i = 1; i <= md.getColumnCount(); i++) m.put(md.getColumnLabel(i), r.getObject(i));
    return m;
  }

  private static String s(Map<String, Object> m, String k) { return (String) m.get(k); }

  private static ConsultationRecord fromSnapshot(Map<String, Object> m, List<ConsultationRecord.Vitals> vitals,
                                                 List<ConsultationRecord.Diagnosis> dx) {
    var created = toInstant(m.get("created_at"));
    var completed = m.get("completed_at") == null ? null : toInstant(m.get("completed_at"));
    var fu = m.get("follow_up_date");
    return new ConsultationRecord((UUID) m.get("id"), s(m, "branch_id"), s(m, "appointment_id"), s(m, "patient_id"),
        s(m, "doctor_id"), created.atZone(IST).toLocalDate(), s(m, "template"), vitals.isEmpty() ? null : vitals.get(0), vitals,
        s(m, "chief_complaint"), s(m, "hpi"), s(m, "past_history"), s(m, "family_history"), s(m, "social_history"),
        s(m, "current_meds"), s(m, "allergy_note"), s(m, "examination"), dx, s(m, "assessment"), s(m, "plan"), s(m, "notes"),
        s(m, "follow_up"), fu == null ? null : ((java.sql.Date) fu).toLocalDate(), s(m, "status"), (UUID) m.get("prescription_id"),
        ((Number) m.get("version")).intValue(), completed);
  }

  private static java.time.Instant toInstant(Object o) {
    if (o instanceof java.sql.Timestamp t) return t.toInstant();
    if (o instanceof OffsetDateTime t) return t.toInstant();
    throw new IllegalStateException("Unexpected timestamp type " + o.getClass());
  }

  public UUID insert(String branchId, String patientId, String doctorId, String appointmentId, String template, String pmh,
                     String fh, String meds, String allergyNote, UUID by) {
    return db.sql("""
        insert into consultation (branch_id, patient_id, doctor_id, appointment_id, template, past_history, family_history,
          current_meds, allergy_note, created_by) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id""")
        .params(branchId, patientId, doctorId, appointmentId, template, nz(pmh), nz(fh), nz(meds), nz(allergyNote), by)
        .query(UUID.class).single();
  }

  /** Saves a draft's notes; false when the version is stale or it is no longer a draft. */
  public boolean update(UUID id, ConsultationInput.Update u, ConsultationRecord cur) {
    var p = new HashMap<String, Object>();
    p.put("id", id); p.put("version", u.version());
    p.put("template", or(u.template(), cur.template())); p.put("cc", or(u.cc(), cur.cc())); p.put("hpi", or(u.hpi(), cur.hpi()));
    p.put("pmh", or(u.pmh(), cur.pmh())); p.put("fh", or(u.fh(), cur.fh())); p.put("sh", or(u.sh(), cur.sh()));
    p.put("meds", or(u.meds(), cur.meds())); p.put("allergy", or(u.allergyNote(), cur.allergyNote()));
    p.put("exam", or(u.exam(), cur.exam())); p.put("assessment", or(u.assessment(), cur.assessment()));
    p.put("plan", or(u.plan(), cur.plan())); p.put("notes", or(u.notes(), cur.notes()));
    p.put("fu", or(u.followUp(), cur.followUp())); p.put("fuDate", u.followUpDate() != null ? u.followUpDate() : cur.followUpDate());
    return db.sql("""
        update consultation set template = :template, chief_complaint = :cc, hpi = :hpi, past_history = :pmh,
          family_history = :fh, social_history = :sh, current_meds = :meds, allergy_note = :allergy, examination = :exam,
          assessment = :assessment, plan = :plan, notes = :notes, follow_up = :fu, follow_up_date = :fuDate,
          version = version + 1, updated_at = now()
        where id = :id and version = :version and status = 'Draft'""").params(p).update() == 1;
  }

  public void replaceDiagnoses(UUID id, List<ConsultationInput.Diagnosis> dx) {
    db.sql("delete from consultation_diagnosis where consultation_id = ?").param(id).update();
    int pos = 0;
    var seen = new java.util.HashSet<String>();
    for (var d : dx) {
      String code = d.code().trim().toUpperCase();
      if (!seen.add(code)) continue;
      db.sql("insert into consultation_diagnosis (consultation_id, position, code, label) values (?, ?, ?, ?)")
          .params(id, pos++, code, d.label().trim()).update();
    }
  }

  public void addVitals(UUID id, ConsultationInput.Vitals v, UUID by) {
    Integer sys = null, dia = null;
    if (v.bp() != null && !v.bp().isBlank()) {
      var parts = v.bp().split("/");
      sys = Integer.parseInt(parts[0]); dia = Integer.parseInt(parts[1]);
    }
    db.sql("""
        insert into consultation_vitals (consultation_id, bp_systolic, bp_diastolic, heart_rate, temperature_f, resp_rate, spo2,
          height_cm, weight_kg, recorded_by) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
        .params(id, sys, dia, v.hr(), v.temp(), v.rr(), v.spo2(), v.height(), v.weight(), by).update();
  }

  public boolean complete(UUID id, int version, UUID by) {
    return db.sql("""
        update consultation set status = 'Completed', completed_by = ?, completed_at = now(), version = version + 1, updated_at = now()
        where id = ? and version = ? and status = 'Draft'""").params(by, id, version).update() == 1;
  }

  /** Height and weight from the patient's latest earlier reading, to prefill a new visit. */
  public Optional<ConsultationRecord.Vitals> lastBody(String patientId) {
    return db.sql("""
        select v.* from consultation_vitals v join consultation c on c.id = v.consultation_id
        where c.patient_id = ? and (v.height_cm is not null or v.weight_kg is not null)
        order by v.recorded_at desc limit 1""").param(patientId).query((r, i) -> vitals(r)).optional();
  }

  static String nz(String s) { return s == null ? "" : s; }
  private static String or(String v, String cur) { return v == null ? cur : v; }

  static boolean sameVitals(ConsultationRecord.Vitals a, ConsultationInput.Vitals b) {
    if (a == null) return false;
    return nz(a.bp()).equals(nz(b.bp())) && eq(a.hr(), b.hr()) && eqd(a.temp(), b.temp()) && eq(a.rr(), b.rr())
        && eq(a.spo2(), b.spo2()) && eqd(a.height(), b.height()) && eqd(a.weight(), b.weight());
  }
  private static boolean eq(Integer a, Integer b) { return a == null ? b == null : a.equals(b); }
  private static boolean eqd(BigDecimal a, BigDecimal b) { return a == null ? b == null : b != null && a.compareTo(b) == 0; }
}
