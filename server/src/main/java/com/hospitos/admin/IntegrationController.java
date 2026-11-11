package com.hospitos.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hospitos.audit.AuditService;
import com.hospitos.admin.IntegrationSettings.Row;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/**
 * Connection settings for outside systems. A connection test checks that the settings are complete and, for integrations with a
 * {@link LiveConnector} (WhatsApp so far), checks the real connection without messaging anyone. Secret values are write-only: the
 * API reports whether one is set.
 */
@RestController
@RequestMapping("/api/admin/integrations")
@PreAuthorize("hasRole('super-admin')")
public class IntegrationController {
  private final JdbcClient db;
  private final ObjectMapper json;
  private final SecretBox box;
  private final IntegrationSettings settings;
  private final AuditService audit;
  private final Map<String, LiveConnector> connectors = new LinkedHashMap<>();
  public IntegrationController(JdbcClient db, ObjectMapper json, SecretBox box, IntegrationSettings settings, AuditService audit,
                               List<LiveConnector> live) {
    this.db = db; this.json = json; this.box = box; this.settings = settings; this.audit = audit;
    live.forEach(c -> connectors.put(c.id(), c));
  }

  /** A field as the screen shows it. Secret fields carry no value, only whether one is stored. */
  public record Field(String key, String label, boolean secret, boolean optional, String value, boolean set) {}
  public record Integration(String id, String name, String category, String description, boolean enabled, String status,
                            List<Field> fields, OffsetDateTime lastTest, String lastResult, int version, boolean live) {}
  public record Update(@NotNull Boolean enabled, @NotNull Map<String, String> values, @NotNull Integer version) {}
  public record TestResult(boolean ok, List<String> log, Integration integration) {}

  private Row row(String id, boolean lock) { return settings.row(id, lock); }
  private static boolean blank(String s) { return s == null || s.isBlank(); }

  /**
   * Disabled, Not configured (a required field is empty), Configured, or, for integrations with a live connector, Connected after a
   * successful connection test and Error after a failed one.
   */
  private String status(Row r) {
    if (!r.enabled()) return "Disabled";
    if (!r.missing().isEmpty()) return "Not configured";
    if (connectors.containsKey(r.id()) && r.lastResult() != null) return r.lastResult().startsWith("Connected") ? "Connected" : "Error";
    return "Configured";
  }

  private Integration view(Row r) {
    var fields = r.fields().stream().map(f -> f.isSecret()
        ? new Field(f.key(), f.label(), true, f.isOptional(), null, !blank(r.secrets().get(f.key())))
        : new Field(f.key(), f.label(), false, f.isOptional(), r.config().getOrDefault(f.key(), ""), !blank(r.config().get(f.key())))).toList();
    return new Integration(r.id(), r.name(), r.category(), r.description(), r.enabled(), status(r), fields, r.lastTest(), r.lastResult(), r.version(),
        connectors.containsKey(r.id()));
  }

  @GetMapping
  public List<Integration> list() {
    return db.sql("select id from integration order by category, name").query(String.class).list().stream().map(id -> view(row(id, false))).toList();
  }

  /** Saves settings. A secret sent as an empty string is left unchanged; send "-" to clear it. */
  @PutMapping("/{id}")
  @Transactional
  public Integration update(@PathVariable String id, @Valid @RequestBody Update in) {
    var r = row(id, true);
    if (r.version() != in.version()) throw new ApiException(409, "Someone else changed these settings. Reload and try again");
    var config = new LinkedHashMap<>(r.config());
    var secrets = new LinkedHashMap<>(r.secrets());
    var changed = new ArrayList<String>();
    for (var f : r.fields()) {
      if (!in.values().containsKey(f.key())) continue;
      String v = in.values().get(f.key()) == null ? "" : in.values().get(f.key()).trim();
      if (v.length() > 500) throw new ApiException(400, f.label() + " is too long");
      if (f.isSecret()) {
        if (v.isEmpty()) continue;
        if ("-".equals(v)) secrets.remove(f.key()); else secrets.put(f.key(), v);
        changed.add(f.label() + " (secret)");
      } else if (!v.equals(config.getOrDefault(f.key(), ""))) { config.put(f.key(), v); changed.add(f.label()); }
    }
    try {
      db.sql("""
          update integration set enabled = ?, config = ?::jsonb, secrets = ?, version = version + 1, updated_by = ?, updated_at = now(),
            last_result = case when ? then null else last_result end
          where id = ?""")
          .params(in.enabled(), json.writeValueAsString(config), secrets.isEmpty() ? null : box.seal(json.writeValueAsString(secrets)),
              CurrentUser.get().name(), !changed.isEmpty(), id).update();
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) { throw new IllegalStateException(e); }
    String detail = r.name() + (in.enabled() != r.enabled() ? (in.enabled() ? " enabled" : " disabled") : "")
        + (changed.isEmpty() ? "" : "; changed " + String.join(", ", changed));
    audit.log("Changed", "Integration", id, detail);
    return view(row(id, false));
  }

  @PostMapping("/{id}/test")
  @Transactional
  public TestResult test(@PathVariable String id) {
    var r = row(id, true);
    var log = new ArrayList<String>();
    var miss = r.missing();
    boolean ok = miss.isEmpty();
    var connector = connectors.get(id);
    if (!r.enabled()) log.add("> " + r.name() + " is turned off. Turn it on to use it.");
    String result;
    if (!ok) {
      log.add("> Missing: " + String.join(", ", miss));
      log.add("> Status: Not configured");
      result = "Missing " + String.join(", ", miss);
    } else if (connector != null) {
      log.add("> All settings are filled in. Checking the connection…");
      var out = connector.test(r);
      log.addAll(out.log());
      ok = out.ok();
      result = out.summary();
      log.add("> Status: " + (ok ? "Connected" : "Error"));
    } else {
      log.add("> All settings are filled in.");
      log.add("> HospitOS does not have a live connector for " + r.name() + " yet, so no request was sent.");
      log.add("> Status: Configured");
      result = "Settings complete; no live connector yet";
    }
    db.sql("update integration set last_test = now(), last_result = ? where id = ?").params(result, id).update();
    audit.log("Tested", "Integration", id, r.name() + ": " + result);
    return new TestResult(ok, log, view(row(id, false)));
  }
}
