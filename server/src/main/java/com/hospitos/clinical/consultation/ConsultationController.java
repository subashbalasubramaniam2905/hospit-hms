package com.hospitos.clinical.consultation;

import static com.hospitos.clinical.ClinicalLookup.CLINICAL_READERS;
import static com.hospitos.clinical.ClinicalLookup.CLINICIANS;
import static com.hospitos.clinical.ClinicalLookup.VITALS_WRITERS;

import com.hospitos.audit.AuditService;
import com.hospitos.clinical.prescription.PrescriptionRecord;
import com.hospitos.clinical.prescription.PrescriptionService;
import com.hospitos.clinical.safety.SafetyAlert;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** The consultation workspace: notes, vitals, diagnoses and the linked prescription. */
@RestController
@RequestMapping("/api/clinical/consultations")
@PreAuthorize(CLINICAL_READERS)
public class ConsultationController {
  private final ConsultationService service;
  private final PrescriptionService rx;
  private final AuditService audit;

  public ConsultationController(ConsultationService service, PrescriptionService rx, AuditService audit) {
    this.service = service; this.rx = rx; this.audit = audit;
  }

  public record Detail(ConsultationRecord consultation, PrescriptionRecord prescription, List<SafetyAlert> alerts) {}

  @GetMapping
  public List<ConsultationRecord> list(@RequestParam(defaultValue = "") String patientId, @RequestParam(defaultValue = "") String doctorId,
                                       @RequestParam(defaultValue = "") String status,
                                       @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
                                       @RequestParam(defaultValue = "100") int limit, @RequestParam(defaultValue = "0") int offset) {
    var out = service.list(patientId, doctorId, status, date, Math.min(Math.max(limit, 1), 500), Math.max(offset, 0));
    if (!patientId.isBlank()) audit.log("Viewed", "Consultations", patientId, out.size() + " consultations");
    return out;
  }

  @GetMapping("/{id}")
  public Detail get(@PathVariable UUID id) {
    var c = service.visible(id);
    audit.log("Viewed", "Consultation", id.toString(), c.patientId());
    return detail(c);
  }

  /** Opens today's draft for the patient and doctor, creating it when there is none. */
  @PostMapping
  @PreAuthorize(CLINICIANS)
  public Detail open(@Valid @RequestBody ConsultationInput.Open in) { return detail(service.open(in)); }

  @PutMapping("/{id}")
  @PreAuthorize(CLINICIANS)
  public Detail update(@PathVariable UUID id, @Valid @RequestBody ConsultationInput.Update in) { return detail(service.update(id, in)); }

  @PostMapping("/{id}/vitals")
  @PreAuthorize(VITALS_WRITERS)
  public Detail vitals(@PathVariable UUID id, @Valid @RequestBody ConsultationInput.Vitals in) { return detail(service.addVitals(id, in)); }

  @PostMapping("/{id}/complete")
  @PreAuthorize(CLINICIANS)
  public Detail complete(@PathVariable UUID id, @Valid @RequestBody ConsultationInput.Complete in) {
    return detail(service.complete(id, in));
  }

  private Detail detail(ConsultationRecord c) {
    if (c.prescriptionId() == null) return new Detail(c, null, List.of());
    var p = rx.find(c.prescriptionId()).orElse(null);
    return new Detail(c, p, p == null ? List.of() : rx.alertsFor(p));
  }
}
