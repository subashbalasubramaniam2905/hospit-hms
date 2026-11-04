package com.hospitos.pharmacy;

import com.hospitos.audit.AuditService;
import com.hospitos.billing.api.BillingApi;
import com.hospitos.billing.api.InvoiceKind;
import com.hospitos.billing.api.LineCategory;
import com.hospitos.billing.api.NewInvoice;
import com.hospitos.billing.api.NewInvoiceLine;
import com.hospitos.billing.api.PayMode;
import com.hospitos.clinical.prescription.PrescriptionService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import com.hospitos.pharmacy.PharmacyDtos.DispenseInput;
import com.hospitos.pharmacy.PharmacyDtos.DispenseResult;
import com.hospitos.pharmacy.PharmacyDtos.DispensedLine;
import com.hospitos.pharmacy.PharmacyDtos.FefoPick;
import com.hospitos.pharmacy.PharmacyDtos.LowStock;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Dispenses a signed prescription: takes stock first-expiry-first-out, bills and records payment through billing,
 * and moves the prescription to Dispensed or Partially dispensed. All of it happens in one transaction.
 */
@Service
public class DispenseService {
  static final Set<String> WAITING = Set.of("Sent to pharmacy", "Partially dispensed");
  private final PharmacyRepository repo;
  private final PrescriptionService prescriptions;
  private final BillingApi billing;
  private final AuditService audit;
  private final JdbcClient db;

  public DispenseService(PharmacyRepository repo, PrescriptionService prescriptions, BillingApi billing, AuditService audit, JdbcClient db) {
    this.repo = repo; this.prescriptions = prescriptions; this.billing = billing; this.audit = audit; this.db = db;
  }

  /** Accepts the Angular labels ("Cash", "UPI", "Bank transfer") as well as the enum names. */
  static PayMode payMode(String s) {
    try { return PayMode.valueOf(s.trim().toUpperCase().replace(' ', '_')); }
    catch (IllegalArgumentException e) { throw new ApiException(400, "Unknown payment mode " + s); }
  }

  private static String label(String name) {
    return switch (name) { case "UPI" -> "UPI"; case "BANK_TRANSFER" -> "Bank transfer";
      default -> name.charAt(0) + name.substring(1).toLowerCase(); };
  }

  private record Pending(String medicineId, String substitutedFor, String name, int requested, int qty, BigDecimal rate, BigDecimal gst,
                         BigDecimal amount, List<FefoPick> picks) {}

