package com.hospitos.pharmacy;

import com.hospitos.pharmacy.PharmacyDtos.Batch;
import com.hospitos.pharmacy.PharmacyDtos.FefoPick;
import com.hospitos.pharmacy.PharmacyDtos.Medicine;
import com.hospitos.pharmacy.PharmacyDtos.MedicineInput;
import com.hospitos.pharmacy.PharmacyDtos.StockMove;
import com.hospitos.pharmacy.PharmacyDtos.Supplier;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
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
public class PharmacyRepository {
  private final JdbcClient db;
  public PharmacyRepository(JdbcClient db) { this.db = db; }

  /** A medicine row without stock, used internally. */
  public record MedicineRow(String id, String generic, String brand, String strength, String form, String category, String route,
                            BigDecimal price, BigDecimal gstPct, int reorder, String rack, String schedule, boolean active, int version) {
    public String label() { return strength.isBlank() ? brand : brand + " " + strength; }
  }

  /** A batch row locked for update while stock is taken from it. */
  public record LockedBatch(UUID id, String medicineId, String branchId, String batch, LocalDate expiry, int qty, String supplierId,
                            BigDecimal cost) {}

  private static MedicineRow medicine(ResultSet r, int i) throws SQLException {
    return new MedicineRow(r.getString("id"), r.getString("generic"), r.getString("brand"), r.getString("strength"), r.getString("form"),
        r.getString("category"), r.getString("route"), r.getBigDecimal("price"), r.getBigDecimal("gst_pct"), r.getInt("reorder"),
        r.getString("rack"), r.getString("schedule"), r.getBoolean("active"), r.getInt("version"));
  }

  private static Batch batch(ResultSet r, int i) throws SQLException {
    return new Batch(r.getObject("id", UUID.class), r.getString("batch"), r.getObject("expiry", LocalDate.class), r.getInt("qty"),
        r.getString("supplier_id"), r.getBigDecimal("cost"), r.getObject("received", LocalDate.class));
  }

  private static LockedBatch locked(ResultSet r, int i) throws SQLException {
    return new LockedBatch(r.getObject("id", UUID.class), r.getString("medicine_id"), r.getString("branch_id"), r.getString("batch"),
        r.getObject("expiry", LocalDate.class), r.getInt("qty"), r.getString("supplier_id"), r.getBigDecimal("cost"));
  }

  private static Medicine withStock(MedicineRow m, String branchId, List<Batch> batches) {
    int stock = batches.stream().mapToInt(Batch::qty).sum();
    return new Medicine(m.id(), m.generic(), m.brand(), m.strength(), m.form(), m.category(), m.route(), m.price(), m.gstPct(),
        m.reorder(), m.rack(), m.schedule(), m.active(), m.version(), branchId, stock, batches);
  }

  public Optional<MedicineRow> medicine(String id) {
    return db.sql("select * from medicine where id = ?").param(id).query(PharmacyRepository::medicine).optional();
  }

  /** The formulary with each medicine's batches (earliest expiry first) in one branch. */
  public List<Medicine> list(String branchId, String q, boolean includeInactive) {
    String term = q == null ? "" : q.trim().toLowerCase().replaceAll("[%_\\\\]", "");
    var meds = db.sql("""
        select * from medicine
        where (:all or active)
          and (:term = '' or lower(generic) like '%' || :term || '%' or lower(brand) like '%' || :term || '%'
               or lower(rack) like :term || '%' or lower(id) = :term)
        order by brand, strength""")
        .param("all", includeInactive).param("term", term).query(PharmacyRepository::medicine).list();
    var byMed = new HashMap<String, List<Batch>>();
    db.sql("select * from medicine_batch where branch_id = ? and qty > 0 order by expiry, batch").param(branchId)
        .query((r, i) -> Map.entry(r.getString("medicine_id"), batch(r, i))).list()
        .forEach(e -> byMed.computeIfAbsent(e.getKey(), k -> new ArrayList<>()).add(e.getValue()));
    return meds.stream().map(m -> withStock(m, branchId, byMed.getOrDefault(m.id(), List.of()))).toList();
  }

  public Optional<Medicine> get(String id, String branchId) {
    return medicine(id).map(m -> withStock(m, branchId, db.sql(
        "select * from medicine_batch where medicine_id = ? and branch_id = ? and qty > 0 order by expiry, batch")
        .params(id, branchId).query(PharmacyRepository::batch).list()));
  }

  public int stock(String medicineId, String branchId) {
    return db.sql("select coalesce(sum(qty), 0) from medicine_batch where medicine_id = ? and branch_id = ?")
        .params(medicineId, branchId).query(Integer.class).single();
  }

