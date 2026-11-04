package com.hospitos.patients;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class PatientRepository {
  private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};
  private static final String SQL_INSERT = """
        insert into patient (id, branch_id, name, dob, gender, mobile, email, address, blood, allergies, conditions, history,
          surgical_history, family_history, medications, emergency, insurance, abha, consent, primary_doctor_id, created_by)
        values (:id, :branch, :name, :dob, :gender, :mobile, :email, cast(:address as jsonb), :blood, :allergies, :conditions, :history,
          :surg, :fam, :meds, cast(:emergency as jsonb), cast(:insurance as jsonb), :abha, :consent, :doc, :by)""";
  private static final String SQL_UPDATE = """
        update patient set name = :name, dob = :dob, gender = :gender, mobile = :mobile, email = :email,
          address = cast(:address as jsonb), blood = :blood, allergies = :allergies, conditions = :conditions, history = :history,
          surgical_history = :surg, family_history = :fam, medications = :meds, emergency = cast(:emergency as jsonb),
          insurance = cast(:insurance as jsonb), abha = :abha, consent = :consent, primary_doctor_id = :doc,
          version = version + 1, updated_at = now()
        where id = :id and version = :version""";
  private final JdbcClient db;
  private final ObjectMapper json;
  public PatientRepository(JdbcClient db, ObjectMapper json) { this.db = db; this.json = json; }

  private Map<String, Object> obj(String s) {
    if (s == null) return null;
    try { return json.readValue(s, MAP); } catch (Exception e) { throw new IllegalStateException(e); }
  }
  private String str(Map<String, Object> m) {
    if (m == null) return null;
    try { return json.writeValueAsString(m); } catch (Exception e) { throw new IllegalStateException(e); }
  }
  private static List<String> arr(Array a) throws SQLException { return a == null ? List.of() : Arrays.asList((String[]) a.getArray()); }

  private PatientRecord map(ResultSet r, int i) throws SQLException {
    return new PatientRecord(r.getString("id"), r.getString("name"), r.getObject("dob", LocalDate.class), r.getString("gender"),
        r.getString("mobile"), r.getString("email"), obj(r.getString("address")), r.getString("blood"),
        arr(r.getArray("allergies")), arr(r.getArray("conditions")), r.getString("history"), r.getString("surgical_history"),
        r.getString("family_history"), r.getString("medications"), obj(r.getString("emergency")), obj(r.getString("insurance")),
        r.getString("abha"), r.getString("consent"), r.getObject("registered", LocalDate.class), r.getString("primary_doctor_id"),
        List.of(), r.getString("branch_id"), r.getInt("version"));
  }

  public Optional<PatientRecord> byId(String id) {
    return db.sql("select * from patient where id = ?").param(id).query(this::map).optional();
  }

  /** Searches by name, UHID, mobile or ABHA within the given branches (null means every branch). */
  public List<PatientRecord> search(String q, List<String> branches, int limit, int offset) {
    String term = q == null ? "" : q.trim().replaceAll("[%_\\\\]", "");
    String digits = term.replaceAll("\\D", "");
    return db.sql("""
        select * from patient
        where (:all or branch_id = any(:branches))
          and (:term = '' or lower(name) like '%' || lower(:term) || '%' or lower(id) like lower(:term) || '%'
               or (length(:digits) >= 4 and regexp_replace(mobile, '\\D', '', 'g') like '%' || :digits || '%')
               or (length(:digits) >= 4 and regexp_replace(coalesce(abha, ''), '\\D', '', 'g') like :digits || '%'))
        order by registered desc, id desc limit :limit offset :offset""")
        .param("all", branches == null).param("branches", branches == null ? new String[0] : branches.toArray(String[]::new))
        .param("term", term).param("digits", digits).param("limit", limit).param("offset", offset)
        .query(this::map).list();
  }

  /** Candidates for duplicate detection: same last-10 mobile digits or same date of birth. */
  public List<PatientRecord> duplicateCandidates(String mobile, LocalDate dob, List<String> branches) {
    String m = mobile == null ? "" : mobile.replaceAll("\\D", "");
    m = m.length() > 10 ? m.substring(m.length() - 10) : m;
    return db.sql("""
        select * from patient where (:all or branch_id = any(:branches))
          and ((length(:m) = 10 and right(regexp_replace(mobile, '\\D', '', 'g'), 10) = :m) or dob = :dob)
        limit 200""")
        .param("all", branches == null).param("branches", branches == null ? new String[0] : branches.toArray(String[]::new))
        .param("m", m).param("dob", dob).query(this::map).list();
  }

  /** Allocates the next UHID for the current year, e.g. HS-26-00001. Safe under concurrent registrations. */
  public String nextUhid() {
    int yy = LocalDate.now().getYear() % 100;
    int n = db.sql("""
        insert into uhid_counter (yy, next) values (?, 2)
        on conflict (yy) do update set next = uhid_counter.next + 1
        returning next - 1""").param(yy).query(Integer.class).single();
    return String.format("HS-%02d-%05d", yy, n);
  }

  public void insert(String id, String branchId, PatientInput p, UUID by) {
    var m = params(p); m.put("id", id); m.put("branch", branchId); m.put("by", by);
    db.sql(SQL_INSERT).params(m).update();
  }

  /** Returns false when the row changed since the client's version (optimistic locking). */
  public boolean update(String id, PatientInput p) {
    var m = params(p); m.put("id", id); m.put("version", p.version());
    return db.sql(SQL_UPDATE).params(m).update() == 1;
  }

  private java.util.HashMap<String, Object> params(PatientInput p) {
    var m = new java.util.HashMap<String, Object>();
    m.put("name", p.name().trim()); m.put("dob", p.dob()); m.put("gender", p.gender()); m.put("mobile", p.mobile().trim());
    m.put("email", blank(p.email())); m.put("address", str(p.address() == null ? Map.of() : p.address()));
    m.put("blood", p.blood() == null || p.blood().isBlank() ? "Unknown" : p.blood());
    m.put("allergies", (p.allergies() == null ? List.<String>of() : p.allergies()).toArray(String[]::new));
    m.put("conditions", (p.conditions() == null ? List.<String>of() : p.conditions()).toArray(String[]::new));
    m.put("history", p.history() == null ? "" : p.history()); m.put("surg", blank(p.surgicalHistory()));
    m.put("fam", blank(p.familyHistory())); m.put("meds", blank(p.medications()));
    m.put("emergency", str(p.emergency() == null ? Map.of() : p.emergency())); m.put("insurance", str(p.insurance()));
    m.put("abha", blank(p.abha())); m.put("consent", p.consent() == null ? "Pending" : p.consent());
    m.put("doc", p.primaryDoctorId() == null ? "" : p.primaryDoctorId());
    return m;
  }
  private static String blank(String s) { return s == null || s.isBlank() ? null : s.trim(); }
}
