package com.hospitos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
class RadiologyTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired JdbcClient db;

  String admin, rad1, rad2, nurse1, desk1, doc1;
  String patient, allergic;
  final String tomorrow = LocalDate.now(ZoneId.of("Asia/Kolkata")).plusDays(1).toString();

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

  @BeforeAll
  void setUp() throws Exception {
    admin = login("admin@test.local", "AdminPass123");
    rad1 = staff("rd-rad1@test.local", "radiologist", "BR1");
    rad2 = staff("rd-rad2@test.local", "radiologist", "BR2");
    nurse1 = staff("rd-nurse1@test.local", "nurse", "BR1");
    desk1 = staff("rd-desk1@test.local", "receptionist", "BR1");
    doc1 = staff("rd-doc1@test.local", "doctor", "BR1");
    db.sql("insert into department (id, branch_id, name) values ('DP1', 'BR1', 'General medicine') on conflict do nothing").update();
    db.sql("insert into doctor (id, branch_id, dept_id, name) values ('D01', 'BR1', 'DP1', 'Dr. Test Doctor') on conflict do nothing").update();
    patient = body(mvc.perform(as(post("/api/patients"), desk1).content("""
        {"name":"Imaging Patient","dob":"1975-04-05","gender":"Female","mobile":"+91 90000 33333","consent":"Given"}"""))
        .andExpect(status().isCreated()).andReturn()).get("id").asText();
    allergic = body(mvc.perform(as(post("/api/patients"), desk1).content("""
        {"name":"Allergic Patient","dob":"1960-01-02","gender":"Male","mobile":"+91 90000 44444","consent":"Given","allergies":["Iodinated contrast"]}"""))
        .andExpect(status().isCreated()).andReturn()).get("id").asText();
  }

  @Test @Order(1)
  void catalogueAndRoomsAreScopedToBranches() throws Exception {
    var studies = body(mvc.perform(as(get("/api/radiology/studies"), nurse1)).andExpect(status().isOk()).andReturn());
    assertThat(studies.size()).isEqualTo(18);
    mvc.perform(as(get("/api/radiology/rooms"), rad1)).andExpect(jsonPath("$.length()").value(5));
    mvc.perform(as(get("/api/radiology/rooms"), rad2)).andExpect(jsonPath("$.length()").value(3));
    mvc.perform(as(get("/api/radiology/rooms?branchId=BR1"), rad2)).andExpect(jsonPath("$.length()").value(0));
    mvc.perform(as(get("/api/radiology/schedule?branchId=BR1&date=" + tomorrow), rad2)).andExpect(status().isForbidden());
  }

  @Test @Order(2)
  void studyRunsFromOrderToVerifiedReport() throws Exception {
    mvc.perform(as(post("/api/radiology/orders"), desk1).content("{\"patientId\":\"" + patient + "\",\"studyId\":\"NOPE\"}"))
        .andExpect(status().isBadRequest());
    mvc.perform(as(post("/api/radiology/orders"), rad2).content("{\"patientId\":\"" + patient + "\",\"studyId\":\"R01\"}"))
        .andExpect(status().isBadRequest());
    var o = body(mvc.perform(as(post("/api/radiology/orders"), doc1)
        .content("{\"patientId\":\"" + patient + "\",\"doctorId\":\"D01\",\"studyId\":\"R06\",\"priority\":\"Urgent\"}"))
        .andExpect(status().isCreated()).andReturn());
    String id = o.get("id").asText();
    assertThat(id).matches("IM\\d{5}");
    assertThat(o.get("status").asText()).isEqualTo("Ordered");
    assertThat(o.get("modality").asText()).isEqualTo("Ultrasound");
    assertThat(o.get("price").decimalValue()).isEqualByComparingTo("1500");
    assertThat(o.get("billed").asBoolean()).isTrue();
    assertThat(o.get("invoiceNumber").asText()).isNotBlank();
    assertThat(o.get("doctorName").asText()).isEqualTo("Dr. Test Doctor");
    mvc.perform(as(get("/api/radiology/orders/" + id), rad2)).andExpect(status().isNotFound());

    // Scheduling: unscheduled studies cannot start; the ultrasound goes to the first free room.
    mvc.perform(as(post("/api/radiology/orders/" + id + "/start"), rad1)).andExpect(status().isConflict());
    mvc.perform(as(put("/api/radiology/orders/" + id + "/schedule"), nurse1)
        .content("{\"date\":\"" + tomorrow + "\",\"slot\":\"10:00\",\"version\":" + o.get("version").asInt() + "}")).andExpect(status().isForbidden());
    mvc.perform(as(put("/api/radiology/orders/" + id + "/schedule"), desk1)
        .content("{\"date\":\"2020-01-01\",\"slot\":\"10:00\",\"version\":" + o.get("version").asInt() + "}")).andExpect(status().isBadRequest());
    mvc.perform(as(put("/api/radiology/orders/" + id + "/schedule"), desk1)
        .content("{\"date\":\"" + tomorrow + "\",\"slot\":\"10:00\",\"room\":\"CT-1\",\"version\":" + o.get("version").asInt() + "}"))
        .andExpect(status().isBadRequest());
    var s = body(mvc.perform(as(put("/api/radiology/orders/" + id + "/schedule"), desk1)
        .content("{\"date\":\"" + tomorrow + "\",\"slot\":\"10:00\",\"version\":" + o.get("version").asInt() + "}"))
        .andExpect(status().isOk()).andReturn());
    assertThat(s.get("status").asText()).isEqualTo("Scheduled");
    assertThat(s.get("room").asText()).isEqualTo("US-1");
    assertThat(s.get("slot").asText()).isEqualTo("10:00");
    // A stale version is refused.
    mvc.perform(as(put("/api/radiology/orders/" + id + "/schedule"), desk1)
        .content("{\"date\":\"" + tomorrow + "\",\"slot\":\"11:00\",\"version\":" + o.get("version").asInt() + "}")).andExpect(status().isConflict());

    // Two more 20-minute ultrasounds at 10:10: the first takes US-2, the second finds every room booked.
    var b = body(mvc.perform(as(post("/api/radiology/orders"), desk1).content("{\"patientId\":\"" + patient
        + "\",\"studyId\":\"R08\",\"date\":\"" + tomorrow + "\",\"slot\":\"10:10\",\"bill\":false}")).andExpect(status().isCreated()).andReturn());
    assertThat(b.get("room").asText()).isEqualTo("US-2");
    assertThat(b.get("billed").asBoolean()).isFalse();
    mvc.perform(as(post("/api/radiology/orders"), desk1).content("{\"patientId\":\"" + patient
        + "\",\"studyId\":\"R09\",\"date\":\"" + tomorrow + "\",\"slot\":\"10:10\",\"bill\":false}")).andExpect(status().isConflict());
    mvc.perform(as(post("/api/radiology/orders"), desk1).content("{\"patientId\":\"" + patient
        + "\",\"studyId\":\"R09\",\"date\":\"" + tomorrow + "\",\"slot\":\"10:15\",\"room\":\"US-1\",\"bill\":false}")).andExpect(status().isConflict());
    var c = body(mvc.perform(as(post("/api/radiology/orders"), desk1).content("{\"patientId\":\"" + patient
        + "\",\"studyId\":\"R09\",\"date\":\"" + tomorrow + "\",\"slot\":\"10:20\",\"room\":\"US-1\",\"bill\":false}"))
        .andExpect(status().isCreated()).andReturn());
    assertThat(c.get("room").asText()).isEqualTo("US-1");
    mvc.perform(as(get("/api/radiology/schedule?branchId=BR1&date=" + tomorrow), desk1)).andExpect(jsonPath("$.length()").value(3));

    // Scan, then report.
    mvc.perform(as(post("/api/radiology/orders/" + id + "/start"), nurse1)).andExpect(status().isForbidden());
    var st = body(mvc.perform(as(post("/api/radiology/orders/" + id + "/start"), rad1).content("{\"technician\":\"Sharmila (sonographer)\"}"))
        .andExpect(status().isOk()).andReturn());
    assertThat(st.get("status").asText()).isEqualTo("In progress");
    assertThat(st.get("technician").asText()).isEqualTo("Sharmila (sonographer)");
    mvc.perform(as(put("/api/radiology/orders/" + id + "/schedule"), desk1)
        .content("{\"date\":\"" + tomorrow + "\",\"slot\":\"12:00\",\"version\":" + st.get("version").asInt() + "}")).andExpect(status().isConflict());
    mvc.perform(as(put("/api/radiology/orders/" + id + "/report"), rad1)
        .content("{\"findings\":\"x\",\"impression\":\"y\",\"version\":" + st.get("version").asInt() + ",\"submit\":true}")).andExpect(status().isConflict());
    var aq = body(mvc.perform(as(post("/api/radiology/orders/" + id + "/acquire"), rad1)).andExpect(status().isOk()).andReturn());
    assertThat(aq.get("status").asText()).isEqualTo("Awaiting report");
    int v = aq.get("version").asInt();
    mvc.perform(as(put("/api/radiology/orders/" + id + "/report"), rad1)
        .content("{\"findings\":\"Liver normal.\",\"version\":" + v + ",\"submit\":true}")).andExpect(status().isUnprocessableEntity());
    var draft = body(mvc.perform(as(put("/api/radiology/orders/" + id + "/report"), rad1)
        .content("{\"findings\":\"Liver normal.\",\"version\":" + v + ",\"submit\":false}")).andExpect(status().isOk()).andReturn());
    assertThat(draft.get("status").asText()).isEqualTo("Awaiting report");
    assertThat(draft.get("findings").asText()).isEqualTo("Liver normal.");
    mvc.perform(as(put("/api/radiology/orders/" + id + "/report"), rad1)
        .content("{\"findings\":\"Liver normal.\",\"impression\":\"Normal\",\"version\":" + v + ",\"submit\":true}")).andExpect(status().isConflict());
    mvc.perform(as(get("/api/radiology/orders/" + id + "/report"), rad1)).andExpect(status().isConflict());
    var rep = body(mvc.perform(as(put("/api/radiology/orders/" + id + "/report"), rad1)
        .content("{\"findings\":\"Liver normal in size.\",\"impression\":\"Normal study.\",\"version\":" + draft.get("version").asInt() + ",\"submit\":true}"))
        .andExpect(status().isOk()).andReturn());
    assertThat(rep.get("status").asText()).isEqualTo("Reported");
    assertThat(rep.get("radiologist").asText()).isEqualTo("radiologist BR1");
    mvc.perform(as(post("/api/radiology/orders/" + id + "/verify"), doc1)).andExpect(status().isForbidden());
    mvc.perform(as(post("/api/radiology/orders/" + id + "/reopen"), rad1)).andExpect(jsonPath("$.status").value("Awaiting report"));
    var again = body(mvc.perform(as(get("/api/radiology/orders/" + id), rad1)).andReturn());
    mvc.perform(as(put("/api/radiology/orders/" + id + "/report"), rad1)
        .content("{\"findings\":\"Liver normal in size.\",\"impression\":\"Normal study.\",\"version\":" + again.get("version").asInt() + ",\"submit\":true}"))
        .andExpect(status().isOk());
    var ver = body(mvc.perform(as(post("/api/radiology/orders/" + id + "/verify"), rad1)).andExpect(status().isOk()).andReturn());
    assertThat(ver.get("status").asText()).isEqualTo("Verified");
    assertThat(ver.get("verifiedBy").asText()).isEqualTo("radiologist BR1");
    mvc.perform(as(post("/api/radiology/orders/" + id + "/verify"), rad1)).andExpect(status().isConflict());
    mvc.perform(as(post("/api/radiology/orders/" + id + "/cancel"), rad1).content("{\"reason\":\"x\"}")).andExpect(status().isConflict());
    var r = body(mvc.perform(as(get("/api/radiology/orders/" + id + "/report"), doc1)).andExpect(status().isOk()).andReturn());
    assertThat(r.get("patient").get("name").asText()).isEqualTo("Imaging Patient");
    assertThat(r.get("order").get("impression").asText()).isEqualTo("Normal study.");

    // Lists.
    mvc.perform(as(get("/api/radiology/orders?status=Verified"), rad1)).andExpect(jsonPath("$.length()").value(1));
    mvc.perform(as(get("/api/radiology/orders?modality=Ultrasound&date=" + tomorrow), rad1)).andExpect(jsonPath("$.length()").value(3));
    mvc.perform(as(get("/api/radiology/orders?q=thyroid"), rad1)).andExpect(jsonPath("$.length()").value(1));
    mvc.perform(as(get("/api/radiology/orders"), rad2)).andExpect(jsonPath("$.length()").value(0));
  }

  @Test @Order(3)
  void freeTextStudiesUseTheCatalogueOrTheModalityRate() throws Exception {
    var a = body(mvc.perform(as(post("/api/radiology/orders"), doc1)
        .content("{\"patientId\":\"" + patient + "\",\"modality\":\"CT\",\"study\":\"ct brain plain\"}")).andExpect(status().isCreated()).andReturn());
    assertThat(a.get("studyId").asText()).isEqualTo("R11");
    assertThat(a.get("price").decimalValue()).isEqualByComparingTo("3500");
    var b = body(mvc.perform(as(post("/api/radiology/orders"), doc1)
        .content("{\"patientId\":\"" + patient + "\",\"modality\":\"X-ray\",\"study\":\"X-ray wrist PA\"}")).andExpect(status().isCreated()).andReturn());
    assertThat(b.has("studyId")).isFalse();
    assertThat(b.get("price").decimalValue()).isEqualByComparingTo("450");
    assertThat(b.get("durationMin").asInt()).isEqualTo(15);
    mvc.perform(as(post("/api/radiology/orders"), doc1).content("{\"patientId\":\"" + patient + "\",\"modality\":\"PET\",\"study\":\"PET scan\"}"))
        .andExpect(status().isBadRequest());
    mvc.perform(as(post("/api/radiology/orders"), doc1).content("{\"patientId\":\"" + patient + "\",\"modality\":\"CT\"}"))
        .andExpect(status().isBadRequest());
  }

  @Test @Order(4)
  void contrastStudiesForAllergicPatientsNeedAReason() throws Exception {
    mvc.perform(as(post("/api/radiology/orders"), doc1).content("{\"patientId\":\"" + allergic + "\",\"studyId\":\"R13\"}"))
        .andExpect(status().isUnprocessableEntity());
    mvc.perform(as(post("/api/radiology/orders"), doc1).content("{\"patientId\":\"" + allergic + "\",\"modality\":\"MRI\",\"study\":\"MRI pelvis with contrast\"}"))
        .andExpect(status().isUnprocessableEntity());
    mvc.perform(as(post("/api/radiology/orders"), doc1).content("{\"patientId\":\"" + allergic + "\",\"studyId\":\"R11\"}"))
        .andExpect(status().isCreated());
    var o = body(mvc.perform(as(post("/api/radiology/orders"), doc1)
        .content("{\"patientId\":\"" + allergic + "\",\"studyId\":\"R13\",\"contrastOverride\":\"Premedication protocol given\"}"))
        .andExpect(status().isCreated()).andReturn());
    assertThat(o.get("contrast").asBoolean()).isTrue();
    assertThat(o.get("contrastOverride").asText()).isEqualTo("Premedication protocol given");
    int overrides = db.sql("select count(*) from audit_log where action = 'Override' and entity_id = ?").param(o.get("id").asText()).query(Integer.class).single();
    assertThat(overrides).isEqualTo(1);
  }

  @Test @Order(5)
  void billedStudiesAreCancelledOnlyAfterTheirInvoice() throws Exception {
    var o = body(mvc.perform(as(post("/api/radiology/orders"), desk1)
        .content("{\"patientId\":\"" + patient + "\",\"studyId\":\"R15\",\"date\":\"" + tomorrow + "\",\"slot\":\"15:00\"}")).andExpect(status().isCreated()).andReturn());
    String id = o.get("id").asText();
    assertThat(o.get("status").asText()).isEqualTo("Scheduled");
    assertThat(o.get("room").asText()).isEqualTo("MR-1");
    mvc.perform(as(post("/api/radiology/orders/" + id + "/cancel"), nurse1).content("{\"reason\":\"Patient declined\"}")).andExpect(status().isForbidden());
    mvc.perform(as(post("/api/radiology/orders/" + id + "/cancel"), desk1).content("{\"reason\":\"Patient declined\"}")).andExpect(status().isConflict());
    mvc.perform(as(post("/api/billing/invoices/" + o.get("invoiceId").asText() + "/cancel"), admin).content("{\"reason\":\"Study cancelled\"}"))
        .andExpect(status().isOk());
    var c = body(mvc.perform(as(post("/api/radiology/orders/" + id + "/cancel"), desk1).content("{\"reason\":\"Patient declined\"}"))
        .andExpect(status().isOk()).andReturn());
    assertThat(c.get("status").asText()).isEqualTo("Cancelled");
    // The slot is free again.
    mvc.perform(as(post("/api/radiology/orders"), desk1)
        .content("{\"patientId\":\"" + patient + "\",\"studyId\":\"R16\",\"date\":\"" + tomorrow + "\",\"slot\":\"15:10\",\"bill\":false}"))
        .andExpect(status().isCreated());
  }
}
