package com.hospitos.clinical.consultation;

import com.hospitos.audit.AuditService;
import com.hospitos.clinical.ClinicalLookup;
import com.hospitos.clinical.prescription.PrescriptionInput;
import com.hospitos.clinical.prescription.PrescriptionRecord;
import com.hospitos.clinical.prescription.PrescriptionRepository;
import com.hospitos.clinical.prescription.PrescriptionService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ConsultationService {
  private final ConsultationRepository repo;
  private final PrescriptionRepository rxRepo;
  private final PrescriptionService rx;
  private final ClinicalLookup lookup;
  private final AuditService audit;

  public ConsultationService(ConsultationRepository repo, PrescriptionRepository rxRepo, PrescriptionService rx,
                             ClinicalLookup lookup, AuditService audit) {
    this.repo = repo; this.rxRepo = rxRepo; this.rx = rx; this.lookup = lookup; this.audit = audit;
  }

  public ConsultationRecord visible(UUID id) {
    var c = repo.byId(id).orElseThrow(() -> new ApiException(404, "Consultation not found"));
    if (!CurrentUser.get().canSee(c.branchId())) throw new ApiException(404, "Consultation not found");
    return c;
  }

  public List<ConsultationRecord> list(String patientId, String doctorId, String status, LocalDate date, int limit, int offset) {
    var me = CurrentUser.get();
    return repo.list(me.superAdmin() ? null : me.branches(), patientId, doctorId, status, date, limit, offset);
  }

  /**
   * Returns the open draft for this patient and doctor, or starts one prefilled from the patient record:
   * history, family history, current medicines, allergies, and height and weight from the last visit.
   */
  @Transactional
  public ConsultationRecord open(ConsultationInput.Open in) {
    var doctor = lookup.actingDoctor(in.doctorId());
    var existing = repo.openDraft(in.patientId(), doctor.id());
    if (existing.isPresent()) return repo.byId(existing.get()).orElseThrow();
    var p = lookup.visiblePatient(in.patientId());
    var me = CurrentUser.get();
    String template = p.conditions().stream().anyMatch(c -> c.toLowerCase().contains("diabetes")) ? "Diabetes care"
        : p.conditions().stream().anyMatch(c -> c.toLowerCase().contains("hypertension")) ? "Hypertension review" : "General medicine";
    String allergyNote = p.allergies().isEmpty() ? "No known allergies" : String.join(", ", p.allergies());
    UUID id;
    try {
      id = repo.insert(doctor.branchId(), p.id(), doctor.id(), blank(in.appointmentId()), template, p.history(), p.familyHistory(),
          p.medications(), allergyNote, me.id());
    } catch (DuplicateKeyException race) {
      return repo.byId(repo.openDraft(in.patientId(), doctor.id()).orElseThrow()).orElseThrow();
    }
    repo.lastBody(p.id()).ifPresent(v -> repo.addVitals(id,
        new ConsultationInput.Vitals(null, null, null, null, null, v.height(), v.weight()), me.id()));
    audit.logForBranch(doctor.branchId(), "Created", "Consultation", id.toString(), "Started consultation for " + p.name() + " with " + doctor.name());
    return repo.byId(id).orElseThrow();
  }

  @Transactional
  public ConsultationRecord update(UUID id, ConsultationInput.Update in) {
    var c = editable(id);
    if (in.version() == null) throw new ApiException(400, "version is required");
    if (!repo.update(id, in, c)) throw new ApiException(409, "Someone else updated this consultation. Reload and try again");
    if (in.dx() != null) repo.replaceDiagnoses(id, in.dx());
    if (in.vitals() != null && !ConsultationRepository.sameVitals(c.vitals(), in.vitals()))
      repo.addVitals(id, in.vitals(), CurrentUser.get().id());
    if (in.prescription() != null) saveDraftRx(c, in.prescription(), diagnosisText(repo.byId(id).orElseThrow()));
    audit.logForBranch(c.branchId(), "Updated", "Consultation", id.toString(), "Saved draft");
    return repo.byId(id).orElseThrow();
  }

  /** Nurses and doctors record a new set of vitals during the visit. */
  @Transactional
  public ConsultationRecord addVitals(UUID id, ConsultationInput.Vitals v) {
    var c = visible(id);
    if (!ConsultationRecord.DRAFT.equals(c.status())) throw new ApiException(409, "This consultation is already signed");
    repo.addVitals(id, v, CurrentUser.get().id());
    audit.logForBranch(c.branchId(), "Recorded vitals", "Consultation", id.toString(), v.bp() == null ? "" : "BP " + v.bp());
    return repo.byId(id).orElseThrow();
  }

  /**
   * Signs the consultation. A prescription with medicines is saved, safety-checked, signed and sent to the pharmacy
   * in the same transaction, so a blocking safety alert leaves both the consultation and the prescription as drafts.
   */
  @Transactional
  public ConsultationRecord complete(UUID id, ConsultationInput.Complete in) {
    var c = editable(id);
    if (in.version() == null) throw new ApiException(400, "version is required");
    if (in.version() != c.version()) throw new ApiException(409, "Someone else updated this consultation. Reload and try again");
    if (in.prescription() != null) saveDraftRx(c, in.prescription(), diagnosisText(c));
    var draft = rxRepo.byConsultation(id);
    if (draft.isPresent() && PrescriptionRecord.DRAFT.equals(draft.get().status())) {
      if (draft.get().items().isEmpty()) rxRepo.delete(draft.get().id());
      else rx.sign(draft.get().id(), draft.get().version(), true, in.overrideReason());
    }
    if (!repo.complete(id, in.version(), CurrentUser.get().id()))
      throw new ApiException(409, "Someone else updated this consultation. Reload and try again");
    audit.logForBranch(c.branchId(), "Signed", "Consultation", id.toString(), "Completed consultation" + (c.dx().isEmpty() ? "" : " · " + c.dx().get(0).label()));
    return repo.byId(id).orElseThrow();
  }

  private ConsultationRecord editable(UUID id) {
    var c = visible(id);
    lookup.actingDoctor(c.doctorId());
    if (!ConsultationRecord.DRAFT.equals(c.status())) throw new ApiException(409, "This consultation is already signed and is read-only");
    return c;
  }

  private void saveDraftRx(ConsultationRecord c, ConsultationInput.Rx in, String diagnosis) {
    var existing = rxRepo.byConsultation(c.id());
    var items = in.items() == null ? List.<PrescriptionInput.Line>of() : in.items();
    if (existing.isEmpty()) {
      if (items.isEmpty()) return;
      rx.create(new PrescriptionInput.Create(c.patientId(), c.doctorId(), c.id(), diagnosis, in.notes(), items));
    } else {
      var cur = existing.get();
      if (!PrescriptionRecord.DRAFT.equals(cur.status())) throw new ApiException(409, "The prescription is already signed");
      rx.update(cur.id(), new PrescriptionInput.Update(cur.version(), diagnosis, in.notes(), items));
    }
  }

  private static String diagnosisText(ConsultationRecord c) {
    return c.dx().stream().map(ConsultationRecord.Diagnosis::label).collect(Collectors.joining("; "));
  }

  private static String blank(String s) { return s == null || s.isBlank() ? null : s.trim(); }
}
