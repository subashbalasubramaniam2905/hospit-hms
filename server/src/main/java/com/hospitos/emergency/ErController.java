package com.hospitos.emergency;

import com.hospitos.audit.AuditService;
import com.hospitos.common.CurrentUser;
import com.hospitos.emergency.ErDtos.AdmittedInput;
import com.hospitos.emergency.ErDtos.Bay;
import com.hospitos.emergency.ErDtos.ErCase;
import com.hospitos.emergency.ErDtos.LinkInput;
import com.hospitos.emergency.ErDtos.NewCase;
import com.hospitos.emergency.ErDtos.OrderInput;
import com.hospitos.emergency.ErDtos.StatusInput;
import com.hospitos.emergency.ErDtos.Update;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** Emergency triage board: arrivals, bays, re-triage, orders, linking unknown patients and disposition. */
@RestController
@RequestMapping("/api/er")
@PreAuthorize(ErController.FRONT)
public class ErController {
  /** Everyone who works the ER desk: registration, linking and the admission hand-off. */
  static final String FRONT = "hasAnyRole('super-admin','admin','doctor','nurse','receptionist')";
  /** Clinical decisions: triage, doctor, orders and disposition. */
  static final String CLINICAL = "hasAnyRole('super-admin','admin','doctor','nurse')";
  private final ErService er;
  private final ErRepository repo;
  private final AuditService audit;
  public ErController(ErService er, ErRepository repo, AuditService audit) { this.er = er; this.repo = repo; this.audit = audit; }

  @GetMapping("/bays")
  public List<Bay> bays(@RequestParam(required = false) String branchId) { return repo.bays(er.branch(branchId)); }

  /** The board: open cases in the branch and those closed today. With patientId, that patient's ER visits instead. */
  @GetMapping("/cases")
  public List<ErCase> cases(@RequestParam(required = false) String branchId, @RequestParam(required = false) String patientId) {
    if (patientId != null && !patientId.isBlank()) {
      var out = er.forPatient(patientId.trim());
      audit.logForBranch(CurrentUser.get().homeBranch(), "Viewed", "ER visits", patientId.trim(), out.size() + " ER visits");
      return out;
    }
    return er.board(branchId);
  }

  @GetMapping("/cases/{id}")
  public ErCase get(@PathVariable String id) {
    var c = er.visible(id);
    audit.logForBranch(c.branchId(), "Viewed", "Emergency case", id, c.label());
    return c;
  }

  @PostMapping("/cases")
  @ResponseStatus(HttpStatus.CREATED)
  public ErCase register(@Valid @RequestBody NewCase in) { return er.register(in); }

  @PatchMapping("/cases/{id}")
  @PreAuthorize(CLINICAL)
  public ErCase update(@PathVariable String id, @Valid @RequestBody Update in) { return er.update(id, in); }

  @PostMapping("/cases/{id}/orders")
  @PreAuthorize(CLINICAL)
  public ErCase order(@PathVariable String id, @Valid @RequestBody OrderInput in) { return er.order(id, in.name()); }

  @PostMapping("/cases/{id}/link")
  public ErCase link(@PathVariable String id, @Valid @RequestBody LinkInput in) { return er.link(id, in.patientId()); }

  @PostMapping("/cases/{id}/status")
  @PreAuthorize(CLINICAL)
  public ErCase status(@PathVariable String id, @Valid @RequestBody StatusInput in) { return er.status(id, in.status(), in.note()); }

  /** Called by the admission screen once the inpatient admission exists. */
  @PostMapping("/cases/{id}/admitted")
  public ErCase admitted(@PathVariable String id, @RequestBody(required = false) @Valid AdmittedInput in) {
    return er.admitted(id, in == null ? null : in.admissionId());
  }
}
