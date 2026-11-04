package com.hospitos.audit;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/audit")
@PreAuthorize("hasAnyRole('super-admin','admin')")
public class AuditController {
  private final JdbcClient db;
  public AuditController(JdbcClient db) { this.db = db; }

  public record Entry(long id, OffsetDateTime at, String userName, String role, String action, String entity,
                      String entityId, String detail, String ip) {}

  @GetMapping
  public List<Entry> list(@RequestParam(required = false) String entity, @RequestParam(required = false) String entityId,
                          @RequestParam(defaultValue = "200") int limit) {
    return db.sql("""
        select id, at, user_name, role, action, entity, entity_id, detail, ip from audit_log
        where (:entity::text is null or entity = :entity) and (:entityId::text is null or entity_id = :entityId)
        order by id desc limit :limit""")
        .param("entity", entity).param("entityId", entityId).param("limit", Math.min(Math.max(limit, 1), 1000))
        .query(Entry.class).list();
  }

  /** Recomputes the hash chain and reports the first row that does not match, if any. */
  @GetMapping("/verify")
  public Map<String, Object> verify() {
    Long broken = db.sql("""
        with c as (
          select id, hash, prev_hash, lag(hash, 1, 'GENESIS') over (order by id) as expected_prev,
                 encode(digest(prev_hash || '|' || at::text || '|' || coalesce(user_id::text, '') || '|' || user_name || '|' ||
                   role || '|' || action || '|' || entity || '|' || coalesce(entity_id, '') || '|' || detail, 'sha256'), 'hex') as recomputed
          from audit_log)
        select min(id) from c where prev_hash <> expected_prev or hash <> recomputed""")
        .query(Long.class).optional().orElse(null);
    long count = db.sql("select count(*) from audit_log").query(Long.class).single();
    return broken == null ? Map.of("intact", true, "entries", count) : Map.of("intact", false, "entries", count, "firstBrokenId", broken);
  }
}
