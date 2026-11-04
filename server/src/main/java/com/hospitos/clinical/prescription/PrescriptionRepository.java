package com.hospitos.clinical.prescription;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class PrescriptionRepository {
  static final ZoneId IST = ZoneId.of("Asia/Kolkata");
  private final JdbcClient db;
  public PrescriptionRepository(JdbcClient db) { this.db = db; }

  private record Head(UUID id, String branchId, UUID consultationId, String patientId, String doctorId, LocalDate date,
                      String diagnosis, String status, String notes, int version, UUID signedBy, Instant signedAt) {}

  private static Head head(ResultSet r, int i) throws SQLException {
    var created = r.getObject("created_at", java.time.OffsetDateTime.class);
    var signed = r.getObject("signed_at", java.time.OffsetDateTime.class);
    return new Head(r.getObject("id", UUID.class), r.getString("branch_id"), r.getObject("consultation_id", UUID.class),
        r.getString("patient_id"), r.getString("doctor_id"), created.atZoneSameInstant(IST).toLocalDate(), r.getString("diagnosis"),
        r.getString("status"), r.getString("notes"), r.getInt("version"), r.getObject("signed_by", UUID.class),
        signed == null ? null : signed.toInstant());
  }

  public Optional<PrescriptionRecord> byId(UUID id) {
    return db.sql("select * from prescription where id = ?").param(id).query(PrescriptionRepository::head).optional()
        .map(h -> assemble(List.of(h)).get(0));
  }

  public Optional<PrescriptionRecord> byConsultation(UUID consultationId) {
    return db.sql("select * from prescription where consultation_id = ?").param(consultationId)
        .query(PrescriptionRepository::head).optional().map(h -> assemble(List.of(h)).get(0));
  }

  /** Lists prescriptions in the given branches (null means every branch), newest first. */
  public List<PrescriptionRecord> list(List<String> branches, String status, String patientId, int limit, int offset) {
    var heads = db.sql("""
        select * from prescription
        where (:all or branch_id = any(:branches)) and (:status = '' or status = :status) and (:patient = '' or patient_id = :patient)
        order by created_at desc limit :limit offset :offset""")
        .param("all", branches == null).param("branches", branches == null ? new String[0] : branches.toArray(String[]::new))
        .param("status", status == null ? "" : status).param("patient", patientId == null ? "" : patientId)
        .param("limit", limit).param("offset", offset)
        .query(PrescriptionRepository::head).list();
    return assemble(heads);
  }

  private List<PrescriptionRecord> assemble(List<Head> heads) {
    if (heads.isEmpty()) return List.of();
    UUID[] ids = heads.stream().map(Head::id).toArray(UUID[]::new);
    Map<UUID, List<PrescriptionRecord.Item>> items = new LinkedHashMap<>();
    db.sql("select * from prescription_item where prescription_id = any(?) order by prescription_id, position").param(ids)
        .query((ResultSet r) -> {
          items.computeIfAbsent(r.getObject("prescription_id", UUID.class), k -> new ArrayList<>()).add(new PrescriptionRecord.Item(
              r.getObject("id", UUID.class), r.getString("medicine_id"), r.getString("name"), r.getString("generic"),
              r.getString("strength"), r.getString("dose"), r.getString("route"), r.getString("frequency"), r.getString("duration"),
              r.getInt("qty"), r.getString("food"), r.getString("instructions"), r.getInt("refills")));
        });
    Map<UUID, List<PrescriptionRecord.Override>> overrides = new LinkedHashMap<>();
    db.sql("select * from prescription_override where prescription_id = any(?) order by overridden_at").param(ids)
        .query((ResultSet r) -> {
          overrides.computeIfAbsent(r.getObject("prescription_id", UUID.class), k -> new ArrayList<>()).add(new PrescriptionRecord.Override(
              r.getString("alert_code"), r.getString("kind"), r.getString("title"), r.getString("reason"),
              r.getObject("overridden_by", UUID.class), r.getObject("overridden_at", java.time.OffsetDateTime.class).toInstant()));
        });
    return heads.stream().map(h -> new PrescriptionRecord(h.id(), h.branchId(), h.consultationId(), h.patientId(), h.doctorId(),
        h.date(), h.diagnosis(), items.getOrDefault(h.id(), List.of()), h.status(), h.notes(), h.version(), h.signedBy(), h.signedAt(),
        overrides.getOrDefault(h.id(), List.of()))).toList();
  }

  public UUID insert(String branchId, String patientId, String doctorId, UUID consultationId, String diagnosis, String notes, UUID by) {
    return db.sql("""
        insert into prescription (branch_id, patient_id, doctor_id, consultation_id, diagnosis, notes, created_by)
        values (?, ?, ?, ?, ?, ?, ?) returning id""")
        .params(branchId, patientId, doctorId, consultationId, nz(diagnosis), nz(notes), by).query(UUID.class).single();
  }

  /** Updates a draft's header; false when the version is stale or it is no longer a draft. */
  public boolean updateDraft(UUID id, int version, String diagnosis, String notes) {
    return db.sql("""
        update prescription set diagnosis = ?, notes = ?, version = version + 1, updated_at = now()
        where id = ? and version = ? and status = 'Draft'""")
        .params(nz(diagnosis), nz(notes), id, version).update() == 1;
  }

  public void replaceItems(UUID id, List<PrescriptionInput.Line> lines) {
    db.sql("delete from prescription_item where prescription_id = ?").param(id).update();
    int pos = 0;
    for (var l : lines == null ? List.<PrescriptionInput.Line>of() : lines) {
      db.sql("""
          insert into prescription_item (prescription_id, position, medicine_id, name, generic, strength, dose, route, frequency,
            duration, qty, food, instructions, refills) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
          .params(id, pos++, blank(l.medId()), l.name().trim(), nz(l.generic()), nz(l.strength()), nz(l.dose()), nz(l.route()),
              nz(l.frequency()), nz(l.duration()), l.qty() == null ? 0 : l.qty(), nz(l.food()), nz(l.instructions()),
              l.refills() == null ? 0 : l.refills())
          .update();
    }
  }

  public boolean sign(UUID id, int version, String status, UUID by) {
    return db.sql("""
        update prescription set status = ?, signed_by = ?, signed_at = now(), version = version + 1, updated_at = now()
        where id = ? and version = ? and status = 'Draft'""")
        .params(status, by, id, version).update() == 1;
  }

  public boolean sendSigned(UUID id, int version) {
    return db.sql("""
        update prescription set status = 'Sent to pharmacy', version = version + 1, updated_at = now()
        where id = ? and version = ? and status = 'Signed'""").params(id, version).update() == 1;
  }

  public void addOverride(UUID id, String code, String kind, String title, String reason, UUID by) {
    db.sql("""
        insert into prescription_override (prescription_id, alert_code, kind, title, reason, overridden_by)
        values (?, ?, ?, ?, ?, ?) on conflict (prescription_id, alert_code) do update set reason = excluded.reason,
          overridden_by = excluded.overridden_by, overridden_at = now()""")
        .params(id, code, kind, title, reason, by).update();
  }

  public boolean setDispensed(UUID id, String status) {
    return db.sql("""
        update prescription set status = ?, version = version + 1, updated_at = now()
        where id = ? and status in ('Sent to pharmacy', 'Partially dispensed')""").params(status, id).update() == 1;
  }

  public void delete(UUID id) {
    db.sql("delete from prescription where id = ? and status = 'Draft'").param(id).update();
  }

  static String nz(String s) { return s == null ? "" : s.trim(); }
  private static String blank(String s) { return s == null || s.isBlank() ? null : s.trim(); }
}
