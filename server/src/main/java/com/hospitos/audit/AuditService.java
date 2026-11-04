package com.hospitos.audit;

import com.hospitos.common.CurrentUser;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/** Writes to the append-only, hash-chained audit trail. */
@Service
public class AuditService {
  private final JdbcClient db;
  public AuditService(JdbcClient db) { this.db = db; }

  /** Logs an action by the signed-in user that is not tied to one branch (visible to super administrators). */
  public void log(String action, String entity, String entityId, String detail) {
    logForBranch(null, action, entity, entityId, detail);
  }

  /** Logs an action on a record that belongs to a branch, so that branch's administrators can review it. */
  public void logForBranch(String branchId, String action, String entity, String entityId, String detail) {
    var u = CurrentUser.get();
    write(u.id(), u.name(), u.role(), branchId, action, entity, entityId, detail);
  }

  public void write(UUID userId, String userName, String role, String branchId, String action, String entity, String entityId, String detail) {
    db.sql("""
        insert into audit_log (user_id, user_name, role, branch_id, action, entity, entity_id, detail, ip, prev_hash, hash)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '')""")
        .params(userId, userName, role, branchId, action, entity, entityId, detail == null ? "" : detail, ip())
        .update();
  }

  /** The client address as resolved by the servlet container. X-Forwarded-For is honoured only from trusted proxies. */
  private static String ip() {
    return RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes a ? a.getRequest().getRemoteAddr() : null;
  }
}
