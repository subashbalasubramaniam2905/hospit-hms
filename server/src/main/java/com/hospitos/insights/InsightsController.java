package com.hospitos.insights;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/insights")
public class InsightsController {
  static final String ADMINS = "hasAnyRole('super-admin','admin')";
  static final String STAFF = "hasAnyRole('super-admin','admin','doctor','nurse','receptionist','pharmacist','lab-tech','radiologist','billing','hr','inventory')";

  private final DashboardService dashboard;
  private final ReportService reports;
  private final BranchService branches;
  private final AlertService alerts;
  private final FollowUpService followUps;
  private final LeakageService leakage;
  private final SafetyReviewService safety;

  public InsightsController(DashboardService dashboard, ReportService reports, BranchService branches, AlertService alerts,
                            FollowUpService followUps, LeakageService leakage, SafetyReviewService safety) {
    this.dashboard = dashboard; this.reports = reports; this.branches = branches; this.alerts = alerts;
    this.followUps = followUps; this.leakage = leakage; this.safety = safety;
  }

  @GetMapping("/dashboard")
  @PreAuthorize(STAFF)
  public DashboardService.Dashboard dashboard(@RequestParam(required = false) String branch) { return dashboard.get(branch); }

  @GetMapping("/reports/{id}")
  @PreAuthorize("hasAnyRole('super-admin','admin','billing','hr')")
  public ReportService.Report report(@PathVariable String id, @RequestParam(defaultValue = "30") int days,
                                     @RequestParam(required = false) String deptId, @RequestParam(required = false) String branch) {
    return reports.get(id, days, deptId, branch);
  }

  @GetMapping("/branches")
  @PreAuthorize(ADMINS)
  public List<BranchService.BranchStats> branches() { return branches.list(); }

  // ---------------------------------------------------------------- alerts

  @GetMapping("/alerts")
  @PreAuthorize(STAFF)
  public List<AlertService.Alert> alerts(@RequestParam(required = false) String branch, @RequestParam(required = false) String status) {
    return alerts.list(branch, status);
  }

  public record AlertStatus(@NotBlank String status, String note) {}
  public record Assign(@NotBlank String assignee) {}

  @PostMapping("/alerts/{id}/status")
  @PreAuthorize(STAFF)
  public AlertService.Alert alertStatus(@PathVariable long id, @Valid @RequestBody AlertStatus in) { return alerts.setStatus(id, in.status(), in.note()); }

  @PostMapping("/alerts/{id}/assign")
  @PreAuthorize(STAFF)
  public AlertService.Alert assign(@PathVariable long id, @Valid @RequestBody Assign in) { return alerts.assign(id, in.assignee()); }

  @PostMapping("/alerts/acknowledge-low")
  @PreAuthorize(STAFF)
  public Map<String, Integer> ackLow(@RequestParam(required = false) String branch) { return Map.of("acknowledged", alerts.acknowledgeLow(branch)); }

  // ---------------------------------------------------------------- follow-ups

  @GetMapping("/followups")
  @PreAuthorize("hasAnyRole('super-admin','admin','doctor','nurse','receptionist')")
  public List<FollowUpService.FollowUp> followUps(@RequestParam(required = false) String branch, @RequestParam(required = false) String doctorId) {
    return followUps.list(branch, doctorId);
  }

  public record Remind(@NotEmpty List<String> ids) {}

  @PostMapping("/followups/remind")
  @PreAuthorize("hasAnyRole('super-admin','admin','doctor','nurse','receptionist')")
  public Map<String, Integer> remind(@Valid @RequestBody Remind in) { return Map.of("reminded", followUps.remind(in.ids())); }

  // ---------------------------------------------------------------- leakage

  @GetMapping("/leakage")
  @PreAuthorize("hasAnyRole('super-admin','admin','billing')")
  public List<LeakageService.Finding> leakage(@RequestParam(required = false) String branch) { return leakage.list(branch); }

  public record Review(@NotBlank String key, @NotBlank String action, @NotBlank String reason) {}

  @PostMapping("/leakage/review")
  @PreAuthorize("hasAnyRole('super-admin','admin','billing')")
  public void review(@Valid @RequestBody Review in) { leakage.review(in.key(), in.action(), in.reason()); }

  // ---------------------------------------------------------------- medication safety

  @GetMapping("/safety")
  @PreAuthorize("hasAnyRole('super-admin','admin','doctor','pharmacist','nurse')")
  public SafetyReviewService.Result safety(@RequestParam(required = false) String branch) { return safety.list(branch); }

  public record SafetyReview(@NotNull UUID prescriptionId, @NotBlank String alertCode, @NotBlank String outcome, String note) {}

  @PostMapping("/safety/review")
  @PreAuthorize("hasAnyRole('super-admin','admin','doctor','pharmacist')")
  public void safetyReview(@Valid @RequestBody SafetyReview in) { safety.review(in.prescriptionId(), in.alertCode(), in.outcome(), in.note()); }
}
