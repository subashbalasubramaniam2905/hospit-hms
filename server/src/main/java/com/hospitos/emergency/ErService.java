package com.hospitos.emergency;

import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import com.hospitos.emergency.ErDtos.ErCase;
import com.hospitos.emergency.ErDtos.NewCase;
import com.hospitos.emergency.ErDtos.Update;
import com.hospitos.emergency.ErDtos.Vitals;
import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Emergency department board. A case is open while Waiting, Under treatment or in Observation, and closes when the
 * patient is Admitted, Discharged or Referred out. Unknown patients get a temporary ER number and are linked to a
 * registered record later; admission needs a linked record.
 */
@Service
public class ErService {
  static final List<String> TRIAGE = List.of("Red", "Orange", "Yellow", "Green");
  static final Set<String> MODES = Set.of("Walk-in", "Ambulance", "Referred", "Police");
  static final Set<String> GENDERS = Set.of("Male", "Female", "Other", "Unknown");
  /** Statuses a user can set directly; Admitted comes only from a completed admission. */
  static final Set<String> SETTABLE = Set.of("Under treatment", "Observation", "Discharged", "Referred");
  static final Set<String> CLOSED = Set.of("Admitted", "Discharged", "Referred");
  private final ErRepository repo;
  private final AuditService audit;
  private final Clock clock;
  public ErService(ErRepository repo, AuditService audit, Clock clock) { this.repo = repo; this.audit = audit; this.clock = clock; }

  /** The branch to work in: the one asked for, or the user's home branch. */
  String branch(String requested) {
    var me = CurrentUser.get();
    String b = requested == null || requested.isBlank() ? me.homeBranch() : requested.trim();
    if (b == null) throw new ApiException(400, "Choose a branch");
    if (!me.canSee(b)) throw new ApiException(403, "You do not have access to this branch");
    return b;
  }

  ErCase visible(String id) {
    var c = repo.find(id).orElseThrow(() -> new ApiException(404, "ER case not found"));
    if (!CurrentUser.get().canSee(c.branchId())) throw new ApiException(404, "ER case not found");
    return c;
  }

  /** Open cases of a branch plus the ones closed since midnight clinic time. */
  public List<ErCase> board(String branchId) {
    var since = LocalDate.now(clock).atStartOfDay(clock.getZone()).toOffsetDateTime();
    return repo.search(branch(branchId), since, null, 500);
  }

  public List<ErCase> forPatient(String patientId) {
    var me = CurrentUser.get();
    return repo.search(null, null, patientId, 100).stream().filter(c -> me.canSee(c.branchId())).toList();
  }

  @Transactional
  public ErCase register(NewCase in) {
    var me = CurrentUser.get();
    String branch = branch(in.branchId());
    String mode = choice(in.mode(), MODES, "Arrival must be Walk-in, Ambulance, Referred or Police");
    String triage = choice(in.triage(), Set.copyOf(TRIAGE), "Triage must be Red, Orange, Yellow or Green");
    String gender = in.gender() == null || in.gender().isBlank() ? "Unknown" : choice(in.gender(), GENDERS, "Sex must be Male, Female, Other or Unknown");
    Vitals v = in.vitals() == null ? new Vitals("", null, null, null, null) : in.vitals();
    String label;
    String patientId = blank(in.patientId());
    if (patientId != null) {
      var p = repo.patient(patientId).filter(x -> me.canSee(x.branchId())).orElseThrow(() -> new ApiException(400, "Patient not found"));
      label = p.name();
    } else {
      label = "Unknown " + (gender.equals("Unknown") ? "patient" : gender.toLowerCase()) + (in.age() == null ? "" : ", about " + in.age() + " years");
    }
    String doctor = doctor(in.doctorId());
    String bay = freeBay(branch, blank(in.bay()), null);
    String suggested = TriageRules.suggest(v.bp(), v.hr(), v.spo2(), v.gcs());
    String id = repo.nextId();
    repo.insert(id, branch, patientId, label, in.age(), gender, mode, triage, suggested, in.complaint().trim(), bay, doctor, v, me.id());
    repo.event(id, me.name(), "Arrived by " + mode.toLowerCase() + ", triaged " + triage
        + (triage.equals(suggested) ? "" : " (vitals suggested " + suggested + ")") + (bay == null ? ", waiting for a bay" : ", " + bay));
    audit.logForBranch(branch, "Created", "Emergency case", id, label + ": " + in.complaint().trim() + " · " + triage);
    if (triage.equals("Red")) audit.logForBranch(branch, "Alert", "Emergency case", id, "Red triage: " + label + ". Resus team to attend.");
    return repo.find(id).orElseThrow();
  }

