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
abstract class ApiTestBase {
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

}
