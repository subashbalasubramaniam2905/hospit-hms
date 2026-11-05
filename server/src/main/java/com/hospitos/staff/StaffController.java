package com.hospitos.staff;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.BranchScope;
import com.hospitos.common.CurrentUser;
import com.hospitos.notifications.NotificationService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/** Staff directory, leave, weekly roster, attendance register and a payroll preview. HR data, so HR and administrators only. */
@RestController
@RequestMapping("/api/staff")
@PreAuthorize("hasAnyRole('super-admin','admin','hr')")
public class StaffController {
  private static final Set<String> CATEGORIES = Set.of("Doctor", "Nurse", "Technician", "Admin", "Support", "Pharmacist");
  private static final Set<String> SHIFTS = Set.of("Morning", "Evening", "Night", "General");
  private static final Set<String> ROSTER = Set.of("Morning", "Evening", "Night", "Off");
  private static final Set<String> MARKS = Set.of("Present", "Absent", "Half day", "Leave");
  private static final BigDecimal PF = new BigDecimal("0.12"), PROF_TAX = new BigDecimal("200");
  private final JdbcClient db;
  private final AuditService audit;
  private final NotificationService notes;
  private final ObjectMapper json;
  private final Clock clock;
  public StaffController(JdbcClient db, AuditService audit, NotificationService notes, ObjectMapper json, Clock clock) {
    this.db = db; this.audit = audit; this.notes = notes; this.json = json; this.clock = clock;
  }

  private LocalDate today() { return LocalDate.now(clock); }

  // ------------------------------------------------------------------ directory

  /** attendancePct covers the last 30 days with marks; null when none were recorded. */
  public record Staff(String id, String branchId, String name, String role, String category, String deptId, String phone, String email,
                      String shift, String status, LocalDate joined, BigDecimal salary, String doctorId, Integer attendancePct, int version) {}
  public record StaffInput(@NotBlank @Size(max = 120) String name, @NotBlank @Size(max = 80) String role, @NotBlank String category,
                           @Size(max = 10) String deptId, @Size(max = 30) String phone, @Size(max = 120) String email, @NotBlank String shift,
                           String status, @NotNull @DecimalMin("0") BigDecimal salary, String branchId, LocalDate joined, Integer version) {}

  private static final String STAFF_SQL = """
      select s.id, s.branch_id, s.name, s.role, s.category, s.dept_id, s.phone, s.email, s.shift,
             case when s.status <> 'On leave' and exists (select 1 from leave_request l where l.staff_id = s.id and l.status = 'Approved'
                    and :today between l.from_date and l.to_date) then 'On leave' else s.status end as status,
             s.joined, s.salary, s.doctor_id,
             (select round(100.0 * sum(case a.status when 'Present' then 1 when 'Half day' then 0.5 else 0 end) / count(*))::int
                from attendance a where a.staff_id = s.id and a.day > :today - 30 and a.day <= :today) as attendance_pct,
             s.version
      from staff_member s where s.active and (:all or s.branch_id = any(:branches)) %s order by s.name""";

  private List<Staff> query(String extra, Map<String, Object> params) {
    var me = CurrentUser.get();
    var q = db.sql(STAFF_SQL.formatted(extra)).param("today", today()).param("all", me.superAdmin()).param("branches", me.branches().toArray(String[]::new));
    for (var e : params.entrySet()) q = q.param(e.getKey(), e.getValue());
    return q.query(Staff.class).list();
  }

  private Staff get(String id) {
    return query("and s.id = :id", Map.of("id", id)).stream().findFirst().orElseThrow(() -> new ApiException(404, "Staff member not found"));
  }

  @GetMapping
  public List<Staff> list(@RequestParam(required = false) String branch) {
    if (branch == null || branch.isBlank()) return query("", Map.of());
    BranchScope.check(branch, "Branch");
    return query("and s.branch_id = :b", Map.of("b", branch));
  }

