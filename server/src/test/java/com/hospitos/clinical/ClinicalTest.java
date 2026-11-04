package com.hospitos.clinical;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hospitos.CleanDatabase;
import com.hospitos.clinical.prescription.PrescriptionService;
import com.hospitos.common.ApiException;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
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
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ClinicalTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired JdbcClient db;
  @Autowired PrescriptionService prescriptions;

  String admin, doctor, doctor2, nurse, pharmacist, otherBranch, desk;
  String patientId;

  private String login(String email, String pw) throws Exception {
    var res = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"" + email + "\",\"password\":\"" + pw + "\"}")).andExpect(status().isOk()).andReturn();
    return "Bearer " + json.readTree(res.getResponse().getContentAsString()).get("token").asText();
  }

  private String firstLogin(String email) throws Exception {
    String temp = login(email, "TempPass1234");
    var r = mvc.perform(post("/api/auth/password").header("Authorization", temp).contentType(MediaType.APPLICATION_JSON)
        .content("{\"currentPassword\":\"TempPass1234\",\"newPassword\":\"RealPass5678\"}")).andExpect(status().isOk()).andReturn();
    return "Bearer " + json.readTree(r.getResponse().getContentAsString()).get("token").asText();
  }

  private String user(String email, String role, String branch) throws Exception {
    var r = mvc.perform(post("/api/users").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"" + email + "\",\"name\":\"" + role + " " + branch + "\",\"role\":\"" + role + "\",\"branches\":[\""
            + branch + "\"],\"temporaryPassword\":\"TempPass1234\"}")).andExpect(status().isCreated()).andReturn();
    return json.readTree(r.getResponse().getContentAsString()).get("id").asText();
  }

  private ResultActions call(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder req, String token, String body)
      throws Exception {
    req.header("Authorization", token);
    if (body != null) req.contentType(MediaType.APPLICATION_JSON).content(body);
    return mvc.perform(req);
  }

  private JsonNode ok(ResultActions r) throws Exception {
    return json.readTree(r.andExpect(status().is2xxSuccessful()).andReturn().getResponse().getContentAsString());
  }

  private JsonNode body(ResultActions r) throws Exception {
    return json.readTree(r.andReturn().getResponse().getContentAsString());
  }

  @BeforeAll
  void setUp() throws Exception {
    admin = login("admin@test.local", "AdminPass123");
    db.sql("insert into department (id, branch_id, name) values ('CL-GM', 'BR1', 'General medicine') on conflict do nothing").update();
    String docUser = user("cl-doc@test.local", "doctor", "BR1");
    String docUser2 = user("cl-doc2@test.local", "doctor", "BR1");
    db.sql("insert into doctor (id, branch_id, dept_id, user_id, name) values ('CL-D1', 'BR1', 'CL-GM', ?::uuid, 'Dr. Meena')")
        .param(docUser).update();
    db.sql("insert into doctor (id, branch_id, dept_id, user_id, name) values ('CL-D2', 'BR1', 'CL-GM', ?::uuid, 'Dr. Arun')")
        .param(docUser2).update();
    user("cl-nurse@test.local", "nurse", "BR1");
    user("cl-pharm@test.local", "pharmacist", "BR1");
    user("cl-br2@test.local", "doctor", "BR2");
    user("cl-desk@test.local", "receptionist", "BR1");
    doctor = firstLogin("cl-doc@test.local");
    doctor2 = firstLogin("cl-doc2@test.local");
    nurse = firstLogin("cl-nurse@test.local");
    pharmacist = firstLogin("cl-pharm@test.local");
    otherBranch = firstLogin("cl-br2@test.local");
    desk = firstLogin("cl-desk@test.local");
    patientId = ok(call(post("/api/patients"), admin, """
        {"name":"Selvi Murugan","dob":"1972-03-02","gender":"Female","mobile":"+91 90000 22222","consent":"Given","branchId":"BR1",
         "allergies":["Penicillin"],"conditions":["Type 2 diabetes"],"history":"Diabetes for 8 years","medications":"Metformin 500"}"""))
        .get("id").asText();
  }

  private JsonNode open(String token, String doctorId) throws Exception {
    return ok(call(post("/api/clinical/consultations"), token, "{\"patientId\":\"" + patientId + "\",\"doctorId\":\"" + doctorId + "\"}"));
  }

  private static final String AMOX = """
      {"medId":"M010","name":"Mox 500","generic":"Amoxicillin","strength":"500 mg","dose":"1 cap","route":"Oral",
       "frequency":"Three times daily (1-1-1)","duration":"5 days","qty":15,"food":"After food"}""";
  private static final String PCM = """
      {"medId":"M001","name":"Dolo 650","generic":"Paracetamol","strength":"650 mg","dose":"1 tab","route":"Oral",
       "frequency":"As needed (SOS)","duration":"3 days","qty":6,"food":"After food"}""";

  @Test
  void fullConsultationFlowWithAllergyOverride() throws Exception {
    var c = open(doctor, "CL-D1").get("consultation");
    String id = c.get("id").asText();
    assertThat(c.get("status").asText()).isEqualTo("Draft");
    assertThat(c.get("template").asText()).isEqualTo("Diabetes care");
    assertThat(c.get("allergyNote").asText()).isEqualTo("Penicillin");
    assertThat(c.get("pmh").asText()).isEqualTo("Diabetes for 8 years");
    // Opening again returns the same draft.
    assertThat(open(doctor, "CL-D1").get("consultation").get("id").asText()).isEqualTo(id);

    // Nurse records vitals but cannot edit notes.
    var afterVitals = ok(call(post("/api/clinical/consultations/" + id + "/vitals"), nurse,
        "{\"bp\":\"148/92\",\"hr\":84,\"temp\":98.6,\"rr\":16,\"spo2\":97,\"height\":158,\"weight\":71.5}")).get("consultation");
    assertThat(afterVitals.get("vitals").get("bp").asText()).isEqualTo("148/92");
    call(put("/api/clinical/consultations/" + id), nurse, "{\"version\":1,\"cc\":\"x\"}").andExpect(status().isForbidden());
    call(post("/api/clinical/consultations/" + id + "/vitals"), nurse, "{\"bp\":\"148-92\"}").andExpect(status().isBadRequest());

    // Doctor saves notes, diagnoses and a draft prescription with amoxicillin.
    var saved = ok(call(put("/api/clinical/consultations/" + id), doctor, """
        {"version":1,"cc":"Fever and sore throat","exam":"Tonsils enlarged","dx":[{"code":"J02.9","label":"Acute pharyngitis, unspecified"},
         {"code":"j02.9","label":"duplicate"}],"plan":"Antibiotic course","followUpDate":"2026-11-11","followUp":"Review in 1 week",
         "prescription":{"items":[%s,%s]}}""".formatted(AMOX, PCM)));
    var cons = saved.get("consultation");
    assertThat(cons.get("version").asInt()).isEqualTo(2);
    assertThat(cons.get("dx")).hasSize(1);
    assertThat(saved.get("prescription").get("status").asText()).isEqualTo("Draft");
    assertThat(saved.get("prescription").get("items")).hasSize(2);
    assertThat(saved.get("prescription").get("diagnosis").asText()).isEqualTo("Acute pharyngitis, unspecified");
    assertThat(saved.get("alerts").get(0).get("code").asText()).isEqualTo("allergy:penicillin:amoxicillin");

    // Stale version is refused.
    call(put("/api/clinical/consultations/" + id), doctor, "{\"version\":1,\"cc\":\"stale\"}").andExpect(status().isConflict());
    // Another doctor cannot write this doctor's consultation.
    call(put("/api/clinical/consultations/" + id), doctor2, "{\"version\":2,\"cc\":\"x\"}").andExpect(status().isForbidden());
    // Reception cannot read clinical notes; another branch cannot see it.
    call(get("/api/clinical/consultations/" + id), desk, null).andExpect(status().isForbidden());
    call(get("/api/clinical/consultations/" + id), otherBranch, null).andExpect(status().isNotFound());

    // Completing without an override reason is blocked and changes nothing.
    var blocked = body(call(post("/api/clinical/consultations/" + id + "/complete"), doctor, "{\"version\":2}")
        .andExpect(status().isUnprocessableEntity()));
    assertThat(blocked.get("alerts").get(0).get("kind").asText()).isEqualTo("Allergy");
    var still = ok(call(get("/api/clinical/consultations/" + id), doctor, null));
    assertThat(still.get("consultation").get("status").asText()).isEqualTo("Draft");
    assertThat(still.get("prescription").get("status").asText()).isEqualTo("Draft");

    // With a reason it completes and the prescription goes to the pharmacy.
    var done = ok(call(post("/api/clinical/consultations/" + id + "/complete"), doctor,
        "{\"version\":2,\"overrideReason\":\"Tolerated amoxicillin in 2024, rash history unclear\"}"));
    assertThat(done.get("consultation").get("status").asText()).isEqualTo("Completed");
    var rx = done.get("prescription");
    assertThat(rx.get("status").asText()).isEqualTo("Sent to pharmacy");
    assertThat(rx.get("overrides").get(0).get("code").asText()).isEqualTo("allergy:penicillin:amoxicillin");
    assertThat(db.sql("select count(*) from audit_log where entity = 'Prescription' and action = 'Overrode safety alert' and entity_id = ?")
        .param(rx.get("id").asText()).query(Integer.class).single()).isEqualTo(1);
    assertThat(db.sql("select count(*) from audit_log where entity = 'Consultation' and action = 'Viewed' and entity_id = ?")
        .param(id).query(Integer.class).single()).isGreaterThanOrEqualTo(1);

    // Signed records are read-only.
    call(put("/api/clinical/consultations/" + id), doctor, "{\"version\":3,\"cc\":\"late edit\"}").andExpect(status().isConflict());
    call(put("/api/clinical/prescriptions/" + rx.get("id").asText()), doctor, "{\"version\":2,\"items\":[]}").andExpect(status().isConflict());

    // Pharmacy sees it in its queue and the dispensing API moves it on.
    var queue = ok(call(get("/api/clinical/prescriptions?status=Sent to pharmacy"), pharmacist, null));
    assertThat(queue.findValuesAsText("id")).contains(rx.get("id").asText());
    call(post("/api/clinical/prescriptions"), pharmacist, "{\"patientId\":\"" + patientId + "\",\"doctorId\":\"CL-D1\"}")
        .andExpect(status().isForbidden());
    UUID rxId = UUID.fromString(rx.get("id").asText());
    assertThat(prescriptions.markDispensed(rxId, true).status()).isEqualTo("Partially dispensed");
    assertThat(prescriptions.markDispensed(rxId, false).status()).isEqualTo("Dispensed");
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> prescriptions.markDispensed(rxId, false))
        .isInstanceOf(ApiException.class);

    // A new visit prefills height and weight from this one.
    var next = open(doctor, "CL-D1").get("consultation");
    assertThat(next.get("id").asText()).isNotEqualTo(id);
    assertThat(next.get("vitals").get("weight").decimalValue()).isEqualByComparingTo("71.5");
    var history = ok(call(get("/api/clinical/consultations?patientId=" + patientId + "&status=Completed"), doctor, null));
    assertThat(history).hasSize(1);
  }

  @Test
  void standalonePrescriptionSignsWithoutAlertsAndChecksPreview() throws Exception {
    var rx = ok(call(post("/api/clinical/prescriptions"), doctor2, """
        {"patientId":"%s","doctorId":"CL-D2","diagnosis":"Fever","items":[%s]}""".formatted(patientId, PCM)));
    String id = rx.get("id").asText();
    var signed = ok(call(post("/api/clinical/prescriptions/" + id + "/sign"), doctor2, "{\"version\":1}"));
    assertThat(signed.get("status").asText()).isEqualTo("Signed");
    var sent = ok(call(post("/api/clinical/prescriptions/" + id + "/send"), doctor2, "{\"version\":2}"));
    assertThat(sent.get("status").asText()).isEqualTo("Sent to pharmacy");

    var alerts = ok(call(post("/api/clinical/prescriptions/check"), doctor2, """
        {"patientId":"%s","items":[{"name":"Clopilet","generic":"Clopidogrel"},{"name":"Omez","generic":"Omeprazole"},
         {"name":"Augmentin","generic":"Amoxicillin + Clavulanic acid"}]}""".formatted(patientId)));
    assertThat(alerts.findValuesAsText("kind")).contains("Interaction", "Allergy");

    // An empty draft cannot be signed; a doctor cannot prescribe as someone else.
    var empty = ok(call(post("/api/clinical/prescriptions"), doctor2,
        "{\"patientId\":\"" + patientId + "\",\"doctorId\":\"CL-D2\",\"items\":[]}"));
    call(post("/api/clinical/prescriptions/" + empty.get("id").asText() + "/sign"), doctor2, "{\"version\":1}")
        .andExpect(status().isBadRequest());
    call(post("/api/clinical/prescriptions"), doctor2, "{\"patientId\":\"" + patientId + "\",\"doctorId\":\"CL-D1\",\"items\":[]}")
        .andExpect(status().isForbidden());
  }
}
