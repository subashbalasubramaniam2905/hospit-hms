package com.hospitos.admin;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import com.hospitos.users.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/** Hospital settings outside billing, screen access by role, and departments. */
@RestController
@RequestMapping("/api/admin")
public class AdminController {
  private static final Set<String> LEVELS = Set.of("Full", "View", "None");
  private static final List<String> DAYS = List.of("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun");
  private final JdbcClient db;
  private final ObjectMapper json;
  private final AuditService audit;
  public AdminController(JdbcClient db, ObjectMapper json, AuditService audit) { this.db = db; this.json = json; this.audit = audit; }

  // ------------------------------------------------------------------ hospital settings

  public record Hours(@NotBlank String day, @NotBlank String open, @NotBlank String close, boolean closed) {}
  public record ApptRules(@Min(5) @Max(120) int slotMin, @Min(1) @Max(365) int maxAdvanceDays, boolean allowOverbook,
                          @Min(0) @Max(240) int noShowAfterMin, @Min(0) @Max(168) int reminderHours) {}
  public record QueueRules(boolean tokenPrefixByDept, @Min(0) @Max(480) int delayAlertMin, boolean emergencyJumpsQueue, boolean seniorPriority) {}
  public record NotifyRule(@NotBlank String key, @NotBlank String label, boolean sms, boolean email, boolean whatsapp, boolean inapp) {}
  public record Config(@Size(max = 80) String registration, @NotNull @Size(min = 7, max = 7) List<@Valid Hours> workingHours,
                       @NotNull @Valid ApptRules apptRules, @NotNull @Valid QueueRules queueRules,
                       @NotNull @Size(max = 30) List<@Valid NotifyRule> notifyRules, Integer version, String updatedBy, OffsetDateTime updatedAt) {}

  private <T> T read(String s, Class<T> t) { try { return json.readValue(s, t); } catch (JsonProcessingException e) { throw new IllegalStateException(e); } }
  private <T> T read(String s, com.fasterxml.jackson.core.type.TypeReference<T> t) { try { return json.readValue(s, t); } catch (JsonProcessingException e) { throw new IllegalStateException(e); } }
  private String write(Object o) { try { return json.writeValueAsString(o); } catch (JsonProcessingException e) { throw new IllegalStateException(e); } }

  /** Readable by every signed-in user, since booking, queue and notification screens follow these rules. */
  @GetMapping("/config")
  public Config config() {
    return db.sql("select * from hospital_config where id = 1").query((r, i) -> new Config(r.getString("registration"),
        read(r.getString("working_hours"), new com.fasterxml.jackson.core.type.TypeReference<List<Hours>>() {}),
        read(r.getString("appt_rules"), ApptRules.class), read(r.getString("queue_rules"), QueueRules.class),
        read(r.getString("notify_rules"), new com.fasterxml.jackson.core.type.TypeReference<List<NotifyRule>>() {}),
        r.getInt("version"), r.getString("updated_by"), r.getObject("updated_at", OffsetDateTime.class))).single();
  }

  @PutMapping("/config")
  @PreAuthorize("hasAnyRole('super-admin','admin')")
  @Transactional
  public Config saveConfig(@Valid @RequestBody Config in) {
    int cur = db.sql("select version from hospital_config where id = 1 for update").query(Integer.class).single();
    if (in.version() == null || in.version() != cur) throw new ApiException(409, "Someone else changed the settings. Reload and try again");
    for (int i = 0; i < 7; i++) {
      var h = in.workingHours().get(i);
      if (!DAYS.get(i).equals(h.day())) throw new ApiException(400, "Working hours must list Mon to Sun in order");
      try {
        if (!h.closed() && !LocalTime.parse(h.close()).isAfter(LocalTime.parse(h.open())))
          throw new ApiException(400, h.day() + ": closing time must be after opening time");
      } catch (java.time.format.DateTimeParseException e) { throw new ApiException(400, h.day() + ": times must be HH:mm"); }
    }
    db.sql("""
        update hospital_config set registration = ?, working_hours = ?::jsonb, appt_rules = ?::jsonb, queue_rules = ?::jsonb,
          notify_rules = ?::jsonb, version = version + 1, updated_by = ?, updated_at = now() where id = 1""")
        .params(in.registration() == null ? "" : in.registration().trim(), write(in.workingHours()), write(in.apptRules()),
            write(in.queueRules()), write(in.notifyRules()), CurrentUser.get().name()).update();
    audit.log("Changed", "Settings", "hospital", "Hospital settings updated");
    return config();
  }

  // ------------------------------------------------------------------ screen access by role

  public record Access(String role, String path, String level, String updatedBy, OffsetDateTime updatedAt) {}
  public record AccessInput(@NotBlank String role, @NotBlank @Pattern(regexp = "/[a-z0-9/-]{0,60}") String path, @NotBlank String level) {}

