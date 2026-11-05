package com.hospitos.ipd;

import com.hospitos.audit.AuditService;
import com.hospitos.common.CurrentUser;
import com.hospitos.ipd.IpdDtos.Admission;
import com.hospitos.ipd.IpdDtos.AdmitInput;
import com.hospitos.ipd.IpdDtos.AdmitResult;
import com.hospitos.ipd.IpdDtos.Bed;
import com.hospitos.ipd.IpdDtos.BedInput;
import com.hospitos.ipd.IpdDtos.BedStatusInput;
import com.hospitos.ipd.IpdDtos.BillPreview;
import com.hospitos.ipd.IpdDtos.CarePlanInput;
import com.hospitos.ipd.IpdDtos.ChargeInput;
import com.hospitos.ipd.IpdDtos.DepositInput;
import com.hospitos.ipd.IpdDtos.DischargeInput;
import com.hospitos.ipd.IpdDtos.IoInput;
import com.hospitos.ipd.IpdDtos.MarInput;
import com.hospitos.ipd.IpdDtos.MarStatusInput;
import com.hospitos.ipd.IpdDtos.NoteInput;
import com.hospitos.ipd.IpdDtos.ObsInput;
import com.hospitos.ipd.IpdDtos.RefundInput;
import com.hospitos.ipd.IpdDtos.TransferInput;
import com.hospitos.ipd.IpdDtos.UpdateInput;
import com.hospitos.ipd.IpdDtos.Ward;
import com.hospitos.ipd.IpdDtos.WardInput;
import com.hospitos.common.ApiException;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/**
 * Inpatient wards, beds and admissions. Everything is limited to the user's branches. Front desk and billing staff see
 * admissions without the clinical record; doctors and nurses write the ward record.
 */
@RestController
@RequestMapping("/api/ipd")
@PreAuthorize("hasAnyRole('super-admin','admin','doctor','nurse','receptionist','billing')")
public class IpdController {
  static final String ADMINS = "hasAnyRole('super-admin','admin')";
  static final String CLINICAL = "hasAnyRole('doctor','nurse')";
  static final String WARD_DESK = "hasAnyRole('super-admin','admin','doctor','nurse','receptionist')";
  static final String CASHIERS = "hasAnyRole('super-admin','admin','billing','receptionist')";
  private final IpdRepository repo;
  private final IpdService ipd;
  private final AuditService audit;
  public IpdController(IpdRepository repo, IpdService ipd, AuditService audit) { this.repo = repo; this.ipd = ipd; this.audit = audit; }

  // ---------- wards and beds ----------

  @GetMapping("/wards")
  public List<Ward> wards(@RequestParam(required = false) String branchId, @RequestParam(defaultValue = "false") boolean includeClosed) {
    return repo.wards(IpdService.branch(branchId), includeClosed);
  }

  @PostMapping("/wards")
  @ResponseStatus(HttpStatus.CREATED)
  @PreAuthorize(ADMINS)
  public Ward createWard(@Valid @RequestBody WardInput in) { return ipd.createWard(in); }

  @PutMapping("/wards/{id}")
  @PreAuthorize(ADMINS)
  public Ward updateWard(@PathVariable String id, @Valid @RequestBody WardInput in) { return ipd.updateWard(id, in); }

  @PostMapping("/wards/{id}/beds")
  @ResponseStatus(HttpStatus.CREATED)
  @PreAuthorize(ADMINS)
  public Bed addBed(@PathVariable String id, @Valid @RequestBody BedInput in) { return ipd.addBed(id, in.label()); }

  @GetMapping("/beds")
  public List<Bed> beds(@RequestParam(required = false) String branchId) { return repo.beds(IpdService.branch(branchId)); }

  /** Housekeeping and reservations for a free bed: Available, Reserved, Cleaning or Maintenance. */
  @PostMapping("/beds/{id}/status")
  @PreAuthorize(WARD_DESK)
  public Bed bedStatus(@PathVariable String id, @Valid @RequestBody BedStatusInput in) { return ipd.setBedStatus(id, in.status()); }

  // ---------- admissions ----------

  /** status is current (default), discharged or all. Lists carry the latest notes and observations only. */
  @GetMapping("/admissions")
  public List<Admission> admissions(@RequestParam(defaultValue = "current") String status, @RequestParam(required = false) String patientId,
                                    @RequestParam(required = false) String branchId, @RequestParam(defaultValue = "200") int limit) {
    var me = CurrentUser.get();
    if (!List.of("current", "discharged", "all").contains(status)) throw new ApiException(400, "status must be current, discharged or all");
    List<String> branches = branchId != null && !branchId.isBlank() ? List.of(IpdService.branch(branchId)) : me.superAdmin() ? null : me.branches();
    String pid = patientId == null || patientId.isBlank() ? null : patientId;
    var out = repo.search(branches, status, pid, Math.min(Math.max(limit, 1), 500), IpdService.clinical(me), true);
    if (pid != null && IpdService.clinical(me)) audit.logForBranch(me.homeBranch(), "Viewed", "Admissions", pid, out.size() + " admissions");
    return out;
  }

