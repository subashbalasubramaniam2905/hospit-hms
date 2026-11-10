package com.hospitos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.hospitos.audit.AuditService;
import com.hospitos.config.DemoAccounts;
import com.hospitos.users.UserRepository;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;

/** The online demo's sample data and per-role sign-ins. Each test rolls back, so other tests see an empty database. */
@Transactional
class DemoSetupTest extends ApiTestBase {
  @Autowired UserRepository users;
  @Autowired PasswordEncoder encoder;
  @Autowired AuditService audit;

  @Test
  void demoPasswordCreatesOneSignInPerRoleOnce() throws Exception {
    var seeder = new DemoAccounts("DemoPass2026", users, encoder, audit);
    seeder.run(null);
    seeder.run(null); // a restart must not fail or duplicate
    assertThat(db.sql("select count(*) from app_user where email like '%@hospitos.demo'").query(Integer.class).single()).isEqualTo(10);
    assertThat(db.sql("select count(distinct role) from app_user where email like '%@hospitos.demo'").query(Integer.class).single()).isEqualTo(10);
    mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"doctor@hospitos.demo\",\"password\":\"DemoPass2026\"}")).andExpect(status().isOk());
  }

  @Test
  void restartWithANewDemoPasswordResetsEveryDemoAccount() throws Exception {
    new DemoAccounts("DemoPass2026", users, encoder, audit).run(null);
    db.sql("update app_user set locked_until = now() + interval '1 hour', failed_logins = 5, status = 'Suspended' where email = 'nurse@hospitos.demo'").update();
    new DemoAccounts("NewDemo2027", users, encoder, audit).run(null);
    mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"nurse@hospitos.demo\",\"password\":\"NewDemo2027\"}")).andExpect(status().isOk());
  }

  @Test
  void infoShowsTheRunningCommitWithoutSignIn() throws Exception {
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/actuator/info"))
        .andExpect(status().isOk())
        .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.commit").value("local"));
  }

  @Test
  void noDemoPasswordCreatesNothing() {
    new DemoAccounts("", users, encoder, audit).run(null);
    assertThat(db.sql("select count(*) from app_user where email like '%@hospitos.demo'").query(Integer.class).single()).isZero();
  }

  @Test
  void samplePatientsLoadAndCanBeReloaded() throws Exception {
    var sql = new ClassPathResource("db/sample/R__sample_patients.sql").getContentAsString(StandardCharsets.UTF_8);
    db.sql(sql).update();
    db.sql(sql).update();
    assertThat(db.sql("select count(*) from patient where id like 'HS-24-%'").query(Integer.class).single()).isEqualTo(12);
    var found = get("/api/patients?q=Meena", root);
    assertThat(found.toString()).contains("HS-24-00001");
  }
}
