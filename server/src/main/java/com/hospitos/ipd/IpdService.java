package com.hospitos.ipd;

import com.hospitos.audit.AuditService;
import com.hospitos.billing.api.BillingApi;
import com.hospitos.billing.api.InvoiceKind;
import com.hospitos.billing.api.LineCategory;
import com.hospitos.billing.api.NewInvoice;
import com.hospitos.billing.api.NewInvoiceLine;
import com.hospitos.billing.api.PayMode;
import com.hospitos.billing.service.ClaimService;
import com.hospitos.billing.service.TariffService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import com.hospitos.ipd.IpdDtos.Admission;
import com.hospitos.ipd.IpdDtos.AdmitInput;
import com.hospitos.ipd.IpdDtos.AdmitResult;
import com.hospitos.ipd.IpdDtos.Bed;
import com.hospitos.ipd.IpdDtos.BillLine;
import com.hospitos.ipd.IpdDtos.BillPreview;
import com.hospitos.ipd.IpdDtos.ChargeInput;
import com.hospitos.ipd.IpdDtos.DepositInput;
import com.hospitos.ipd.IpdDtos.DischargeInput;
import com.hospitos.ipd.IpdDtos.IoInput;
import com.hospitos.ipd.IpdDtos.MarInput;
import com.hospitos.ipd.IpdDtos.MarStatusInput;
import com.hospitos.ipd.IpdDtos.NoteInput;
import com.hospitos.ipd.IpdDtos.ObsInput;
import com.hospitos.ipd.IpdDtos.RefundInput;
import com.hospitos.ipd.IpdDtos.UpdateInput;
import com.hospitos.ipd.IpdDtos.Ward;
import com.hospitos.ipd.IpdDtos.WardInput;
import com.hospitos.ipd.IpdRepository.Head;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Inpatient workflow: admit to a bed (with an advance deposit and optional cashless pre-authorisation), transfer
 * between beds, ward records (notes, care plan, MAR, observations with NEWS2, intake/output), services to bill, and
 * discharge, which raises the final IPD invoice through {@link BillingApi} and adjusts the deposit against it.
 */
@Service
public class IpdService {
  static final Set<String> CLINICAL = Set.of("super-admin", "admin", "doctor", "nurse");
  static final Set<String> FREE_STATUSES = Set.of("Available", "Reserved", "Cleaning", "Maintenance");
  static final String NURSING_CODE = "NUR-DAY";
  static final String VISIT_CODE = "IPD-VISIT";
  static final String REF = "ADMISSION";
  private final IpdRepository repo;
  private final BillingApi billing;
  private final TariffService tariff;
  private final ClaimService claims;
  private final AuditService audit;
  private final Clock clock;

  public IpdService(IpdRepository repo, BillingApi billing, TariffService tariff, ClaimService claims, AuditService audit, Clock clock) {
    this.repo = repo; this.billing = billing; this.tariff = tariff; this.claims = claims; this.audit = audit; this.clock = clock;
  }

  private OffsetDateTime now() { return OffsetDateTime.now(clock); }
  static boolean clinical(CurrentUser me) { return CLINICAL.contains(me.role()); }

  /** The branch to read: the one asked for (if the user may see it) or the user's first branch. */
  static String branch(String requested) {
    var me = CurrentUser.get();
    if (requested != null && !requested.isBlank()) {
      if (!me.canSee(requested)) throw new ApiException(403, "You do not have access to this branch");
      return requested;
    }
    if (me.homeBranch() == null) throw new ApiException(400, "Choose a branch");
    return me.homeBranch();
  }

  Head visible(String id, boolean lock) {
    var h = repo.head(id, lock).orElseThrow(() -> new ApiException(404, "Admission not found"));
    if (!CurrentUser.get().canSee(h.branchId())) throw new ApiException(404, "Admission not found");
    return h;
  }

  private Head open(String id) {
    var h = visible(id, true);
    if (h.status().equals("Discharged")) throw new ApiException(409, "This patient has been discharged; the record is closed");
    return h;
  }