  /** Every signed-in user reads this, because the sidebar is built from it. */
  @GetMapping("/role-access")
  public List<Access> access() {
    return db.sql("select role, path, level, updated_by, updated_at from role_access order by role, path").query(Access.class).list();
  }

  @PutMapping("/role-access")
  @PreAuthorize("hasAnyRole('super-admin','admin')")
  public Access setAccess(@Valid @RequestBody AccessInput in) {
    var me = CurrentUser.get();
    if (!Roles.STAFF.contains(in.role())) throw new ApiException(400, "Unknown role: " + in.role());
    if (!LEVELS.contains(in.level())) throw new ApiException(400, "Level must be Full, View or None");
    if ("super-admin".equals(in.role())) throw new ApiException(400, "Super administrators always have full access");
    if ("admin".equals(in.role()) && !me.superAdmin()) throw new ApiException(403, "Only a super administrator can change administrator access");
    db.sql("""
        insert into role_access (role, path, level, updated_by) values (?, ?, ?, ?)
        on conflict (role, path) do update set level = excluded.level, updated_by = excluded.updated_by, updated_at = now()""")
        .params(in.role(), in.path(), in.level(), me.name()).update();
    audit.log("Changed", "Role permission", in.role() + ":" + in.path(), in.role() + " → " + in.path() + ": " + in.level());
    return db.sql("select role, path, level, updated_by, updated_at from role_access where role = ? and path = ?")
        .params(in.role(), in.path()).query(Access.class).single();
  }

  // ------------------------------------------------------------------ departments

  public record Department(String id, String branchId, String name, String icon, String floor, boolean active) {}
  public record DepartmentInput(@NotBlank @Size(max = 10) String branchId, @NotBlank @Size(max = 80) String name,
                                @Size(max = 40) String icon, @Size(max = 40) String floor, Boolean active) {}

  private Department dept(String id) {
    return db.sql("select id, branch_id, name, icon, floor, active from department where id = ?").param(id).query(Department.class)
        .optional().orElseThrow(() -> new ApiException(404, "Department not found"));
  }

  @GetMapping("/departments")
  @PreAuthorize("hasAnyRole('super-admin','admin')")
  public List<Department> departments() {
    var me = CurrentUser.get();
    return db.sql("select id, branch_id, name, icon, floor, active from department order by name").query(Department.class).list()
        .stream().filter(d -> me.canSee(d.branchId())).toList();
  }

  @PostMapping("/departments")
  @PreAuthorize("hasAnyRole('super-admin','admin')")
  @ResponseStatus(HttpStatus.CREATED)
  @Transactional
  public Department createDept(@Valid @RequestBody DepartmentInput in) {
    if (!CurrentUser.get().canSee(in.branchId())) throw new ApiException(403, "You can only add departments to your own branches");
    if (db.sql("select count(*) from branch where id = ?").param(in.branchId()).query(Integer.class).single() == 0) throw new ApiException(400, "Unknown branch");
    // Readable id from the name, like CARD or GM: initials of the words, or the first four letters of one word.
    String[] words = in.name().trim().toUpperCase().replaceAll("[^A-Z ]", "").split("\\s+");
    String base = words.length > 1 ? java.util.Arrays.stream(words).filter(w -> !w.isEmpty()).map(w -> w.substring(0, 1)).reduce("", String::concat)
        : words[0].substring(0, Math.min(4, words[0].length()));
    if (base.isEmpty()) base = "DEPT";
    String id = base; int n = 2;
    while (db.sql("select count(*) from department where id = ?").param(id).query(Integer.class).single() > 0) id = base + n++;
    db.sql("insert into department (id, branch_id, name, icon, floor) values (?, ?, ?, ?, ?)")
        .params(id, in.branchId(), in.name().trim(), in.icon() == null || in.icon().isBlank() ? "layout-grid" : in.icon(), in.floor() == null ? "" : in.floor().trim()).update();
    audit.logForBranch(in.branchId(), "Created", "Department", id, in.name());
    return dept(id);
  }

  @PutMapping("/departments/{id}")
  @PreAuthorize("hasAnyRole('super-admin','admin')")
  public Department updateDept(@PathVariable String id, @Valid @RequestBody DepartmentInput in) {
    var cur = dept(id);
    var me = CurrentUser.get();
    if (!me.canSee(cur.branchId())) throw new ApiException(404, "Department not found");
    if (!cur.branchId().equals(in.branchId())) throw new ApiException(400, "A department cannot move to another branch");
    db.sql("update department set name = ?, icon = ?, floor = ?, active = ? where id = ?")
        .params(in.name().trim(), in.icon() == null || in.icon().isBlank() ? cur.icon() : in.icon(), in.floor() == null ? cur.floor() : in.floor().trim(),
            in.active() == null ? cur.active() : in.active(), id).update();
    audit.logForBranch(cur.branchId(), "Updated", "Department", id, in.name() + (Boolean.FALSE.equals(in.active()) ? " (closed)" : ""));
    return dept(id);
  }
}
