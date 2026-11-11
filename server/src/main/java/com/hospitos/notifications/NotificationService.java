package com.hospitos.notifications;

import com.hospitos.admin.IntegrationSettings;
import com.hospitos.common.CurrentUser;
import com.hospitos.notifications.whatsapp.WhatsAppClient;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Staff inbox notes and the outgoing patient message log. Other modules call {@link #inApp} to alert staff.
 * WhatsApp messages are sent by {@link com.hospitos.notifications.whatsapp.WhatsAppDispatcher} once the WhatsApp integration is
 * set up. No SMS or email provider is connected yet, so those stay Queued and nothing is sent.
 */
@Service
public class NotificationService {
  private final JdbcClient db;
  private final IntegrationSettings settings;
  public NotificationService(JdbcClient db, IntegrationSettings settings) { this.db = db; this.settings = settings; }

  /** True when messages on this channel will really be sent. */
  public boolean canSend(String channel) {
    return "WhatsApp".equals(channel) && settings.find(WhatsAppClient.ID, false).map(IntegrationSettings.Row::usable).orElse(false);
  }

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

  /**
   * Records a patient message as Queued. If its channel is set up the dispatcher sends it shortly; otherwise it stays Queued with
   * a note saying why. {@code address} is the raw mobile or email; {@code to} is how it is shown. Returns its id.
   */
  public long queue(String branchId, String channel, String type, String patientId, String to, String address, String message) {
    String by = CurrentUser.get().name();
    boolean live = canSend(channel);
    String note = live ? null : "WhatsApp".equals(channel) ? "WhatsApp is not set up yet (Admin, Integrations)" : "No " + channel + " provider is connected yet";
    return db.sql("""
        insert into notification_msg (branch_id, channel, type, patient_id, to_text, to_address, message, status, error, sent_by, deliver)
        values (?, ?, ?, ?, ?, ?, ?, 'Queued', ?, ?, ?) returning id""")
        .params(branchId, channel, type, patientId, to, address, message, note, by, live).query(Long.class).single();
  }
}
