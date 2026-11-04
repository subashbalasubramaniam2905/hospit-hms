package com.hospitos.billing.service;

import com.hospitos.audit.AuditService;
import com.hospitos.billing.api.PayMode;
import com.hospitos.billing.model.Claim;
import com.hospitos.billing.model.InsuranceProvider;
import com.hospitos.billing.model.Invoice;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Insurance pre-authorisations and claims. The workflow is DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → SETTLED,
 * with REJECTED reachable from SUBMITTED or UNDER_REVIEW and resubmittable. Settling posts an INSURANCE payment to the
 * linked invoice. There is no live TPA/NHCX connection yet: staff record each insurer response by hand.
 */
@Service
public class ClaimService {
  private static final Map<String, Set<String>> NEXT = Map.of(
      "DRAFT", Set.of("SUBMITTED"),
      "SUBMITTED", Set.of("UNDER_REVIEW", "REJECTED"),
      "UNDER_REVIEW", Set.of("APPROVED", "REJECTED"),
      "APPROVED", Set.of("SETTLED"),
      "REJECTED", Set.of("SUBMITTED"),
      "SETTLED", Set.of());
  public static final List<String> DOCUMENTS = List.of("Pre-auth form", "ID proof", "Policy card", "Doctor notes",
      "Investigation reports", "Invoice", "Discharge summary");

  private final JdbcClient db;
  private final InvoiceService invoices;
  private final SettingsService settings;
  private final Numbering numbering;
  private final AuditService audit;

  public ClaimService(JdbcClient db, InvoiceService invoices, SettingsService settings, Numbering numbering, AuditService audit) {
    this.db = db; this.invoices = invoices; this.settings = settings; this.numbering = numbering; this.audit = audit;
  }

  public List<InsuranceProvider> providers() {
    return db.sql("select * from billing_insurance_providers where active order by name").query((r, i) -> new InsuranceProvider(
        r.getString("id"), r.getString("name"), r.getString("tpa"), r.getString("type"), r.getString("phone"),
        r.getBoolean("cashless"), r.getBoolean("active"))).list();
  }

  public record NewClaim(UUID invoiceId, String patientId, String providerId, String policyNo, String type,
      BigDecimal claimed, BigDecimal copayPct, List<String> documents) {}

  @Transactional
  public Claim create(NewClaim in) {
    var me = CurrentUser.get();
    String type = in.type() == null ? (in.invoiceId() == null ? "PRE_AUTHORISATION" : "FINAL_CLAIM") : in.type();
    if (!Set.of("PRE_AUTHORISATION", "FINAL_CLAIM", "REIMBURSEMENT").contains(type)) throw new ApiException(400, "Unknown claim type");
    String patientId = in.patientId(), branch;
    BigDecimal copay = in.copayPct() != null ? in.copayPct() : settings.get().defaultCopayPct();
    BigDecimal claimed = in.claimed();
    if (in.invoiceId() != null) {
      Invoice inv = invoices.get(in.invoiceId());
      if ("CANCELLED".equals(inv.status())) throw new ApiException(422, "Invoice " + inv.number() + " is cancelled");
      if (patientId != null && !patientId.equals(inv.patientId())) throw new ApiException(422, "The invoice belongs to another patient");
      patientId = inv.patientId();
      branch = inv.branchId();
      BigDecimal max = inv.due();
      if (max.signum() <= 0) throw new ApiException(422, "Nothing is due on invoice " + inv.number() + " to claim");
      if (claimed == null)
        claimed = inv.total().multiply(BigDecimal.valueOf(100).subtract(copay)).divide(BigDecimal.valueOf(100), 0, RoundingMode.HALF_UP).min(max);
      if (claimed.compareTo(max) > 0) throw new ApiException(422, "Claim is more than the Rs " + max.toPlainString() + " still due on the invoice");
    } else {
      if (patientId == null) throw new ApiException(400, "patientId or invoiceId is required");
      branch = db.sql("select branch_id from patient where id = ?").param(patientId).query(String.class).optional()
          .orElseThrow(() -> new ApiException(422, "Patient " + in.patientId() + " not found"));
      if (claimed == null) throw new ApiException(400, "claimed amount is required without an invoice");
    }
    if (!me.canSee(branch)) throw new ApiException(403, "You cannot work on claims in this branch");
    if (claimed.signum() < 0) throw new ApiException(422, "Claimed amount cannot be negative");
    boolean provider = db.sql("select count(*) > 0 from billing_insurance_providers where id = ? and active").param(in.providerId())
        .query(Boolean.class).single();
    if (!provider) throw new ApiException(422, "Unknown insurer or TPA");
    if (in.policyNo() == null || in.policyNo().isBlank()) throw new ApiException(422, "Policy number is required");

    String number = numbering.next(settings.get().claimPrefix(), BillingTime.today());
    UUID id;
    try {
      id = db.sql("""
          insert into billing_claims (number, branch_id, patient_id, invoice_id, provider_id, policy_no, type, status, claimed, copay_pct,
            documents, created_by, created_by_name)
          values (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?) returning id""")
          .params(number, branch, patientId, in.invoiceId(), in.providerId(), in.policyNo().trim(), type, claimed, copay,
              docs(in.documents()), me.id(), me.name()).query(UUID.class).single();
    } catch (DuplicateKeyException e) {
      throw new ApiException(409, "This invoice already has an open claim");
    }
    event(id, "DRAFT", in.invoiceId() != null ? "Created from invoice" : "Created");
    audit.logForBranch(branch, "Created", "Claim", number, type + " Rs " + claimed.toPlainString() + " to " + in.providerId());
    return get(id);
  }