  /** Re-triage, assign a doctor, move bay or record new vitals. */
  @Transactional
  public ErCase update(String id, Update in) {
    var me = CurrentUser.get();
    var c = open(id);
    var events = new ArrayList<String>();
    if (in.triage() != null && !in.triage().equals(c.triage())) {
      String t = choice(in.triage(), Set.copyOf(TRIAGE), "Triage must be Red, Orange, Yellow or Green");
      repo.updateOpen(id, "triage = ?", t);
      events.add("Re-triaged " + c.triage() + " → " + t);
      if (t.equals("Red")) audit.logForBranch(c.branchId(), "Alert", "Emergency case", id, "Red triage: " + c.label());
    }
    if (in.doctorId() != null && !in.doctorId().equals(c.doctorId() == null ? "" : c.doctorId())) {
      String d = doctor(in.doctorId());
      repo.updateOpen(id, "doctor_id = ?", d);
      events.add(d == null ? "Doctor unassigned" : "Assigned to " + repo.doctorName(d).orElse(d));
    }
    if (in.bay() != null) {
      String bay = blank(in.bay());
      if (bay == null ? c.bay() != null : !bay.equals(c.bay())) {
        repo.updateOpen(id, "bay = ?", freeBay(c.branchId(), bay, id));
        events.add(bay == null ? "Moved to the corridor" : "Moved to " + bay);
      }
    }
    if (in.vitals() != null) {
      var v = in.vitals();
      repo.updateOpen(id, "bp = ?, hr = ?, spo2 = ?, gcs = ?, temp = ?", v.bp() == null ? "" : v.bp().trim(), v.hr(), v.spo2(), v.gcs(), v.temp());
      String s = TriageRules.suggest(v.bp(), v.hr(), v.spo2(), v.gcs());
      events.add("Vitals: BP " + dash(v.bp()) + ", HR " + dash(v.hr()) + ", SpO₂ " + dash(v.spo2()) + ", GCS " + dash(v.gcs())
          + (TRIAGE.indexOf(s) < TRIAGE.indexOf(in.triage() == null ? c.triage() : in.triage()) ? ". Vitals now suggest " + s : ""));
    }
    if (events.isEmpty()) return c;
    for (String e : events) repo.event(id, me.name(), e);
    audit.logForBranch(c.branchId(), "Updated", "Emergency case", id, String.join("; ", events));
    return repo.find(id).orElseThrow();
  }

  @Transactional
  public ErCase order(String id, String name) {
    var me = CurrentUser.get();
    var c = open(id);
    String n = name.trim();
    if (!repo.addOrder(id, n, me.name())) throw new ApiException(409, n + " is already ordered");
    repo.updateOpen(id, "status = case when status = 'Waiting' then 'Under treatment' else status end");
    repo.event(id, me.name(), "Ordered " + n);
    audit.logForBranch(c.branchId(), "Created", "ER order", id, n);
    return repo.find(id).orElseThrow();
  }

