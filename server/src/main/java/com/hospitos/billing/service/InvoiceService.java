package com.hospitos.billing.service;

import com.hospitos.audit.AuditService;
import com.hospitos.billing.api.BillingApi;
import com.hospitos.billing.api.InvoiceKind;
import com.hospitos.billing.api.InvoiceRef;
import com.hospitos.billing.api.LineCategory;
import com.hospitos.billing.api.NewInvoice;
import com.hospitos.billing.api.NewInvoiceLine;
import com.hospitos.billing.api.PayMode;
import com.hospitos.billing.api.PaymentRef;
import com.hospitos.billing.gst.GstCalculator;
import com.hospitos.billing.model.BillingSettings;
import com.hospitos.billing.model.Invoice;
import com.hospitos.billing.model.InvoiceLine;
import com.hospitos.billing.model.Payment;
import com.hospitos.billing.model.TariffItem;
import com.hospitos.billing.model.TaxRate;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Tax invoices, receipts and refunds. Invoices are never edited once issued: a mistake is corrected by cancelling
 * (manager only, nothing paid) and raising a new one, which keeps the GST series and audit trail clean.
 */
@Service
public class InvoiceService implements BillingApi {
  /** Roles that may approve discounts above the threshold and cancel invoices. */
  public static final Set<String> MANAGERS = Set.of("super-admin", "admin");

  private final JdbcClient db;
  private final SettingsService settings;
  private final TariffService tariff;
  private final Numbering numbering;
  private final AuditService audit;

  public InvoiceService(JdbcClient db, SettingsService settings, TariffService tariff, Numbering numbering, AuditService audit) {
    this.db = db; this.settings = settings; this.tariff = tariff; this.numbering = numbering; this.audit = audit;
  }

  // ------------------------------------------------------------------ create

  @Override
  @Transactional
  public InvoiceRef createInvoice(NewInvoice cmd) {
    Invoice inv = create(cmd);
    return new InvoiceRef(inv.id(), inv.number(), inv.total(), inv.due());
  }

  private record PatientRow(String id, String branchId, String name) {}