  Admission read(String id) {
    var me = CurrentUser.get();
    return repo.admission(id, clinical(me)).orElseThrow(() -> new ApiException(404, "Admission not found"));
  }

  // ---------- wards and beds ----------

  @Transactional
  public Ward createWard(WardInput in) {
    String branch = branch(in.branchId());
    String id = repo.nextWardId(branch);
    repo.insertWard(id, branch, in.name().trim(), in.type(), blank(in.floor(), ""), in.rate(), repo.nextWardPosition(branch));
    audit.logForBranch(branch, "Created", "Ward", id, in.name().trim() + " Rs " + in.rate().toPlainString() + "/day");
    return repo.ward(id).orElseThrow();
  }

  @Transactional
  public Ward updateWard(String id, WardInput in) {
    var w = repo.ward(id).filter(x -> CurrentUser.get().canSee(x.branchId())).orElseThrow(() -> new ApiException(404, "Ward not found"));
    boolean active = in.active() == null || in.active();
    repo.updateWard(id, in.name().trim(), in.type(), blank(in.floor(), ""), in.rate(), active);
    audit.logForBranch(w.branchId(), "Updated", "Ward", id, in.name().trim() + " Rs " + in.rate().toPlainString() + "/day"
        + (active ? "" : " (closed)") + (w.rate().compareTo(in.rate()) != 0 ? ", was Rs " + w.rate().toPlainString() : ""));
    return repo.ward(id).orElseThrow();
  }

  @Transactional
  public Bed addBed(String wardId, String label) {
    var w = repo.ward(wardId).filter(x -> CurrentUser.get().canSee(x.branchId())).orElseThrow(() -> new ApiException(404, "Ward not found"));
    String l = label.trim().toUpperCase();
    if (repo.labelTaken(w.branchId(), l)) throw new ApiException(409, "Bed " + l + " already exists in this branch");
    String id = repo.insertBed(wardId, l);
    audit.logForBranch(w.branchId(), "Created", "Bed", id, l + " in " + w.name());
    return repo.bed(id).orElseThrow();
  }

  @Transactional
  public Bed setBedStatus(String bedId, String status) {
    if (!FREE_STATUSES.contains(status)) throw new ApiException(400, "Status must be Available, Reserved, Cleaning or Maintenance");
    var b = repo.bedForUpdate(bedId).filter(x -> CurrentUser.get().canSee(x.branchId())).orElseThrow(() -> new ApiException(404, "Bed not found"));
    if (!repo.setFreeBedStatus(bedId, status))
      throw new ApiException(409, b.label() + " is occupied. Transfer or discharge the patient first");
    audit.logForBranch(b.branchId(), "Updated", "Bed", bedId, b.label() + ": " + b.status() + " to " + status);
    return repo.bed(bedId).orElseThrow();
  }

  // ---------- admit, transfer, update ----------

