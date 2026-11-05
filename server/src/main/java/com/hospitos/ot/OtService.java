package com.hospitos.ot;

import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import com.hospitos.ot.OtDtos.NewSurgery;
import com.hospitos.ot.OtDtos.Surgery;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Operation theatre schedule: Scheduled → Pre-op → In progress → Recovery → Completed, or Cancelled before surgery
 * starts. A room or surgeon is never double booked, and surgery cannot start until every safety checklist item is ticked.
 */
@Service
public class OtService {
  /** Pre-operative safety checks (based on the WHO surgical safety checklist sign-in). */
  static final List<String> CHECKLIST = List.of("Consent signed", "Site marked", "Fasting confirmed", "Allergies checked",
      "Blood arranged", "Anaesthesia review", "Implants available");
  static final List<String> FLOW = List.of("Scheduled", "Pre-op", "In progress", "Recovery", "Completed");
  static final Map<String, String> EVENTS = Map.of("Pre-op", "Pre-op checks started", "In progress", "Patient in OT, surgery started",
      "Recovery", "Moved to recovery", "Completed", "Shifted to ward");
  static final Set<String> ANAESTHESIA = Set.of("General", "Spinal", "Regional block", "Local with sedation");
  private static final DateTimeFormatter HM = DateTimeFormatter.ofPattern("HH:mm");
  private final OtRepository repo;
  private final AuditService audit;
  private final Clock clock;
  public OtService(OtRepository repo, AuditService audit, Clock clock) { this.repo = repo; this.audit = audit; this.clock = clock; }

  String branch(String requested) {
    var me = CurrentUser.get();
    String b = requested == null || requested.isBlank() ? me.homeBranch() : requested.trim();
    if (b == null) throw new ApiException(400, "Choose a branch");
    if (!me.canSee(b)) throw new ApiException(403, "You do not have access to this branch");
    return b;
  }

  Surgery visible(String id) {
    var s = repo.find(id).orElseThrow(() -> new ApiException(404, "Surgery not found"));
    if (!CurrentUser.get().canSee(s.branchId())) throw new ApiException(404, "Surgery not found");
    return s;
  }

  public List<Surgery> list(String branchId, LocalDate from, LocalDate to, String patientId) {
    var me = CurrentUser.get();
    if (patientId != null) {
      var f = from == null ? LocalDate.of(2000, 1, 1) : from;
      var t = to == null ? LocalDate.now(clock).plusYears(2) : to;
      return repo.search(me.superAdmin() ? null : me.branches(), f, t, patientId);
    }
    var f = from == null ? LocalDate.now(clock) : from;
    var t = to == null ? f : to;
    if (t.isBefore(f)) throw new ApiException(400, "The end date is before the start date");
    if (f.plusDays(62).isBefore(t)) throw new ApiException(400, "Choose at most two months at a time");
    return repo.search(List.of(branch(branchId)), f, t, null);
  }

  @Transactional
  public Surgery book(NewSurgery in) {
    var me = CurrentUser.get();
    String branch = branch(in.branchId());
    var p = repo.patient(in.patientId().trim()).filter(x -> me.canSee(x.branchId())).orElseThrow(() -> new ApiException(400, "Patient not found"));
    String surgeon = repo.doctorName(in.surgeonId().trim()).map(n -> in.surgeonId().trim())
        .orElseThrow(() -> new ApiException(400, "Unknown surgeon " + in.surgeonId()));
    String room = in.room().trim();
    if (!repo.rooms(branch).contains(room)) throw new ApiException(400, "Unknown theatre " + room);
    if (!ANAESTHESIA.contains(in.anaesthesia().trim())) throw new ApiException(400, "Anaesthesia must be General, Spinal, Regional block or Local with sedation");
    if (in.date().isBefore(LocalDate.now(clock))) throw new ApiException(422, "Surgery cannot be booked on a past date");
    var start = in.date().atTime(LocalTime.parse(in.start()));
    var end = start.plusMinutes(in.durationMin());
    checkClash(branch, room, surgeon, start, end, null);
    String id = repo.nextId();
    try {
      repo.insert(id, branch, p.id(), surgeon, blank(in.anaesthetist()), in.anaesthesia().trim(), room, start, end, in.procedure().trim(),
          blank(in.admissionId()), me.id(), CHECKLIST);
    } catch (DataIntegrityViolationException e) {
      // Someone booked an overlapping slot at the same moment; the database constraint refused this one.
      throw new ApiException(409, room + " was just booked for an overlapping time. Refresh and choose another slot");
    }
    repo.event(id, me.name(), "Booked for " + in.date() + " " + in.start() + " in " + room);
    audit.logForBranch(branch, "Created", "Surgery", id, p.name() + ": " + in.procedure().trim() + " · " + room + " " + in.date() + " " + in.start());
    return repo.find(id).orElseThrow();
  }

