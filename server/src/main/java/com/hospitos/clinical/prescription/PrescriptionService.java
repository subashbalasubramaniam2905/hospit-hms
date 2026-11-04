package com.hospitos.clinical.prescription;

import com.hospitos.audit.AuditService;
import com.hospitos.clinical.ClinicalLookup;
import com.hospitos.clinical.SafetyBlockedException;
import com.hospitos.clinical.safety.DrugLine;
import com.hospitos.clinical.safety.SafetyAlert;
import com.hospitos.clinical.safety.SafetyService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Prescriptions and their safety screen. {@link #find} and {@link #markDispensed} are the API the pharmacy module
 * calls; they do not check roles or write audit entries, so the caller does both.
 */
@Service
public class PrescriptionService {
  private final PrescriptionRepository repo;
  private final ClinicalLookup lookup;
  private final SafetyService safety;
  private final AuditService audit;

  public PrescriptionService(PrescriptionRepository repo, ClinicalLookup lookup, SafetyService safety, AuditService audit) {
    this.repo = repo; this.lookup = lookup; this.safety = safety; this.audit = audit;
  }

  // ---------- API for other modules ----------

  public Optional<PrescriptionRecord> find(UUID id) { return repo.byId(id); }

  /** Pharmacy calls this after dispensing. Only prescriptions sent to the pharmacy can be dispensed. */
  @Transactional
  public PrescriptionRecord markDispensed(UUID id, boolean partial) {
    if (!repo.setDispensed(id, partial ? PrescriptionRecord.PARTIAL : PrescriptionRecord.DISPENSED))
      throw new ApiException(409, "This prescription has not been sent to the pharmacy or is already dispensed");
    return repo.byId(id).orElseThrow();
  }

  // ---------- used by the controllers ----------

  public PrescriptionRecord visible(UUID id) {
    var rx = repo.byId(id).orElseThrow(() -> new ApiException(404, "Prescription not found"));
    if (!CurrentUser.get().canSee(rx.branchId())) throw new ApiException(404, "Prescription not found");
    return rx;
  }

  public List<PrescriptionRecord> list(String status, String patientId, int limit, int offset) {
    var me = CurrentUser.get();
    return repo.list(me.superAdmin() ? null : me.branches(), status, patientId, limit, offset);
  }

  @Transactional
  public PrescriptionRecord create(PrescriptionInput.Create in) {
    var me = CurrentUser.get();
    var doctor = lookup.actingDoctor(in.doctorId());
    var patient = lookup.patient(in.patientId());
    if (in.consultationId() != null) {
      if (repo.byConsultation(in.consultationId()).isPresent())
        throw new ApiException(409, "This consultation already has a prescription");
    }
    UUID id = repo.insert(doctor.branchId(), patient.id(), doctor.id(), in.consultationId(), in.diagnosis(), in.notes(), me.id());
    repo.replaceItems(id, in.items());
    audit.log("Created", "Prescription", id.toString(), "Draft for " + patient.name());
    return repo.byId(id).orElseThrow();
  }

  @Transactional
  public PrescriptionRecord update(UUID id, PrescriptionInput.Update in) {
    var rx = visible(id);
    lookup.actingDoctor(rx.doctorId());
    if (in.version() == null) throw new ApiException(400, "version is required");
    if (!PrescriptionRecord.DRAFT.equals(rx.status())) throw new ApiException(409, "A signed prescription cannot be changed");
    if (!repo.updateDraft(id, in.version(), in.diagnosis(), in.notes()))
      throw new ApiException(409, "Someone else updated this prescription. Reload and try again");
    repo.replaceItems(id, in.items());
    audit.log("Updated", "Prescription", id.toString(), (in.items() == null ? 0 : in.items().size()) + " medicines");
    return repo.byId(id).orElseThrow();
  }

  /**
   * Signs a draft. Critical alerts that were not overridden before need {@code overrideReason}; the reason is stored
   * against each of them and written to the audit trail. Otherwise a {@link SafetyBlockedException} lists them.
   */
  @Transactional
  public PrescriptionRecord sign(UUID id, int version, boolean sendToPharmacy, String overrideReason) {
    var rx = visible(id);
    lookup.actingDoctor(rx.doctorId());
    if (!PrescriptionRecord.DRAFT.equals(rx.status())) throw new ApiException(409, "This prescription is already signed");
    if (rx.items().isEmpty()) throw new ApiException(400, "Add at least one medicine before signing");
    var me = CurrentUser.get();
    var patient = lookup.patient(rx.patientId());
    var done = new HashSet<String>();
    rx.overrides().forEach(o -> done.add(o.code()));
    var blocking = safety.check(patient.allergies(), lines(rx)).stream()
        .filter(SafetyAlert::critical).filter(a -> !done.contains(a.code())).toList();
    String reason = overrideReason == null ? "" : overrideReason.trim();
    if (!blocking.isEmpty() && reason.length() < 5) throw new SafetyBlockedException(blocking);
    for (var a : blocking) {
      repo.addOverride(id, a.code(), a.kind(), a.title(), reason, me.id());
      audit.log("Overrode safety alert", "Prescription", id.toString(), a.title() + " · " + reason);
    }
    String status = sendToPharmacy ? PrescriptionRecord.SENT : PrescriptionRecord.SIGNED;
    if (!repo.sign(id, version, status, me.id()))
      throw new ApiException(409, "Someone else updated this prescription. Reload and try again");
    audit.log("Signed", "Prescription", id.toString(), status + " · " + patient.name() + " · " + rx.items().size() + " medicines");
    return repo.byId(id).orElseThrow();
  }

  @Transactional
  public PrescriptionRecord send(UUID id, int version) {
    var rx = visible(id);
    lookup.actingDoctor(rx.doctorId());
    if (!PrescriptionRecord.SIGNED.equals(rx.status())) throw new ApiException(409, "Only a signed prescription can be sent");
    if (!repo.sendSigned(id, version)) throw new ApiException(409, "Someone else updated this prescription. Reload and try again");
    audit.log("Sent to pharmacy", "Prescription", id.toString(), "");
    return repo.byId(id).orElseThrow();
  }

  public List<SafetyAlert> alertsFor(String patientId, List<PrescriptionInput.Line> items) {
    var patient = lookup.patient(patientId);
    var lines = (items == null ? List.<PrescriptionInput.Line>of() : items).stream()
        .map(l -> new DrugLine(l.name(), l.generic())).toList();
    return safety.check(patient.allergies(), lines);
  }

  public List<SafetyAlert> alertsFor(PrescriptionRecord rx) {
    return safety.check(lookup.patient(rx.patientId()).allergies(), lines(rx));
  }

  private static List<DrugLine> lines(PrescriptionRecord rx) {
    return rx.items().stream().map(i -> new DrugLine(i.name(), i.generic())).toList();
  }
}
