package com.hospitos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.hospitos.notifications.whatsapp.WhatsAppClient;
import com.hospitos.notifications.whatsapp.WhatsAppDispatcher;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** WhatsApp Cloud API sending, the admin connection test and delivery receipts, against a fake Graph API. */
class WhatsAppTest extends ApiTestBase {
  static final HttpServer graph;
  static final List<String> requests = new CopyOnWriteArrayList<>();
  /** What the fake API answers to the next sends: "ok", "busy" (temporary) or "bad" (permanent). */
  static final List<String> script = new CopyOnWriteArrayList<>();
  static final AtomicInteger seq = new AtomicInteger();

  static {
    try {
      graph = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      graph.createContext("/", ex -> {
        String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        requests.add(ex.getRequestMethod() + " " + ex.getRequestURI() + " " + ex.getRequestHeaders().getFirst("Authorization") + " " + body);
        boolean goodToken = "Bearer good-token".equals(ex.getRequestHeaders().getFirst("Authorization"));
        int code; String out;
        if (!goodToken) { code = 401; out = "{\"error\":{\"message\":\"Invalid OAuth access token.\",\"code\":190}}"; }
        else if ("GET".equals(ex.getRequestMethod())) { code = 200; out = "{\"display_phone_number\":\"+1 555 010 0000\",\"verified_name\":\"Test Number\",\"id\":\"123\"}"; }
        else {
          String next = script.isEmpty() ? "ok" : script.remove(0);
          switch (next) {
            case "busy" -> { code = 429; out = "{\"error\":{\"message\":\"Rate limit hit\",\"code\":130429}}"; }
            case "bad" -> { code = 400; out = "{\"error\":{\"message\":\"(#131026) Message undeliverable\",\"code\":131026,\"error_data\":{\"details\":\"Recipient is not a WhatsApp user\"}}}"; }
            default -> { code = 200; out = "{\"messaging_product\":\"whatsapp\",\"messages\":[{\"id\":\"wamid.TEST" + seq.incrementAndGet() + "\"}]}"; }
          }
        }
        byte[] b = out.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("Content-Type", "application/json");
        ex.sendResponseHeaders(code, b.length);
        ex.getResponseBody().write(b);
        ex.close();
      });
      graph.start();
    } catch (java.io.IOException e) { throw new IllegalStateException(e); }
  }

  @DynamicPropertySource
  static void graphUrl(DynamicPropertyRegistry r) { r.add("hospitos.whatsapp.graph-url", () -> "http://127.0.0.1:" + graph.getAddress().getPort()); }

  @AfterAll
  static void stop() { graph.stop(0); }

  @Autowired WhatsAppDispatcher dispatcher;

  private JsonNode wa() throws Exception {
    for (var n : get("/api/admin/integrations", root)) if (n.get("id").asText().equals("wa")) return n;
    throw new AssertionError("no wa integration");
  }

  private JsonNode configure(String values) throws Exception {
    return body(send(put("/api/admin/integrations/wa"), root, "{\"enabled\":true,\"version\":" + wa().get("version").asInt() + ",\"values\":" + values + "}")
        .andExpect(status().isOk()));
  }

  private String patient(String name, String mobile) throws Exception {
    return body(send(post("/api/patients"), root, "{\"name\":\"" + name + "\",\"dob\":\"1980-02-02\",\"gender\":\"Male\",\"mobile\":\"" + mobile
        + "\",\"consent\":\"Given\",\"branchId\":\"BR1\"}").andExpect(status().isCreated())).get("id").asText();
  }

  private JsonNode message(String pid, String text) throws Exception {
    return body(send(post("/api/notifications/messages"), root, "{\"channel\":\"WhatsApp\",\"type\":\"Lab report ready\",\"patientIds\":[\"" + pid
        + "\"],\"message\":\"" + text + "\",\"branchId\":\"BR1\"}").andExpect(status().isCreated()));
  }