  @Transactional
  public AdmitResult admit(AdmitInput in) {
    var me = CurrentUser.get();
    if (!Boolean.TRUE.equals(in.consent())) throw new ApiException(422, "The general consent for admission must be signed first");
    var patient = repo.patient(in.patientId()).filter(p -> me.canSee(p.branchId())).orElseThrow(() -> new ApiException(400, "Patient not found"));
    var doctor = repo.doctor(in.doctorId()).orElseThrow(() -> new ApiException(400, "Unknown consultant " + in.doctorId()));
    var bed = repo.bedForUpdate(in.bedId()).filter(b -> me.canSee(b.branchId())).orElseThrow(() -> new ApiException(400, "Bed not found"));
    if (repo.hasOpenAdmission(patient.id())) throw new ApiException(409, patient.name() + " is already admitted");
    if (!bed.active() || !(bed.status().equals("Available") || bed.status().equals("Reserved")))
      throw new ApiException(409, bed.label() + " is " + bed.status().toLowerCase() + ". Choose another bed");
    var at = now();
    LocalDate expected = in.expectedDischarge() == null ? at.atZoneSameInstant(clock.getZone()).toLocalDate().plusDays(3) : in.expectedDischarge();
    if (expected.isBefore(at.atZoneSameInstant(clock.getZone()).toLocalDate())) throw new ApiException(400, "Expected discharge cannot be in the past");
    String type = in.type() == null ? "Planned" : in.type();
    String reason = in.reason().trim();
    String id = repo.nextAdmissionId();
    try {
      repo.insertAdmission(id, bed.branchId(), patient.id(), doctor.id(), doctor.deptId(), bed.id(), type, reason,
          blank(in.diagnosis(), reason), expected, at, me.id(), blank(in.erCaseId(), null));
    } catch (DuplicateKeyException race) {
      throw new ApiException(409, patient.name() + " is already admitted");
    }
    if (!repo.occupy(bed.id(), id)) throw new ApiException(409, bed.label() + " was just taken. Choose another bed");
    repo.openStay(id, bed.id(), at);
    repo.insertNote(id, "Progress", "Admitted to " + bed.label() + " under " + doctor.name() + " for " + reason + ".", me.name(), me.id(), at);
    if (in.advance() != null && in.advance().signum() > 0)
      receive(id, in.advance(), in.advanceMode() == null ? "CASH" : in.advanceMode(), blank(in.advanceReference(), null), me, at);
    audit.logForBranch(bed.branchId(), "Created", "Admission", id, patient.name() + " to " + bed.label() + " under " + doctor.name()
        + (in.erCaseId() == null ? "" : " from ER " + in.erCaseId()));

    String claimNumber = null, warning = null;
    if (Boolean.TRUE.equals(in.preauth())) {
      if (patient.providerId() == null || patient.policyNo() == null || patient.policyNo().isBlank())
        warning = "No insurance details on the patient record, so no pre-authorisation was raised";
      else if (!repo.insurerActive(patient.providerId()))
        warning = "The patient's insurer is not in the billing insurer list, so no pre-authorisation was raised";
      else {
        // Checked above, so the claim service does not reject it (an exception there would roll back the admission).
        int days = Math.max(1, (int) java.time.temporal.ChronoUnit.DAYS.between(at.atZoneSameInstant(clock.getZone()).toLocalDate(), expected));
        var w = repo.ward(bed.wardId()).orElseThrow();
        BigDecimal perDay = w.rate().add(price(NURSING_CODE)).add(price(VISIT_CODE));
        var c = claims.create(new ClaimService.NewClaim(null, patient.id(), patient.providerId(), patient.policyNo(), "PRE_AUTHORISATION",
            perDay.multiply(BigDecimal.valueOf(days)), null, List.of("Pre-auth form", "ID proof", "Policy card")));
        repo.setClaim(id, c.id());
        claimNumber = c.number();
      }
    }
    return new AdmitResult(read(id), claimNumber, warning);
  }

  @Transactional
  public Admission transfer(String id, String bedId) {
    var me = CurrentUser.get();
    var a = open(id);
    if (a.bedId().equals(bedId)) throw new ApiException(400, "The patient is already in this bed");
    var from = repo.bed(a.bedId()).orElseThrow();
    var to = repo.bedForUpdate(bedId).filter(b -> b.branchId().equals(a.branchId()))
        .orElseThrow(() -> new ApiException(400, "Bed not found in this branch"));
    var at = now();
    repo.vacate(from.id(), id);
    if (!repo.occupy(to.id(), id)) throw new ApiException(409, to.label() + " is " + to.status().toLowerCase() + ". Choose a free bed");
    repo.setBed(id, to.id());
    repo.closeStay(id, at);
    repo.openStay(id, to.id(), at);
    repo.insertNote(id, "Progress", "Transferred from " + from.label() + " to " + to.label() + ".", me.name(), me.id(), at);
    audit.logForBranch(a.branchId(), "Transferred", "Admission", id, a.patientName() + ": " + from.label() + " to " + to.label());
    return read(id);
  }

