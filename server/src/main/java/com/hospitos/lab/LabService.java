package com.hospitos.lab;

import com.hospitos.audit.AuditService;
import com.hospitos.billing.api.BillingApi;
import com.hospitos.billing.api.InvoiceKind;
import com.hospitos.billing.api.LineCategory;
import com.hospitos.billing.api.NewInvoice;
import com.hospitos.billing.api.NewInvoiceLine;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import com.hospitos.lab.LabDtos.Critical;
import com.hospitos.lab.LabDtos.LabOrder;
import com.hospitos.lab.LabDtos.LabTest;
import com.hospitos.lab.LabDtos.NewOrder;
import com.hospitos.lab.LabDtos.Param;
import com.hospitos.lab.LabDtos.Report;
import com.hospitos.lab.LabDtos.ReportParam;
import com.hospitos.lab.LabDtos.ReportPatient;
import com.hospitos.lab.LabDtos.ReportTest;
import com.hospitos.lab.LabDtos.ResultsInput;
import com.hospitos.lab.LabDtos.Verified;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Lab workflow: Awaiting sample → Sample collected → Processing → Result ready → Verified → Delivered.
 * A rejected sample goes back to Awaiting sample, and Result ready can be reopened for editing until it is verified.
 */
@Service
public class LabService {
  static final Set<String> PRIORITIES = Set.of("Routine", "Urgent", "STAT");
  private final LabRepository repo;
  private final BillingApi billing;
  private final AuditService audit;
  public LabService(LabRepository repo, BillingApi billing, AuditService audit) { this.repo = repo; this.billing = billing; this.audit = audit; }

  /** Normal, low, high or critical, from the parameter's reference and critical limits. */
  static String flag(Param p, BigDecimal v) {
    if (v == null) return "";
    if ((p.critLow() != null && v.compareTo(p.critLow()) <= 0) || (p.critHigh() != null && v.compareTo(p.critHigh()) >= 0)) return "C";
    if (v.compareTo(p.low()) < 0) return "L";
    if (v.compareTo(p.high()) > 0) return "H";
    return "N";
  }

  LabOrder visible(String id) {
    var o = repo.order(id).orElseThrow(() -> new ApiException(404, "Lab order not found"));
    if (!CurrentUser.get().canSee(o.branchId())) throw new ApiException(404, "Lab order not found");
    return o;
  }

  @Transactional
  public LabOrder create(NewOrder in) {
    var me = CurrentUser.get();
    var patient = repo.patient(in.patientId()).orElseThrow(() -> new ApiException(400, "Patient not found"));
    if (!me.canSee(patient.branchId())) throw new ApiException(400, "Patient not found");
    String branch = in.branchId() == null || in.branchId().isBlank() ? patient.branchId() : in.branchId();
    if (!me.canSee(branch)) throw new ApiException(403, "You do not have access to this branch");
    String priority = in.priority() == null || in.priority().isBlank() ? "Routine" : in.priority();
    if (!PRIORITIES.contains(priority)) throw new ApiException(400, "Priority must be Routine, Urgent or STAT");
    String doctor = in.doctorId() == null || in.doctorId().isBlank() ? null : in.doctorId();
    if (doctor != null && !repo.doctorExists(doctor)) throw new ApiException(400, "Unknown doctor " + doctor);
    var catalogue = repo.testMap();
    var ids = new LinkedHashSet<>(in.testIds());
    var tests = new ArrayList<LabTest>();
    for (String t : ids) {
      var test = catalogue.get(t);
      if (test == null) throw new ApiException(400, "Unknown lab test " + t);
      tests.add(test);
    }
    String id = repo.nextOrderId();
    repo.insertOrder(id, branch, patient.id(), doctor, priority, me.id(), blank(in.comments()));
    int pos = 0;
    for (var t : tests) repo.insertOrderTest(id, t.id(), ++pos, t.price());
    if (in.bill() == null || in.bill()) {
      var lines = tests.stream().map(t -> NewInvoiceLine.of(t.name(), LineCategory.LABORATORY, BigDecimal.ONE, t.price(), null,
          "LAB_ORDER", id)).toList();
      var inv = billing.createInvoice(new NewInvoice(patient.id(), InvoiceKind.LAB, branch, lines, BigDecimal.ZERO, null, "LAB_ORDER", id, null));
      repo.setInvoice(id, inv.id(), inv.number());
    }
    audit.logForBranch(branch, "Created", "Lab order", id, patient.name() + ": " + tests.stream().map(LabTest::code).collect(Collectors.joining(", "))
        + (priority.equals("Routine") ? "" : " (" + priority + ")"));
    return repo.order(id).orElseThrow();
  }