  private static String[] docs(List<String> d) {
    if (d == null) return new String[0];
    var s = new LinkedHashSet<String>();
    for (String x : d) if (x != null && !x.isBlank()) s.add(x.trim());
    return s.toArray(String[]::new);
  }

  @Transactional
  public Claim setDocuments(UUID id, List<String> documents, int version) {
    Claim c = get(id);
    if (!Set.of("DRAFT", "REJECTED").contains(c.status())) throw new ApiException(422, "Documents can only change before submission");
    int n = db.sql("update billing_claims set documents = ?, version = version + 1, updated_at = now() where id = ? and version = ?")
        .params(docs(documents), id, version).update();
    if (n == 0) throw new ApiException(409, "Someone else updated this claim. Reload and try again");
    return get(id);
  }

  public record Transition(String status, String note, BigDecimal approved, String rejectionReason, String settlementRef,
      BigDecimal settledAmount, Integer version) {}

  @Transactional
  public Claim transition(UUID id, Transition t) {
    if (t.version() == null) throw new ApiException(400, "version is required");
    Claim c = get(id);
    if (c.version() != t.version()) throw new ApiException(409, "Someone else updated this claim. Reload and try again");
    String to = t.status();
    if (!NEXT.getOrDefault(c.status(), Set.of()).contains(to))
      throw new ApiException(422, "A " + label(c.status()) + " claim cannot move to " + label(to));
    BigDecimal approved = c.approved(), settled = c.settled();
    String reason = c.rejectionReason(), ref = c.settlementRef(), note = t.note();
    switch (to) {
      case "SUBMITTED" -> {
        if (c.documents().size() < 2) throw new ApiException(422, "Attach at least two documents before submitting");
        reason = null;
        if (note == null) note = "Submitted with " + c.documents().size() + " documents";
      }
      case "APPROVED" -> {
        if (t.approved() == null || t.approved().signum() <= 0) throw new ApiException(422, "Enter the approved amount");
        if (t.approved().compareTo(c.claimed()) > 0) throw new ApiException(422, "Approved amount cannot be more than the claimed Rs " + c.claimed().toPlainString());
        approved = t.approved();
        if (note == null) note = "Approved Rs " + approved.toPlainString();
      }
      case "REJECTED" -> {
        if (t.rejectionReason() == null || t.rejectionReason().isBlank()) throw new ApiException(422, "Give the rejection reason");
        reason = t.rejectionReason().trim();
        if (note == null) note = reason;
      }
      case "SETTLED" -> {
        if (t.settlementRef() == null || t.settlementRef().isBlank()) throw new ApiException(422, "Enter the UTR or settlement reference");
        settled = t.settledAmount() != null ? t.settledAmount() : approved;
        if (settled.signum() <= 0 || settled.compareTo(approved) > 0) throw new ApiException(422, "Settled amount must be above zero and no more than the approved Rs " + approved.toPlainString());
        ref = t.settlementRef().trim();
        if (c.invoiceId() != null && !"PRE_AUTHORISATION".equals(c.type())) {
          BigDecimal due = invoices.get(c.invoiceId()).due();
          BigDecimal post = settled.min(due);
          if (post.signum() > 0) invoices.pay(c.invoiceId(), PayMode.INSURANCE, post, c.number() + " " + ref);
        }
        if (note == null) note = "Settled Rs " + settled.toPlainString() + ", UTR " + ref;
      }
      default -> { if (note == null) note = label(to); }
    }
    db.sql("""
        update billing_claims set status = ?, approved = ?, settled = ?, rejection_reason = ?, settlement_ref = ?,
          version = version + 1, updated_at = now() where id = ?""")
        .params(to, approved, settled, reason, ref, id).update();
    event(id, to, note);
    audit.logForBranch(c.branchId(), "Updated", "Claim", c.number(), label(c.status()) + " -> " + label(to) + (note == null ? "" : ": " + note));
    return get(id);
  }