  /** Links a case registered without a record (unknown patient) to the patient's registered record. */
  @Transactional
  public ErCase link(String id, String patientId) {
    var me = CurrentUser.get();
    var c = visible(id);
    if (c.patientId() != null) throw new ApiException(409, "This case is already linked to " + c.patientId());
    var p = repo.patient(patientId.trim()).filter(x -> me.canSee(x.branchId())).orElseThrow(() -> new ApiException(400, "Patient not found"));
    // Allowed after the case closes too, so a discharged unknown patient's visit can still be filed.
    if (repo.linkPatient(id, p.id(), p.name()) != 1) throw new ApiException(409, "This case is already linked");
    repo.event(id, me.name(), "Linked to " + p.name() + " (" + p.id() + ")");
    audit.logForBranch(c.branchId(), "Merged", "ER case", id, c.label() + " linked to " + p.id());
    return repo.find(id).orElseThrow();
  }

  @Transactional
  public ErCase status(String id, String status, String note) {
    var me = CurrentUser.get();
    var c = open(id);
    String s = choice(status, SETTABLE, "Status must be Under treatment, Observation, Discharged or Referred");
    if (s.equals(c.status())) return c;
    String n = blank(note);
    if (CLOSED.contains(s)) {
      if (!repo.close(id, s, n, null)) throw closed(c);
    } else repo.updateOpen(id, "status = ?", s);
    repo.event(id, me.name(), (s.equals("Referred") ? "Referred out" : s) + (n == null ? "" : ": " + n));
    audit.logForBranch(c.branchId(), "Updated", "Emergency case", id, c.label() + " → " + s + (n == null ? "" : " (" + n + ")"));
    return repo.find(id).orElseThrow();
  }

  /**
   * Called after the inpatient admission for this case has been created. Safe to call twice: a case that is already
   * admitted only records the admission number if it was missing.
   */
  @Transactional
  public ErCase admitted(String id, String admissionId) {
    var me = CurrentUser.get();
    var c = visible(id);
    String adm = blank(admissionId);
    if (c.status().equals("Admitted")) {
      if (adm != null && c.admissionId() == null) repo.setAdmission(id, adm);
      return repo.find(id).orElseThrow();
    }
    if (CLOSED.contains(c.status())) throw closed(c);
    if (c.patientId() == null) throw new ApiException(409, "Link or register the patient before admission");
    if (!repo.close(id, "Admitted", null, adm)) throw closed(c);
    repo.event(id, me.name(), "Admitted" + (adm == null ? "" : " (" + adm + ")") + (c.bay() == null ? "" : ", " + c.bay() + " released"));
    audit.logForBranch(c.branchId(), "Updated", "Emergency case", id, c.label() + " admitted" + (adm == null ? "" : " as " + adm));
    return repo.find(id).orElseThrow();
  }

  // ---------- helpers ----------

  private ErCase open(String id) {
    var c = visible(id);
    if (CLOSED.contains(c.status())) throw closed(c);
    return c;
  }

  private static ApiException closed(ErCase c) {
    return new ApiException(409, c.label() + " has already been " + (c.status().equals("Referred") ? "referred out" : c.status().toLowerCase()));
  }

  /** Checks a bay exists and is free; null means no bay (corridor). */
  private String freeBay(String branch, String bay, String exceptCase) {
    if (bay == null) return null;
    if (!repo.bayExists(branch, bay)) throw new ApiException(400, "Unknown bay " + bay);
    repo.bayTakenBy(branch, bay, exceptCase).ifPresent(other -> { throw new ApiException(409, bay + " is occupied by " + other); });
    return bay;
  }

  private String doctor(String id) {
    String d = blank(id);
    if (d != null && repo.doctorName(d).isEmpty()) throw new ApiException(400, "Unknown doctor " + d);
    return d;
  }

  private static String choice(String v, Set<String> allowed, String error) {
    if (v == null || !allowed.contains(v.trim())) throw new ApiException(400, error);
    return v.trim();
  }

  private static String blank(String s) { return s == null || s.isBlank() ? null : s.trim(); }
  private static String dash(Object o) { return o == null || o.toString().isBlank() ? "—" : o.toString(); }
}