  @Transactional
  public Admission update(String id, UpdateInput in) {
    var a = open(id);
    if (in.expectedDischarge() != null && in.expectedDischarge().isBefore(LocalDate.now(clock)))
      throw new ApiException(400, "Expected discharge cannot be in the past");
    if (!repo.update(id, blank(in.diagnosis(), null), in.expectedDischarge(), in.version()))
      throw new ApiException(409, "Someone else updated this admission. Reload and try again");
    audit.logForBranch(a.branchId(), "Updated", "Admission", id, a.patientName()
        + (in.diagnosis() == null ? "" : ", diagnosis") + (in.expectedDischarge() == null ? "" : ", expected discharge " + in.expectedDischarge()));
    return read(id);
  }

  @Transactional
  public Admission planDischarge(String id) {
    var a = open(id);
    if (!a.status().equals("Discharge planned")) repo.setStatus(id, "Discharge planned");
    audit.logForBranch(a.branchId(), "Updated", "Admission", id, a.patientName() + ": discharge planned");
    return read(id);
  }

  // ---------- ward records ----------

  @Transactional
  public Admission addNote(String id, NoteInput in) {
    var me = CurrentUser.get();
    var a = open(id);
    if (in.type().equals("Doctor round") && !me.role().equals("doctor")) throw new ApiException(403, "Only doctors record doctor rounds");
    if (in.type().equals("Nursing") && !me.role().equals("nurse")) throw new ApiException(403, "Only nurses record nursing notes");
    repo.insertNote(id, in.type(), in.text().trim(), me.name(), me.id(), now());
    audit.logForBranch(a.branchId(), "Created", "Clinical note", id, in.type() + " note for " + a.patientName());
    return read(id);
  }

  @Transactional
  public Admission addCarePlan(String id, String text) {
    var me = CurrentUser.get();
    var a = open(id);
    repo.insertCarePlan(id, text.trim(), me.name(), now());
    audit.logForBranch(a.branchId(), "Updated", "Care plan", id, a.patientName() + ": " + text.trim());
    return read(id);
  }

  @Transactional
  public Admission addMar(String id, MarInput in) {
    var me = CurrentUser.get();
    var a = open(id);
    var today = LocalDate.now(clock);
    var date = in.date() == null ? today : in.date();
    if (date.isBefore(today.minusDays(1))) throw new ApiException(400, "Doses can be scheduled from yesterday onwards");
    repo.insertMar(id, in.med().trim(), blank(in.dose(), "—"), in.route(), date, in.time(), me.name(), me.id(), now());
    audit.logForBranch(a.branchId(), "Created", "MAR", id, in.med().trim() + " " + in.route() + " at " + in.time() + " for " + a.patientName());
    return read(id);
  }

  @Transactional
  public Admission recordDose(String id, UUID marId, MarStatusInput in) {
    var me = CurrentUser.get();
    var a = open(id);
    String med = repo.marMed(marId, id).orElseThrow(() -> new ApiException(404, "Dose not found on this admission"));
    if (!in.status().equals("Given") && (in.note() == null || in.note().isBlank()))
      throw new ApiException(422, "Give a reason when a dose is held or missed");
    if (!repo.setMar(marId, id, in.status(), me.name(), me.id(), now(), blank(in.note(), null)))
      throw new ApiException(409, med + " has already been recorded");
    audit.logForBranch(a.branchId(), "Updated", "MAR", id, med + " " + in.status().toLowerCase() + " for " + a.patientName());
    return read(id);
  }

  @Transactional
  public Admission addObs(String id, ObsInput in) {
    var me = CurrentUser.get();
    var a = open(id);
    int news = News2.score(in.rr(), in.spo2(), in.bp(), in.hr(), in.temp());
    repo.insertObs(id, now(), in.bp(), in.hr(), in.temp(), in.spo2(), in.rr(), in.pain(), news, me.name(), me.id());
    audit.logForBranch(a.branchId(), "Created", "Observations", id, a.patientName() + ": NEWS2 " + news);
    if (news >= 5)
      audit.logForBranch(a.branchId(), "Escalation", "Observations", id, "NEWS2 " + news + " for " + a.patientName() + ": urgent review by the doctor on duty");
    return read(id);
  }

