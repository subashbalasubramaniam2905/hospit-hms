package com.hospitos.radiology;

import com.hospitos.audit.AuditService;
import com.hospitos.billing.api.BillingApi;
import com.hospitos.billing.api.InvoiceKind;
import com.hospitos.billing.api.LineCategory;
import com.hospitos.billing.api.NewInvoice;
import com.hospitos.billing.api.NewInvoiceLine;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import com.hospitos.radiology.RadiologyDtos.Booking;
import com.hospitos.radiology.RadiologyDtos.ImagingOrder;
import com.hospitos.radiology.RadiologyDtos.NewOrder;
import com.hospitos.radiology.RadiologyDtos.Report;
import com.hospitos.radiology.RadiologyDtos.ReportInput;
import com.hospitos.radiology.RadiologyDtos.ReportPatient;
import com.hospitos.radiology.RadiologyDtos.Room;
import com.hospitos.radiology.RadiologyDtos.ScheduleInput;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Radiology workflow: Ordered → Scheduled → In progress → Awaiting report → Reported → Verified.
 * A scheduled study holds its room for its duration; Ordered and Scheduled studies can be cancelled once any invoice
 * for them has been cancelled; a submitted report can be reopened until it is verified.
 */
@Service
public class RadiologyService {
  static final Set<String> PRIORITIES = Set.of("Routine", "Urgent");
  static final String REF = "IMAGING_ORDER";
  private final RadiologyRepository repo;
  private final BillingApi billing;
  private final AuditService audit;
  public RadiologyService(RadiologyRepository repo, BillingApi billing, AuditService audit) { this.repo = repo; this.billing = billing; this.audit = audit; }

  ImagingOrder visible(String id) {
    var o = repo.order(id).orElseThrow(() -> new ApiException(404, "Imaging order not found"));
    if (!CurrentUser.get().canSee(o.branchId())) throw new ApiException(404, "Imaging order not found");
    return o;
  }

  /** True when the patient has a recorded allergy to contrast media (for example "Iodinated contrast"). */
  static boolean contrastAllergy(List<String> allergies) {
    return allergies.stream().anyMatch(a -> a.toLowerCase().contains("contrast") || a.toLowerCase().contains("gadolinium"));
  }

  @Transactional
  public ImagingOrder create(NewOrder in) {
    var me = CurrentUser.get();
    var patient = repo.patient(in.patientId()).orElseThrow(() -> new ApiException(400, "Patient not found"));
    if (!me.canSee(patient.branchId())) throw new ApiException(400, "Patient not found");
    String branch = blank(in.branchId()) == null ? patient.branchId() : in.branchId();
    if (!me.canSee(branch)) throw new ApiException(403, "You do not have access to this branch");
    String priority = blank(in.priority()) == null ? "Routine" : in.priority();
    if (!PRIORITIES.contains(priority)) throw new ApiException(400, "Priority must be Routine or Urgent");
    String doctor = blank(in.doctorId());
    if (doctor != null && !repo.doctorExists(doctor)) throw new ApiException(400, "Unknown doctor " + doctor);

    // The study: a catalogue entry, or a free-text name under a modality (matched to the catalogue when the name is the same).
    String studyId, modality, name;
    BigDecimal price;
    int minutes;
    boolean contrast;
    var cat = blank(in.studyId()) != null
        ? repo.study(in.studyId()).orElseThrow(() -> new ApiException(400, "Unknown imaging study " + in.studyId()))
        : null;
    if (cat == null && blank(in.modality()) != null && blank(in.study()) != null)
      cat = repo.studyByName(in.modality(), in.study()).orElse(null);
    if (cat != null) {
      studyId = cat.id(); modality = cat.modality(); name = cat.name(); price = cat.price(); minutes = cat.durationMin(); contrast = cat.contrast();
    } else {
      if (blank(in.modality()) == null || blank(in.study()) == null) throw new ApiException(400, "Choose a study, or give a modality and study name");
      var def = repo.modality(in.modality()).orElseThrow(() -> new ApiException(400, "Modality must be X-ray, Ultrasound, CT or MRI"));
      studyId = null; modality = in.modality(); name = in.study().trim(); price = def.price(); minutes = def.minutes();
      contrast = name.toLowerCase().contains("contrast") && !name.toLowerCase().contains("non-contrast");
    }

    String override = blank(in.contrastOverride());
    if (contrast && contrastAllergy(patient.allergies()) && override == null)
      throw new ApiException(422, patient.name() + " has a contrast allergy on record. Order a non-contrast study, or give a reason (for example premedication protocol) to go ahead");

    String id = repo.nextOrderId();
    repo.insertOrder(id, branch, patient.id(), doctor, studyId, modality, name, contrast, price, minutes, priority, me.id(), blank(in.comments()),
        contrast && contrastAllergy(patient.allergies()) ? override : null);
    if (in.date() != null || blank(in.slot()) != null) {
      if (in.date() == null || blank(in.slot()) == null) throw new ApiException(400, "Give both a date and a slot to schedule the study");
      book(repo.order(id).orElseThrow(), in.date(), in.slot(), in.room(), 1);
    }
    if (in.bill() == null || in.bill()) {
      var line = NewInvoiceLine.of(name, LineCategory.IMAGING, BigDecimal.ONE, price, null, REF, id);
      var inv = billing.createInvoice(new NewInvoice(patient.id(), InvoiceKind.OPD, branch, List.of(line), BigDecimal.ZERO, null, REF, id, null));
      repo.setInvoice(id, inv.id(), inv.number());
    }
    audit.logForBranch(branch, "Created", "Imaging order", id, patient.name() + ": " + modality + " " + name
        + (priority.equals("Routine") ? "" : " (" + priority + ")"));
    if (override != null && contrast && contrastAllergy(patient.allergies()))
      audit.logForBranch(branch, "Override", "Safety alert", id, "Contrast allergy for " + patient.name() + ": " + override);
    return repo.order(id).orElseThrow();
  }

