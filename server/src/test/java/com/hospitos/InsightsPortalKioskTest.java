package com.hospitos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hospitos.ai.AiModel;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@SpringBootTest(properties = "hospitos.portal.dev-otp=true")
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(CleanDatabase.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class InsightsPortalKioskTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired JdbcClient db;
  @MockitoBean AiModel ai;

  static final String MOBILE = "98765 43210";
  String admin, doctor, nurse, billing, patient, consultation;
  LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));

  private JsonNode body(MvcResult r) throws Exception { return json.readTree(r.getResponse().getContentAsString()); }

  private String login(String email, String pw) throws Exception {
    var res = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"" + email + "\",\"password\":\"" + pw + "\"}")).andExpect(status().isOk()).andReturn();
    return "Bearer " + body(res).get("token").asText();
  }

  private String staff(String email, String role) throws Exception {
    mvc.perform(post("/api/users").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"" + email + "\",\"name\":\"" + role + " one\",\"role\":\"" + role + "\",\"branches\":[\"BR1\"],\"temporaryPassword\":\"TempPass1234\"}"))
        .andExpect(status().isCreated());
    String temp = login(email, "TempPass1234");
    var r = mvc.perform(post("/api/auth/password").header("Authorization", temp).contentType(MediaType.APPLICATION_JSON)
        .content("{\"currentPassword\":\"TempPass1234\",\"newPassword\":\"RealPass5678\"}")).andExpect(status().isOk()).andReturn();
    return "Bearer " + body(r).get("token").asText();
  }

  private MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder b, String token) {
    return b.header("Authorization", token).contentType(MediaType.APPLICATION_JSON);
  }

  private JsonNode ok(MockHttpServletRequestBuilder b, String token) throws Exception {
    return body(mvc.perform(as(b, token)).andExpect(status().is2xxSuccessful()).andReturn());
  }

  @BeforeAll
  void setUp() throws Exception {
    admin = login("admin@test.local", "AdminPass123");
    doctor = staff("ins-doc@test.local", "doctor");
    nurse = staff("ins-nurse@test.local", "nurse");
    billing = staff("ins-billing@test.local", "billing");
    db.sql("insert into department (id, branch_id, name) values ('DX', 'BR1', 'General medicine')").update();
    db.sql("""
        insert into doctor (id, branch_id, dept_id, name, fee, days, start_time, end_time, slot_min, break_start, break_end, status)
        values ('DX01', 'BR1', 'DX', 'Dr. Asha Menon', 500, '{Mon,Tue,Wed,Thu,Fri,Sat,Sun}', '00:00', '23:45', 15, null, null, 'Available'),
               ('DX02', 'BR1', 'DX', 'Dr. Vikram Iyer', 400, '{Mon,Tue,Wed,Thu,Fri,Sat,Sun}', '00:00', '23:45', 15, null, null, 'Available')""").update();
    var p = ok(post("/api/patients").content("""
        {"name":"Lakshmi Narayan","dob":"1975-03-02","gender":"Female","mobile":"+91 98765 43210","consent":"Given","allergies":["Penicillin"]}"""), admin);
    patient = p.get("id").asText();
    // A visit completed yesterday, not billed, with a follow-up that is now overdue.
    consultation = db.sql("""
        insert into consultation (branch_id, patient_id, doctor_id, status, follow_up, follow_up_date, completed_at)
        values ('BR1', ?, 'DX01', 'Completed', 'Sugar review', ?, now() - interval '1 day') returning id""")
        .params(patient, today.minusDays(1)).query(UUID.class).single().toString();
    // Booked today with another doctor, for the kiosk to check in.
    db.sql("""
        insert into appointment (id, branch_id, patient_id, doctor_id, dept_id, appt_date, start_time, duration_min, type, status)
        values ('AP-T1', 'BR1', ?, 'DX02', 'DX', ?, '23:30', 15, 'Follow-up', 'Scheduled')""").params(patient, today).update();
  }

  @Test @Order(1)
  void dashboardCountsLiveData() throws Exception {
    var d = ok(get("/api/insights/dashboard"), admin);
    assertThat(d.get("appointments").asInt()).isEqualTo(1);
    assertThat(d.get("toCome").asInt()).isEqualTo(1);
    assertThat(d.get("unbilledConsultations").asInt()).isEqualTo(1);
    assertThat(d.get("followUpsOverdue").asInt()).isEqualTo(1);
    assertThat(d.get("doctorsTotal").asInt()).isEqualTo(2);
    assertThat(d.get("revenue12m")).hasSize(12);
    assertThat(d.get("hourly").get(0).get("hour").asInt()).isEqualTo(8);
    // A nurse in another branch can't ask for BR2... and nobody can ask for a branch they don't work in.
    mvc.perform(as(get("/api/insights/dashboard?branch=BR2"), nurse)).andExpect(status().isForbidden());
  }

  @Test @Order(2)
  void reportsRunAndAreLimitedToManagers() throws Exception {
    for (String id : new String[] { "opd", "revenue", "doctor", "lab", "pharmacy", "claims", "noshow", "beds" })
      ok(get("/api/insights/reports/" + id + "?days=30"), admin);
    var opd = ok(get("/api/insights/reports/opd?days=7"), admin);
    assertThat(opd.get("rows").get(0).get("Department").asText()).isEqualTo("General medicine");
    mvc.perform(as(get("/api/insights/reports/nope"), admin)).andExpect(status().isNotFound());
    mvc.perform(as(get("/api/insights/reports/opd"), nurse)).andExpect(status().isForbidden());
    ok(get("/api/insights/branches"), admin);
  }

  @Test @Order(3)
  void followUpsShowOverdueAndRecordReminders() throws Exception {
    var list = ok(get("/api/insights/followups"), nurse);
    assertThat(list).hasSize(1);
    assertThat(list.get(0).get("status").asText()).isEqualTo("Overdue");
    assertThat(list.get(0).get("reason").asText()).isEqualTo("Sugar review");
    ok(post("/api/insights/followups/remind").content("{\"ids\":[\"" + consultation + "\"]}"), nurse);
    assertThat(ok(get("/api/insights/followups"), nurse).get(0).get("reminder").asText()).isEqualTo("Sent");
    mvc.perform(as(get("/api/insights/followups"), billing)).andExpect(status().isForbidden());
  }

  @Test @Order(4)
  void leakageFindsUnbilledVisitsAndWaiverClearsThem() throws Exception {
    var list = ok(get("/api/insights/leakage"), billing);
    String key = "CONS:" + consultation;
    assertThat(list.findValuesAsText("key")).contains(key);
    mvc.perform(as(post("/api/insights/leakage/review"), billing).content("{\"key\":\"" + key + "\",\"action\":\"Waived\",\"reason\":\"Free follow-up within 7 days\"}"))
        .andExpect(status().isOk());
    assertThat(ok(get("/api/insights/leakage"), billing).findValuesAsText("key")).doesNotContain(key);
    assertThat(ok(get("/api/insights/dashboard"), admin).get("unbilledConsultations").asInt()).isZero();
    mvc.perform(as(post("/api/insights/leakage/review"), billing).content("{\"key\":\"" + key + "\",\"action\":\"Waived\",\"reason\":\"again\"}"))
        .andExpect(status().isNotFound());
    int audited = db.sql("select count(*) from audit_log where entity = 'Revenue leakage' and entity_id = ?").param(key).query(Integer.class).single();
    assertThat(audited).isEqualTo(1);
  }

  @Test @Order(5)
  void alertsAreRaisedOnceAndClearWhenTheProblemGoes() throws Exception {
    String med = db.sql("select id from medicine order by id limit 1").query(String.class).single();
    UUID batch = db.sql("insert into medicine_batch (medicine_id, branch_id, batch, expiry, qty) values (?, 'BR1', 'OLD-1', ?, 5) returning id")
        .params(med, today.minusDays(2)).query(UUID.class).single();
    var alerts = ok(get("/api/insights/alerts"), nurse);
    var expired = findByTitlePrefix(alerts, "Expired stock");
    assertThat(expired).isNotNull();
    assertThat(expired.get("priority").asText()).isEqualTo("High");
    long id = expired.get("id").asLong();
    // Reading again does not raise it twice.
    assertThat(countTitle(ok(get("/api/insights/alerts"), nurse), "Expired stock")).isEqualTo(1);
    ok(post("/api/insights/alerts/" + id + "/assign").content("{\"assignee\":\"Pharmacy desk\"}"), nurse);
    var acked = ok(post("/api/insights/alerts/" + id + "/status").content("{\"status\":\"Acknowledged\"}"), nurse);
    assertThat(acked.get("assignee").asText()).isEqualTo("Pharmacy desk");
    // The batch is written off: the alert clears by itself.
    db.sql("update medicine_batch set qty = 0 where id = ?").param(batch).update();
    ok(get("/api/insights/alerts"), nurse);
    String st = db.sql("select status from insight_alert where id = ?").param(id).query(String.class).single();
    assertThat(st).isEqualTo("Resolved");
  }

  private static JsonNode findByTitlePrefix(JsonNode list, String prefix) {
    for (var a : list) if (a.get("title").asText().startsWith(prefix)) return a;
    return null;
  }

  private static int countTitle(JsonNode list, String prefix) {
    int n = 0;
    for (var a : list) if (a.get("title").asText().startsWith(prefix)) n++;
    return n;
  }

  @Test @Order(6)
  void safetyScreenFlagsAllergyAndRecordsReview() throws Exception {
    UUID rx = db.sql("insert into prescription (branch_id, patient_id, doctor_id, status) values ('BR1', ?, 'DX01', 'Sent to pharmacy') returning id")
        .param(patient).query(UUID.class).single();
    db.sql("insert into prescription_item (prescription_id, position, name, generic, qty) values (?, 1, 'Mox 500', 'Amoxicillin', 10)").param(rx).update();
    var res = ok(get("/api/insights/safety"), doctor);
    JsonNode allergy = null;
    for (var a : res.get("alerts")) if (a.get("prescriptionId").asText().equals(rx.toString()) && a.get("kind").asText().equals("Allergy")) allergy = a;
    assertThat(allergy).isNotNull();
    assertThat(res.get("patientsWithAllergies").asInt()).isEqualTo(1);
    String review = "{\"prescriptionId\":\"" + rx + "\",\"alertCode\":\"" + allergy.get("alertCode").asText() + "\",\"outcome\":\"Prescriber contacted, change agreed\"}";
    mvc.perform(as(post("/api/insights/safety/review"), doctor).content(review)).andExpect(status().isOk());
    mvc.perform(as(post("/api/insights/safety/review"), doctor).content(review)).andExpect(status().isConflict());
    assertThat(ok(get("/api/insights/safety"), doctor).get("alerts").findValuesAsText("key")).doesNotContain(allergy.get("key").asText());
  }

  @Test @Order(7)
  void portalSignInBookingAndRecords() throws Exception {
    // An unknown number gets the same answer, but no code.
    var unknown = body(mvc.perform(post("/api/portal/otp").contentType(MediaType.APPLICATION_JSON).content("{\"mobile\":\"90000 00009\"}"))
        .andExpect(status().isOk()).andReturn());
    assertThat(unknown.get("sent").asBoolean()).isTrue();
    assertThat(unknown.has("devCode")).isFalse();
    String code = body(mvc.perform(post("/api/portal/otp").contentType(MediaType.APPLICATION_JSON).content("{\"mobile\":\"+91 " + MOBILE + "\"}"))
        .andExpect(status().isOk()).andReturn()).get("devCode").asText();
    String wrong = code.equals("000000") ? "111111" : "000000";
    mvc.perform(post("/api/portal/verify").contentType(MediaType.APPLICATION_JSON).content("{\"mobile\":\"" + MOBILE + "\",\"code\":\"" + wrong + "\"}"))
        .andExpect(status().isUnauthorized());
    var signed = body(mvc.perform(post("/api/portal/verify").contentType(MediaType.APPLICATION_JSON)
        .content("{\"mobile\":\"" + MOBILE + "\",\"code\":\"" + code + "\"}")).andExpect(status().isOk()).andReturn());
    String pt = "Bearer " + signed.get("token").asText();
    // The code works once.
    mvc.perform(post("/api/portal/verify").contentType(MediaType.APPLICATION_JSON).content("{\"mobile\":\"" + MOBILE + "\",\"code\":\"" + code + "\"}"))
        .andExpect(status().isUnauthorized());

    var me = ok(get("/api/portal/me"), pt);
    assertThat(me.get(0).get("id").asText()).isEqualTo(patient);
    assertThat(me.get(0).get("followUpDue").asText()).isEqualTo(today.minusDays(1).toString());
    // Patient tokens never reach staff endpoints, and staff tokens never reach the portal.
    mvc.perform(as(get("/api/patients"), pt)).andExpect(status().isForbidden());
    mvc.perform(as(get("/api/auth/me"), pt)).andExpect(status().isForbidden());
    mvc.perform(as(get("/api/portal/me"), admin)).andExpect(status().isForbidden());
    // Another patient's id is refused.
    mvc.perform(as(get("/api/portal/records?patientId=HS-99-99999"), pt)).andExpect(status().isNotFound());

    assertThat(ok(get("/api/portal/doctors"), pt).findValuesAsText("id")).contains("DX01");
    String day = today.plusDays(1).toString();
    var slots = ok(get("/api/portal/slots?doctorId=DX01&date=" + day), pt);
    assertThat(slots.size()).isGreaterThan(10);
    var booked = ok(post("/api/portal/appointments").content("{\"doctorId\":\"DX01\",\"date\":\"" + day + "\",\"time\":\"10:00\"}"), pt);
    assertThat(booked.get("status").asText()).isEqualTo("Scheduled");
    // The booked time is no longer offered.
    assertThat(slotTaken(ok(get("/api/portal/slots?doctorId=DX01&date=" + day), pt), "10:00")).isFalse();
    ok(post("/api/portal/appointments/" + booked.get("id").asText() + "/cancel"), pt);
    String st = db.sql("select status from appointment where id = ?").param(booked.get("id").asText()).query(String.class).single();
    assertThat(st).isEqualTo("Cancelled");
    int who = db.sql("select count(*) from audit_log where entity = 'Appointment' and entity_id = ? and role = 'patient'")
        .param(booked.get("id").asText()).query(Integer.class).single();
    assertThat(who).isEqualTo(2);

    var rec = ok(get("/api/portal/records"), pt);
    assertThat(rec.get("visits")).hasSize(1);
    assertThat(rec.get("prescriptions")).hasSize(1);
    ok(get("/api/portal/bills"), pt);
    mvc.perform(as(post("/api/portal/feedback"), pt).content("{\"rating\":5,\"dept\":\"General medicine\",\"comment\":\"Kind staff\"}"))
        .andExpect(status().isCreated());
  }

  private static boolean slotTaken(JsonNode slots, String t) {
    for (var s : slots) if (s.asText().equals(t)) return true;
    return false;
  }

  @Test @Order(8)
  void kioskPairsChecksInAndIsLimitedToKioskEndpoints() throws Exception {
    var code = ok(post("/api/kiosk/devices").content("{\"branchId\":\"BR1\",\"name\":\"Lobby 1\"}"), admin);
    mvc.perform(as(post("/api/kiosk/devices").content("{\"branchId\":\"BR1\",\"name\":\"x\"}"), nurse)).andExpect(status().isForbidden());
    mvc.perform(post("/api/kiosk/pair").contentType(MediaType.APPLICATION_JSON).content("{\"code\":\"WRONG123\"}")).andExpect(status().isUnauthorized());
    var paired = body(mvc.perform(post("/api/kiosk/pair").contentType(MediaType.APPLICATION_JSON)
        .content("{\"code\":\"" + code.get("code").asText() + "\"}")).andExpect(status().isOk()).andReturn());
    String k = "Bearer " + paired.get("token").asText();
    // The code is single use.
    mvc.perform(post("/api/kiosk/pair").contentType(MediaType.APPLICATION_JSON).content("{\"code\":\"" + code.get("code").asText() + "\"}"))
        .andExpect(status().isUnauthorized());

    var info = ok(get("/api/kiosk/info"), k);
    assertThat(info.get("branchId").asText()).isEqualTo("BR1");
    var found = ok(post("/api/kiosk/find").content("{\"mobile\":\"" + MOBILE + "\"}"), k);
    assertThat(found.get(0).get("displayName").asText()).isEqualTo("Lakshmi N.");
    assertThat(found.get(0).get("today")).hasSize(1);
    var ticket = ok(post("/api/kiosk/check-in").content("{\"patientId\":\"" + patient + "\",\"appointmentId\":\"AP-T1\"}"), k);
    assertThat(ticket.get("token").asText()).isNotBlank();
    mvc.perform(as(post("/api/kiosk/check-in"), k).content("{\"patientId\":\"" + patient + "\",\"appointmentId\":\"AP-T1\"}")).andExpect(status().isConflict());
    assertThat(db.sql("select status from appointment where id = 'AP-T1'").query(String.class).single()).isEqualTo("Arrived");

    var reg = ok(post("/api/kiosk/register").content("{\"name\":\"Ravi Kumar\",\"mobile\":\"9123456780\",\"dob\":\"1988-01-01\",\"gender\":\"Male\",\"consent\":true}"), k);
    // The same person registering again gets a clear answer, not a duplicate record.
    mvc.perform(as(post("/api/kiosk/register").contentType("application/json")
        .content("{\"name\":\"ravi  kumar\",\"mobile\":\"+91 91234 56780\",\"dob\":\"1988-01-01\",\"gender\":\"Male\",\"consent\":true}"), k))
        .andExpect(status().isConflict());
    var walk = ok(post("/api/kiosk/walk-in").content("{\"patientId\":\"" + reg.get("patientId").asText() + "\",\"deptId\":\"DX\"}"), k);
    // The walk-in goes to the doctor with the shorter queue.
    assertThat(walk.get("doctorName").asText()).isEqualTo("Dr. Asha Menon");
    assertThat(walk.get("ahead").asInt()).isZero();

    mvc.perform(as(get("/api/patients"), k)).andExpect(status().isForbidden());
    mvc.perform(as(get("/api/kiosk/devices"), k)).andExpect(status().isForbidden());
    mvc.perform(as(get("/api/portal/me"), k)).andExpect(status().isForbidden());
    ok(post("/api/kiosk/devices/" + code.get("id").asText() + "/revoke"), admin);
    mvc.perform(as(get("/api/kiosk/info"), k)).andExpect(status().isUnauthorized());
  }

  @Test @Order(9)
  void assistantUsesRulesWithoutAModelAndSendsNoNamesToOne() throws Exception {
    when(ai.enabled()).thenReturn(false);
    assertThat(ok(get("/api/ai/status"), admin).get("live").asBoolean()).isFalse();
    var a = ok(post("/api/ai/ask").content("{\"question\":\"Where are patients waiting?\"}"), admin);
    assertThat(a.get("source").asText()).isEqualTo("rules");
    assertThat(a.get("answer").asText()).contains("in the OPD queue");
    assertThat(a.get("link").asText()).isEqualTo("/queue");

    when(ai.enabled()).thenReturn(true);
    when(ai.name()).thenReturn("test-model");
    when(ai.answer(anyString(), anyString())).thenReturn(Optional.of("Two patients are waiting."));
    var b = ok(post("/api/ai/ask").content("{\"question\":\"How is the queue?\",\"history\":[{\"from\":\"me\",\"text\":\"hi\"}]}"), admin);
    assertThat(b.get("source").asText()).isEqualTo("claude");
    assertThat(b.get("answer").asText()).isEqualTo("Two patients are waiting.");
    var user = ArgumentCaptor.forClass(String.class);
    verify(ai).answer(anyString(), user.capture());
    assertThat(user.getValue()).contains("OPD queue now by step").doesNotContain("Lakshmi").doesNotContain(patient);

    // A failed call falls back to the rules.
    when(ai.answer(anyString(), anyString())).thenReturn(Optional.empty());
    assertThat(ok(post("/api/ai/ask").content("{\"question\":\"Collections today?\"}"), admin).get("source").asText()).isEqualTo("rules");
    mvc.perform(as(post("/api/ai/ask").content("{\"question\":\"x\"}"), nurse)).andExpect(status().isForbidden());
  }
}