  private void event(UUID claimId, String status, String note) {
    var me = CurrentUser.get();
    db.sql("insert into billing_claim_events (claim_id, status, note, by_user, by_name) values (?, ?, ?, ?, ?)")
        .params(claimId, status, note, me.id(), me.name()).update();
  }

  private static String label(String s) { return s.replace('_', ' ').toLowerCase(); }

  private static final String SELECT = """
      select c.*, p.name as patient_name, i.number as invoice_number, ip.name as provider_name, ip.tpa
      from billing_claims c join patient p on p.id = c.patient_id join billing_insurance_providers ip on ip.id = c.provider_id
      left join billing_invoices i on i.id = c.invoice_id
      """;

  private static List<String> arr(Array a) throws SQLException { return a == null ? List.of() : Arrays.asList((String[]) a.getArray()); }

  private static Claim claim(ResultSet r, int i) throws SQLException {
    return new Claim((UUID) r.getObject("id"), r.getString("number"), r.getString("branch_id"), r.getString("patient_id"),
        r.getString("patient_name"), (UUID) r.getObject("invoice_id"), r.getString("invoice_number"), r.getString("provider_id"),
        r.getString("provider_name"), r.getString("tpa"), r.getString("policy_no"), r.getString("type"), r.getString("status"),
        r.getBigDecimal("claimed"), r.getBigDecimal("approved"), r.getBigDecimal("settled"), r.getBigDecimal("copay_pct"),
        arr(r.getArray("documents")), r.getString("rejection_reason"), r.getString("settlement_ref"), r.getString("created_by_name"),
        r.getObject("created_at", OffsetDateTime.class).toInstant(), r.getInt("version"), null);
  }

  public Claim get(UUID id) {
    Claim c = db.sql(SELECT + " where c.id = ?").param(id).query(ClaimService::claim).optional()
        .orElseThrow(() -> new ApiException(404, "Claim not found"));
    if (!CurrentUser.get().canSee(c.branchId())) throw new ApiException(404, "Claim not found");
    var h = db.sql("select * from billing_claim_events where claim_id = ? order by at, id").param(id)
        .query((r, i) -> new Claim.Event(r.getString("status"), r.getString("note"), r.getObject("at", OffsetDateTime.class).toInstant(),
            r.getString("by_name"))).list();
    return c.withHistory(h);
  }

  public List<Claim> search(String status, String patientId) {
    var me = CurrentUser.get();
    String[] branches = me.superAdmin() ? null : me.branches().toArray(String[]::new);
    return db.sql(SELECT + """
         where (cast(:branches as text[]) is null or c.branch_id = any(cast(:branches as text[])))
           and (cast(:status as text) is null or c.status = :status)
           and (cast(:patient as text) is null or c.patient_id = :patient)
         order by c.created_at desc limit 500""")
        .param("branches", branches).param("status", status).param("patient", patientId).query(ClaimService::claim).list();
  }
}