  @Transactional
  public Admission addIo(String id, IoInput in) {
    var me = CurrentUser.get();
    var a = open(id);
    String type = blank(in.type(), in.kind().equals("Intake") ? "Oral" : "Urine");
    repo.insertIo(id, now(), in.kind(), type, in.ml(), me.name(), me.id());
    audit.logForBranch(a.branchId(), "Created", "Intake/output", id, in.kind() + " " + in.ml() + " ml for " + a.patientName());
    return read(id);
  }

  // ---------- money ----------

  private void receive(String id, BigDecimal amount, String mode, String reference, CurrentUser me, OffsetDateTime at) {
    String receipt = repo.nextReceipt("ADV");
    repo.insertDeposit(id, "DEPOSIT", receipt, amount, mode, reference, me.name(), me.id(), at);
    audit.logForBranch(repo.head(id, false).orElseThrow().branchId(), "Created", "Advance deposit", id, receipt + " Rs " + amount.toPlainString() + " by " + mode);
  }

  @Transactional
  public Admission deposit(String id, DepositInput in) {
    var me = CurrentUser.get();
    open(id);
    receive(id, in.amount(), in.mode() == null ? "CASH" : in.mode(), blank(in.reference(), null), me, now());
    return read(id);
  }

  /** Refunds what is left of the deposit after discharge. */
  @Transactional
  public Admission refundDeposit(String id, RefundInput in) {
    var me = CurrentUser.get();
    var a = visible(id, true);
    if (!a.status().equals("Discharged")) throw new ApiException(409, "Refund the deposit balance after discharge, once the final bill is settled");
    BigDecimal bal = repo.depositBalance(id);
    if (bal.signum() <= 0) throw new ApiException(409, "There is no deposit balance to refund");
    String receipt = repo.nextReceipt("ADR");
    repo.insertDeposit(id, "REFUND", receipt, bal, in.mode() == null ? "CASH" : in.mode(), blank(in.reference(), null), me.name(), me.id(), now());
    audit.logForBranch(a.branchId(), "Refunded", "Advance deposit", id, receipt + " Rs " + bal.toPlainString() + " to " + a.patientName());
    return read(id);
  }

  @Transactional
  public Admission addCharge(String id, ChargeInput in) {
    var me = CurrentUser.get();
    var a = open(id);
    String code = blank(in.tariffCode(), null);
    String desc, category; BigDecimal rate;
    if (code != null) {
      String asked = code;
      var t = tariff.byCode(asked).filter(x -> x.active()).orElseThrow(() -> new ApiException(400, "Unknown tariff code " + asked));
      desc = blank(in.description(), t.name()); category = t.category().name(); rate = in.rate() == null ? t.price() : in.rate();
      code = t.code();
    } else {
      if (in.description() == null || in.description().isBlank() || in.category() == null || in.rate() == null)
        throw new ApiException(400, "Give a tariff code, or a description, category and rate");
      desc = in.description().trim(); category = in.category(); rate = in.rate();
    }
    repo.insertCharge(id, code, desc, category, in.qty(), rate, me.name(), me.id(), now());
    audit.logForBranch(a.branchId(), "Created", "IPD charge", id, desc + " x " + in.qty().stripTrailingZeros().toPlainString() + " @ Rs " + rate.toPlainString());
    return read(id);
  }

  @Transactional
  public Admission cancelCharge(String id, UUID chargeId) {
    var a = open(id);
    if (!repo.cancelCharge(chargeId, id)) throw new ApiException(404, "Charge not found on this admission");
    audit.logForBranch(a.branchId(), "Cancelled", "IPD charge", id, chargeId.toString());
    return read(id);
  }

  private BigDecimal price(String code) {
    return tariff.byCode(code).filter(t -> t.active()).map(t -> t.price()).orElse(BigDecimal.ZERO);
  }