  @GetMapping("/admissions/{id}")
  public Admission admission(@PathVariable String id) {
    var h = ipd.visible(id, false);
    var a = ipd.read(id);
    if (IpdService.clinical(CurrentUser.get())) audit.logForBranch(h.branchId(), "Viewed", "Admission", id, h.patientName());
    return a;
  }

  @PostMapping("/admissions")
  @ResponseStatus(HttpStatus.CREATED)
  @PreAuthorize("hasAnyRole('super-admin','admin','doctor','nurse','receptionist','billing')")
  public AdmitResult admit(@Valid @RequestBody AdmitInput in) { return ipd.admit(in); }

  @PatchMapping("/admissions/{id}")
  @PreAuthorize("hasAnyRole('super-admin','admin','doctor')")
  public Admission update(@PathVariable String id, @Valid @RequestBody UpdateInput in) { return ipd.update(id, in); }

  @PostMapping("/admissions/{id}/transfer")
  @PreAuthorize(WARD_DESK)
  public Admission transfer(@PathVariable String id, @Valid @RequestBody TransferInput in) { return ipd.transfer(id, in.bedId()); }

  @PostMapping("/admissions/{id}/plan-discharge")
  @PreAuthorize("hasAnyRole('super-admin','admin','doctor','nurse')")
  public Admission planDischarge(@PathVariable String id) { return ipd.planDischarge(id); }

  @PostMapping("/admissions/{id}/discharge")
  @PreAuthorize("hasAnyRole('super-admin','admin','doctor')")
  public Admission discharge(@PathVariable String id, @Valid @RequestBody DischargeInput in) { return ipd.discharge(id, in); }

  // ---------- ward record ----------

  @PostMapping("/admissions/{id}/notes")
  @PreAuthorize(CLINICAL)
  public Admission note(@PathVariable String id, @Valid @RequestBody NoteInput in) { return ipd.addNote(id, in); }

  @PostMapping("/admissions/{id}/care-plan")
  @PreAuthorize(CLINICAL)
  public Admission carePlan(@PathVariable String id, @Valid @RequestBody CarePlanInput in) { return ipd.addCarePlan(id, in.text()); }

  @PostMapping("/admissions/{id}/mar")
  @PreAuthorize(CLINICAL)
  public Admission mar(@PathVariable String id, @Valid @RequestBody MarInput in) { return ipd.addMar(id, in); }

  @PostMapping("/admissions/{id}/mar/{marId}")
  @PreAuthorize(CLINICAL)
  public Admission dose(@PathVariable String id, @PathVariable UUID marId, @Valid @RequestBody MarStatusInput in) {
    return ipd.recordDose(id, marId, in);
  }

  @PostMapping("/admissions/{id}/obs")
  @PreAuthorize(CLINICAL)
  public Admission obs(@PathVariable String id, @Valid @RequestBody ObsInput in) { return ipd.addObs(id, in); }

  @PostMapping("/admissions/{id}/io")
  @PreAuthorize(CLINICAL)
  public Admission io(@PathVariable String id, @Valid @RequestBody IoInput in) { return ipd.addIo(id, in); }

  // ---------- money ----------

  @GetMapping("/admissions/{id}/bill")
  public BillPreview bill(@PathVariable String id) { return ipd.bill(id); }

  @PostMapping("/admissions/{id}/deposits")
  @PreAuthorize(CASHIERS)
  public Admission deposit(@PathVariable String id, @Valid @RequestBody DepositInput in) { return ipd.deposit(id, in); }

  @PostMapping("/admissions/{id}/refund-deposit")
  @PreAuthorize("hasAnyRole('super-admin','admin','billing')")
  public Admission refund(@PathVariable String id, @Valid @RequestBody RefundInput in) { return ipd.refundDeposit(id, in); }

  @PostMapping("/admissions/{id}/charges")
  @PreAuthorize("hasAnyRole('super-admin','admin','billing','doctor','nurse')")
  public Admission charge(@PathVariable String id, @Valid @RequestBody ChargeInput in) { return ipd.addCharge(id, in); }

  @DeleteMapping("/admissions/{id}/charges/{chargeId}")
  @PreAuthorize("hasAnyRole('super-admin','admin','billing')")
  public Admission cancelCharge(@PathVariable String id, @PathVariable UUID chargeId) { return ipd.cancelCharge(id, chargeId); }
}