  public String nextMedicineId() {
    long n = db.sql("select nextval('medicine_seq')").query(Long.class).single();
    return String.format("M%03d", n);
  }

  public void insert(String id, MedicineInput in) {
    db.sql("""
        insert into medicine (id, generic, brand, strength, form, category, route, price, gst_pct, reorder, rack, schedule, active)
        values (:id, :generic, :brand, :strength, :form, :category, :route, :price, :gst, :reorder, :rack, :schedule, :active)""")
        .params(params(in)).param("id", id).update();
  }

  /** Returns false when the row changed since the client's version. */
  public boolean update(String id, MedicineInput in) {
    return db.sql("""
        update medicine set generic = :generic, brand = :brand, strength = :strength, form = :form, category = :category,
          route = :route, price = :price, gst_pct = :gst, reorder = :reorder, rack = :rack, schedule = :schedule, active = :active,
          version = version + 1, updated_at = now()
        where id = :id and version = :version""")
        .params(params(in)).param("id", id).param("version", in.version()).update() == 1;
  }

  private static Map<String, Object> params(MedicineInput in) {
    var m = new HashMap<String, Object>();
    m.put("generic", in.generic().trim()); m.put("brand", in.brand().trim());
    m.put("strength", in.strength() == null ? "" : in.strength().trim()); m.put("form", in.form().trim());
    m.put("category", in.category().trim()); m.put("route", in.route() == null || in.route().isBlank() ? "Oral" : in.route().trim());
    m.put("price", in.price()); m.put("gst", in.gstPct() == null ? new BigDecimal("12") : in.gstPct());
    m.put("reorder", in.reorder() == null ? 0 : in.reorder()); m.put("rack", in.rack() == null ? "" : in.rack().trim());
    m.put("schedule", in.schedule() == null || in.schedule().isBlank() ? null : in.schedule().trim());
    m.put("active", in.active() == null || in.active());
    return m;
  }

  public List<Supplier> suppliers() {
    return db.sql("select * from supplier where active order by name").query((r, i) -> new Supplier(r.getString("id"), r.getString("name"),
        r.getString("contact"), r.getString("phone"), r.getString("gst"), r.getString("city"), r.getString("type"),
        r.getBigDecimal("rating"))).list();
  }

  public boolean supplierExists(String id) {
    return db.sql("select count(*) from supplier where id = ?").param(id).query(Integer.class).single() > 0;
  }

  /**
   * Locks and returns the usable batches of a medicine in a branch, first expiry first.
   * Expired batches are never dispensed or transferred.
   */
  public List<LockedBatch> lockUsable(String medicineId, String branchId) {
    return db.sql("""
        select * from medicine_batch where medicine_id = ? and branch_id = ? and qty > 0 and expiry >= current_date
        order by expiry, received, batch for update""").params(medicineId, branchId).query(PharmacyRepository::locked).list();
  }

  public Optional<LockedBatch> lockBatch(UUID id) {
    return db.sql("select * from medicine_batch where id = ? for update").param(id).query(PharmacyRepository::locked).optional();
  }

  /** First-expiry-first-out plan without changing stock. */
  public List<FefoPick> plan(String medicineId, String branchId, int qty) {
    var batches = db.sql("""
        select * from medicine_batch where medicine_id = ? and branch_id = ? and qty > 0 and expiry >= current_date
        order by expiry, received, batch""").params(medicineId, branchId).query(PharmacyRepository::locked).list();
    return pick(batches, qty);
  }

  public static List<FefoPick> pick(List<LockedBatch> batches, int qty) {
    var out = new ArrayList<FefoPick>();
    int left = qty;
    for (var b : batches) {
      if (left <= 0) break;
      int take = Math.min(b.qty(), left);
      out.add(new FefoPick(b.id(), b.batch(), b.expiry(), take));
      left -= take;
    }
    return out;
  }

  public void take(UUID batchId, int qty) {
    int n = db.sql("update medicine_batch set qty = qty - ? where id = ? and qty >= ?").params(qty, batchId, qty).update();
    if (n != 1) throw new IllegalStateException("Batch " + batchId + " does not have " + qty + " units");
  }

  public void setQty(UUID batchId, int qty) {
    db.sql("update medicine_batch set qty = ? where id = ?").params(qty, batchId).update();
  }

  /** Adds stock to a batch, creating it in the branch if needed. Returns the batch id. */
  public UUID addToBatch(String medicineId, String branchId, String batch, LocalDate expiry, int qty, String supplierId, BigDecimal cost) {
    return db.sql("""
        insert into medicine_batch (medicine_id, branch_id, batch, expiry, qty, supplier_id, cost)
        values (?, ?, ?, ?, ?, ?, ?)
        on conflict (medicine_id, branch_id, batch) do update set qty = medicine_batch.qty + excluded.qty
        returning id""").params(medicineId, branchId, batch, expiry, qty, supplierId, cost == null ? BigDecimal.ZERO : cost)
        .query(UUID.class).single();
  }