  private JsonNode row(long id) throws Exception {
    for (var n : get("/api/notifications/messages", root)) if (n.get("id").asLong() == id) return n;
    throw new AssertionError("no message " + id);
  }

  private void receipt(String secret, String payload, int expect) throws Exception {
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    String sig = "sha256=" + HexFormat.of().formatHex(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
    mvc.perform(post("/api/webhooks/whatsapp").header("X-Hub-Signature-256", sig).contentType(MediaType.APPLICATION_JSON).content(payload))
        .andExpect(status().is(expect));
  }

  private static String receiptJson(String wamid, String s) {
    return "{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"1\",\"changes\":[{\"field\":\"messages\",\"value\":{\"statuses\":[{\"id\":\""
        + wamid + "\",\"status\":\"" + s + "\",\"recipient_id\":\"919000088888\"}]}}]}]}";
  }

  @Test
  void normalisesIndianNumbers() {
    assertThat(WhatsAppClient.normalise("+91 90000 88888")).isEqualTo("919000088888");
    assertThat(WhatsAppClient.normalise("09000088888")).isEqualTo("919000088888");
    assertThat(WhatsAppClient.normalise("9000088888")).isEqualTo("919000088888");
    assertThat(WhatsAppClient.normalise("1234")).isNull();
    assertThat(WhatsAppClient.normalise("0422 123456")).isNull();
  }

  @Test
  void sendsQueuedMessagesAndTracksReceipts() throws Exception {
    String pid = patient("Wa Patient", "+91 90000 88888");

    // Before set-up nothing is sent, and turning WhatsApp on later doesn't send old messages.
    long early = message(pid, "Before setup").get("messages").get(0).get("id").asLong();
    assertThat(wa().get("status").asText()).isEqualTo("Disabled");
    assertThat(wa().get("live").asBoolean()).isTrue();

    // A wrong token fails the connection test; the right one connects. The test sends no message.
    configure("{\"phone\":\"123\",\"token\":\"bad-token\"}");
    var t = body(send(post("/api/admin/integrations/wa/test"), root, "").andExpect(status().isOk()));
    assertThat(t.get("ok").asBoolean()).isFalse();
    assertThat(t.get("integration").get("status").asText()).isEqualTo("Error");
    assertThat(t.get("integration").get("lastResult").asText()).contains("190");
    configure("{\"token\":\"good-token\",\"template\":\"hospital_update\",\"appSecret\":\"app-secret\",\"verifyToken\":\"verify-me\"}");
    assertThat(wa().get("status").asText()).isEqualTo("Configured");
    t = body(send(post("/api/admin/integrations/wa/test"), root, "").andExpect(status().isOk()));
    assertThat(t.get("ok").asBoolean()).isTrue();
    assertThat(t.get("integration").get("status").asText()).isEqualTo("Connected");
    assertThat(t.get("integration").get("lastResult").asText()).contains("+1 555 010 0000");
    assertThat(requests).noneMatch(r -> r.startsWith("POST"));
    // The token is never returned.
    assertThat(wa().toString()).doesNotContain("good-token");

    // Now a message is sent as the approved template, with the patient's name and the text as variables.
    var r = message(pid, "Your CBC report is ready.");
    assertThat(r.get("sending").asBoolean()).isTrue();
    long id = r.get("messages").get(0).get("id").asLong();
    assertThat(dispatcher.runOnce()).isEqualTo(1);
    String sent = requests.get(requests.size() - 1);
    assertThat(sent).startsWith("POST /v21.0/123/messages Bearer good-token");
    assertThat(sent).contains("\"to\":\"919000088888\"", "\"name\":\"hospital_update\"", "\"code\":\"en\"",
        "{\"type\":\"text\",\"text\":\"Wa Patient\"}", "{\"type\":\"text\",\"text\":\"Your CBC report is ready.\"}");
    var m = row(id);
    assertThat(m.get("status").asText()).isEqualTo("Sent");
    assertThat(row(early).get("status").asText()).isEqualTo("Queued");
    assertThat(dispatcher.runOnce()).isZero();

    // Receipts need a valid signature and only move the status forward.
    String wamid = "wamid.TEST" + seq.get();
    receipt("wrong-secret", receiptJson(wamid, "read"), 403);
    assertThat(row(id).get("status").asText()).isEqualTo("Sent");
    receipt("app-secret", receiptJson(wamid, "read"), 200);
    receipt("app-secret", receiptJson(wamid, "delivered"), 200);
    assertThat(row(id).get("status").asText()).isEqualTo("Read");

    // Webhook subscription check.
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/webhooks/whatsapp").param("hub.mode", "subscribe").param("hub.verify_token", "verify-me").param("hub.challenge", "42"))
        .andExpect(status().isOk()).andExpect(content().string("42"));
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/webhooks/whatsapp").param("hub.mode", "subscribe").param("hub.verify_token", "nope").param("hub.challenge", "42"))
        .andExpect(status().isForbidden());

    // A temporary error keeps the message queued for a retry; a permanent one fails it with WhatsApp's reason.
    script.add("busy");
    long busy = message(pid, "Retry me").get("messages").get(0).get("id").asLong();
    dispatcher.runOnce();
    assertThat(row(busy).get("status").asText()).isEqualTo("Queued");
    assertThat(row(busy).get("error").asText()).contains("Will retry", "130429");
    db.sql("update notification_msg set updated_at = now() - interval '2 minutes' where id = ?").param(busy).update();
    dispatcher.runOnce();
    assertThat(row(busy).get("status").asText()).isEqualTo("Sent");

    script.add("bad");
    long bad = message(pid, "Undeliverable").get("messages").get(0).get("id").asLong();
    dispatcher.runOnce();
    assertThat(row(bad).get("status").asText()).isEqualTo("Failed");
    assertThat(row(bad).get("error").asText()).contains("Recipient is not a WhatsApp user");

    // A failed receipt after delivery doesn't undo it; a failed receipt on a sent message records why.
    String wBusy = "wamid.TEST" + (seq.get());
    receipt("app-secret", "{\"entry\":[{\"changes\":[{\"value\":{\"statuses\":[{\"id\":\"" + wBusy
        + "\",\"status\":\"failed\",\"errors\":[{\"code\":131047,\"title\":\"Re-engagement message\"}]}]}}]}]}", 200);
    assertThat(row(busy).get("status").asText()).isEqualTo("Failed");
    assertThat(row(busy).get("error").asText()).contains("131047", "Re-engagement message");
    receipt("app-secret", "{\"entry\":[{\"changes\":[{\"value\":{\"statuses\":[{\"id\":\"" + wamid + "\",\"status\":\"failed\"}]}}]}]}", 200);
    assertThat(row(id).get("status").asText()).isEqualTo("Read");

    // A number WhatsApp can't use fails without calling the API.
    String landline = patient("Wa Landline", "0422 123456");
    long ll = message(landline, "Hello").get("messages").get(0).get("id").asLong();
    int before = requests.size();
    dispatcher.runOnce();
    assertThat(row(ll).get("status").asText()).isEqualTo("Failed");
    assertThat(requests).hasSize(before);

    // Without a template the text goes as a plain message.
    configure("{\"template\":\"\"}");
    assertThat(wa().get("status").asText()).isEqualTo("Configured");
    message(pid, "Plain text");
    dispatcher.runOnce();
    assertThat(requests.get(requests.size() - 1)).contains("\"type\":\"text\"", "\"body\":\"Plain text\"");

    // Turned off, messages wait again.
    send(put("/api/admin/integrations/wa"), root, "{\"enabled\":false,\"version\":" + wa().get("version").asInt() + ",\"values\":{}}").andExpect(status().isOk());
    var off = message(pid, "While off");
    assertThat(off.get("sending").asBoolean()).isFalse();
    assertThat(off.get("messages").get(0).get("error").asText()).contains("WhatsApp is not set up");
  }
}