  private static void check(StaffInput in) {
    if (!CATEGORIES.contains(in.category())) throw new ApiException(400, "Unknown category: " + in.category());
    if (!SHIFTS.contains(in.shift())) throw new ApiException(400, "Shift must be Morning, Evening, Night or General");
    if (in.status() != null && !Set.of("On duty", "Off duty", "On leave").contains(in.status())) throw new ApiException(400, "Unknown status");
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public Staff create(@Valid @RequestBody StaffInput in) {
    check(in);
    String br = BranchScope.pick(in.branchId());
    String id = "ST" + db.sql("select nextval('staff_seq')").query(Long.class).single();
    db.sql("""
        insert into staff_member (id, branch_id, name, role, category, dept_id, phone, email, shift, status, joined, salary)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
        .params(id, br, in.name().trim(), in.role().trim(), in.category(), nz(in.deptId()), nz(in.phone()), nz(in.email()), in.shift(),
            in.status() == null ? "Off duty" : in.status(), in.joined() == null ? today() : in.joined(), in.salary()).update();
    audit.logForBranch(br, "Created", "Staff", id, in.name() + " · " + in.role());
    return get(id);
  }

  @PutMapping("/{id}")
  @Transactional
  public Staff update(@PathVariable String id, @Valid @RequestBody StaffInput in) {
    check(in);
    var cur = get(id);
    if (in.version() == null || in.version() != cur.version()) throw new ApiException(409, "Someone else changed this record. Reload and try again");
    db.sql("""
        update staff_member set name = ?, role = ?, category = ?, dept_id = ?, phone = ?, email = ?, shift = ?, status = ?, salary = ?,
          version = version + 1 where id = ? and version = ?""")
        .params(in.name().trim(), in.role().trim(), in.category(), nz(in.deptId()), nz(in.phone()), nz(in.email()), in.shift(),
            in.status() == null ? cur.status() : in.status(), in.salary(), id, cur.version()).update();
    String detail = in.name() + (cur.salary().compareTo(in.salary()) != 0 ? " · salary changed" : "");
    audit.logForBranch(cur.branchId(), "Updated", "Staff", id, detail);
    return get(id);
  }

  @DeleteMapping("/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void deactivate(@PathVariable String id) {
    var cur = get(id);
    db.sql("update staff_member set active = false, version = version + 1 where id = ?").param(id).update();
    audit.logForBranch(cur.branchId(), "Deactivated", "Staff", id, cur.name());
  }

  private static String nz(String s) { return s == null ? "" : s.trim(); }

  // ------------------------------------------------------------------ leave

  public record Leave(String id, String staffId, String staffName, LocalDate from, LocalDate to, String type, String reason, String status,
                      String decidedBy, OffsetDateTime decidedAt) {}
  public record LeaveInput(@NotBlank String staffId, @NotNull LocalDate from, @NotNull LocalDate to, @NotBlank String type, @Size(max = 300) String reason) {}
  public record Decision(@NotBlank String status) {}

  private List<Leave> leaves(String extra, Object id) {
    var me = CurrentUser.get();
    var q = db.sql("""
        select l.id, l.staff_id, s.name as staff_name, l.from_date as "from", l.to_date as "to", l.type, l.reason, l.status, l.decided_by, l.decided_at
        from leave_request l join staff_member s on s.id = l.staff_id
        where (:all or s.branch_id = any(:branches)) %s order by l.from_date desc, l.id desc""".formatted(extra))
        .param("all", me.superAdmin()).param("branches", me.branches().toArray(String[]::new));
    if (id != null) q = q.param("id", id);
    return q.query(Leave.class).list();
  }

  @GetMapping("/leave")
  public List<Leave> leave() { return leaves("", null); }

  @PostMapping("/leave")
  @ResponseStatus(HttpStatus.CREATED)
  public Leave requestLeave(@Valid @RequestBody LeaveInput in) {
    var s = get(in.staffId());
    if (!Set.of("Casual", "Sick", "Earned", "Maternity").contains(in.type())) throw new ApiException(400, "Unknown leave type");
    if (in.to().isBefore(in.from())) throw new ApiException(400, "The leave must end on or after its first day");
    if (in.from().plusDays(366).isBefore(in.to())) throw new ApiException(400, "Leave longer than a year is not allowed");
    String id = "LV" + db.sql("select nextval('leave_seq')").query(Long.class).single();
    db.sql("insert into leave_request (id, staff_id, from_date, to_date, type, reason) values (?, ?, ?, ?, ?, ?)")
        .params(id, s.id(), in.from(), in.to(), in.type(), nz(in.reason())).update();
    audit.logForBranch(s.branchId(), "Created", "Leave", id, s.name() + " " + in.type() + " " + in.from() + " to " + in.to());
    return leaves("and l.id = :id", id).get(0);
  }

  @PostMapping("/leave/{id}/decide")
  @Transactional
  public Leave decide(@PathVariable String id, @Valid @RequestBody Decision in) {
    if (!Set.of("Approved", "Rejected").contains(in.status())) throw new ApiException(400, "Status must be Approved or Rejected");
    var l = leaves("and l.id = :id", id).stream().findFirst().orElseThrow(() -> new ApiException(404, "Leave request not found"));
    if (!"Pending".equals(l.status())) throw new ApiException(409, "This request was already " + l.status().toLowerCase());
    var s = get(l.staffId());
    db.sql("update leave_request set status = ?, decided_by = ?, decided_at = now() where id = ? and status = 'Pending'")
        .params(in.status(), CurrentUser.get().name(), id).update();
    audit.logForBranch(s.branchId(), in.status(), "Leave", id, s.name() + " " + l.type() + " leave " + l.from() + " to " + l.to());
    return leaves("and l.id = :id", id).get(0);
  }

  // ------------------------------------------------------------------ roster

  public record RosterRow(@NotBlank String staffId, @NotNull @Size(min = 7, max = 7) List<String> shifts) {}
  public record Roster(LocalDate week, List<RosterRow> rows) {}
  public record RosterInput(@NotNull LocalDate week, @NotNull @Size(max = 500) List<@Valid RosterRow> rows, String branchId) {}

  private static LocalDate monday(LocalDate d) { return d.with(DayOfWeek.MONDAY); }

  /** The week starting on the Monday of {@code week} (default this week). Days with no saved shift show the person's usual shift. */
  @GetMapping("/roster")
  public Roster roster(@RequestParam(required = false) LocalDate week, @RequestParam(required = false) String branch) {
    LocalDate mon = monday(week == null ? today() : week);
    var people = list(branch);
    Map<String, String> saved = new HashMap<>();
    db.sql("select staff_id, day, shift from roster_shift where day between ? and ?").params(mon, mon.plusDays(6))
        .query((r, i) -> saved.put(r.getString(1) + "|" + r.getObject(2, LocalDate.class), r.getString(3))).list();
    var rows = new ArrayList<RosterRow>();
    for (var s : people) {
      var shifts = new ArrayList<String>();
      for (int i = 0; i < 7; i++) {
        String v = saved.get(s.id() + "|" + mon.plusDays(i));
        shifts.add(v != null ? v : i == 6 ? "Off" : "General".equals(s.shift()) ? "Morning" : s.shift());
      }
      rows.add(new RosterRow(s.id(), shifts));
    }
    return new Roster(mon, rows);
  }

  /** Saves and publishes the week's roster. Every listed person gets an in-app note to their account if they have one. */
  @PutMapping("/roster")
  @Transactional
  public Roster publish(@Valid @RequestBody RosterInput in) {
    LocalDate mon = monday(in.week());
    String br = BranchScope.pick(in.branchId());
    for (var row : in.rows()) {
      var s = get(row.staffId());
      for (int i = 0; i < 7; i++) {
        String sh = row.shifts().get(i);
        if (!ROSTER.contains(sh)) throw new ApiException(400, "Shift must be Morning, Evening, Night or Off");
        db.sql("insert into roster_shift (staff_id, day, shift) values (?, ?, ?) on conflict (staff_id, day) do update set shift = excluded.shift")
            .params(s.id(), mon.plusDays(i), sh).update();
      }
      UUID uid = db.sql("select user_id from staff_member where id = ?").param(s.id()).query(UUID.class).optional().orElse(null);
      if (uid != null) notes.inAppTo(uid, new NotificationService.Note("Roster published", "Your shifts for the week of " + mon + " are out.", "/staff", "calendar-days", "b"));
    }
    audit.logForBranch(br, "Published", "Roster", mon.toString(), in.rows().size() + " staff, week of " + mon);
    return roster(mon, in.branchId());
  }

  // ------------------------------------------------------------------ attendance

  public record Mark(@NotBlank String staffId, @NotBlank String status) {}
  public record Register(@NotNull LocalDate date, @NotNull @Size(max = 500) List<@Valid Mark> entries) {}

  @GetMapping("/attendance")
  public List<Mark> attendance(@RequestParam(required = false) LocalDate date) {
    LocalDate d = date == null ? today() : date;
    var ids = list(null).stream().map(Staff::id).toList();
    return db.sql("select staff_id, status from attendance where day = ? and staff_id = any(?)").params(d, ids.toArray(String[]::new))
        .query(Mark.class).list();
  }

  @PutMapping("/attendance")
  @Transactional
  public List<Mark> mark(@Valid @RequestBody Register in) {
    if (in.date().isAfter(today())) throw new ApiException(400, "Attendance cannot be marked for a future day");
    if (in.date().isBefore(today().minusDays(31))) throw new ApiException(400, "Attendance older than a month cannot be changed here");
    String by = CurrentUser.get().name();
    String branch = null;
    for (var m : in.entries()) {
      if (!MARKS.contains(m.status())) throw new ApiException(400, "Status must be Present, Absent, Half day or Leave");
      var s = get(m.staffId()); branch = s.branchId();
      db.sql("""
          insert into attendance (staff_id, day, status, marked_by) values (?, ?, ?, ?)
          on conflict (staff_id, day) do update set status = excluded.status, marked_by = excluded.marked_by""")
          .params(s.id(), in.date(), m.status(), by).update();
    }
    audit.logForBranch(branch, "Marked", "Attendance", in.date().toString(), in.entries().size() + " staff");
    return attendance(in.date());
  }

  // ------------------------------------------------------------------ payroll

  /** Illustrative deductions only (PF 12%, professional tax ₹200, loss of pay for absent days). Not a statutory calculation. */
  public record PayLine(String staffId, String name, String role, BigDecimal gross, BigDecimal pf, BigDecimal pt, BigDecimal lop,
                        BigDecimal absentDays, BigDecimal net) {}
  public record Payroll(String month, String branchId, List<PayLine> lines, BigDecimal gross, BigDecimal net, Run run) {}
  public record Run(long id, String month, int staff, BigDecimal gross, BigDecimal net, String runBy, OffsetDateTime runAt) {}
  public record RunInput(@NotBlank @Pattern(regexp = "\\d{4}-\\d{2}") String month, String branchId) {}

  @GetMapping("/payroll")
  public Payroll payroll(@RequestParam(required = false) String month, @RequestParam(required = false) String branch) {
    YearMonth ym = month == null ? YearMonth.from(today()) : YearMonth.parse(month);
    String br = BranchScope.pick(branch);
    Map<String, BigDecimal> absent = new HashMap<>();
    db.sql("""
        select a.staff_id, sum(case a.status when 'Absent' then 1 when 'Half day' then 0.5 else 0 end)
        from attendance a join staff_member s on s.id = a.staff_id
        where s.branch_id = ? and a.day between ? and ? group by a.staff_id""")
        .params(br, ym.atDay(1), ym.atEndOfMonth()).query((r, i) -> absent.put(r.getString(1), r.getBigDecimal(2))).list();
    var lines = new ArrayList<PayLine>();
    BigDecimal days = BigDecimal.valueOf(ym.lengthOfMonth()), tg = BigDecimal.ZERO, tn = BigDecimal.ZERO;
    for (var s : list(br)) {
      BigDecimal g = s.salary(), pf = g.multiply(PF).setScale(0, RoundingMode.HALF_UP), ab = absent.getOrDefault(s.id(), BigDecimal.ZERO);
      BigDecimal lop = g.multiply(ab).divide(days, 0, RoundingMode.HALF_UP);
      BigDecimal net = g.subtract(pf).subtract(lop).subtract(PROF_TAX).max(BigDecimal.ZERO);
      lines.add(new PayLine(s.id(), s.name(), s.role(), g, pf, PROF_TAX, lop, ab, net));
      tg = tg.add(g); tn = tn.add(net);
    }
    var run = db.sql("select id, month, staff, gross, net, run_by, run_at from payroll_run where branch_id = ? and month = ?")
        .params(br, ym.toString()).query(Run.class).optional().orElse(null);
    return new Payroll(ym.toString(), br, lines, tg, tn, run);
  }

  /** Records the month's payroll for the branch once. Nothing is uploaded to a bank. */
  @PostMapping("/payroll")
  @PreAuthorize("hasAnyRole('super-admin','admin')")
  @Transactional
  public Payroll run(@Valid @RequestBody RunInput in) {
    var p = payroll(in.month(), in.branchId());
    if (p.run() != null) throw new ApiException(409, "Payroll for " + p.month() + " was already run by " + p.run().runBy());
    if (p.lines().isEmpty()) throw new ApiException(400, "No staff in this branch");
    try {
      db.sql("insert into payroll_run (branch_id, month, staff, gross, net, lines, run_by) values (?, ?, ?, ?, ?, ?::jsonb, ?)")
          .params(p.branchId(), p.month(), p.lines().size(), p.gross(), p.net(), json.writeValueAsString(p.lines()), CurrentUser.get().name()).update();
    } catch (JsonProcessingException e) { throw new IllegalStateException(e); }
    audit.logForBranch(p.branchId(), "Approved", "Payroll", p.month(), p.lines().size() + " staff, net ₹" + p.net());
    return payroll(in.month(), in.branchId());
  }
}