  public Optional<LockedBatch> findBatch(String medicineId, String branchId, String batch) {
    return db.sql("select * from medicine_batch where medicine_id = ? and branch_id = ? and batch = ?")
        .params(medicineId, branchId, batch).query(PharmacyRepository::locked).optional();
  }

  public void move(String branchId, String medicineId, UUID batchId, String batch, String kind, int qty, String ref, String note,
                   UUID byUser, String byName) {
    db.sql("""
        insert into stock_move (branch_id, medicine_id, batch_id, batch, kind, qty, ref, note, by_user, by_name)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
        .params(branchId, medicineId, batchId, batch == null ? "" : batch, kind, qty, ref == null ? "" : ref, note, byUser, byName)
        .update();
  }

  public List<StockMove> moves(String branchId, String medicineId, int limit) {
    return db.sql("""
        select s.*, m.brand, m.strength from stock_move s join medicine m on m.id = s.medicine_id
        where s.branch_id = :branch and (:med = '' or s.medicine_id = :med)
        order by s.at desc limit :limit""")
        .param("branch", branchId).param("med", medicineId == null ? "" : medicineId).param("limit", limit)
        .query((r, i) -> new StockMove(r.getObject("id", UUID.class), r.getObject("at", OffsetDateTime.class), r.getString("branch_id"),
            r.getString("medicine_id"), label(r.getString("brand"), r.getString("strength")), r.getObject("batch_id", UUID.class),
            r.getString("batch"), r.getString("kind"), r.getInt("qty"), r.getString("ref"), r.getString("by_name"), r.getString("note")))
        .list();
  }

  private static String label(String brand, String strength) { return strength == null || strength.isBlank() ? brand : brand + " " + strength; }

  /** Total quantity already dispensed per medicine for a prescription, across earlier partial dispenses. */
  public Map<String, Integer> alreadyDispensed(UUID prescriptionId) {
    var out = new LinkedHashMap<String, Integer>();
    db.sql("""
        select coalesce(l.substituted_for, l.medicine_id) as med, sum(l.qty) as qty
        from dispense_line l join dispense d on d.id = l.dispense_id where d.prescription_id = ? group by 1""")
        .param(prescriptionId).query((r, i) -> Map.entry(r.getString("med"), r.getInt("qty"))).list()
        .forEach(e -> out.put(e.getKey(), e.getValue()));
    return out;
  }

  public UUID insertDispense(String branchId, UUID rxId, String patientId, boolean partial, String payMode, BigDecimal total,
                             UUID invoiceId, String invoiceNumber, boolean counselled, UUID byUser, String byName) {
    return db.sql("""
        insert into dispense (branch_id, prescription_id, patient_id, partial, pay_mode, total, invoice_id, invoice_number,
          counselled, by_user, by_name)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id""")
        .params(branchId, rxId, patientId, partial, payMode, total, invoiceId, invoiceNumber, counselled, byUser, byName)
        .query(UUID.class).single();
  }

  public void setInvoice(UUID dispenseId, UUID invoiceId, String number) {
    db.sql("update dispense set invoice_id = ?, invoice_number = ? where id = ?").params(invoiceId, number, dispenseId).update();
  }

  public void insertLine(UUID dispenseId, int position, String medicineId, String substitutedFor, int requested, int qty,
                         BigDecimal rate, BigDecimal gstPct, BigDecimal amount, String batches) {
    db.sql("""
        insert into dispense_line (dispense_id, position, medicine_id, substituted_for, requested, qty, rate, gst_pct, amount, batches)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
        .params(dispenseId, position, medicineId, substitutedFor, requested, qty, rate, gstPct, amount, batches).update();
  }

  public List<PharmacyDtos.DispenseSummary> dispenses(String branchId, LocalDate from, LocalDate to, int limit) {
    return db.sql("""
        select d.*, p.name as patient_name from dispense d join patient p on p.id = d.patient_id
        where d.branch_id = ? and d.at >= ?::date and d.at < (?::date + 1)
        order by d.at desc limit ?""").params(branchId, from, to, limit)
        .query((r, i) -> new PharmacyDtos.DispenseSummary(r.getObject("id", UUID.class), r.getObject("prescription_id", UUID.class),
            r.getString("patient_id"), r.getString("patient_name"), r.getString("branch_id"), r.getBoolean("partial"),
            r.getString("pay_mode"), r.getBigDecimal("total"), r.getString("invoice_number"), r.getObject("at", OffsetDateTime.class),
            r.getString("by_name"))).list();
  }
}
