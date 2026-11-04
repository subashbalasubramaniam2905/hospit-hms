package com.hospitos.audit;

import com.hospitos.common.CurrentUser;
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

  public record Entry(long id, OffsetDateTime at, String userName, String role, String branchId, String action, String entity,
                      String entityId, String detail, String ip) {}

  /** Super administrators see everything; branch administrators see entries for their own branches. */
  @GetMapping
  public List<Entry> list(@RequestParam(required = false) String entity, @RequestParam(required = false) String entityId,
                          @RequestParam(defaultValue = "200") int limit) {
    var me = CurrentUser.get();
    return db.sql("""
        select id, at, user_name, role, branch_id, action, entity, entity_id, detail, ip from audit_log
        where (:entity::text is null or entity = :entity) and (:entityId::text is null or entity_id = :entityId)
          and (:all or branch_id = any(:branches))
        order by id desc limit :limit""")
        .param("entity", entity).param("entityId", entityId).param("limit", Math.min(Math.max(limit, 1), 1000))
        .param("all", me.superAdmin()).param("branches", me.branches().toArray(String[]::new))
        .query(Entry.class).list();
  }

  /** Recomputes the hash chain and reports the first row that does not match, if any. */
  @GetMapping("/verify")
  @PreAuthorize("hasRole('super-admin')")
  public Map<String, Object> verify() {
    Long broken = db.sql("""
        with c as (
          select a.id, a.hash, a.prev_hash, lag(a.hash, 1, 'GENESIS') over (order by a.id) as expected_prev,
                 encode(digest(audit_payload(a), 'sha256'), 'hex') as recomputed
          from audit_log a)
        select min(id) from c where prev_hash <> expected_prev or hash <> recomputed""")
        .query(Long.class).optional().orElse(null);
    long count = db.sql("select count(*) from audit_log").query(Long.class).single();
    return broken == null ? Map.of("intact", true, "entries", count) : Map.of("intact", false, "entries", count, "firstBrokenId", broken);
  }
}