  private void checkClash(String branch, String room, String surgeon, LocalDateTime start, LocalDateTime end, String except) {
    var hit = repo.clashes(branch, room, surgeon, start, end, except);
    if (hit.isEmpty()) return;
    var c = hit.get(0);
    if (c.sameRoom())
      throw new ApiException(409, room + " is booked for " + c.procedure() + " at " + c.startsAt().format(HM) + " (" + c.durationMin() + " min)");
    throw new ApiException(409, c.surgeonName() + " is already operating at " + c.startsAt().format(HM) + " (" + c.durationMin() + " min)");
  }

  @Transactional
  public Surgery check(String id, String item, boolean done) {
    var me = CurrentUser.get();
    var s = visible(id);
    if (s.status().equals("Completed") || s.status().equals("Cancelled")) throw new ApiException(409, "This surgery is " + s.status().toLowerCase());
    if (!done && !s.status().equals("Scheduled") && !s.status().equals("Pre-op"))
      throw new ApiException(409, "The checklist is locked once surgery has started");
    if (!s.checklist().containsKey(item)) throw new ApiException(400, "Unknown checklist item " + item);
    if (s.checklist().get(item) == done) return s;
    repo.setCheck(id, item, done, me.name());
    repo.event(id, me.name(), (done ? "Checked: " : "Unchecked: ") + item);
    audit.logForBranch(s.branchId(), "Updated", "Surgery checklist", id, item + (done ? " done" : " undone"));
    return repo.find(id).orElseThrow();
  }

  @Transactional
  public Surgery advance(String id, String from) {
    var me = CurrentUser.get();
    var s = visible(id);
    if (!s.status().equals(from)) throw new ApiException(409, "This surgery is now " + s.status().toLowerCase() + ". Refresh to see the latest");
    int i = FLOW.indexOf(from);
    if (i < 0 || i == FLOW.size() - 1) throw new ApiException(409, "This surgery is " + from.toLowerCase());
    String to = FLOW.get(i + 1);
    if (to.equals("In progress")) {
      var missing = s.checklist().entrySet().stream().filter(e -> !e.getValue()).map(Map.Entry::getKey).toList();
      if (!missing.isEmpty()) throw new ApiException(422, "Complete the safety checklist before starting surgery: " + String.join(", ", missing));
    }
    if (!repo.transition(id, from, to, "")) throw new ApiException(409, "This surgery was just updated. Refresh to see the latest");
    repo.event(id, me.name(), EVENTS.get(to));
    audit.logForBranch(s.branchId(), "Updated", "Surgery", id, s.procedure() + " → " + to);
    return repo.find(id).orElseThrow();
  }

  @Transactional
  public Surgery cancel(String id, String reason) {
    var me = CurrentUser.get();
    var s = visible(id);
    if (!s.status().equals("Scheduled") && !s.status().equals("Pre-op"))
      throw new ApiException(409, "Only a surgery that has not started can be cancelled; this one is " + s.status().toLowerCase());
    String r = blank(reason);
    if (!repo.transition(id, s.status(), "Cancelled", "cancel_reason = ?", r)) throw new ApiException(409, "This surgery was just updated. Refresh to see the latest");
    repo.event(id, me.name(), "Cancelled" + (r.isEmpty() ? "" : ": " + r));
    audit.logForBranch(s.branchId(), "Cancelled", "Surgery", id, s.procedure() + " for " + s.patientName() + (r.isEmpty() ? "" : " (" + r + ")"));
    return repo.find(id).orElseThrow();
  }

  @Transactional
  public Surgery notes(String id, String notes) {
    var s = visible(id);
    if (!s.status().equals("Recovery") && !s.status().equals("Completed"))
      throw new ApiException(409, "Post-op notes can be written once the patient is in recovery");
    repo.setNotes(id, notes.trim());
    audit.logForBranch(s.branchId(), "Updated", "Post-op notes", id, s.procedure());
    return repo.find(id).orElseThrow();
  }

  private static String blank(String s) { return s == null ? "" : s.trim(); }
}
