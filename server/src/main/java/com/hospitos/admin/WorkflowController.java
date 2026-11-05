package com.hospitos.admin;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/**
 * Workflow definitions (trigger, conditions, actions). There is no workflow engine yet: a test run checks the
 * definition and records the run, and nothing is sent.
 */
@RestController
@RequestMapping("/api/admin/workflows")
@PreAuthorize("hasAnyRole('super-admin','admin')")
public class WorkflowController {
  private static final Set<String> KINDS = Set.of("trigger", "condition", "action");
  private final JdbcClient db;
  private final ObjectMapper json;
  private final AuditService audit;
  public WorkflowController(JdbcClient db, ObjectMapper json, AuditService audit) { this.db = db; this.json = json; this.audit = audit; }

  public record Step(@NotBlank String kind, @NotBlank @Size(max = 120) String label, @Size(max = 200) String detail) {}
  public record Workflow(String id, String name, boolean enabled, List<Step> steps, int runs, OffsetDateTime lastRun, int version) {}
  public record Input(@NotBlank @Size(max = 120) String name, @NotNull Boolean enabled, @NotNull @Size(max = 20) List<@Valid Step> steps, Integer version) {}
  public record RunResult(Workflow workflow, List<String> log) {}

  private Workflow map(java.sql.ResultSet r) throws java.sql.SQLException {
    try {
      return new Workflow(r.getString("id"), r.getString("name"), r.getBoolean("enabled"),
          json.readValue(r.getString("steps"), new TypeReference<List<Step>>() {}), r.getInt("runs"),
          r.getObject("last_run", OffsetDateTime.class), r.getInt("version"));
    } catch (JsonProcessingException e) { throw new IllegalStateException(e); }
  }

  private Workflow get(String id, boolean lock) {
    return db.sql("select * from workflow where id = ?" + (lock ? " for update" : "")).param(id).query((r, i) -> map(r)).optional()
        .orElseThrow(() -> new ApiException(404, "Workflow not found"));
  }

  private static void check(Input in) {
    for (var s : in.steps()) if (!KINDS.contains(s.kind())) throw new ApiException(400, "Unknown step kind: " + s.kind());
    if (!in.steps().isEmpty() && !"trigger".equals(in.steps().get(0).kind())) throw new ApiException(400, "The first step must be a trigger");
    if (in.steps().stream().skip(1).anyMatch(s -> "trigger".equals(s.kind()))) throw new ApiException(400, "A workflow has only one trigger");
    if (in.enabled() && in.steps().stream().noneMatch(s -> "action".equals(s.kind())))
      throw new ApiException(400, "Add at least one action before turning this on");
  }

  private String steps(List<Step> steps) {
    try { return json.writeValueAsString(steps.stream().map(s -> new Step(s.kind(), s.label().trim(), s.detail() == null ? "" : s.detail().trim())).toList()); }
    catch (JsonProcessingException e) { throw new IllegalStateException(e); }
  }

  @GetMapping
  public List<Workflow> list() { return db.sql("select * from workflow order by id").query((r, i) -> map(r)).list(); }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public Workflow create(@Valid @RequestBody Input in) {
    check(in);
    String id = "WF" + db.sql("select nextval('workflow_seq')").query(Long.class).single();
    db.sql("insert into workflow (id, name, enabled, steps, created_by) values (?, ?, ?, ?::jsonb, ?)")
        .params(id, in.name().trim(), in.enabled(), steps(in.steps()), CurrentUser.get().name()).update();
    audit.log("Created", "Workflow", id, in.name());
    return get(id, false);
  }

  @PutMapping("/{id}")
  @Transactional
  public Workflow update(@PathVariable String id, @Valid @RequestBody Input in) {
    var cur = get(id, true);
    if (in.version() == null || in.version() != cur.version()) throw new ApiException(409, "Someone else changed this workflow. Reload and try again");
    check(in);
    db.sql("update workflow set name = ?, enabled = ?, steps = ?::jsonb, version = version + 1, updated_at = now() where id = ?")
        .params(in.name().trim(), in.enabled(), steps(in.steps()), id).update();
    String what = cur.enabled() != in.enabled() ? (in.enabled() ? "enabled" : "disabled") : "saved (" + in.steps().size() + " steps)";
    audit.log("Changed", "Workflow", id, in.name() + " " + what);
    return get(id, false);
  }

  @DeleteMapping("/{id}")
  @Transactional
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void delete(@PathVariable String id) {
    var cur = get(id, true);
    db.sql("delete from workflow_run where workflow_id = ?").param(id).update();
    db.sql("delete from workflow where id = ?").param(id).update();
    audit.log("Deleted", "Workflow", id, cur.name());
  }

  /** Walks the steps and records a test run. Nothing is sent: actions are listed as they would run. */
  @PostMapping("/{id}/test")
  @Transactional
  public RunResult test(@PathVariable String id) {
    var w = get(id, true);
    if (w.steps().isEmpty()) throw new ApiException(400, "Add a trigger first");
    var log = new java.util.ArrayList<String>();
    for (var s : w.steps()) {
      String d = s.detail() == null || s.detail().isBlank() ? "" : " (" + s.detail() + ")";
      log.add(switch (s.kind()) {
        case "trigger" -> "When: " + s.label() + d;
        case "condition" -> "Only if: " + s.label() + d + " (assumed true in a test)";
        default -> "Then: " + s.label() + d + " (not sent in a test)";
      });
    }
    try {
      db.sql("insert into workflow_run (workflow_id, by_name, test, result) values (?, ?, true, ?::jsonb)")
          .params(id, CurrentUser.get().name(), json.writeValueAsString(Map.of("log", log))).update();
    } catch (JsonProcessingException e) { throw new IllegalStateException(e); }
    db.sql("update workflow set runs = runs + 1, last_run = now() where id = ?").param(id).update();
    audit.log("Tested", "Workflow", id, w.name());
    return new RunResult(get(id, false), log);
  }
}
