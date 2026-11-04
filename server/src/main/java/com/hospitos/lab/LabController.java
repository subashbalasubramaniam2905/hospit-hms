package com.hospitos.lab;

import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import com.hospitos.lab.LabDtos.LabOrder;
import com.hospitos.lab.LabDtos.LabTest;
import com.hospitos.lab.LabDtos.NewOrder;
import com.hospitos.lab.LabDtos.RejectInput;
import com.hospitos.lab.LabDtos.Report;
import com.hospitos.lab.LabDtos.ResultsInput;
import com.hospitos.lab.LabDtos.Verified;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** Lab test catalogue, orders, sample collection, result entry, verification and reports. */
@RestController
@RequestMapping("/api/lab")
@PreAuthorize("hasAnyRole('super-admin','admin','lab-tech','doctor','nurse','receptionist','billing')")
public class LabController {
  static final String ORDERERS = "hasAnyRole('super-admin','admin','lab-tech','doctor','nurse','receptionist')";
  static final String LAB = "hasAnyRole('super-admin','admin','lab-tech')";
  static final String VERIFIERS = "hasAnyRole('super-admin','admin','lab-tech','doctor')";
  private final LabRepository repo;
  private final LabService lab;
  private final AuditService audit;
  public LabController(LabRepository repo, LabService lab, AuditService audit) { this.repo = repo; this.lab = lab; this.audit = audit; }

  @GetMapping("/tests")
  public List<LabTest> tests() { return repo.tests(false); }

  /** Orders in the user's branches. status takes a comma-separated list, for example Awaiting sample,Ordered. */
  @GetMapping("/orders")
  public List<LabOrder> orders(@RequestParam(defaultValue = "") String status, @RequestParam(required = false) String patientId,
                               @RequestParam(required = false) String priority, @RequestParam(defaultValue = "") String q,
                               @RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to,
                               @RequestParam(defaultValue = "200") int limit) {
    var me = CurrentUser.get();
    var statuses = Arrays.stream(status.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    var out = repo.search(me.superAdmin() ? null : me.branches(), statuses, patientId, priority, q, from, to, Math.min(Math.max(limit, 1), 1000));
    if (patientId != null && !patientId.isBlank()) audit.logForBranch(me.homeBranch(), "Viewed", "Lab results", patientId, out.size() + " lab orders");
    return out;
  }

  @GetMapping("/orders/{id}")
  public LabOrder order(@PathVariable String id) {
    var o = lab.visible(id);
    audit.logForBranch(o.branchId(), "Viewed", "Lab order", id, o.patientName());
    return o;
  }

  /** Looks an order up by its barcode (sample id) or order id, as the sample screen's scanner does. */
  @GetMapping("/scan/{code}")
  public LabOrder scan(@PathVariable String code) {
    String c = code.trim().toUpperCase();
    var o = repo.bySample(c).or(() -> repo.order(c)).orElseThrow(() -> new ApiException(404, "No sample or order matches " + c));
    if (!CurrentUser.get().canSee(o.branchId())) throw new ApiException(404, "No sample or order matches " + c);
    return o;
  }

  @PostMapping("/orders")
  @ResponseStatus(HttpStatus.CREATED)
  @PreAuthorize(ORDERERS)
  public LabOrder create(@Valid @RequestBody NewOrder in) { return lab.create(in); }

  @PostMapping("/orders/{id}/collect")
  @PreAuthorize("hasAnyRole('super-admin','admin','lab-tech','nurse')")
  public LabOrder collect(@PathVariable String id) { return lab.collect(id); }

  @PostMapping("/orders/{id}/reject")
  @PreAuthorize(LAB)
  public LabOrder reject(@PathVariable String id, @Valid @RequestBody RejectInput in) { return lab.reject(id, in.reason()); }

  @PostMapping("/orders/{id}/receive")
  @PreAuthorize(LAB)
  public LabOrder receive(@PathVariable String id) { return lab.receive(id); }

  @PutMapping("/orders/{id}/results")
  @PreAuthorize(LAB)
  public LabOrder results(@PathVariable String id, @Valid @RequestBody ResultsInput in) { return lab.saveResults(id, in); }

  @PostMapping("/orders/{id}/reopen")
  @PreAuthorize(VERIFIERS)
  public LabOrder reopen(@PathVariable String id) { return lab.reopen(id); }

  @PostMapping("/orders/{id}/verify")
  @PreAuthorize(VERIFIERS)
  public Verified verify(@PathVariable String id) { return lab.verify(id); }

  @PostMapping("/orders/{id}/deliver")
  @PreAuthorize(LAB)
  public LabOrder deliver(@PathVariable String id) { return lab.deliver(id); }

  @GetMapping("/orders/{id}/report")
  public Report report(@PathVariable String id) { return lab.report(id); }
}
