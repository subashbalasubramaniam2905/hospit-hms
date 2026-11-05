package com.hospitos.audit;

import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/audit")
@PreAuthorize("hasAnyRole('super-admin','admin')")
public class AuditController {
  private final JdbcClient db;
  private final AuditService audit;
  public AuditController(JdbcClient db, AuditService audit) { this.db = db; this.audit = audit; }

  /** risk is Flagged (an administrator flagged it for review), Sensitive (access, money, settings or exports) or Normal. */
  public record Entry(long id, OffsetDateTime at, String userName, String role, String branchId, String action, String entity,
                      String entityId, String detail, String ip, String risk, String flaggedBy, String flagNote) {}
  public record Login(long id, OffsetDateTime at, String userName, String role, String email, String ip, String result) {}
  public record FlagInput(@Size(max = 300) String note) {}
  public record ExportInput(@Size(max = 60) String what, @Min(0) int rows) {}

  private static final String RISK = """
      case when f.audit_id is not null then 'Flagged'
           when a.action in ('Exported','Reset password','Sign-in failed','Sign-in blocked (locked)','Refunded','Cancelled','Deleted')
             or (a.entity in ('User','Role permission','Settings','Integration','Payroll','Billing settings','Tax rate','Tariff','Audit entry')
                 and a.action <> 'Signed in')
           then 'Sensitive' else 'Normal' end""";

  /** Super administrators see everything; branch administrators see entries for their own branches. */
  @GetMapping
  public List<Entry> list(@RequestParam(required = false) String entity, @RequestParam(required = false) String entityId,
                          @RequestParam(required = false) String risk, @RequestParam(defaultValue = "200") int limit) {
    return query(entity, entityId, risk, null, limit);
  }

  private List<Entry> query(String entity, String entityId, String risk, Long id, int limit) {
    var me = CurrentUser.get();
    return db.sql("""
        select * from (
          select a.id, a.at, a.user_name, a.role, a.branch_id, a.action, a.entity, a.entity_id, a.detail, a.ip,
                 %s as risk, f.by_name as flagged_by, f.note as flag_note
          from audit_log a left join audit_flag f on f.audit_id = a.id
          where (:id::bigint is null or a.id = :id) and (:entity::text is null or a.entity = :entity) and (:entityId::text is null or a.entity_id = :entityId)
            and (:all or a.branch_id = any(:branches))) x
        where (:risk::text is null or risk = :risk)
        order by id desc limit :limit""".formatted(RISK))
        .param("id", id).param("entity", entity).param("entityId", entityId).param("risk", risk).param("limit", Math.min(Math.max(limit, 1), 2000))
        .param("all", me.superAdmin()).param("branches", me.branches().toArray(String[]::new))
        .query(Entry.class).list();
  }

  /** Sign-ins, failed attempts and lock-outs, newest first. */
  @GetMapping("/logins")
  public List<Login> logins(@RequestParam(defaultValue = "200") int limit) {
    var me = CurrentUser.get();
    return db.sql("""
        select id, at, user_name, role, detail as email, ip,
               case action when 'Signed in' then 'Success' when 'Sign-in failed' then 'Failed' else 'Locked' end as result
        from audit_log where entity = 'User' and action in ('Signed in','Sign-in failed','Sign-in blocked (locked)')
          and (:all or branch_id = any(:branches))
        order by id desc limit :limit""")
        .param("limit", Math.min(Math.max(limit, 1), 1000)).param("all", me.superAdmin()).param("branches", me.branches().toArray(String[]::new))
        .query(Login.class).list();
  }

  /** Marks an entry for compliance review. The entry itself stays unchanged; the flag is recorded beside it and audited. */
  @PostMapping("/{id}/flag")
  @Transactional
  public Entry flag(@PathVariable long id, @Valid @RequestBody(required = false) FlagInput in) {
    var me = CurrentUser.get();
    var branch = db.sql("select branch_id from audit_log where id = ?").param(id).query((r, i) -> java.util.Optional.ofNullable(r.getString(1)))
        .optional().orElseThrow(() -> new ApiException(404, "Audit entry not found"));
    if (!me.superAdmin() && (branch.isEmpty() || !me.canSee(branch.get()))) throw new ApiException(404, "Audit entry not found");
    String note = in == null || in.note() == null ? "" : in.note().trim();
    int n = db.sql("insert into audit_flag (audit_id, flagged_by, by_name, note) values (?, ?, ?, ?) on conflict do nothing")
        .params(id, me.id(), me.name(), note).update();
    if (n > 0) audit.logForBranch(branch.orElse(null), "Flagged", "Audit entry", String.valueOf(id), note.isEmpty() ? "Flagged for review" : note);
    return query(null, null, null, id, 1).stream().findFirst().orElseThrow(() -> new ApiException(404, "Audit entry not found"));
  }

  /** The audit screen exports in the browser; this records that the export happened. */
  @PostMapping("/exported")
  public void exported(@Valid @RequestBody ExportInput in) {
    var me = CurrentUser.get();
    audit.logForBranch(me.homeBranch(), "Exported", in.what() == null || in.what().isBlank() ? "Audit log" : in.what(), null, in.rows() + " rows");
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
