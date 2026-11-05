package com.hospitos.radiology;

import com.hospitos.radiology.RadiologyDtos.Booking;
import com.hospitos.radiology.RadiologyDtos.ImagingOrder;
import com.hospitos.radiology.RadiologyDtos.Prior;
import com.hospitos.radiology.RadiologyDtos.Room;
import com.hospitos.radiology.RadiologyDtos.Study;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class RadiologyRepository {
  /** The hospital's local time, used for scheduling and for the order date shown on screens and reports. */
  static final ZoneId IST = ZoneId.of("Asia/Kolkata");
  static final DateTimeFormatter HM = DateTimeFormatter.ofPattern("HH:mm");
  /** Statuses that hold a room: the slot is booked or the scan is running. */
  static final String[] HOLDS_ROOM = {"Scheduled", "In progress"};
  private final JdbcClient db;
  public RadiologyRepository(JdbcClient db) { this.db = db; }

  // ---------- catalogue ----------

  private static Study study(ResultSet r, int i) throws SQLException {
    return new Study(r.getString("id"), r.getString("code"), r.getString("name"), r.getString("modality"), r.getBigDecimal("price"),
        r.getInt("duration_min"), r.getBoolean("contrast"));
  }

  public List<Study> studies() { return db.sql("select * from imaging_study where active order by modality, id").query(RadiologyRepository::study).list(); }

  public Optional<Study> study(String id) { return db.sql("select * from imaging_study where id = ? and active").param(id).query(RadiologyRepository::study).optional(); }

  public Optional<Study> studyByName(String modality, String name) {
    return db.sql("select * from imaging_study where active and modality = ? and lower(name) = lower(?)").params(modality, name.trim())
        .query(RadiologyRepository::study).optional();
  }

  public record ModalityDefaults(BigDecimal price, int minutes) {}

  public Optional<ModalityDefaults> modality(String id) {
    return db.sql("select * from imaging_modality where id = ?").param(id)
        .query((r, i) -> new ModalityDefaults(r.getBigDecimal("default_price"), r.getInt("default_min"))).optional();
  }

  /** Active rooms in the given branches (null means every branch). */
  public List<Room> rooms(List<String> branches) {
    return db.sql("select * from imaging_room where active and (:all or branch_id = any(:b)) order by branch_id, code")
        .param("all", branches == null).param("b", branches == null ? new String[0] : branches.toArray(String[]::new))
        .query((r, i) -> new Room(r.getString("branch_id"), r.getString("code"), r.getString("modality"), r.getString("name"))).list();
  }

  public Optional<Room> room(String branchId, String code) {
    return db.sql("select * from imaging_room where active and branch_id = ? and code = ?").params(branchId, code)
        .query((r, i) -> new Room(r.getString("branch_id"), r.getString("code"), r.getString("modality"), r.getString("name"))).optional();
  }

  // ---------- orders ----------

  public String nextOrderId() { return String.format("IM%05d", db.sql("select nextval('imaging_order_seq')").query(Long.class).single()); }

  public void insertOrder(String id, String branchId, String patientId, String doctorId, String studyId, String modality, String study,
                          boolean contrast, BigDecimal price, int minutes, String priority, UUID by, String comments, String override) {
    db.sql("""
        insert into imaging_order (id, branch_id, patient_id, doctor_id, study_id, modality, study, contrast, price, duration_min,
          priority, ordered_by, comments, contrast_override)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
        .params(id, branchId, patientId, doctorId, studyId, modality, study, contrast, price, minutes, priority, by, comments, override).update();
  }

  public void setInvoice(String orderId, UUID invoiceId, String number) {
    db.sql("update imaging_order set billed = true, invoice_id = ?, invoice_number = ? where id = ?").params(invoiceId, number, orderId).update();
  }

  private static final String SELECT = """
      select o.*, p.name as patient_name, d.name as doctor_name
      from imaging_order o join patient p on p.id = o.patient_id left join doctor d on d.id = o.doctor_id
      """;

  private static OffsetDateTime ts(ResultSet r, String col) throws SQLException { return r.getObject(col, OffsetDateTime.class); }

  private static ImagingOrder row(ResultSet r, int i) throws SQLException {
    var slot = r.getObject("slot", LocalTime.class);
    return new ImagingOrder(r.getString("id"), r.getString("branch_id"), r.getString("patient_id"), r.getString("patient_name"),
        r.getString("doctor_id"), r.getString("doctor_name"), r.getString("study_id"), r.getString("modality"), r.getString("study"),
        r.getBoolean("contrast"), r.getBigDecimal("price"), r.getInt("duration_min"), r.getString("status"), r.getString("priority"),
        r.getObject("scheduled_date", LocalDate.class), slot == null ? null : slot.format(HM), r.getString("room"), ts(r, "ordered_at"),
        r.getString("technician"), ts(r, "started_at"), ts(r, "acquired_at"), r.getString("findings"), r.getString("impression"),
        r.getString("radiologist"), ts(r, "reported_at"), r.getString("verified_by"), ts(r, "verified_at"), r.getString("contrast_override"),
        r.getString("cancel_reason"), r.getBoolean("billed"), r.getObject("invoice_id", UUID.class), r.getString("invoice_number"),
        r.getString("comments"), r.getInt("version"));
  }

  public Optional<ImagingOrder> order(String id) { return db.sql(SELECT + " where o.id = ?").param(id).query(RadiologyRepository::row).optional(); }

  /**
   * Lists orders in the given branches (null means every branch). {@code date} matches the scheduled day, and also
   * unscheduled orders placed that day, so a day's worklist shows everything waiting for a slot.
   */
  public List<ImagingOrder> search(List<String> branches, List<String> statuses, String modality, String patientId, String q,
                                   LocalDate date, LocalDate from, LocalDate to, int limit) {
    String term = q == null ? "" : q.trim().toLowerCase().replaceAll("[%_\\\\]", "");
    return db.sql(SELECT + """
        where (:all or o.branch_id = any(:branches))
          and (cardinality(:statuses) = 0 or o.status = any(:statuses))
          and (:modality = '' or o.modality = :modality)
          and (:patient = '' or o.patient_id = :patient)
          and (:term = '' or lower(o.id) like :term || '%' or lower(p.name) like '%' || :term || '%' or lower(p.id) like :term || '%'
               or lower(o.study) like '%' || :term || '%')
          and (cast(:date as date) is null or o.scheduled_date = :date
               or (o.scheduled_date is null and (o.ordered_at at time zone 'Asia/Kolkata')::date = :date))
          and (cast(:from as date) is null or coalesce(o.scheduled_date, (o.ordered_at at time zone 'Asia/Kolkata')::date) >= :from)
          and (cast(:to as date) is null or coalesce(o.scheduled_date, (o.ordered_at at time zone 'Asia/Kolkata')::date) <= :to)
        order by coalesce(o.scheduled_date, (o.ordered_at at time zone 'Asia/Kolkata')::date) desc, o.slot nulls first, o.id desc
        limit :limit""")
        .param("all", branches == null).param("branches", branches == null ? new String[0] : branches.toArray(String[]::new))
        .param("statuses", statuses.toArray(String[]::new)).param("modality", modality == null ? "" : modality)
        .param("patient", patientId == null ? "" : patientId).param("term", term).param("date", date).param("from", from).param("to", to)
        .param("limit", limit).query(RadiologyRepository::row).list();
  }

  /** Orders that hold a room on the day, for the scheduling view and the clash check. */
  public List<Booking> bookings(String branchId, LocalDate date, String room) {
    return db.sql("""
        select o.id, o.room, o.slot, o.duration_min, p.name, o.study, o.status from imaging_order o join patient p on p.id = o.patient_id
        where o.branch_id = ? and o.scheduled_date = ? and o.status = any(?) and (cast(? as text) is null or o.room = ?)
        order by o.room, o.slot""").params(branchId, date, HOLDS_ROOM, room, room)
        .query((r, i) -> new Booking(r.getString("id"), r.getString("room"), r.getObject("slot", LocalTime.class).format(HM),
            r.getInt("duration_min"), r.getString("name"), r.getString("study"), r.getString("status"))).list();
  }

  /** Locks the room's bookings for the day so two people cannot book the same slot at once. */
  public void lockRoomDay(String branchId, String room, LocalDate date) {
    db.sql("select pg_advisory_xact_lock(hashtext(? || '|' || ? || '|' || ?))").params(branchId, room, date.toString()).query(Object.class).list();
  }

  public boolean schedule(String id, int version, LocalDate date, LocalTime slot, String room) {
    return db.sql("""
        update imaging_order set status = 'Scheduled', scheduled_date = ?, slot = ?, room = ?, version = version + 1, updated_at = now()
        where id = ? and version = ? and status in ('Ordered','Scheduled')""").params(date, slot, room, id, version).update() == 1;
  }

  /** Moves an order between statuses. Returns false when it is no longer in one of the expected statuses. */
  public boolean transition(String id, List<String> from, String to, String setSql, Object... args) {
    var p = new ArrayList<Object>();
    p.add(to);
    p.addAll(List.of(args));
    p.add(id);
    p.add(from.toArray(String[]::new));
    return db.sql("update imaging_order set status = ?, version = version + 1, updated_at = now()" + (setSql.isEmpty() ? "" : ", " + setSql)
        + " where id = ? and status = any(?)").params(p).update() == 1;
  }

  public boolean saveReport(String id, int version, String findings, String impression, boolean submit, String by, UUID byUser) {
    return db.sql("""
        update imaging_order set findings = ?, impression = ?,
          status = case when ? then 'Reported' else status end,
          radiologist = case when ? then ? else radiologist end,
          radiologist_user = case when ? then ? else radiologist_user end,
          reported_at = case when ? then now() else reported_at end,
          version = version + 1, updated_at = now()
        where id = ? and version = ? and status = 'Awaiting report'""")
        .params(findings, impression, submit, submit, by, submit, byUser, submit, id, version).update() == 1;
  }

  /** The patient's earlier verified studies of the same modality, newest first. */
  public List<Prior> priors(String patientId, String modality, String excludeOrder, OffsetDateTime before) {
    return db.sql("""
        select id, coalesce(scheduled_date, (ordered_at at time zone 'Asia/Kolkata')::date) as d, study, impression from imaging_order
        where patient_id = ? and modality = ? and id <> ? and ordered_at < ? and status = 'Verified'
        order by ordered_at desc limit 5""").params(patientId, modality, excludeOrder, before)
        .query((r, i) -> new Prior(r.getString("id"), r.getObject("d", LocalDate.class), r.getString("study"), r.getString("impression"))).list();
  }

  public record PatientBrief(String id, String name, LocalDate dob, String gender, String mobile, String branchId, List<String> allergies) {}

  public Optional<PatientBrief> patient(String id) {
    return db.sql("select id, name, dob, gender, mobile, branch_id, allergies from patient where id = ?").param(id)
        .query((r, i) -> new PatientBrief(r.getString("id"), r.getString("name"), r.getObject("dob", LocalDate.class),
            r.getString("gender"), r.getString("mobile"), r.getString("branch_id"), List.of((String[]) r.getArray("allergies").getArray()))).optional();
  }

  public boolean doctorExists(String id) {
    return db.sql("select count(*) from doctor where id = ? and active").param(id).query(Integer.class).single() > 0;
  }
}