  @Transactional
  public LabOrder collect(String id) {
    var me = CurrentUser.get();
    var o = visible(id);
    String sample = repo.nextSampleId();
    if (!repo.transition(id, List.of("Ordered", "Awaiting sample"), "Sample collected",
        "sample_id = ?, collected_at = now(), collected_by = ?", sample, me.name()))
      throw new ApiException(409, "This order is " + o.status().toLowerCase() + "; its sample has already been collected");
    audit.logForBranch(o.branchId(), "Collected", "Lab sample", id, sample + " for " + o.patientName());
    return repo.order(id).orElseThrow();
  }

  @Transactional
  public LabOrder reject(String id, String reason) {
    var o = visible(id);
    if (!repo.transition(id, List.of("Sample collected", "Processing"), "Awaiting sample",
        "sample_id = null, collected_at = null, collected_by = null, comments = ?", "Sample rejected: " + reason.trim() + ". Recollect."))
      throw new ApiException(409, "Only a collected sample that has no results yet can be rejected");
    audit.logForBranch(o.branchId(), "Rejected", "Lab sample", id, o.sampleId() + ": " + reason.trim());
    return repo.order(id).orElseThrow();
  }

  @Transactional
  public LabOrder receive(String id) {
    var o = visible(id);
    if (!repo.transition(id, List.of("Sample collected"), "Processing", ""))
      throw new ApiException(409, "This order is " + o.status().toLowerCase() + ", not waiting to be received");
    audit.logForBranch(o.branchId(), "Received", "Lab sample", id, o.sampleId() + " accepted in lab");
    return repo.order(id).orElseThrow();
  }

  /**
   * Saves result values. With submit=true every parameter must have a value and the order moves to Result ready;
   * otherwise the values are kept as a draft while the order is processing.
   */
  @Transactional
  public LabOrder saveResults(String id, ResultsInput in) {
    var me = CurrentUser.get();
    var o = visible(id);
    if (!List.of("Sample collected", "Processing").contains(o.status()))
      throw new ApiException(409, o.status().equals("Result ready") ? "Reopen the results before editing them" : "Results cannot be entered while the order is " + o.status().toLowerCase());
    var catalogue = repo.testMap();
    for (var e : in.results().entrySet())
      if (!o.testIds().contains(e.getKey())) throw new ApiException(400, "Test " + e.getKey() + " is not on this order");
    boolean submit = Boolean.TRUE.equals(in.submit());
    var missing = new ArrayList<String>();
    for (String tid : o.testIds()) {
      var t = catalogue.get(tid);
      Map<String, BigDecimal> values = in.results().getOrDefault(tid, Map.of());
      var names = t.params().stream().map(Param::name).collect(Collectors.toSet());
      for (String k : values.keySet()) if (!names.contains(k)) throw new ApiException(400, t.name() + " has no parameter " + k);
      for (var p : t.params()) {
        BigDecimal v = values.get(p.name());
        if (v == null) { missing.add(t.code() + " " + p.name()); repo.deleteResult(id, tid, p.name()); }
        else repo.putResult(id, tid, p.name(), v, flag(p, v));
      }
    }
    if (submit && !missing.isEmpty()) throw new ApiException(422, "Enter every result before saving: " + String.join(", ", missing));
    String status = submit ? "Result ready" : "Processing";
    if (!repo.saveHeader(id, in.version(), blank(in.comments()), status, submit ? me.name() : null))
      throw new ApiException(409, "Someone else updated this order. Reload and try again");
    audit.logForBranch(o.branchId(), "Updated", "Lab result", id, submit ? "Results entered" : "Draft results saved");
    return repo.order(id).orElseThrow();
  }

