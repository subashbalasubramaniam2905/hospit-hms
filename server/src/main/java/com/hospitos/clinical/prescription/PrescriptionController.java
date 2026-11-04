package com.hospitos.clinical.prescription;

import static com.hospitos.clinical.ClinicalLookup.CLINICAL_READERS;
import static com.hospitos.clinical.ClinicalLookup.CLINICIANS;

import com.hospitos.audit.AuditService;
import com.hospitos.clinical.safety.SafetyAlert;
import com.hospitos.common.ApiException;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** Prescriptions. Doctors write and sign them; pharmacy and other clinical roles read them. */
@RestController
@RequestMapping("/api/clinical/prescriptions")
@PreAuthorize(CLINICAL_READERS)
public class PrescriptionController {
  private final PrescriptionService rx;
  private final AuditService audit;
  public PrescriptionController(PrescriptionService rx, AuditService audit) { this.rx = rx; this.audit = audit; }

  public record Detail(PrescriptionRecord prescription, List<SafetyAlert> alerts) {}

  @GetMapping
  public List<PrescriptionRecord> list(@RequestParam(defaultValue = "") String status, @RequestParam(defaultValue = "") String patientId,
                                       @RequestParam(defaultValue = "100") int limit, @RequestParam(defaultValue = "0") int offset) {
    var out = rx.list(status, patientId, Math.min(Math.max(limit, 1), 500), Math.max(offset, 0));
    if (!patientId.isBlank()) audit.log("Viewed", "Prescriptions", patientId, out.size() + " prescriptions");
    return out;
  }

  @GetMapping("/{id}")
  public Detail get(@PathVariable UUID id) {
    var p = rx.visible(id);
    audit.log("Viewed", "Prescription", id.toString(), p.patientId());
    return new Detail(p, rx.alertsFor(p));
  }

  /** Screens unsaved lines against the patient's allergies and each other. Nothing is stored. */
  @PostMapping("/check")
  @PreAuthorize(CLINICIANS)
  public List<SafetyAlert> check(@Valid @RequestBody PrescriptionInput.Check in) {
    return rx.alertsFor(in.patientId(), in.items());
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  @PreAuthorize(CLINICIANS)
  public PrescriptionRecord create(@Valid @RequestBody PrescriptionInput.Create in) { return rx.create(in); }

  @PutMapping("/{id}")
  @PreAuthorize(CLINICIANS)
  public PrescriptionRecord update(@PathVariable UUID id, @Valid @RequestBody PrescriptionInput.Update in) { return rx.update(id, in); }

  @PostMapping("/{id}/sign")
  @PreAuthorize(CLINICIANS)
  public PrescriptionRecord sign(@PathVariable UUID id, @Valid @RequestBody PrescriptionInput.Sign in) {
    if (in.version() == null) throw new ApiException(400, "version is required");
    return rx.sign(id, in.version(), Boolean.TRUE.equals(in.sendToPharmacy()), in.overrideReason());
  }

  @PostMapping("/{id}/send")
  @PreAuthorize(CLINICIANS)
  public PrescriptionRecord send(@PathVariable UUID id, @RequestBody PrescriptionInput.Sign in) {
    if (in.version() == null) throw new ApiException(400, "version is required");
    return rx.send(id, in.version());
  }
}
