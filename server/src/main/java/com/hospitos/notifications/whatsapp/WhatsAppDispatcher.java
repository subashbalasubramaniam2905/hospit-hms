package com.hospitos.notifications.whatsapp;

import com.hospitos.admin.IntegrationSettings;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Sends queued WhatsApp messages in the background. Only messages queued while WhatsApp was set up are sent, so turning
 * WhatsApp on later never sends old messages. A temporary failure is retried after a minute, up to three tries.
 */
@Component
public class WhatsAppDispatcher {
  private static final Logger log = LoggerFactory.getLogger(WhatsAppDispatcher.class);
  static final int MAX_ATTEMPTS = 3;
  private final JdbcClient db;
  private final IntegrationSettings settings;
  private final WhatsAppClient client;

  public WhatsAppDispatcher(JdbcClient db, IntegrationSettings settings, WhatsAppClient client) {
    this.db = db; this.settings = settings; this.client = client;
  }

  private record Job(long id, String toAddress, String message, String patientName, int attempts) {}

  @Scheduled(initialDelayString = "${hospitos.whatsapp.poll-ms:5000}", fixedDelayString = "${hospitos.whatsapp.poll-ms:5000}")
  public void poll() {
    try { runOnce(); } catch (RuntimeException e) { log.warn("WhatsApp dispatch failed: {}", e.getMessage()); }
  }

  /** Sends up to 20 due messages. Returns how many were tried. */
  public synchronized int runOnce() {
    var wa = settings.find(WhatsAppClient.ID, false).filter(IntegrationSettings.Row::usable);
    if (wa.isEmpty()) return 0;
    var cfg = WhatsAppClient.Config.of(wa.get());
    // Claim the batch first so a second server instance never sends the same message twice.
    var jobs = db.sql("""
        update notification_msg m set attempts = m.attempts + 1, updated_at = now()
        where m.id in (select id from notification_msg where channel = 'WhatsApp' and status = 'Queued' and deliver and attempts < :max
                         and (updated_at is null or updated_at < now() - interval '1 minute')
                       order by id limit 20 for update skip locked)
        returning m.id, m.to_address, m.message, (select p.name from patient p where p.id = m.patient_id), m.attempts""")
        .param("max", MAX_ATTEMPTS)
        .query((r, i) -> new Job(r.getLong(1), r.getString(2), r.getString(3), r.getString(4), r.getInt(5))).list();
    for (var j : jobs) {
      String to = WhatsAppClient.normalise(j.toAddress());
      if (to == null) { finish(j.id(), "Failed", null, "Mobile number " + j.toAddress() + " can't be used on WhatsApp"); continue; }
      var res = client.send(cfg, to, j.patientName(), j.message());
      if (res.ok()) finish(j.id(), "Sent", res.messageId(), null);
      else if (res.retry() && j.attempts() < MAX_ATTEMPTS) note(j.id(), "Will retry: " + res.error());
      else finish(j.id(), "Failed", null, res.error());
    }
    return jobs.size();
  }

  private void finish(long id, String status, String ref, String error) {
    db.sql("update notification_msg set status = ?, provider_ref = coalesce(?, provider_ref), error = ?, updated_at = now() where id = ?")
        .params(status, ref, error, id).update();
  }

  private void note(long id, String error) {
    db.sql("update notification_msg set error = ? where id = ?").params(error, id).update();
  }
}
