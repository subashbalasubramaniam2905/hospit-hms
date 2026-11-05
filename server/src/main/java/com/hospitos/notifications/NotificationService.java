package com.hospitos.notifications;

import com.hospitos.common.CurrentUser;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Staff inbox notes and the outgoing patient message log. Other modules call {@link #inApp} to alert staff.
 * No SMS, email or WhatsApp provider is connected yet, so patient messages are recorded as Queued and nothing is sent.
 */
@Service
public class NotificationService {
  private final JdbcClient db;
  public NotificationService(JdbcClient db) { this.db = db; }

  /** Tone is one of g (green), a (amber), r (red), b (blue), v (violet). */
  public record Note(String title, String body, String link, String icon, String tone) {}

  /** A note for everyone with {@code role} (null for every role) in {@code branchId} (null for every branch). Joins the caller's transaction. */
  public long inApp(String role, String branchId, Note n) { return insert(null, role, branchId, n); }

  /** A note for one account. */
  public long inAppTo(UUID userId, Note n) { return insert(userId, null, null, n); }

  private long insert(UUID userId, String role, String branchId, Note n) {
    return db.sql("insert into inbox_note (user_id, role, branch_id, title, body, link, icon, tone) values (?, ?, ?, ?, ?, ?, ?, ?) returning id")
        .params(userId, role, branchId, n.title(), n.body() == null ? "" : n.body(), n.link(), n.icon() == null ? "bell" : n.icon(),
            n.tone() == null ? "b" : n.tone()).query(Long.class).single();
  }

  /** Records a patient message as Queued. Returns its id. */
  public long queue(String branchId, String channel, String type, String patientId, String to, String message) {
    String by = CurrentUser.get().name();
    return db.sql("""
        insert into notification_msg (branch_id, channel, type, patient_id, to_text, message, status, error, sent_by)
        values (?, ?, ?, ?, ?, ?, 'Queued', 'No ' || ? || ' provider is connected yet', ?) returning id""")
        .params(branchId, channel, type, patientId, to, message, channel, by).query(Long.class).single();
  }
}