  /** Books (or moves) the study to a room and start time, refusing a slot that overlaps another study in the room. */
  @Transactional
  public ImagingOrder schedule(String id, ScheduleInput in) {
    var o = visible(id);
    if (!List.of("Ordered", "Scheduled").contains(o.status()))
      throw new ApiException(409, "This study is " + o.status().toLowerCase() + " and can no longer be rescheduled");
    book(o, in.date(), in.slot(), in.room(), in.version());
    audit.logForBranch(o.branchId(), o.status().equals("Scheduled") ? "Rescheduled" : "Scheduled", "Imaging order", id,
        in.date() + " " + in.slot() + " for " + o.patientName());
    return repo.order(id).orElseThrow();
  }

  private void book(ImagingOrder o, LocalDate date, String slotText, String roomCode, int version) {
    LocalTime slot;
    try { slot = LocalTime.parse(slotText.trim()); } catch (DateTimeParseException e) { throw new ApiException(400, "Slot must be a time such as 09:30"); }
    if (date.isBefore(LocalDate.now(RadiologyRepository.IST))) throw new ApiException(400, "Choose today or a later date");
    if (slot.plusMinutes(o.durationMin()).isBefore(slot)) throw new ApiException(400, "The study would run past midnight. Choose an earlier slot");
    LocalTime end = slot.plusMinutes(o.durationMin());
    List<Room> candidates;
    if (blank(roomCode) != null) {
      var room = repo.room(o.branchId(), roomCode.trim()).orElseThrow(() -> new ApiException(400, "No room " + roomCode + " in this branch"));
      if (!room.modality().equals(o.modality())) throw new ApiException(400, room.name() + " is for " + room.modality() + ", not " + o.modality());
      candidates = List.of(room);
    } else {
      candidates = repo.rooms(List.of(o.branchId())).stream().filter(r -> r.modality().equals(o.modality())).toList();
      if (candidates.isEmpty()) throw new ApiException(400, "This branch has no " + o.modality() + " room");
    }
    String clash = null;
    for (var room : candidates) {
      repo.lockRoomDay(o.branchId(), room.code(), date);
      var hit = repo.bookings(o.branchId(), date, room.code()).stream()
          .filter(b -> !b.orderId().equals(o.id()))
          .filter(b -> { var s = LocalTime.parse(b.slot()); return s.isBefore(end) && slot.isBefore(s.plusMinutes(b.durationMin())); })
          .findFirst();
      if (hit.isEmpty()) {
        if (!repo.schedule(o.id(), version, date, slot, room.code())) throw new ApiException(409, "Someone else updated this order. Reload and try again");
        return;
      }
      if (clash == null) clash = room.code() + " is booked " + hit.get().slot() + " for " + hit.get().study();
    }
    throw new ApiException(409, candidates.size() == 1 ? clash + ". Choose another slot" : "Every " + o.modality() + " room is booked at " + slotText + ". Choose another slot");
  }

  public List<Booking> bookings(String branchId, LocalDate date) {
    if (!CurrentUser.get().canSee(branchId)) throw new ApiException(403, "You do not have access to this branch");
    return repo.bookings(branchId, date, null);
  }