  @Transactional
  public LabOrder reopen(String id) {
    var o = visible(id);
    if (!repo.transition(id, List.of("Result ready"), "Processing", ""))
      throw new ApiException(409, "Only unverified results can be reopened");
    audit.logForBranch(o.branchId(), "Reopened", "Lab result", id, o.patientName());
    return repo.order(id).orElseThrow();
  }

  @Transactional
  public Verified verify(String id) {
    var me = CurrentUser.get();
    var o = visible(id);
    if (!repo.transition(id, List.of("Result ready"), "Verified", "verified_by = ?, verified_by_user = ?, verified_at = now()", me.name(), me.id()))
      throw new ApiException(409, "This order is " + o.status().toLowerCase() + ", not ready to verify");
    var order = repo.order(id).orElseThrow();
    var crit = criticals(order, repo.testMap());
    audit.logForBranch(o.branchId(), "Verified", "Lab result", id, "Verified by " + me.name());
    for (var c : crit)
      audit.logForBranch(o.branchId(), "Critical value", "Lab result", id, c.param() + " " + c.value().toPlainString() + " " + c.unit() + " for " + order.patientName()
          + (order.doctorName() == null ? "" : ", inform " + order.doctorName()));
    return new Verified(order, crit);
  }

  @Transactional
  public LabOrder deliver(String id) {
    var o = visible(id);
    if (!repo.transition(id, List.of("Verified"), "Delivered", "delivered_at = now()"))
      throw new ApiException(409, "Only a verified report can be delivered");
    audit.logForBranch(o.branchId(), "Delivered", "Lab report", id, o.patientName());
    return repo.order(id).orElseThrow();
  }

  static List<Critical> criticals(LabOrder o, Map<String, LabTest> catalogue) {
    var out = new ArrayList<Critical>();
    for (String tid : o.testIds()) {
      var t = catalogue.get(tid);
      var flags = o.flags().getOrDefault(tid, Map.of());
      for (var p : t.params())
        if ("C".equals(flags.get(p.name()))) {
          BigDecimal v = o.results().get(tid).get(p.name());
          boolean high = p.critHigh() != null && v.compareTo(p.critHigh()) >= 0;
          out.add(new Critical(tid, t.name(), p.name(), v, p.unit(), high ? "Critical high" : "Critical low"));
        }
    }
    return out;
  }

  /** The printable report: every parameter with its reference range, flag and the patient's previous verified value. */
  public Report report(String id) {
    var o = visible(id);
    var catalogue = repo.testMap();
    var prev = repo.previous(o.patientId(), o.id(), o.orderedAt());
    var tests = new ArrayList<ReportTest>();
    for (String tid : o.testIds()) {
      var t = catalogue.get(tid);
      var values = o.results().getOrDefault(tid, Map.of());
      var flags = o.flags().getOrDefault(tid, Map.of());
      var params = t.params().stream().map(p -> {
        var pv = prev.get(tid + "|" + p.name());
        return new ReportParam(p.name(), p.unit(), p.low(), p.high(), values.get(p.name()), flags.getOrDefault(p.name(), ""),
            pv == null ? null : pv.getKey(), pv == null ? null : pv.getValue());
      }).toList();
      tests.add(new ReportTest(t.id(), t.code(), t.name(), t.category(), t.sample(), params));
    }
    var p = repo.patient(o.patientId()).orElseThrow();
    audit.logForBranch(o.branchId(), "Viewed", "Lab report", id, o.patientName());
    return new Report(o, new ReportPatient(p.id(), p.name(), p.dob(), p.gender(), p.mobile()), tests, criticals(o, catalogue));
  }

  private static String blank(String s) { return s == null || s.isBlank() ? null : s.trim(); }
}