  /** The final bill's lines (before GST) if the patient left at {@code until}. */
  List<BillLine> lines(Head a, OffsetDateTime until) {
    var out = new ArrayList<BillLine>();
    var stays = repo.stays(a.id());
    var start = a.admittedAt().toInstant();
    int days = RoomDays.days(start, until.toInstant(), clock.getZone());
    for (var w : RoomDays.split(stays, start, until.toInstant(), clock.getZone())) {
      var qty = BigDecimal.valueOf(w.days());
      out.add(new BillLine(w.wardName() + " bed charges (" + w.days() + (w.days() == 1 ? " day)" : " days)"), "ROOM", null, qty, w.rate(),
          w.rate().multiply(qty)));
    }
    tariff.byCode(NURSING_CODE).filter(t -> t.active()).ifPresent(t -> out.add(new BillLine(t.name(), "NURSING", t.code(),
        BigDecimal.valueOf(days), t.price(), t.price().multiply(BigDecimal.valueOf(days)))));
    int visits = repo.countNotes(a.id(), "Doctor round");
    if (visits > 0) tariff.byCode(VISIT_CODE).filter(t -> t.active()).ifPresent(t -> out.add(new BillLine(t.name(), "CONSULTATION", t.code(),
        BigDecimal.valueOf(visits), t.price(), t.price().multiply(BigDecimal.valueOf(visits)))));
    for (var c : repo.charges(a.id()))
      out.add(new BillLine(c.description(), c.category(), c.tariffCode(), c.qty(), c.rate(), c.rate().multiply(c.qty())));
    return out;
  }

  public BillPreview bill(String id) {
    var a = visible(id, false);
    var adm = read(id);
    BigDecimal deposits = repo.deposited(id), balance = repo.depositBalance(id);
    if (a.status().equals("Discharged"))
      return new BillPreview(id, 0, List.of(), BigDecimal.ZERO, deposits, balance, BigDecimal.ZERO, adm.invoiceId(), adm.invoiceNumber());
    var at = now();
    var lines = lines(a, at);
    BigDecimal subtotal = lines.stream().map(BillLine::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
    int days = RoomDays.days(a.admittedAt().toInstant(), at.toInstant(), clock.getZone());
    return new BillPreview(id, days, lines, subtotal, deposits, balance, subtotal.subtract(balance).max(BigDecimal.ZERO), null, null);
  }

  // ---------- discharge ----------

  @Transactional
  public Admission discharge(String id, DischargeInput in) {
    var me = CurrentUser.get();
    var a = open(id);
    var at = now();
    var lines = lines(a, at);
    var invLines = lines.stream().map(l -> l.tariffCode() != null && !l.category().equals("ROOM")
        ? new NewInvoiceLine(l.tariffCode(), l.description(), LineCategory.valueOf(l.category()), l.qty(), l.rate(), null, REF, id)
        : NewInvoiceLine.of(l.description(), LineCategory.valueOf(l.category()), l.qty(), l.rate(), null, REF, id)).toList();
    var inv = billing.createInvoice(new NewInvoice(a.patientId(), InvoiceKind.IPD, a.branchId(), invLines, BigDecimal.ZERO, id, REF, id,
        "Final bill for admission " + id));
    BigDecimal balance = repo.depositBalance(id);
    BigDecimal apply = balance.min(inv.due());
    if (apply.signum() > 0) {
      var pay = billing.recordPayment(inv.id(), PayMode.ADVANCE, apply, "Advance deposit for " + id);
      repo.insertDeposit(id, "ADJUSTED", repo.nextReceipt("ADJ"), apply, "ADVANCE", pay.receiptNumber(), me.name(), me.id(), at);
    }
    var checklist = in.checklist() == null ? List.<String>of() : in.checklist().stream().filter(s -> s != null && !s.isBlank()).map(String::trim).toList();
    repo.discharge(id, at, me.id(), me.name(), in.summary().trim(), checklist, inv.id(), inv.number());
    repo.vacate(a.bedId(), id);
    repo.closeStay(id, at);
    audit.logForBranch(a.branchId(), "Discharged", "Admission", id, a.patientName() + ", final bill " + inv.number() + " Rs " + inv.total().toPlainString()
        + (apply.signum() > 0 ? ", advance adjusted Rs " + apply.toPlainString() : ""));
    return read(id);
  }

  private static String blank(String s, String fallback) { return s == null || s.isBlank() ? fallback : s.trim(); }
}
