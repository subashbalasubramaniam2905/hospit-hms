package com.hospitos.admin;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hospitos.common.ApiException;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Reads integration settings with their secrets decrypted, for the admin screen and for the live connectors. */
@Service
public class IntegrationSettings {
  private final JdbcClient db;
  private final ObjectMapper json;
  private final SecretBox box;
  public IntegrationSettings(JdbcClient db, ObjectMapper json, SecretBox box) { this.db = db; this.json = json; this.box = box; }

  public record FieldDef(String key, String label, Boolean secret, Boolean optional) {
    public boolean isSecret() { return Boolean.TRUE.equals(secret); }
    public boolean isOptional() { return Boolean.TRUE.equals(optional); }
  }

  public record Row(String id, String name, String category, String description, boolean enabled, List<FieldDef> fields,
                    Map<String, String> config, Map<String, String> secrets, OffsetDateTime lastTest, String lastResult, int version) {
    /** A setting by key, secret or not; blank when unset. */
    public String value(String key) {
      String v = secrets.containsKey(key) ? secrets.get(key) : config.get(key);
      return v == null ? "" : v.trim();
    }
    /** Labels of required fields that are empty. */
    public List<String> missing() {
      return fields.stream().filter(f -> !f.isOptional()).filter(f -> value(f.key()).isEmpty()).map(FieldDef::label).toList();
    }
    /** Turned on with every required field filled in. */
    public boolean usable() { return enabled && missing().isEmpty(); }
  }

  public Row row(String id, boolean lock) {
    return find(id, lock).orElseThrow(() -> new ApiException(404, "Integration not found"));
  }

  public Optional<Row> find(String id, boolean lock) {
    return db.sql("select * from integration where id = ?" + (lock ? " for update" : "")).param(id).query((r, i) -> {
      try {
        String sealed = r.getString("secrets");
        return new Row(r.getString("id"), r.getString("name"), r.getString("category"), r.getString("description"), r.getBoolean("enabled"),
            json.readValue(r.getString("fields"), new TypeReference<List<FieldDef>>() {}),
            json.readValue(r.getString("config"), new TypeReference<Map<String, String>>() {}),
            sealed == null ? new LinkedHashMap<>() : json.readValue(box.open(sealed), new TypeReference<Map<String, String>>() {}),
            r.getObject("last_test", OffsetDateTime.class), r.getString("last_result"), r.getInt("version"));
      } catch (java.io.IOException e) { throw new IllegalStateException(e); }
    }).optional();
  }
}