  @Transactional
  public Invoice create(NewInvoice cmd) {
    var me = CurrentUser.get();
    if (cmd.lines() == null || cmd.lines().isEmpty()) throw new ApiException(422, "An invoice needs at least one line");
    var p = db.sql("select id, branch_id, name from patient where id = ?").param(cmd.patientId())
        .query((r, i) -> new PatientRow(r.getString(1), r.getString(2), r.getString(3))).optional()
        .orElseThrow(() -> new ApiException(422, "Patient " + cmd.patientId() + " not found"));
    String branch = cmd.branchId() != null ? cmd.branchId() : me.canSee(p.branchId()) || me.homeBranch() == null ? p.branchId() : me.homeBranch();
    if (!me.canSee(branch)) throw new ApiException(403, "You cannot bill in this branch");

    BillingSettings s = settings.get();
    BigDecimal discountPct = cmd.discountPct() == null ? BigDecimal.ZERO : cmd.discountPct();
    boolean bigDiscount = discountPct.compareTo(s.discountApprovalPct()) > 0;
    if (bigDiscount && !MANAGERS.contains(me.role()))
      throw new ApiException(403, "Discounts above " + s.discountApprovalPct().stripTrailingZeros().toPlainString() + "% need a billing manager (admin)");

    Map<LineCategory, TaxRate> rates = settings.taxRateMap();
    List<Draft> drafts = new ArrayList<>();
    for (int k = 0; k < cmd.lines().size(); k++) drafts.add(resolve(cmd.lines().get(k), rates, k + 1));

    String pos = s.stateCode(); // B2C healthcare: place of supply is where the hospital is
    var calc = GstCalculator.compute(drafts.stream().map(d -> new GstCalculator.LineInput(d.qty, d.rate, d.taxPct)).toList(),
        discountPct, !pos.equals(s.stateCode()));

    LocalDate today = BillingTime.today();
    String number = numbering.next(s.invoicePrefix(), today);
    UUID id = db.sql("""
        insert into billing_invoices (number, branch_id, gstin, patient_id, kind, status, invoice_date, place_of_supply, discount_pct,
          subtotal, discount_amount, taxable_amount, cgst, sgst, igst, round_off, total, admission_ref, source_type, source_id, notes,
          created_by, created_by_name)
        values (:number, :branch, :gstin, :patient, :kind, :status, :date, :pos, :disc, :sub, :damt, :taxable, :cgst, :sgst, :igst,
          :round, :total, :adm, :stype, :sid, :notes, :by, :byName) returning id""")
        .param("number", number).param("branch", branch).param("gstin", settings.gstinFor(branch, s))
        .param("patient", p.id()).param("kind", cmd.kind().name())
        .param("status", calc.total().signum() == 0 ? "PAID" : "UNPAID").param("date", today).param("pos", pos)
        .param("disc", discountPct).param("sub", calc.subtotal()).param("damt", calc.discount()).param("taxable", calc.taxable())
        .param("cgst", calc.cgst()).param("sgst", calc.sgst()).param("igst", calc.igst()).param("round", calc.roundOff())
        .param("total", calc.total()).param("adm", cmd.admissionRef()).param("stype", cmd.sourceType()).param("sid", cmd.sourceId())
        .param("notes", cmd.notes()).param("by", me.id()).param("byName", me.name())
        .query(UUID.class).single();
    for (int k = 0; k < drafts.size(); k++) {
      Draft d = drafts.get(k);
      var r = calc.lines().get(k);
      db.sql("""
          insert into billing_invoice_lines (invoice_id, line_no, tariff_code, description, category, hsn_sac, qty, rate, gross,
            discount, taxable, tax_pct, cgst, sgst, igst, amount, ref_type, ref_id)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
          .params(id, k + 1, d.tariffCode, d.description, d.category.name(), d.hsnSac, d.qty, d.rate, r.gross(), r.discount(),
              r.taxable(), d.taxPct, r.cgst(), r.sgst(), r.igst(), r.amount(), d.refType, d.refId).update();
    }
    audit.logForBranch(branch, "Created", "Invoice", number, cmd.kind() + " Rs " + calc.total().toPlainString() + " for " + p.name()
        + (discountPct.signum() > 0 ? ", discount " + discountPct.stripTrailingZeros().toPlainString() + "%" : "")
        + (bigDiscount ? " (above approval limit, approved by " + me.role() + ")" : ""));
    return get(id);
  }

  private static final class Draft {
    String tariffCode, description, hsnSac, refType, refId; LineCategory category; BigDecimal qty, rate, taxPct;
  }

  private Draft resolve(NewInvoiceLine in, Map<LineCategory, TaxRate> rates, int no) {
    if (!in.isComplete()) throw new ApiException(422, "Line " + no + " needs a tariff code, or a description, category and rate");
    TariffItem t = null;
    if (in.tariffCode() != null && !in.tariffCode().isBlank()) {
      t = tariff.byCode(in.tariffCode()).filter(TariffItem::active)
          .orElseThrow(() -> new ApiException(422, "Line " + no + ": tariff code " + in.tariffCode() + " not found or inactive"));
    }
    var d = new Draft();
    d.tariffCode = t == null ? null : t.code();
    d.category = in.category() != null ? in.category() : t.category();
    TaxRate rate = rates.get(d.category);
    d.description = in.description() != null && !in.description().isBlank() ? in.description().trim() : t.name();
    d.rate = GstCalculator.money(in.rate() != null ? in.rate() : t.price());
    d.qty = in.qty();
    d.taxPct = in.taxPct() != null ? in.taxPct() : t != null ? t.effectiveTaxPct() : rate != null ? rate.gstPct() : BigDecimal.ZERO;
    d.hsnSac = t != null && t.hsnSac() != null ? t.hsnSac() : rate != null ? rate.hsnSac() : null;
    d.refType = in.refType();
    d.refId = in.refId();
    return d;
  }

  // ------------------------------------------------------------------ money in and out

  @Override
  @Transactional
  public PaymentRef recordPayment(UUID invoiceId, PayMode mode, BigDecimal amount, String reference) {
    Payment p = pay(invoiceId, mode, amount, reference);
    return new PaymentRef(p.id(), p.receiptNumber(), p.amount(), get(invoiceId).due());
  }

  private record Money(String number, String branchId, String status, BigDecimal total, BigDecimal paid, BigDecimal refunded) {
    BigDecimal net() { return paid.subtract(refunded); }
    BigDecimal due() { return "CANCELLED".equals(status) ? BigDecimal.ZERO : total.subtract(net()).max(BigDecimal.ZERO); }
  }

  /** Locks the invoice row so two counters collecting at once cannot overpay it. */
  private Money lock(UUID id) {
    var m = db.sql("select number, branch_id, status, total, paid, refunded from billing_invoices where id = ? for update").param(id)
        .query((r, i) -> new Money(r.getString(1), r.getString(2), r.getString(3), r.getBigDecimal(4), r.getBigDecimal(5), r.getBigDecimal(6)))
        .optional().orElseThrow(() -> new ApiException(404, "Invoice not found"));
    if (!CurrentUser.get().canSee(m.branchId())) throw new ApiException(404, "Invoice not found");
    return m;
  }

  static String statusFor(BigDecimal total, BigDecimal paid, BigDecimal refunded) {
    BigDecimal net = paid.subtract(refunded);
    if (refunded.signum() > 0 && net.signum() <= 0) return "REFUNDED";
    if (net.compareTo(total) >= 0) return "PAID";
    return net.signum() > 0 ? "PARTIALLY_PAID" : "UNPAID";
  }

  @Transactional
  public Payment pay(UUID invoiceId, PayMode mode, BigDecimal amount, String reference) {
    if (mode == null) throw new ApiException(422, "Choose a payment mode");
    Money m = lock(invoiceId);
    if ("CANCELLED".equals(m.status())) throw new ApiException(422, "Invoice " + m.number() + " is cancelled");
    BigDecimal amt = positive(amount);
    if (amt.compareTo(m.due()) > 0) throw new ApiException(422, "Amount is more than the balance of Rs " + m.due().toPlainString());
    Payment p = insertPayment(invoiceId, "PAYMENT", mode, amt, reference, null, settings.get().receiptPrefix());
    BigDecimal paid = m.paid().add(amt);
    db.sql("update billing_invoices set paid = ?, status = ?, updated_at = now(), version = version + 1 where id = ?")
        .params(paid, statusFor(m.total(), paid, m.refunded()), invoiceId).update();
    audit.logForBranch(m.branchId(), "Created", "Payment", p.receiptNumber(), m.number() + " Rs " + amt.toPlainString() + " by " + mode);
    return p;
  }

  @Transactional
  public Payment refund(UUID invoiceId, BigDecimal amount, PayMode mode, String reason) {
    if (reason == null || reason.isBlank()) throw new ApiException(422, "A refund needs a reason");
    Money m = lock(invoiceId);
    BigDecimal amt = positive(amount);
    if (amt.compareTo(m.net()) > 0) throw new ApiException(422, "Refund is more than the Rs " + m.net().toPlainString() + " paid");
    Payment p = insertPayment(invoiceId, "REFUND", mode == null ? PayMode.CASH : mode, amt, null, reason.trim(), settings.get().refundPrefix());
    BigDecimal refunded = m.refunded().add(amt);
    String status = "CANCELLED".equals(m.status()) ? "CANCELLED" : statusFor(m.total(), m.paid(), refunded);
    db.sql("update billing_invoices set refunded = ?, status = ?, updated_at = now(), version = version + 1 where id = ?")
        .params(refunded, status, invoiceId).update();
    audit.logForBranch(m.branchId(), "Refunded", "Invoice", m.number(), p.receiptNumber() + " Rs " + amt.toPlainString() + ": " + reason.trim());
    return p;
  }

  @Transactional
  public Invoice cancel(UUID invoiceId, String reason) {
    var me = CurrentUser.get();
    if (!MANAGERS.contains(me.role())) throw new ApiException(403, "Only a billing manager (admin) can cancel an invoice");
    if (reason == null || reason.isBlank()) throw new ApiException(422, "Cancelling needs a reason");
    Money m = lock(invoiceId);
    if ("CANCELLED".equals(m.status())) return get(invoiceId);
    if (m.net().signum() > 0) throw new ApiException(422, "Refund the Rs " + m.net().toPlainString() + " paid before cancelling");
    boolean claim = db.sql("select count(*) > 0 from billing_claims where invoice_id = ? and status not in ('REJECTED')")
        .param(invoiceId).query(Boolean.class).single();
    if (claim) throw new ApiException(422, "This invoice has an insurance claim. Close the claim first");
    db.sql("""
        update billing_invoices set status = 'CANCELLED', cancel_reason = ?, cancelled_at = now(), cancelled_by = ?,
          updated_at = now(), version = version + 1 where id = ?""").params(reason.trim(), me.name(), invoiceId).update();
    audit.logForBranch(m.branchId(), "Cancelled", "Invoice", m.number(), reason.trim());
    return get(invoiceId);
  }

  private Payment insertPayment(UUID invoiceId, String type, PayMode mode, BigDecimal amt, String ref, String reason, String prefix) {
    var me = CurrentUser.get();
    String number = numbering.next(prefix, BillingTime.today());
    return db.sql("""
        insert into billing_payments (invoice_id, receipt_number, type, mode, amount, reference, reason, received_by, received_by_name)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?) returning *""")
        .params(invoiceId, number, type, mode.name(), amt, ref, reason, me.id(), me.name())
        .query(InvoiceService::payment).single();
  }

  private static BigDecimal positive(BigDecimal amount) {
    if (amount == null || amount.signum() <= 0) throw new ApiException(422, "Enter an amount above zero");
    if (amount.stripTrailingZeros().scale() > 2) throw new ApiException(422, "Amounts can have at most two decimals");
    return GstCalculator.money(amount);
  }

  // ------------------------------------------------------------------ reads

  @Override
  public boolean isBilled(String refType, String refId) {
    return db.sql("""
        select count(*) > 0 from billing_invoice_lines l join billing_invoices i on i.id = l.invoice_id
        where l.ref_type = ? and l.ref_id = ? and i.status <> 'CANCELLED'""").params(refType, refId).query(Boolean.class).single();
  }

  /** Which of these references are on a live invoice. */
  public Set<String> billedRefs(String refType, List<String> refIds) {
    if (refIds.isEmpty()) return Set.of();
    return Set.copyOf(db.sql("""
        select distinct l.ref_id from billing_invoice_lines l join billing_invoices i on i.id = l.invoice_id
        where l.ref_type = :t and l.ref_id in (:ids) and i.status <> 'CANCELLED'""")
        .param("t", refType).param("ids", refIds).query(String.class).list());
  }

  private static final String SELECT = """
      select i.*, p.name as patient_name, p.mobile as patient_mobile, c.id as claim_id, c.number as claim_number
      from billing_invoices i join patient p on p.id = i.patient_id
      left join lateral (select id, number from billing_claims c where c.invoice_id = i.id and c.status <> 'REJECTED'
                         order by created_at desc limit 1) c on true
      """;

  private static Invoice invoice(ResultSet r, int i) throws SQLException {
    BigDecimal total = r.getBigDecimal("total"), paid = r.getBigDecimal("paid"), refunded = r.getBigDecimal("refunded");
    String status = r.getString("status");
    BigDecimal due = "CANCELLED".equals(status) ? BigDecimal.ZERO.setScale(2) : total.subtract(paid).add(refunded).max(BigDecimal.ZERO);
    return new Invoice((UUID) r.getObject("id"), r.getString("number"), r.getString("branch_id"), r.getString("gstin"),
        r.getString("patient_id"), r.getString("patient_name"), r.getString("patient_mobile"), InvoiceKind.valueOf(r.getString("kind")),
        status, r.getObject("invoice_date", LocalDate.class), r.getString("place_of_supply"), r.getBigDecimal("discount_pct"),
        r.getBigDecimal("subtotal"), r.getBigDecimal("discount_amount"), r.getBigDecimal("taxable_amount"), r.getBigDecimal("cgst"),
        r.getBigDecimal("sgst"), r.getBigDecimal("igst"), r.getBigDecimal("round_off"), total, paid, refunded, due,
        (UUID) r.getObject("claim_id"), r.getString("claim_number"), r.getString("admission_ref"), r.getString("source_type"),
        r.getString("source_id"), r.getString("notes"), r.getString("cancel_reason"), r.getString("created_by_name"),
        r.getObject("created_at", OffsetDateTime.class).toInstant(), r.getInt("version"), null, null);
  }

  static Payment payment(ResultSet r, int i) throws SQLException {
    return new Payment((UUID) r.getObject("id"), (UUID) r.getObject("invoice_id"), r.getString("receipt_number"), r.getString("type"),
        PayMode.valueOf(r.getString("mode")), r.getBigDecimal("amount"), r.getString("reference"), r.getString("reason"),
        r.getObject("received_at", OffsetDateTime.class).toInstant(), r.getString("received_by_name"));
  }

  private static InvoiceLine line(ResultSet r, int i) throws SQLException {
    return new InvoiceLine(r.getInt("line_no"), r.getString("tariff_code"), r.getString("description"),
        LineCategory.valueOf(r.getString("category")), r.getString("hsn_sac"), r.getBigDecimal("qty"), r.getBigDecimal("rate"),
        r.getBigDecimal("gross"), r.getBigDecimal("discount"), r.getBigDecimal("taxable"), r.getBigDecimal("tax_pct"),
        r.getBigDecimal("cgst"), r.getBigDecimal("sgst"), r.getBigDecimal("igst"), r.getBigDecimal("amount"),
        r.getString("ref_type"), r.getString("ref_id"));
  }

  public Invoice get(UUID id) {
    Invoice inv = db.sql(SELECT + " where i.id = ?").param(id).query(InvoiceService::invoice).optional()
        .orElseThrow(() -> new ApiException(404, "Invoice not found"));
    if (!CurrentUser.get().canSee(inv.branchId())) throw new ApiException(404, "Invoice not found");
    var lines = db.sql("select * from billing_invoice_lines where invoice_id = ? order by line_no").param(id).query(InvoiceService::line).list();
    var pays = db.sql("select * from billing_payments where invoice_id = ? order by received_at, receipt_number").param(id)
        .query(InvoiceService::payment).list();
    return inv.withDetail(lines, pays);
  }

  public record Filter(String patientId, String status, InvoiceKind kind, LocalDate from, LocalDate to, String q, String branchId) {}

  /** Invoices newest first, without lines. Only the user's branches unless they are a super admin. */
  public List<Invoice> search(Filter f, int limit, int offset) {
    var me = CurrentUser.get();
    if (f.branchId() != null && !me.canSee(f.branchId())) throw new ApiException(403, "You cannot see this branch");
    String[] branches = f.branchId() != null ? new String[] { f.branchId() } : me.superAdmin() ? null : me.branches().toArray(String[]::new);
    String like = f.q() == null || f.q().isBlank() ? null : "%" + f.q().trim().toLowerCase() + "%";
    String status = f.status();
    boolean outstanding = "OUTSTANDING".equals(status);
    return db.sql(SELECT + """
         where (cast(:branches as text[]) is null or i.branch_id = any(cast(:branches as text[])))
           and (cast(:patient as text) is null or i.patient_id = :patient)
           and (cast(:status as text) is null or i.status = :status)
           and (not :outstanding or i.status in ('UNPAID','PARTIALLY_PAID'))
           and (cast(:kind as text) is null or i.kind = :kind)
           and (cast(:from as date) is null or i.invoice_date >= :from)
           and (cast(:to as date) is null or i.invoice_date <= :to)
           and (cast(:like as text) is null or lower(i.number) like :like or lower(p.name) like :like or lower(i.patient_id) like :like)
         order by i.invoice_date desc, i.created_at desc limit :limit offset :offset""")
        .param("branches", branches).param("patient", f.patientId()).param("status", outstanding ? null : status)
        .param("outstanding", outstanding).param("kind", f.kind() == null ? null : f.kind().name())
        .param("from", f.from()).param("to", f.to()).param("like", like).param("limit", limit).param("offset", offset)
        .query(InvoiceService::invoice).list();
  }
}
