package com.hospitos.notifications.whatsapp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hospitos.admin.IntegrationSettings;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;

/**
 * Meta calls this with delivery and read receipts. Set the callback URL in the Meta app to
 * {@code https://<server>/api/webhooks/whatsapp} with the same verify token as in Integrations, and subscribe to "messages".
 * Every POST must carry a valid X-Hub-Signature-256 made with the app secret.
 */
@RestController
@RequestMapping("/api/webhooks/whatsapp")
public class WhatsAppWebhook {
  private static final Logger log = LoggerFactory.getLogger(WhatsAppWebhook.class);
  private final IntegrationSettings settings;
  private final JdbcClient db;
  private final ObjectMapper json;
  public WhatsAppWebhook(IntegrationSettings settings, JdbcClient db, ObjectMapper json) { this.settings = settings; this.db = db; this.json = json; }

  /** Meta's one-time subscription check. */
  @GetMapping(produces = MediaType.TEXT_PLAIN_VALUE)
  public ResponseEntity<String> verify(@RequestParam(name = "hub.mode", required = false) String mode,
                                       @RequestParam(name = "hub.verify_token", required = false) String token,
                                       @RequestParam(name = "hub.challenge", required = false) String challenge) {
    String expected = settings.find(WhatsAppClient.ID, false).map(r -> r.value("verifyToken")).orElse("");
    if ("subscribe".equals(mode) && !expected.isEmpty() && token != null && challenge != null && same(expected, token))
      return ResponseEntity.ok(challenge);
    return ResponseEntity.status(403).body("Verification failed");
  }

  @PostMapping(consumes = MediaType.ALL_VALUE)
  public ResponseEntity<Void> receive(@RequestHeader(name = "X-Hub-Signature-256", required = false) String signature, @RequestBody byte[] body) {
    String secret = settings.find(WhatsAppClient.ID, false).map(r -> r.value("appSecret")).orElse("");
    if (secret.isEmpty() || signature == null || !signature.startsWith("sha256=") || !same(sign(secret, body), signature.substring(7).toLowerCase()))
      return ResponseEntity.status(403).build();
    try {
      JsonNode root = json.readTree(body);
      for (JsonNode entry : root.path("entry"))
        for (JsonNode change : entry.path("changes"))
          for (JsonNode s : change.path("value").path("statuses")) apply(s);
    } catch (java.io.IOException | RuntimeException e) {
      log.warn("Could not read a WhatsApp webhook: {}", e.getMessage());
    }
    return ResponseEntity.ok().build(); // Meta retries anything but 200, so a body we can't use is still acknowledged.
  }

  /** Statuses only move forward: Sent, then Delivered, then Read. Failed never overrides Delivered or Read. */
  private void apply(JsonNode s) {
    String id = s.path("id").asText("");
    String status = switch (s.path("status").asText("")) {
      case "sent" -> "Sent";
      case "delivered" -> "Delivered";
      case "read" -> "Read";
      case "failed" -> "Failed";
      default -> null;
    };
    if (id.isEmpty() || status == null) return;
    String error = null;
    if ("Failed".equals(status)) {
      JsonNode e = s.path("errors").path(0);
      String detail = e.path("error_data").path("details").asText(e.path("message").asText(e.path("title").asText("Not delivered")));
      String code = e.path("code").asText("");
      error = "WhatsApp error" + (code.isEmpty() ? "" : " " + code) + ": " + detail;
      if (error.length() > 400) error = error.substring(0, 400);
    }
    db.sql("""
        update notification_msg set status = :status, error = case when :status = 'Failed' then :error else null end, updated_at = now()
        where provider_ref = :id and channel = 'WhatsApp' and (
          case status when 'Queued' then 0 when 'Sent' then 1 when 'Delivered' then 2 when 'Read' then 3 else 4 end)
          < (case :status when 'Sent' then 1 when 'Delivered' then 2 when 'Read' then 3 else 2 end)""")
        .param("status", status).param("error", error).param("id", id).update();
  }

  static String sign(String secret, byte[] body) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      return HexFormat.of().formatHex(mac.doFinal(body));
    } catch (Exception e) { throw new IllegalStateException(e); }
  }

  private static boolean same(String a, String b) {
    return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
  }
}
