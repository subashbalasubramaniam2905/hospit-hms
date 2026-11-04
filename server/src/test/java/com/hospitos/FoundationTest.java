package com.hospitos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(CleanDatabase.class)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class FoundationTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired JdbcClient db;

  private String login(String email, String pw) throws Exception {
    var res = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"" + email + "\",\"password\":\"" + pw + "\"}")).andExpect(status().isOk()).andReturn();
    return "Bearer " + json.readTree(res.getResponse().getContentAsString()).get("token").asText();
  }

  private JsonNode body(org.springframework.test.web.servlet.MvcResult r) throws Exception {
    return json.readTree(r.getResponse().getContentAsString());
  }

  private String createUser(String admin, String email, String role, String branches) throws Exception {
    var r = mvc.perform(post("/api/users").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"" + email + "\",\"name\":\"" + role + " user\",\"role\":\"" + role + "\",\"branches\":" + branches
            + ",\"temporaryPassword\":\"TempPass1234\"}")).andExpect(status().isCreated()).andReturn();
    return body(r).get("id").asText();
  }

  private static final String PATIENT = """
      {"name":"Kavya Raman","dob":"1990-05-14","gender":"Female","mobile":"+91 90000 11111","consent":"Given",
       "allergies":["Penicillin"],"address":{"line":"12 Main Rd","city":"Udumalpet","state":"Tamil Nadu","pin":"642126"}}""";

  @Test @Order(1)
  void protectedEndpointsNeedAToken() throws Exception {
    mvc.perform(get("/api/patients")).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/patients").header("Authorization", "Bearer not-a-token")).andExpect(status().isUnauthorized());
    mvc.perform(get("/actuator/health")).andExpect(status().isOk());
  }

  @Test @Order(2)
  void wrongPasswordIsRejectedAndLocksAfterFiveAttempts() throws Exception {
    String admin = login("admin@test.local", "AdminPass123");
    createUser(admin, "lock@test.local", "nurse", "[\"BR1\"]");
    for (int i = 0; i < 5; i++)
      mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
          .content("{\"email\":\"lock@test.local\",\"password\":\"wrong-pass\"}")).andExpect(status().isUnauthorized());
    mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"lock@test.local\",\"password\":\"TempPass1234\"}")).andExpect(status().isLocked());
    mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"nobody@test.local\",\"password\":\"whatever\"}")).andExpect(status().isUnauthorized());
  }

  @Test @Order(3)
  void rolesAndBranchesLimitWhatStaffCanDo() throws Exception {
    String admin = login("admin@test.local", "AdminPass123");
    createUser(admin, "desk1@test.local", "receptionist", "[\"BR1\"]");
    createUser(admin, "desk2@test.local", "receptionist", "[\"BR2\"]");
    createUser(admin, "hr@test.local", "hr", "[\"BR1\"]");
    String desk1 = login("desk1@test.local", "TempPass1234");
    String desk2 = login("desk2@test.local", "TempPass1234");
    String hr = login("hr@test.local", "TempPass1234");

    var created = body(mvc.perform(post("/api/patients").header("Authorization", desk1).contentType(MediaType.APPLICATION_JSON)
        .content(PATIENT)).andExpect(status().isCreated()).andReturn());
    String id = created.get("id").asText();
    assertThat(id).matches("HS-\\d{2}-00001");
    assertThat(created.get("branchId").asText()).isEqualTo("BR1");

    // Another branch cannot see it, and HR cannot open patient records at all.
    mvc.perform(get("/api/patients/" + id).header("Authorization", desk2)).andExpect(status().isNotFound());
    mvc.perform(get("/api/patients").header("Authorization", desk2)).andExpect(jsonPath("$.length()").value(0));
    mvc.perform(get("/api/patients").header("Authorization", hr)).andExpect(status().isForbidden());
    // Receptionists cannot manage accounts.
    mvc.perform(get("/api/users").header("Authorization", desk1)).andExpect(status().isForbidden());

    mvc.perform(get("/api/patients?q=90000").header("Authorization", desk1)).andExpect(jsonPath("$[0].id").value(id));
    mvc.perform(get("/api/patients/duplicates?name=Kavya Raman&mobile=9000011111").header("Authorization", desk1))
        .andExpect(jsonPath("$[0].score").value(99));
  }

  @Test @Order(4)
  void concurrentEditsAreDetected() throws Exception {
    String admin = login("admin@test.local", "AdminPass123");
    String id = body(mvc.perform(post("/api/patients").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON)
        .content(PATIENT)).andReturn()).get("id").asText();
    String edit = PATIENT.replace("\"consent\":\"Given\"", "\"consent\":\"Given\",\"version\":1");
    mvc.perform(put("/api/patients/" + id).header("Authorization", admin).contentType(MediaType.APPLICATION_JSON).content(edit))
        .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(2));
    mvc.perform(put("/api/patients/" + id).header("Authorization", admin).contentType(MediaType.APPLICATION_JSON).content(edit))
        .andExpect(status().isConflict());
    mvc.perform(post("/api/patients").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON)
        .content("{\"name\":\"\",\"gender\":\"X\"}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.fields.name").exists());
  }

  @Test @Order(5)
  void auditTrailIsAppendOnlyAndVerifiable() throws Exception {
    String admin = login("admin@test.local", "AdminPass123");
    mvc.perform(get("/api/audit/verify").header("Authorization", admin)).andExpect(jsonPath("$.intact").value(true));
    mvc.perform(get("/api/audit?entity=Patient").header("Authorization", admin)).andExpect(jsonPath("$[0].entity").value("Patient"));
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> db.sql("update audit_log set detail = 'x'").update())
        .hasMessageContaining("append-only");
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> db.sql("delete from audit_log").update())
        .hasMessageContaining("append-only");
  }

  @Test @Order(6)
  void branchAdminCannotCreateSuperAdmin() throws Exception {
    String sa = login("admin@test.local", "AdminPass123");
    createUser(sa, "badmin@test.local", "admin", "[\"BR1\"]");
    String badmin = login("badmin@test.local", "TempPass1234");
    mvc.perform(post("/api/users").header("Authorization", badmin).contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"x@test.local\",\"name\":\"X\",\"role\":\"super-admin\",\"branches\":[\"BR1\"],\"temporaryPassword\":\"TempPass1234\"}"))
        .andExpect(status().isForbidden());
    mvc.perform(post("/api/users").header("Authorization", badmin).contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"y@test.local\",\"name\":\"Y\",\"role\":\"nurse\",\"branches\":[\"BR2\"],\"temporaryPassword\":\"TempPass1234\"}"))
        .andExpect(status().isForbidden());
    mvc.perform(post("/api/users").header("Authorization", badmin).contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"z@test.local\",\"name\":\"Z\",\"role\":\"nurse\",\"branches\":[\"BR1\"],\"temporaryPassword\":\"short\"}"))
        .andExpect(status().isBadRequest());
  }
}