  @Transactional
  public DispenseResult dispense(DispenseInput in) {
    var me = CurrentUser.get();
    // Serialise dispenses of the same prescription so two counters cannot both hand out the remaining quantity.
    db.sql("select 1 from (select pg_advisory_xact_lock(hashtextextended(?, 0))) x").param("rx:" + in.prescriptionId())
        .query(Integer.class).single();
    var rx = prescriptions.find(in.prescriptionId()).orElseThrow(() -> new ApiException(404, "Prescription not found"));
    if (!me.canSee(rx.branchId())) throw new ApiException(404, "Prescription not found");
    if (!WAITING.contains(rx.status())) throw new ApiException(409, "This prescription is " + rx.status().toLowerCase() + ", not waiting for the pharmacy");
    PayMode mode = payMode(in.payMode());

    var prescribed = new LinkedHashMap<String, Integer>();
    rx.items().forEach(i -> { if (i.medId() != null) prescribed.merge(i.medId(), i.qty(), Integer::sum); });
    var given = new HashMap<>(repo.alreadyDispensed(rx.id()));

    var pending = new ArrayList<Pending>();
    var seen = new java.util.HashSet<String>();
    for (var l : in.lines()) {
      if (!seen.add(l.medicineId())) throw new ApiException(400, "List each medicine once");
      if (l.qty() == 0) continue;
      String sub = l.substitutedFor() == null || l.substitutedFor().isBlank() ? null : l.substitutedFor();
      if (l.medicineId().equals(sub)) sub = null;
      String key = sub != null ? sub : l.medicineId();
      if (!prescribed.containsKey(key)) throw new ApiException(400, key + " is not on this prescription");
      var med = repo.medicine(l.medicineId()).orElseThrow(() -> new ApiException(400, "Unknown medicine " + l.medicineId()));
      if (!med.active()) throw new ApiException(422, med.label() + " is no longer stocked");
      if (sub != null) {
        var orig = repo.medicine(sub).orElseThrow(() -> new ApiException(400, "Unknown medicine " + l.substitutedFor()));
        if (!orig.generic().equalsIgnoreCase(med.generic()))
          throw new ApiException(422, med.label() + " cannot replace " + orig.label() + ": the generic is different");
      }
      int remaining = prescribed.get(key) - given.getOrDefault(key, 0);
      if (l.qty() > remaining)
        throw new ApiException(422, "Only " + Math.max(remaining, 0) + " more of " + med.label() + " can be dispensed on this prescription");
      var picks = PharmacyRepository.pick(repo.lockUsable(med.id(), rx.branchId()), l.qty());
      int got = picks.stream().mapToInt(FefoPick::take).sum();
      given.merge(key, got, Integer::sum);
      BigDecimal amount = med.price().multiply(BigDecimal.valueOf(got))
          .multiply(BigDecimal.ONE.add(med.gstPct().movePointLeft(2))).setScale(2, RoundingMode.HALF_UP);
      pending.add(new Pending(med.id(), sub, med.label() + " (" + med.generic() + ")", l.qty(), got, med.price(), med.gstPct(), amount, picks));
    }
    if (pending.stream().noneMatch(p -> p.qty() > 0)) throw new ApiException(422, "None of these medicines are in stock");
    boolean partial = prescribed.entrySet().stream().anyMatch(e -> given.getOrDefault(e.getKey(), 0) < e.getValue());

    String ref = "RX-" + rx.id().toString().substring(0, 8).toUpperCase();
    var invoiceLines = new ArrayList<NewInvoiceLine>();
    for (var p : pending) {
      if (p.qty() == 0) continue;
      for (var pk : p.picks()) {
        repo.take(pk.batchId(), pk.take());
        repo.move(rx.branchId(), p.medicineId(), pk.batchId(), pk.batch(), "Dispense", -pk.take(), ref, null, me.id(), me.name());
      }
      invoiceLines.add(NewInvoiceLine.of(p.name(), LineCategory.PHARMACY, BigDecimal.valueOf(p.qty()), p.rate(), p.gst(),
          "PRESCRIPTION", rx.id().toString()));
    }
    var inv = billing.createInvoice(new NewInvoice(rx.patientId(), InvoiceKind.PHARMACY, rx.branchId(), invoiceLines, BigDecimal.ZERO,
        null, "PRESCRIPTION", rx.id().toString(), null));
    billing.recordPayment(inv.id(), mode, inv.total(), null);
    prescriptions.markDispensed(rx.id(), partial);

    UUID id = repo.insertDispense(rx.branchId(), rx.id(), rx.patientId(), partial, label(mode.name()), inv.total(), inv.id(), inv.number(),
        Boolean.TRUE.equals(in.counselled()), me.id(), me.name());
    var lines = new ArrayList<DispensedLine>();
    int pos = 0;
    for (var p : pending) {
      String batches = p.picks().stream().map(k -> k.batch() + "x" + k.take()).collect(Collectors.joining(", "));
      repo.insertLine(id, ++pos, p.medicineId(), p.substitutedFor(), p.requested(), p.qty(), p.rate(), p.gst(), p.amount(), batches);
      lines.add(new DispensedLine(p.medicineId(), p.name(), p.substitutedFor(), p.requested(), p.qty(), p.rate(), p.gst(), p.amount(), p.picks()));
    }

    var low = new ArrayList<LowStock>();
    for (var p : pending) {
      var m = repo.medicine(p.medicineId()).orElseThrow();
      int stock = repo.stock(m.id(), rx.branchId());
      if (stock < m.reorder() && low.stream().noneMatch(x -> x.medicineId().equals(m.id())))
        low.add(new LowStock(m.id(), m.label(), stock, m.reorder()));
    }
    audit.logForBranch(rx.branchId(), "Dispensed", "Prescription", rx.id().toString(), (partial ? "Partly dispensed " : "Dispensed ")
        + lines.stream().filter(l -> l.qty() > 0).map(l -> l.name() + " x" + l.qty()).collect(Collectors.joining(", "))
        + " for " + rx.patientId() + ", invoice " + inv.number());
    return new DispenseResult(id, rx.id(), rx.patientId(), rx.branchId(), partial ? "Partially dispensed" : "Dispensed", partial,
        label(mode.name()), inv.total(), inv.id(), inv.number(), lines, low, OffsetDateTime.now(), me.name());
  }

  /** Validates a prescription is visible and returns how much of each medicine is still to be dispensed. */
  public Map<String, Integer> remaining(UUID rxId) {
    var me = CurrentUser.get();
    var rx = prescriptions.find(rxId).orElseThrow(() -> new ApiException(404, "Prescription not found"));
    if (!me.canSee(rx.branchId())) throw new ApiException(404, "Prescription not found");
    var given = repo.alreadyDispensed(rxId);
    var out = new LinkedHashMap<String, Integer>();
    rx.items().forEach(i -> { if (i.medId() != null) out.merge(i.medId(), i.qty(), Integer::sum); });
    out.replaceAll((k, v) -> Math.max(0, v - given.getOrDefault(k, 0)));
    return out;
  }
}
