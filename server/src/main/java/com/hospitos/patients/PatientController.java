package com.hospitos.patients;

import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/** Patient master index. Every read of a single record and every change is written to the audit trail. */
@RestController
@RequestMapping("/api/patients")
@PreAuthorize("hasAnyRole('super-admin','admin','doctor','nurse','receptionist','billing','lab-tech','pharmacist','radiologist')")
public class PatientController {
  private static final String WRITERS = "hasAnyRole('super-admin','admin','doctor','nurse','receptionist')";
  private final PatientRepository repo;
  private final AuditService audit;
  public PatientController(PatientRepository repo, AuditService audit) { this.repo = repo; this.audit = audit; }

  public record Duplicate(PatientRecord patient, int score, List<String> reasons) {}

  private static List<String> scope(CurrentUser me) { return me.superAdmin() ? null : me.branches(); }

  @GetMapping
  public List<PatientRecord> search(@RequestParam(defaultValue = "") String q, @RequestParam(defaultValue = "100") int limit,
                                    @RequestParam(defaultValue = "0") int offset) {
    var me = CurrentUser.get();
    var out = repo.search(q, scope(me), Math.min(Math.max(limit, 1), 500), Math.max(offset, 0));
    audit.logForBranch(me.homeBranch(), "Searched", "Patient", null,
        "q=\"" + q.trim() + "\" · " + out.size() + " results");
    return out;
  }

  @GetMapping("/{id}")
  public PatientRecord get(@PathVariable String id) {
    var p = visible(id);
    audit.logForBranch(p.branchId(), "Viewed", "Patient", id, p.name());
    return p;
  }

  @GetMapping("/duplicates")
  public List<Duplicate> duplicates(@RequestParam String name, @RequestParam(defaultValue = "") String mobile,
                                    @RequestParam(required = false) LocalDate dob) {
    String n = norm(name), m = digits(mobile);
    var out = new ArrayList<Duplicate>();
    for (var p : repo.duplicateCandidates(mobile, dob, scope(CurrentUser.get()))) {
      int score = 0; var reasons = new ArrayList<String>();
      String pn = norm(p.name());
      if (pn.isEmpty()) continue;
      if (n.length() > 2 && pn.equals(n)) { score += 60; reasons.add("Same name"); }
      else if (n.length() > 2 && (pn.contains(n) || n.contains(pn) || similar(pn, n) > .8)) { score += 35; reasons.add("Similar name"); }
      if (m.length() == 10 && digits(p.mobile()).equals(m)) { score += 40; reasons.add("Same mobile"); }
      if (dob != null && dob.equals(p.dob())) { score += 25; reasons.add("Same date of birth"); }
      if (score >= 40) out.add(new Duplicate(p, Math.min(99, score), reasons));
    }
    out.sort((a, b) -> b.score() - a.score());
    var top = out.stream().limit(3).toList();
    var me = CurrentUser.get();
    if (!top.isEmpty()) audit.logForBranch(me.homeBranch(), "Duplicate check", "Patient", null,
        top.size() + " possible matches: " + String.join(", ", top.stream().map(d -> d.patient().id()).toList()));
    return top;
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  @PreAuthorize(WRITERS)
  @Transactional
  public PatientRecord create(@Valid @RequestBody PatientInput in) {
    var me = CurrentUser.get();
    String branch = in.branchId() != null ? in.branchId() : me.branches().isEmpty() ? "BR1" : me.branches().get(0);
    if (!me.canSee(branch)) throw new ApiException(403, "You cannot register patients in this branch");
    String id = repo.nextUhid();
    repo.insert(id, branch, in, me.id());
    audit.logForBranch(branch, "Created", "Patient", id, "Registered " + in.name().trim());
    return repo.byId(id).orElseThrow();
  }

  @PutMapping("/{id}")
  @PreAuthorize(WRITERS)
  @Transactional
  public PatientRecord update(@PathVariable String id, @Valid @RequestBody PatientInput in) {
    var existing = visible(id);
    if (in.version() == null) throw new ApiException(400, "version is required");
    if (!repo.update(id, in)) throw new ApiException(409, "Someone else updated this patient. Reload and try again");
    audit.logForBranch(existing.branchId(), "Updated", "Patient", id, in.name().trim());
    return repo.byId(id).orElseThrow();
  }

  private PatientRecord visible(String id) {
    var p = repo.byId(id).orElseThrow(() -> new ApiException(404, "Patient not found"));
    if (!CurrentUser.get().canSee(p.branchId())) throw new ApiException(404, "Patient not found");
    return p;
  }

  private static String norm(String s) { return s == null ? "" : s.toLowerCase().replaceAll("[^\\p{L}\\p{M}]", ""); }
  private static String digits(String s) {
    String d = s == null ? "" : s.replaceAll("\\D", "");
    return d.length() > 10 ? d.substring(d.length() - 10) : d;
  }
  private static double similar(String a, String b) {
    var A = bigrams(a); var B = bigrams(b);
    long inter = A.stream().filter(B::contains).count();
    int total = A.size() + B.size();
    return total == 0 ? 0 : 2.0 * inter / total;
  }
  private static java.util.Set<String> bigrams(String s) {
    var out = new java.util.HashSet<String>();
    for (int i = 0; i + 1 < s.length(); i++) out.add(s.substring(i, i + 2));
    return out;
  }
}
