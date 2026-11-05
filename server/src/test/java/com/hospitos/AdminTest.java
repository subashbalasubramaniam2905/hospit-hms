package com.hospitos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(CleanDatabase.class)
class AdminTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired JdbcClient db;
  String root;

  String login(String email, String pw) throws Exception {
    var r = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"" + email + "\",\"password\":\"" + pw + "\"}")).andExpect(status().isOk()).andReturn();
    return "Bearer " + json.readTree(r.getResponse().getContentAsString()).get("token").asText();
  }

  /** Creates an account and signs it in past the first-login password change. */
  String user(String email, String role, String branches) throws Exception {
    if (db.sql("select count(*) from app_user where email = ?").param(email).query(Integer.class).single() == 0) {
      send(post("/api/users"), root, "{\"email\":\"" + email + "\",\"name\":\"" + role + " " + email.charAt(0) + "\",\"role\":\"" + role
          + "\",\"branches\":" + branches + ",\"temporaryPassword\":\"TempPass1234\"}").andExpect(status().isCreated());
      String t = login(email, "TempPass1234");
      send(post("/api/auth/password"), t, "{\"currentPassword\":\"TempPass1234\",\"newPassword\":\"RealPass5678\"}").andExpect(status().isOk());
    }
    return login(email, "RealPass5678");
  }

  ResultActions send(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder b, String token, String body) throws Exception {
    return mvc.perform(b.header("Authorization", token).contentType(MediaType.APPLICATION_JSON).content(body));
  }
  JsonNode get(String url, String token) throws Exception {
    return json.readTree(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(url).header("Authorization", token))
        .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
  }
  JsonNode body(ResultActions r) throws Exception { return json.readTree(r.andReturn().getResponse().getContentAsString()); }

  @BeforeEach
  void signIn() throws Exception { root = login("admin@test.local", "AdminPass123"); }

  @Test
  void hospitalSettingsAreValidatedAndVersioned() throws Exception {
    var cfg = (ObjectNode) get("/api/admin/config", root);
    assertThat(cfg.get("workingHours")).hasSize(7);
    cfg.put("registration", "TN/HOSP/2026/001");
    ((ObjectNode) cfg.get("apptRules")).put("slotMin", 20);
    var saved = body(send(put("/api/admin/config"), root, cfg.toString()).andExpect(status().isOk()));
    assertThat(saved.get("registration").asText()).isEqualTo("TN/HOSP/2026/001");
    assertThat(saved.get("apptRules").get("slotMin").asInt()).isEqualTo(20);
    // The old version is now stale.
    send(put("/api/admin/config"), root, cfg.toString()).andExpect(status().isConflict());
    // Closing before opening is refused.
    var bad = (ObjectNode) saved.deepCopy();
    ((ObjectNode) bad.get("workingHours").get(0)).put("close", "07:00");
    send(put("/api/admin/config"), root, bad.toString()).andExpect(status().isBadRequest());
    // Everyone can read the rules; only administrators can change them.
    String nurse = user("nurse.cfg@test.local", "nurse", "[\"BR1\"]");
    get("/api/admin/config", nurse);
    send(put("/api/admin/config"), nurse, saved.toString()).andExpect(status().isForbidden());
  }

  @Test
  void roleAccessOverridesAreSharedAndGuarded() throws Exception {
    send(put("/api/admin/role-access"), root, "{\"role\":\"billing\",\"path\":\"/ipd\",\"level\":\"View\"}").andExpect(status().isOk());
    send(put("/api/admin/role-access"), root, "{\"role\":\"billing\",\"path\":\"/ipd\",\"level\":\"None\"}").andExpect(status().isOk());
    send(put("/api/admin/role-access"), root, "{\"role\":\"super-admin\",\"path\":\"/ipd\",\"level\":\"None\"}").andExpect(status().isBadRequest());
    send(put("/api/admin/role-access"), root, "{\"role\":\"billing\",\"path\":\"/ipd\",\"level\":\"Maybe\"}").andExpect(status().isBadRequest());
    String admin = user("admin.ra@test.local", "admin", "[\"BR1\"]");
    send(put("/api/admin/role-access"), admin, "{\"role\":\"admin\",\"path\":\"/ipd\",\"level\":\"None\"}").andExpect(status().isForbidden());
    String nurse = user("nurse.ra@test.local", "nurse", "[\"BR1\"]");
    var list = get("/api/admin/role-access", nurse);
    assertThat(list.findValuesAsText("level")).contains("None");
    send(put("/api/admin/role-access"), nurse, "{\"role\":\"billing\",\"path\":\"/ipd\",\"level\":\"Full\"}").andExpect(status().isForbidden());
  }

  @Test
  void departmentsCanBeAddedRenamedAndClosedWithinOwnBranches() throws Exception {
    var d = body(send(post("/api/admin/departments"), root, "{\"branchId\":\"BR1\",\"name\":\"Dermatology\",\"floor\":\"Floor 2\"}").andExpect(status().isCreated()));
    String id = d.get("id").asText();
    assertThat(id).isEqualTo("DERM");
    var d2 = body(send(post("/api/admin/departments"), root, "{\"branchId\":\"BR1\",\"name\":\"Dermatology\"}").andExpect(status().isCreated()));
    assertThat(d2.get("id").asText()).isEqualTo("DERM2");
    send(put("/api/admin/departments/" + id), root, "{\"branchId\":\"BR1\",\"name\":\"Skin and hair\",\"active\":false}").andExpect(status().isOk());
    assertThat(get("/api/departments", root).findValuesAsText("id")).doesNotContain(id);
    String admin2 = user("admin.d@test.local", "admin", "[\"BR2\"]");
    send(post("/api/admin/departments"), admin2, "{\"branchId\":\"BR1\",\"name\":\"Nope\"}").andExpect(status().isForbidden());
    send(put("/api/admin/departments/" + id), admin2, "{\"branchId\":\"BR1\",\"name\":\"Nope\"}").andExpect(status().isNotFound());
  }

  @Test
  void workflowsAreValidatedAndTestRunsSendNothing() throws Exception {
    send(post("/api/admin/workflows"), root, "{\"name\":\"Bad\",\"enabled\":false,\"steps\":[{\"kind\":\"action\",\"label\":\"Send SMS\"}]}").andExpect(status().isBadRequest());
    send(post("/api/admin/workflows"), root, "{\"name\":\"No action\",\"enabled\":true,\"steps\":[{\"kind\":\"trigger\",\"label\":\"Patient checks in\"}]}").andExpect(status().isBadRequest());
    var w = body(send(post("/api/admin/workflows"), root, """
        {"name":"Discharge follow-up","enabled":true,"steps":[{"kind":"trigger","label":"Patient is discharged","detail":"IPD"},
         {"kind":"condition","label":"If patient is over 60"},{"kind":"action","label":"Create follow-up task","detail":"Due in 7 days"}]}""")
        .andExpect(status().isCreated()));
    String id = w.get("id").asText();
    var run = body(send(post("/api/admin/workflows/" + id + "/test"), root, "").andExpect(status().isOk()));
    assertThat(run.get("log")).hasSize(3);
    assertThat(run.get("log").get(2).asText()).contains("not sent");
    assertThat(run.get("workflow").get("runs").asInt()).isEqualTo(1);
    var upd = (ObjectNode) run.get("workflow").deepCopy();
    upd.put("enabled", false);
    send(put("/api/admin/workflows/" + id), root, upd.toString()).andExpect(status().isOk());
    send(put("/api/admin/workflows/" + id), root, upd.toString()).andExpect(status().isConflict());
    mvc.perform(delete("/api/admin/workflows/" + id).header("Authorization", root)).andExpect(status().isNoContent());
    String nurse = user("nurse.wf@test.local", "nurse", "[\"BR1\"]");
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/admin/workflows").header("Authorization", nurse))
        .andExpect(status().isForbidden());
  }

  @Test
  void integrationSecretsAreEncryptedAndNeverReturned() throws Exception {
    var sms = find(get("/api/admin/integrations", root), "sms");
    assertThat(sms.get("status").asText()).isEqualTo("Disabled");
    var r = body(send(put("/api/admin/integrations/sms"), root,
        "{\"enabled\":true,\"version\":" + sms.get("version").asInt() + ",\"values\":{\"sender\":\"HOSPOS\",\"dlt\":\"1100220033\",\"key\":\"live-key-123\"}}")
        .andExpect(status().isOk()));
    assertThat(r.get("status").asText()).isEqualTo("Configured");
    assertThat(r.toString()).doesNotContain("live-key-123");
    var key = r.get("fields").get(2);
    assertThat(key.get("set").asBoolean()).isTrue();
    assertThat(key.has("value")).isFalse();
    String stored = db.sql("select secrets from integration where id = 'sms'").query(String.class).single();
    assertThat(stored).doesNotContain("live-key-123");
    // An empty secret keeps the stored one; a stale version is refused.
    var r2 = body(send(put("/api/admin/integrations/sms"), root, "{\"enabled\":true,\"version\":" + r.get("version").asInt() + ",\"values\":{\"key\":\"\"}}").andExpect(status().isOk()));
    assertThat(r2.get("fields").get(2).get("set").asBoolean()).isTrue();
    send(put("/api/admin/integrations/sms"), root, "{\"enabled\":true,\"version\":" + r.get("version").asInt() + ",\"values\":{}}").andExpect(status().isConflict());
    var t = body(send(post("/api/admin/integrations/sms/test"), root, "").andExpect(status().isOk()));
    assertThat(t.get("ok").asBoolean()).isTrue();
    assertThat(t.get("log").toString()).contains("no request was sent");
    var hl7 = body(send(post("/api/admin/integrations/hl7/test"), root, "").andExpect(status().isOk()));
    assertThat(hl7.get("ok").asBoolean()).isFalse();
    assertThat(hl7.get("log").toString()).contains("MLLP host");
    // Branch administrators cannot see or change credentials.
    String admin = user("admin.ig@test.local", "admin", "[\"BR1\"]");
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/admin/integrations").header("Authorization", admin))
        .andExpect(status().isForbidden());
  }

  @Test
  void auditEntriesCanBeFlaggedAndSignInsAreListed() throws Exception {
    mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"admin@test.local\",\"password\":\"wrong-one-1\"}"))
        .andExpect(status().isUnauthorized());
    var logins = get("/api/audit/logins", root);
    assertThat(logins.findValuesAsText("result")).contains("Success", "Failed");
    var entries = get("/api/audit?limit=50", root);
    long id = entries.get(0).get("id").asLong();
    var f = body(send(post("/api/audit/" + id + "/flag"), root, "{\"note\":\"Check this\"}").andExpect(status().isOk()));
    assertThat(f.get("risk").asText()).isEqualTo("Flagged");
    assertThat(f.get("flagNote").asText()).isEqualTo("Check this");
    assertThat(get("/api/audit?risk=Flagged", root).findValuesAsText("id")).contains(String.valueOf(id));
    send(post("/api/audit/exported"), root, "{\"what\":\"Audit log\",\"rows\":12}").andExpect(status().isOk());
    assertThat(get("/api/audit?limit=1", root).get(0).get("action").asText()).isEqualTo("Exported");
    assertThat(get("/api/audit/verify", root).get("intact").asBoolean()).isTrue();
  }

  private static JsonNode find(JsonNode list, String id) {
    for (var n : list) if (n.get("id").asText().equals(id)) return n;
    throw new AssertionError("missing " + id);
  }
}