  @Transactional
  public ImagingOrder start(String id, String technician) {
    var me = CurrentUser.get();
    var o = visible(id);
    String tech = blank(technician) == null ? me.name() : technician.trim();
    if (!repo.transition(id, List.of("Scheduled"), "In progress", "technician = ?, started_at = now()", tech))
      throw new ApiException(409, o.status().equals("Ordered") ? "Schedule the study before starting the scan" : "This study is " + o.status().toLowerCase() + ", not waiting to be scanned");
    audit.logForBranch(o.branchId(), "Started", "Imaging scan", id, o.study() + " for " + o.patientName() + " by " + tech);
    return repo.order(id).orElseThrow();
  }

  @Transactional
  public ImagingOrder acquire(String id) {
    var o = visible(id);
    if (!repo.transition(id, List.of("In progress"), "Awaiting report", "acquired_at = now()"))
      throw new ApiException(409, "This study is " + o.status().toLowerCase() + ", not being scanned");
    audit.logForBranch(o.branchId(), "Acquired", "Imaging scan", id, "Images stored for " + o.patientName());
    return repo.order(id).orElseThrow();
  }

  /** Saves the report. With submit=true findings and impression are required and the study moves to Reported. */
  @Transactional
  public ImagingOrder saveReport(String id, ReportInput in) {
    var me = CurrentUser.get();
    var o = visible(id);
    if (!o.status().equals("Awaiting report"))
      throw new ApiException(409, o.status().equals("Reported") ? "Reopen the report before editing it" : "A report cannot be written while the study is " + o.status().toLowerCase());
    boolean submit = Boolean.TRUE.equals(in.submit());
    String findings = blank(in.findings()), impression = blank(in.impression());
    if (submit && (findings == null || impression == null)) throw new ApiException(422, "Enter both findings and impression before submitting the report");
    if (!repo.saveReport(id, in.version(), findings, impression, submit, me.name(), me.id()))
      throw new ApiException(409, "Someone else updated this study. Reload and try again");
    audit.logForBranch(o.branchId(), "Updated", "Imaging report", id, submit ? "Report submitted" : "Draft report saved");
    return repo.order(id).orElseThrow();
  }

  @Transactional
  public ImagingOrder reopen(String id) {
    var o = visible(id);
    if (!repo.transition(id, List.of("Reported"), "Awaiting report", ""))
      throw new ApiException(409, "Only a submitted, unverified report can be reopened");
    audit.logForBranch(o.branchId(), "Reopened", "Imaging report", id, o.patientName());
    return repo.order(id).orElseThrow();
  }

  @Transactional
  public ImagingOrder verify(String id) {
    var me = CurrentUser.get();
    var o = visible(id);
    if (!repo.transition(id, List.of("Reported"), "Verified", "verified_by = ?, verified_by_user = ?, verified_at = now()", me.name(), me.id()))
      throw new ApiException(409, "This study is " + o.status().toLowerCase() + ", not ready to verify");
    audit.logForBranch(o.branchId(), "Verified", "Imaging report", id, "Verified by " + me.name()
        + (o.doctorName() == null ? "" : ", released to " + o.doctorName()));
    return repo.order(id).orElseThrow();
  }

  @Transactional
  public ImagingOrder cancel(String id, String reason) {
    var o = visible(id);
    if (!List.of("Ordered", "Scheduled").contains(o.status()))
      throw new ApiException(409, "Only a study that has not been scanned yet can be cancelled");
    if (billing.isBilled(REF, id))
      throw new ApiException(409, "Cancel or refund invoice " + o.invoiceNumber() + " in Billing first, then cancel the study");
    if (!repo.transition(id, List.of("Ordered", "Scheduled"), "Cancelled", "cancel_reason = ?", reason.trim()))
      throw new ApiException(409, "Someone else updated this study. Reload and try again");
    audit.logForBranch(o.branchId(), "Cancelled", "Imaging order", id, o.study() + " for " + o.patientName() + ": " + reason.trim());
    return repo.order(id).orElseThrow();
  }

  /** The printable report with the patient's details and earlier verified studies of the same modality. */
  public Report report(String id) {
    var o = visible(id);
    if (!List.of("Reported", "Verified").contains(o.status())) throw new ApiException(409, "This study has no report yet");
    var p = repo.patient(o.patientId()).orElseThrow();
    audit.logForBranch(o.branchId(), "Viewed", "Imaging report", id, o.patientName());
    return new Report(o, new ReportPatient(p.id(), p.name(), p.dob(), p.gender(), p.mobile()),
        repo.priors(o.patientId(), o.modality(), o.id(), o.orderedAt()));
  }

  private static String blank(String s) { return s == null || s.isBlank() ? null : s.trim(); }
}
