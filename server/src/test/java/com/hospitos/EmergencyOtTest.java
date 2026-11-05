package com.hospitos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hospitos.emergency.TriageRules;
import java.time.LocalDate;
import java.time.ZoneId;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(CleanDatabase.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class EmergencyOtTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired JdbcClient db;

  String admin, nurse1, doc1, desk1, nurse2, pharm1;
  String patient, patient2;
  final LocalDate tomorrow = LocalDate.now(ZoneId.of("Asia/Kolkata")).plusDays(1);

  private JsonNode body(MvcResult r) throws Exception { return json.readTree(r.getResponse().getContentAsString()); }

  private String login(String email, String pw) throws Exception {
    var res = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"" + email + "\",\"password\":\"" + pw + "\"}")).andExpect(status().isOk()).andReturn();
    return "Bearer " + body(res).get("token").asText();
  }

  private String staff(String email, String role, String branch) throws Exception {
    mvc.perform(post("/api/users").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"" + email + "\",\"name\":\"" + role + " " + branch + "\",\"role\":\"" + role + "\",\"branches\":[\"" + branch
            + "\"],\"temporaryPassword\":\"TempPass1234\"}")).andExpect(status().isCreated());
    String temp = login(email, "TempPass1234");
    var r = mvc.perform(post("/api/auth/password").header("Authorization", temp).contentType(MediaType.APPLICATION_JSON)
        .content("{\"currentPassword\":\"TempPass1234\",\"newPassword\":\"RealPass5678\"}")).andExpect(status().isOk()).andReturn();
    return "Bearer " + body(r).get("token").asText();
  }

  private MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder b, String token) {
    return b.header("Authorization", token).contentType(MediaType.APPLICATION_JSON);
  }

  private JsonNode ok(MockHttpServletRequestBuilder b) throws Exception { return body(mvc.perform(b).andExpect(status().is2xxSuccessful()).andReturn()); }

  @BeforeAll
  void setUp() throws Exception {
    admin = login("admin@test.local", "AdminPass123");
    nurse1 = staff("eo-nurse1@test.local", "nurse", "BR1");
    doc1 = staff("eo-doc1@test.local", "doctor", "BR1");
    desk1 = staff("eo-desk1@test.local", "receptionist", "BR1");
    nurse2 = staff("eo-nurse2@test.local", "nurse", "BR2");
    pharm1 = staff("eo-pharm1@test.local", "pharmacist", "BR1");
    db.sql("insert into department (id, branch_id, name) values ('DP1', 'BR1', 'Emergency') on conflict do nothing").update();
    db.sql("insert into doctor (id, branch_id, dept_id, name) values ('D08', 'BR1', 'DP1', 'Dr. ER Doctor') on conflict do nothing").update();
    db.sql("insert into doctor (id, branch_id, dept_id, name) values ('D04', 'BR1', 'DP1', 'Dr. Surgeon One') on conflict do nothing").update();
    patient = ok(as(post("/api/patients"), desk1).content("""
        {"name":"Ravi Kumar","dob":"1975-04-05","gender":"Male","mobile":"+91 90000 33333","consent":"Given","allergies":["Penicillin"]}"""))
        .get("id").asText();
    patient2 = ok(as(post("/api/patients"), desk1).content("""
        {"name":"Meena Devi","dob":"1990-06-07","gender":"Female","mobile":"+91 90000 44444","consent":"Given"}""")).get("id").asText();
  }

  @Test @Order(0)
  void triageSuggestionFollowsVitals() {
    assertThat(TriageRules.suggest("70/40", 120, 95, 15)).isEqualTo("Red");
    assertThat(TriageRules.suggest("120/80", 90, 97, 8)).isEqualTo("Red");
    assertThat(TriageRules.suggest("120/80", 140, 97, 15)).isEqualTo("Orange");
    assertThat(TriageRules.suggest("190/100", 90, 97, 15)).isEqualTo("Yellow");
    assertThat(TriageRules.suggest("120/80", 80, 98, 15)).isEqualTo("Green");
    assertThat(TriageRules.suggest("", null, null, null)).isEqualTo("Green");
  }

  // ---------- emergency ----------

  @Test @Order(1)
  void unknownPatientIsRegisteredTriagedTreatedLinkedAndAdmitted() throws Exception {
    mvc.perform(as(get("/api/er/cases"), pharm1)).andExpect(status().isForbidden());
    var bays = ok(as(get("/api/er/bays"), nurse1));
    assertThat(bays.size()).isEqualTo(10);
    assertThat(bays.get(0).get("name").asText()).isEqualTo("Resus 1");

    var c = ok(as(post("/api/er/cases"), desk1).content("""
        {"age":40,"gender":"Male","mode":"Ambulance","triage":"Red","complaint":"Road traffic accident","bay":"Resus 1",
         "vitals":{"bp":"85/50","hr":128,"spo2":93,"gcs":12}}"""));
    String id = c.get("id").asText();
    assertThat(id).matches("ER-\\d+");
    assertThat(c.get("label").asText()).isEqualTo("Unknown male, about 40 years");
    assertThat(c.get("status").asText()).isEqualTo("Waiting");
    assertThat(c.get("suggestedTriage").asText()).isEqualTo("Orange");
    assertThat(c.get("arrival").asText()).matches("\\d\\d:\\d\\d");
    assertThat(c.has("patientId")).isFalse();
    assertThat(db.sql("select count(*) from audit_log where entity_id = ? and action = 'Alert'").param(id).query(Integer.class).single()).isEqualTo(1);

    // The bay is taken now.
    mvc.perform(as(post("/api/er/cases"), desk1).content("""
        {"mode":"Walk-in","triage":"Green","complaint":"Cut finger","bay":"Resus 1"}""")).andExpect(status().isConflict());
    mvc.perform(as(post("/api/er/cases"), desk1).content("""
        {"mode":"Bus","triage":"Green","complaint":"x"}""")).andExpect(status().isBadRequest());
    mvc.perform(as(post("/api/er/cases"), desk1).content("""
        {"mode":"Walk-in","triage":"Green","complaint":"x","vitals":{"bp":"high"}}""")).andExpect(status().isBadRequest());

    // Reception may register but not make clinical decisions.
    mvc.perform(as(patch("/api/er/cases/" + id), desk1).content("{\"triage\":\"Orange\"}")).andExpect(status().isForbidden());
    var u = ok(as(patch("/api/er/cases/" + id), doc1).content("{\"triage\":\"Orange\",\"doctorId\":\"D08\",\"bay\":\"Bay 2\"}"));
    assertThat(u.get("triage").asText()).isEqualTo("Orange");
    assertThat(u.get("doctorName").asText()).isEqualTo("Dr. ER Doctor");
    assertThat(u.get("bay").asText()).isEqualTo("Bay 2");
    mvc.perform(as(patch("/api/er/cases/" + id), doc1).content("{\"doctorId\":\"NOPE\"}")).andExpect(status().isBadRequest());

    var o = ok(as(post("/api/er/cases/" + id + "/orders"), nurse1).content("{\"name\":\"ECG\"}"));
    assertThat(o.get("status").asText()).isEqualTo("Under treatment");
    assertThat(o.get("orders").get(0).asText()).isEqualTo("ECG");
    mvc.perform(as(post("/api/er/cases/" + id + "/orders"), nurse1).content("{\"name\":\"ECG\"}")).andExpect(status().isConflict());

    // Admission needs a registered record.
    mvc.perform(as(post("/api/er/cases/" + id + "/admitted"), desk1).content("{}")).andExpect(status().isConflict());
    var l = ok(as(post("/api/er/cases/" + id + "/link"), desk1).content("{\"patientId\":\"" + patient + "\"}"));
    assertThat(l.get("label").asText()).isEqualTo("Ravi Kumar");
    mvc.perform(as(post("/api/er/cases/" + id + "/link"), desk1).content("{\"patientId\":\"" + patient2 + "\"}")).andExpect(status().isConflict());

    var a = ok(as(post("/api/er/cases/" + id + "/admitted"), desk1).content("{\"admissionId\":\"IPD-02500\"}"));
    assertThat(a.get("status").asText()).isEqualTo("Admitted");
    assertThat(a.get("admissionId").asText()).isEqualTo("IPD-02500");
    // Idempotent, and the case is closed for further changes.
    ok(as(post("/api/er/cases/" + id + "/admitted"), desk1).content("{\"admissionId\":\"IPD-02500\"}"));
    mvc.perform(as(post("/api/er/cases/" + id + "/orders"), nurse1).content("{\"name\":\"CBC\"}")).andExpect(status().isConflict());
    var tl = a.get("timeline");
    assertThat(tl.size()).isGreaterThanOrEqualTo(5);
    assertThat(tl.get(0).get("event").asText()).contains("Arrived by ambulance, triaged Red (vitals suggested Orange)");

    // The bay is free again and the admitted case still shows on today's board.
    var board = ok(as(get("/api/er/cases"), nurse1));
    assertThat(board.size()).isEqualTo(1);
    assertThat(board.get(0).get("status").asText()).isEqualTo("Admitted");
    assertThat(ok(as(get("/api/er/bays"), nurse1)).get(3).has("caseId")).isFalse();
    assertThat(ok(as(get("/api/er/cases?patientId=" + patient), doc1)).size()).isEqualTo(1);
  }

  @Test @Order(2)
  void casesStayInTheirBranchAndCloseWithADisposition() throws Exception {
    var c = ok(as(post("/api/er/cases"), nurse1).content("{\"patientId\":\"" + patient2 + "\",\"mode\":\"Walk-in\",\"triage\":\"Green\",\"complaint\":\"Sprained ankle\",\"bay\":\"Minor 1\"}"));
    String id = c.get("id").asText();
    assertThat(c.get("label").asText()).isEqualTo("Meena Devi");

    mvc.perform(as(get("/api/er/cases/" + id), nurse2)).andExpect(status().isNotFound());
    mvc.perform(as(get("/api/er/cases?branchId=BR1"), nurse2)).andExpect(status().isForbidden());
    assertThat(ok(as(get("/api/er/cases"), nurse2)).size()).isZero();
    mvc.perform(as(post("/api/er/cases"), nurse2).content("{\"patientId\":\"" + patient2 + "\",\"mode\":\"Walk-in\",\"triage\":\"Green\",\"complaint\":\"x\"}"))
        .andExpect(status().isBadRequest());

    var obs = ok(as(post("/api/er/cases/" + id + "/status"), doc1).content("{\"status\":\"Observation\"}"));
    assertThat(obs.get("status").asText()).isEqualTo("Observation");
    mvc.perform(as(post("/api/er/cases/" + id + "/status"), doc1).content("{\"status\":\"Admitted\"}")).andExpect(status().isBadRequest());
    var d = ok(as(post("/api/er/cases/" + id + "/status"), doc1).content("{\"status\":\"Discharged\",\"note\":\"Crepe bandage, review in OPD\"}"));
    assertThat(d.get("status").asText()).isEqualTo("Discharged");
    assertThat(d.get("dispositionNote").asText()).isEqualTo("Crepe bandage, review in OPD");
    mvc.perform(as(post("/api/er/cases/" + id + "/status"), doc1).content("{\"status\":\"Observation\"}")).andExpect(status().isConflict());
    mvc.perform(as(post("/api/er/cases/" + id + "/admitted"), desk1).content("{}")).andExpect(status().isConflict());
    // Minor 1 can take the next patient.
    ok(as(post("/api/er/cases"), nurse1).content("{\"mode\":\"Walk-in\",\"triage\":\"Green\",\"complaint\":\"Fever\",\"bay\":\"Minor 1\"}"));
  }

  // ---------- operation theatre ----------

  private String booking(String room, String start, int dur, String surgeon) {
    return "{\"patientId\":\"" + patient + "\",\"procedure\":\"Laparoscopic appendicectomy\",\"surgeonId\":\"" + surgeon + "\",\"room\":\"" + room
        + "\",\"date\":\"" + tomorrow + "\",\"start\":\"" + start + "\",\"durationMin\":" + dur + ",\"anaesthesia\":\"General\",\"anaesthetist\":\"Dr. Kiran Bhat\"}";
  }

  @Test @Order(10)
  void surgeryIsBookedWithoutClashesAndRunsThroughTheChecklist() throws Exception {
    assertThat(ok(as(get("/api/ot/rooms"), nurse1)).size()).isEqualTo(3);
    mvc.perform(as(post("/api/ot/surgeries"), nurse1).content(booking("OT-1", "10:00", 90, "D04"))).andExpect(status().isForbidden());
    var s = ok(as(post("/api/ot/surgeries"), desk1).content(booking("OT-1", "10:00", 90, "D04")));
    String id = s.get("id").asText();
    assertThat(id).matches("OT\\d{4}");
    assertThat(s.get("status").asText()).isEqualTo("Scheduled");
    assertThat(s.get("start").asText()).isEqualTo("10:00");
    assertThat(s.get("durationMin").asInt()).isEqualTo(90);
    assertThat(s.get("patientAllergies").get(0).asText()).isEqualTo("Penicillin");
    assertThat(s.get("checklist").size()).isEqualTo(7);
    assertThat(s.get("checklist").fieldNames().next()).isEqualTo("Consent signed");

    // Same room overlapping, and the same surgeon in another room, are refused; back-to-back is fine.
    var clash = body(mvc.perform(as(post("/api/ot/surgeries"), desk1).content(booking("OT-1", "11:00", 60, "D08"))).andExpect(status().isConflict()).andReturn());
    assertThat(clash.get("detail").asText()).contains("OT-1 is booked for Laparoscopic appendicectomy at 10:00 (90 min)");
    var surgeon = body(mvc.perform(as(post("/api/ot/surgeries"), desk1).content(booking("OT-2", "11:00", 60, "D04"))).andExpect(status().isConflict()).andReturn());
    assertThat(surgeon.get("detail").asText()).contains("Dr. Surgeon One is already operating");
    ok(as(post("/api/ot/surgeries"), desk1).content(booking("OT-1", "11:30", 30, "D08")));
    mvc.perform(as(post("/api/ot/surgeries"), desk1).content(booking("OT-1", "10:00", 60, "D04").replace(tomorrow.toString(), tomorrow.minusDays(2).toString())))
        .andExpect(status().isUnprocessableEntity());
    mvc.perform(as(post("/api/ot/surgeries"), desk1).content(booking("OT-9", "14:00", 60, "D04"))).andExpect(status().isBadRequest());
    mvc.perform(as(post("/api/ot/surgeries"), desk1).content(booking("OT-1", "25:00", 60, "D04"))).andExpect(status().isBadRequest());

    // The database refuses an overlap even if the service check is bypassed.
    try {
      db.sql("insert into surgery (id, branch_id, patient_id, surgeon_id, anaesthesia, room, starts_at, ends_at, procedure) values ('OTX', 'BR1', ?, 'D08', 'General', 'OT-1', ?, ?, 'x')")
          .params(patient, tomorrow.atTime(10, 30), tomorrow.atTime(10, 45)).update();
      throw new AssertionError("overlap was allowed");
    } catch (org.springframework.dao.DataIntegrityViolationException expected) { /* refused */ }

    var day = ok(as(get("/api/ot/surgeries?date=" + tomorrow), doc1));
    assertThat(day.size()).isEqualTo(2);
    assertThat(ok(as(get("/api/ot/surgeries?date=" + tomorrow), nurse2)).size()).isZero();
    mvc.perform(as(get("/api/ot/surgeries/" + id), nurse2)).andExpect(status().isNotFound());

    ok(as(post("/api/ot/surgeries/" + id + "/advance"), nurse1).content("{\"from\":\"Scheduled\"}"));
    // A stale screen cannot advance twice.
    mvc.perform(as(post("/api/ot/surgeries/" + id + "/advance"), nurse1).content("{\"from\":\"Scheduled\"}")).andExpect(status().isConflict());
    var blocked = body(mvc.perform(as(post("/api/ot/surgeries/" + id + "/advance"), nurse1).content("{\"from\":\"Pre-op\"}"))
        .andExpect(status().isUnprocessableEntity()).andReturn());
    assertThat(blocked.get("detail").asText()).contains("Consent signed");
    mvc.perform(as(post("/api/ot/surgeries/" + id + "/checklist"), nurse1).content("{\"item\":\"Nope\",\"done\":true}")).andExpect(status().isBadRequest());
    JsonNode cur = null;
    for (String item : new String[] {"Consent signed", "Site marked", "Fasting confirmed", "Allergies checked", "Blood arranged", "Anaesthesia review", "Implants available"})
      cur = ok(as(post("/api/ot/surgeries/" + id + "/checklist"), nurse1).content("{\"item\":\"" + item + "\",\"done\":true}"));
    assertThat(cur.get("checklist").get("Implants available").asBoolean()).isTrue();
    mvc.perform(as(put("/api/ot/surgeries/" + id + "/notes"), doc1).content("{\"postOpNotes\":\"too early\"}")).andExpect(status().isConflict());

    assertThat(ok(as(post("/api/ot/surgeries/" + id + "/advance"), doc1).content("{\"from\":\"Pre-op\"}")).get("status").asText()).isEqualTo("In progress");
    mvc.perform(as(post("/api/ot/surgeries/" + id + "/checklist"), nurse1).content("{\"item\":\"Site marked\",\"done\":false}")).andExpect(status().isConflict());
    mvc.perform(as(post("/api/ot/surgeries/" + id + "/cancel"), desk1).content("{}")).andExpect(status().isConflict());
    ok(as(post("/api/ot/surgeries/" + id + "/advance"), doc1).content("{\"from\":\"In progress\"}"));
    var n = ok(as(put("/api/ot/surgeries/" + id + "/notes"), doc1).content("{\"postOpNotes\":\"Uneventful. Drain in situ.\"}"));
    assertThat(n.get("postOpNotes").asText()).isEqualTo("Uneventful. Drain in situ.");
    var done = ok(as(post("/api/ot/surgeries/" + id + "/advance"), doc1).content("{\"from\":\"Recovery\"}"));
    assertThat(done.get("status").asText()).isEqualTo("Completed");
    assertThat(done.get("timeline").get(done.get("timeline").size() - 1).get("event").asText()).isEqualTo("Shifted to ward");
    mvc.perform(as(post("/api/ot/surgeries/" + id + "/advance"), doc1).content("{\"from\":\"Completed\"}")).andExpect(status().isConflict());
  }

  @Test @Order(11)
  void cancellingReleasesTheSlot() throws Exception {
    var s = ok(as(post("/api/ot/surgeries"), desk1).content(booking("OT-3", "15:00", 60, "D04")));
    String id = s.get("id").asText();
    var c = ok(as(post("/api/ot/surgeries/" + id + "/cancel"), desk1).content("{\"reason\":\"Patient unfit, high BP\"}"));
    assertThat(c.get("status").asText()).isEqualTo("Cancelled");
    assertThat(c.get("cancelReason").asText()).isEqualTo("Patient unfit, high BP");
    mvc.perform(as(post("/api/ot/surgeries/" + id + "/checklist"), nurse1).content("{\"item\":\"Site marked\",\"done\":true}")).andExpect(status().isConflict());
    ok(as(post("/api/ot/surgeries"), desk1).content(booking("OT-3", "15:00", 60, "D04")));
    assertThat(ok(as(get("/api/ot/surgeries?patientId=" + patient), doc1)).size()).isEqualTo(4);
  }
}
