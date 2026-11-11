package com.hospitos.notifications.whatsapp;

import com.hospitos.admin.IntegrationSettings;
import com.hospitos.admin.LiveConnector;
import java.util.ArrayList;
import org.springframework.stereotype.Component;

/** The admin "Test connection" for WhatsApp: looks up the sender number with the saved token. Messages no one. */
@Component
public class WhatsAppConnector implements LiveConnector {
  private final WhatsAppClient client;
  public WhatsAppConnector(WhatsAppClient client) { this.client = client; }

  @Override public String id() { return WhatsAppClient.ID; }

  @Override
  public Outcome test(IntegrationSettings.Row r) {
    var cfg = WhatsAppClient.Config.of(r);
    var log = new ArrayList<String>();
    log.add("> Looking up phone number ID " + cfg.phoneId() + " on the WhatsApp Cloud API (" + cfg.apiVersion() + ")…");
    var res = client.check(cfg);
    if (!res.ok()) {
      log.add("> " + res.error());
      return new Outcome(false, log, res.error());
    }
    log.add("> Sender number: " + res.messageId());
    log.add(cfg.template().isEmpty()
        ? "> No template set: messages go as plain text, which WhatsApp only delivers within 24 hours of the patient's last message."
        : "> Messages use the template \"" + cfg.template() + "\" (" + cfg.lang() + ") with variables " + String.join(", ", cfg.vars()) + ".");
    if (r.value("appSecret").isEmpty() || r.value("verifyToken").isEmpty())
      log.add("> Delivery receipts are off until the app secret and webhook verify token are filled in.");
    return new Outcome(true, log, "Connected as " + res.messageId());
  }
}
