package com.hospitos.notifications.whatsapp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.hospitos.admin.IntegrationSettings;
import java.io.IOException;
import java.net.ProxySelector;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Calls Meta's WhatsApp Cloud API (Graph API). Holds no state; settings come from the "wa" integration on every call. */
@Component
public class WhatsAppClient {
  public static final String ID = "wa";
  /** Meta error codes that mean "try again later" (rate limits and temporary outages). */
  private static final Set<Integer> RETRY_CODES = Set.of(1, 2, 4, 80007, 130429, 131016, 131048, 131056, 133004);

  private final HttpClient http;
  private final ObjectMapper json;
  private final String graphUrl;

  public WhatsAppClient(ObjectMapper json, @Value("${hospitos.whatsapp.graph-url:https://graph.facebook.com}") String graphUrl) {
    this.json = json;
    this.graphUrl = graphUrl.replaceAll("/+$", "");
    this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).proxy(ProxySelector.getDefault()).build();
  }

  /** The settings the client needs, read from the integration row. */
  public record Config(String phoneId, String token, String apiVersion, String template, String lang, List<String> vars) {
    public static Config of(IntegrationSettings.Row r) {
      String v = r.value("apiVersion");
      List<String> vars = Arrays.stream(r.value("templateVars").split("[,\\s]+")).map(String::trim).filter(s -> !s.isEmpty()).toList();
      return new Config(r.value("phone"), r.value("token"), v.isEmpty() ? "v21.0" : v, r.value("template"),
          r.value("templateLang").isEmpty() ? "en" : r.value("templateLang"), vars);
    }
  }

  /** {@code retry} is true when the failure is temporary and the message should stay queued. */
  public record Result(boolean ok, String messageId, String error, boolean retry) {}

  /**
   * Sends one message. With a template name it sends that approved template, filling its body variables in the order of
   * {@code vars} ("name" is the patient's name, "message" the text). Without one it sends plain text, which WhatsApp only
   * delivers within 24 hours of the patient's last message to the hospital.
   */
  public Result send(Config c, String to, String patientName, String message) {
    ObjectNode body = json.createObjectNode().put("messaging_product", "whatsapp").put("recipient_type", "individual").put("to", to);
    if (c.template().isEmpty()) {
      body.put("type", "text").putObject("text").put("preview_url", false).put("body", message);
    } else {
      ObjectNode t = body.put("type", "template").putObject("template").put("name", c.template());
      t.putObject("language").put("code", c.lang());
      if (!c.vars().isEmpty()) {
        var params = t.putArray("components").addObject().put("type", "body").putArray("parameters");
        for (String v : c.vars()) {
          String text = switch (v.toLowerCase()) {
            case "name" -> patientName == null || patientName.isBlank() ? "Patient" : patientName;
            case "message" -> message;
            default -> v;
          };
          params.addObject().put("type", "text").put("text", templateText(text));
        }
      }
    }
    try {
      var res = call(HttpRequest.newBuilder(uri(c, "/" + enc(c.phoneId()) + "/messages"))
          .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))), c);
      JsonNode r = parse(res.body());
      if (res.statusCode() / 100 == 2 && r.path("messages").path(0).hasNonNull("id"))
        return new Result(true, r.path("messages").path(0).get("id").asText(), null, false);
      return failure(res.statusCode(), r);
    } catch (IOException e) {
      return new Result(false, null, "Could not reach WhatsApp: " + e.getMessage(), true);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return new Result(false, null, "Interrupted", true);
    }
  }

  /** Looks up the sender number to prove the phone number ID and token work. Sends nothing. */
  public Result check(Config c) {
    try {
      var res = call(HttpRequest.newBuilder(uri(c, "/" + enc(c.phoneId()) + "?fields=display_phone_number,verified_name,quality_rating")).GET(), c);
      JsonNode r = parse(res.body());
      if (res.statusCode() / 100 == 2) {
        String number = r.path("display_phone_number").asText("");
        String name = r.path("verified_name").asText("");
        return new Result(true, (number + (name.isEmpty() ? "" : " (" + name + ")")).trim(), null, false);
      }
      return failure(res.statusCode(), r);
    } catch (IOException e) {
      return new Result(false, null, "Could not reach WhatsApp: " + e.getMessage(), true);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return new Result(false, null, "Interrupted", true);
    }
  }

  private HttpResponse<String> call(HttpRequest.Builder b, Config c) throws IOException, InterruptedException {
    return http.send(b.timeout(Duration.ofSeconds(20)).header("Authorization", "Bearer " + c.token()).build(),
        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  private URI uri(Config c, String path) { return URI.create(graphUrl + "/" + enc(c.apiVersion()) + path); }
  private static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8); }

  private JsonNode parse(String s) {
    try { return s == null || s.isBlank() ? json.createObjectNode() : json.readTree(s); } catch (IOException e) { return json.createObjectNode(); }
  }

  private static Result failure(int status, JsonNode r) {
    JsonNode e = r.path("error");
    int code = e.path("code").asInt(0);
    String detail = e.path("error_data").path("details").asText("");
    String msg = e.path("message").asText("HTTP " + status);
    String text = "WhatsApp error" + (code > 0 ? " " + code : "") + ": " + (detail.isEmpty() ? msg : detail);
    boolean retry = status == 429 || status >= 500 || RETRY_CODES.contains(code);
    return new Result(false, null, text.length() > 400 ? text.substring(0, 400) : text, retry);
  }

  /** Template variables may not hold new lines, tabs or more than four spaces in a row. */
  static String templateText(String s) {
    String t = s.replaceAll("\\s*[\\r\\n\\t]+\\s*", " · ").replaceAll(" {4,}", "   ").trim();
    return t.length() > 1000 ? t.substring(0, 1000) : t;
  }

  /**
   * WhatsApp wants the number with country code and no plus or spaces. Ten-digit numbers are taken as Indian.
   * Returns null when the number can't be used.
   */
  public static String normalise(String mobile) {
    if (mobile == null) return null;
    String d = mobile.replaceAll("\\D", "");
    if (d.startsWith("00")) d = d.substring(2);
    if (d.length() == 11 && d.startsWith("0")) d = d.substring(1);
    if (d.length() == 10) return d.matches("[6-9]\\d{9}") ? "91" + d : null;
    return d.length() >= 11 && d.length() <= 15 ? d : null;
  }
}
