package com.hospitos.admin;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hospitos.audit.AuditService;
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
 * Connection settings for outside systems. HospitOS has no live connectors yet, so a connection test only checks that
 * the settings are complete and never sends anything. Secret values are write-only: the API reports whether one is set.
 */
@RestController
@RequestMapping("/api/admin/integrations")
@PreAuthorize("hasRole('super-admin')")
public class IntegrationController {
  private final JdbcClient db;
  private final ObjectMapper json;
  private final SecretBox box;
  private final AuditService audit;
  public IntegrationController(JdbcClient db, ObjectMapper json, SecretBox box, AuditService audit) {
    this.db = db; this.json = json; this.box = box; this.audit = audit;
  }

  public record FieldDef(String key, String label, Boolean secret) {
    boolean isSecret() { return Boolean.TRUE.equals(secret); }
  }
  /** A field as the screen shows it. Secret fields carry no value, only whether one is stored. */
  public record Field(String key, String label, boolean secret, String value, boolean set) {}
  public record Integration(String id, String name, String category, String description, boolean enabled, String status,
                            List<Field> fields, OffsetDateTime lastTest, String lastResult, int version) {}
  public record Update(@NotNull Boolean enabled, @NotNull Map<String, String> values, @NotNull Integer version) {}
  public record TestResult(boolean ok, List<String> log, Integration integration) {}

  private record Row(String id, String name, String category, String description, boolean enabled, List<FieldDef> fields,
                     Map<String, String> config, Map<String, String> secrets, OffsetDateTime lastTest, String lastResult, int version) {}

  private Row row(String id, boolean lock) {
    return db.sql("select * from integration where id = ?" + (lock ? " for update" : "")).param(id).query((r, i) -> {
      try {
        String sealed = r.getString("secrets");
        return new Row(r.getString("id"), r.getString("name"), r.getString("category"), r.getString("description"), r.getBoolean("enabled"),
            json.readValue(r.getString("fields"), new TypeReference<List<FieldDef>>() {}),
            json.readValue(r.getString("config"), new TypeReference<Map<String, String>>() {}),
            sealed == null ? new LinkedHashMap<>() : json.readValue(box.open(sealed), new TypeReference<Map<String, String>>() {}),
            r.getObject("last_test", OffsetDateTime.class), r.getString("last_result"), r.getInt("version"));
      } catch (java.io.IOException e) { throw new IllegalStateException(e); }
    }).optional().orElseThrow(() -> new ApiException(404, "Integration not found"));
  }

  private static List<String> missing(Row r) {
    return r.fields().stream().filter(f -> blank(f.isSecret() ? r.secrets().get(f.key()) : r.config().get(f.key()))).map(FieldDef::label).toList();
  }
  private static boolean blank(String s) { return s == null || s.isBlank(); }

  /** Disabled, Not configured (a field is empty), or Configured. Connected needs a live connector, which none have yet. */
  private static String status(Row r) {
    if (!r.enabled()) return "Disabled";
    return missing(r).isEmpty() ? "Configured" : "Not configured";
  }

  private Integration view(Row r) {
    var fields = r.fields().stream().map(f -> f.isSecret()
        ? new Field(f.key(), f.label(), true, null, !blank(r.secrets().get(f.key())))
        : new Field(f.key(), f.label(), false, r.config().getOrDefault(f.key(), ""), !blank(r.config().get(f.key())))).toList();
    return new Integration(r.id(), r.name(), r.category(), r.description(), r.enabled(), status(r), fields, r.lastTest(), r.lastResult(), r.version());
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
          update integration set enabled = ?, config = ?::jsonb, secrets = ?, version = version + 1, updated_by = ?, updated_at = now()
          where id = ?""")
          .params(in.enabled(), json.writeValueAsString(config), secrets.isEmpty() ? null : box.seal(json.writeValueAsString(secrets)),
              CurrentUser.get().name(), id).update();
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
    var miss = missing(r);
    boolean ok = miss.isEmpty();
    if (!r.enabled()) log.add("> " + r.name() + " is turned off. Turn it on to use it.");
    if (ok) {
      log.add("> All settings are filled in.");
      log.add("> HospitOS does not have a live connector for " + r.name() + " yet, so no request was sent.");
      log.add("> Status: Configured");
    } else {
      log.add("> Missing: " + String.join(", ", miss));
      log.add("> Status: Not configured");
    }
    String result = ok ? "Settings complete; no live connector yet" : "Missing " + String.join(", ", miss);
    db.sql("update integration set last_test = now(), last_result = ? where id = ?").params(result, id).update();
    audit.log("Tested", "Integration", id, r.name() + ": " + result);
    return new TestResult(ok, log, view(row(id, false)));
  }
}
