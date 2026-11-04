package com.hospitos.audit;

import com.hospitos.common.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
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

  public void log(String action, String entity, String entityId, String detail) {
    var u = CurrentUser.get();
    write(u.id(), u.name(), u.role(), action, entity, entityId, detail);
  }

  public void write(UUID userId, String userName, String role, String action, String entity, String entityId, String detail) {
    db.sql("""
        insert into audit_log (user_id, user_name, role, action, entity, entity_id, detail, ip, prev_hash, hash)
        values (?, ?, ?, ?, ?, ?, ?, ?, '', '')""")
        .params(userId, userName, role, action, entity, entityId, detail == null ? "" : detail, ip())
        .update();
  }

  private static String ip() {
    if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes a) {
      HttpServletRequest r = a.getRequest();
      String fwd = r.getHeader("X-Forwarded-For");
      return fwd != null ? fwd.split(",")[0].trim() : r.getRemoteAddr();
    }
    return null;
  }
}
