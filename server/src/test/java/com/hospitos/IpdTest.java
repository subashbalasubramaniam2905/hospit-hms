package com.hospitos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hospitos.appointments.TestClock;
import java.time.Clock;
import java.time.Duration;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
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
@Import({CleanDatabase.class, IpdTest.Clocks.class})
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class IpdTest {
  static final ZoneId IST = ZoneId.of("Asia/Kolkata");
  static final ZonedDateTime START = ZonedDateTime.of(2026, 11, 5, 10, 0, 0, 0, IST);

  @TestConfiguration
  static class Clocks {
    @Bean @Primary
    Clock testClock() { return new TestClock(START); }
  }

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired JdbcClient db;
  @Autowired Clock clock;

  String admin, desk1, nurse1, nurse2, doctor1, billing1;
  String p1, p2, p3, adm;

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

  private String patient(String name, String mobile) throws Exception {
    return body(mvc.perform(as(post("/api/patients"), desk1).content("{\"name\":\"" + name + "\",\"dob\":\"1970-05-06\",\"gender\":\"Female\","
        + "\"mobile\":\"" + mobile + "\",\"consent\":\"Given\"}")).andExpect(status().isCreated()).andReturn()).get("id").asText();
  }

  private String bedStatus(String bed) {
    return db.sql("select status from bed where id = ?").param(bed).query(String.class).single();
  }

  private void at(int day, int hour) { ((TestClock) clock).set(START.plusDays(day).withHour(hour)); }

  @BeforeAll
  void setUp() throws Exception {
    admin = login("admin@test.local", "AdminPass123");
    desk1 = staff("ipd-desk1@test.local", "receptionist", "BR1");
    nurse1 = staff("ipd-nurse1@test.local", "nurse", "BR1");
    nurse2 = staff("ipd-nurse2@test.local", "nurse", "BR2");
    doctor1 = staff("ipd-doc1@test.local", "doctor", "BR1");
    billing1 = staff("ipd-bill1@test.local", "billing", "BR1");
    db.sql("insert into department (id, branch_id, name) values ('DP1', 'BR1', 'General medicine') on conflict do nothing").update();
    db.sql("insert into doctor (id, branch_id, dept_id, name) values ('D01', 'BR1', 'DP1', 'Dr. Test Doctor') on conflict do nothing").update();
    p1 = patient("Inpatient One", "+91 90000 33331");
    p2 = patient("Inpatient Two", "+91 90000 33332");
    p3 = patient("Insured Three", "+91 90000 33333");
    db.sql("update patient set insurance = '{\"providerId\":\"IP1\",\"policyNo\":\"POL-778\"}'::jsonb where id = ?").param(p3).update();
  }

  @Test @Order(1)
  void wardsAndBedsAreScopedToBranches() throws Exception {
    mvc.perform(as(get("/api/ipd/wards"), nurse1)).andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(5))
        .andExpect(jsonPath("$[0].name").value("General ward A"));
    mvc.perform(as(get("/api/ipd/beds"), nurse1)).andExpect(jsonPath("$.length()").value(20))
        .andExpect(jsonPath("$[0].label").value("GA-01")).andExpect(jsonPath("$[0].status").value("Available"));
    mvc.perform(as(get("/api/ipd/beds"), nurse2)).andExpect(jsonPath("$.length()").value(45));
    mvc.perform(as(get("/api/ipd/beds?branchId=BR1"), nurse2)).andExpect(status().isForbidden());
    mvc.perform(as(post("/api/ipd/wards"), nurse1).content("{\"name\":\"X\",\"type\":\"General\",\"rate\":100}")).andExpect(status().isForbidden());

    var w = body(mvc.perform(as(post("/api/ipd/wards"), admin).content("{\"name\":\"Day care\",\"type\":\"General\",\"rate\":900,\"branchId\":\"BR1\"}"))
        .andExpect(status().isCreated()).andReturn());
    mvc.perform(as(post("/api/ipd/wards/" + w.get("id").asText() + "/beds"), admin).content("{\"label\":\"dc-01\"}"))
        .andExpect(status().isCreated()).andExpect(jsonPath("$.label").value("DC-01"));
    mvc.perform(as(post("/api/ipd/wards/" + w.get("id").asText() + "/beds"), admin).content("{\"label\":\"DC-01\"}")).andExpect(status().isConflict());

    mvc.perform(as(post("/api/ipd/beds/BR1-W1-B3/status"), nurse1).content("{\"status\":\"Cleaning\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("Cleaning"));
    mvc.perform(as(post("/api/ipd/beds/BR1-W1-B3/status"), nurse1).content("{\"status\":\"Occupied\"}")).andExpect(status().isBadRequest());
  }

  @Test @Order(2)
  void admitsToAFreeBedWithAnAdvance() throws Exception {
    String req = "{\"patientId\":\"" + p1 + "\",\"doctorId\":\"D01\",\"bedId\":\"BR1-W1-B1\",\"type\":\"Planned\",\"reason\":\"Community-acquired pneumonia\","
        + "\"expectedDischarge\":\"2026-11-08\",\"advance\":10000,\"advanceMode\":\"UPI\",\"advanceReference\":\"UPI-1\",\"consent\":%s}";
    mvc.perform(as(post("/api/ipd/admissions"), desk1).content(req.formatted("false"))).andExpect(status().isUnprocessableEntity());
    var r = body(mvc.perform(as(post("/api/ipd/admissions"), desk1).content(req.formatted("true"))).andExpect(status().isCreated()).andReturn());
    var a = r.get("admission");
    adm = a.get("id").asText();
    assertThat(adm).isEqualTo("IPD-02500");
    assertThat(a.get("bedLabel").asText()).isEqualTo("GA-01");
    assertThat(a.get("admittedOn").asText()).isEqualTo("2026-11-05 10:00");
    assertThat(a.get("advance").decimalValue()).isEqualByComparingTo("10000");
    assertThat(a.get("deposits").get(0).get("receiptNo").asText()).startsWith("ADV-");
    assertThat(a.get("notes").size()).as("front desk does not get the clinical record").isZero();
    assertThat(bedStatus("BR1-W1-B1")).isEqualTo("Occupied");

    mvc.perform(as(post("/api/ipd/admissions"), desk1).content(req.formatted("true").replace("BR1-W1-B1", "BR1-W1-B2")))
        .andExpect(status().isConflict()).andExpect(jsonPath("$.detail").value("Inpatient One is already admitted"));
    mvc.perform(as(post("/api/ipd/admissions"), desk1).content(req.formatted("true").replace(p1, p2)))
        .andExpect(status().isConflict());
    mvc.perform(as(post("/api/ipd/admissions"), desk1).content(req.formatted("true").replace(p1, p2).replace("BR1-W1-B1", "BR1-W1-B3")))
        .andExpect(status().isConflict()).andExpect(jsonPath("$.detail").value("GA-03 is cleaning. Choose another bed"));
    mvc.perform(as(get("/api/ipd/admissions/" + adm), nurse2)).andExpect(status().isNotFound());

    mvc.perform(as(post("/api/ipd/beds/BR1-W1-B1/status"), nurse1).content("{\"status\":\"Available\"}")).andExpect(status().isConflict());
    mvc.perform(as(get("/api/ipd/admissions"), nurse1)).andExpect(jsonPath("$.length()").value(1))
        .andExpect(jsonPath("$[0].notes[0].text").value("Admitted to GA-01 under Dr. Test Doctor for Community-acquired pneumonia."));
  }

  @Test @Order(3)
  void insuredPatientsGetAPreAuthorisationDraft() throws Exception {
    var r = body(mvc.perform(as(post("/api/ipd/admissions"), desk1).content("{\"patientId\":\"" + p3 + "\",\"doctorId\":\"D01\",\"bedId\":\"BR1-W2-B1\","
        + "\"reason\":\"Knee replacement\",\"expectedDischarge\":\"2026-11-09\",\"consent\":true,\"preauth\":true}")).andExpect(status().isCreated()).andReturn());
    assertThat(r.get("claimNumber").asText()).isNotBlank();
    assertThat(r.get("warning")).isNull();
    var claim = db.sql("select type, claimed, status from billing_claims where patient_id = ?").param(p3).query((rs, i) ->
        rs.getString(1) + " " + rs.getBigDecimal(2).stripTrailingZeros().toPlainString() + " " + rs.getString(3)).single();
    // 4 days x (private room 4500 + nursing 800 + visit 600)
    assertThat(claim).isEqualTo("PRE_AUTHORISATION 23600 DRAFT");

    var r2 = body(mvc.perform(as(post("/api/ipd/admissions"), desk1).content("{\"patientId\":\"" + p2 + "\",\"doctorId\":\"D01\",\"bedId\":\"BR1-W2-B2\","
        + "\"reason\":\"Observation\",\"consent\":true,\"preauth\":true}")).andExpect(status().isCreated()).andReturn());
    assertThat(r2.get("warning").asText()).contains("No insurance details");
  }

  @Test @Order(4)
  void nursesAndDoctorsKeepTheWardRecord() throws Exception {
    String base = "/api/ipd/admissions/" + adm;
    var a = body(mvc.perform(as(post(base + "/obs"), nurse1).content("{\"bp\":\"95/60\",\"hr\":118,\"temp\":101.5,\"spo2\":92,\"rr\":23,\"pain\":4}"))
        .andExpect(status().isOk()).andReturn());
    assertThat(a.get("obs").get(0).get("news").asInt()).isEqualTo(9);
    assertThat(db.sql("select count(*) from audit_log where action = 'Escalation' and entity_id = ?").param(adm).query(Integer.class).single()).isEqualTo(1);
    mvc.perform(as(post(base + "/obs"), nurse1).content("{\"bp\":\"high\",\"hr\":118,\"temp\":101.5,\"spo2\":92,\"rr\":23,\"pain\":4}"))
        .andExpect(status().isBadRequest());

    a = body(mvc.perform(as(post(base + "/mar"), doctor1).content("{\"med\":\"Ceftriaxone 1 g\",\"dose\":\"1 g\",\"route\":\"IV\",\"time\":\"14:00\"}"))
        .andExpect(status().isOk()).andReturn());
    String dose = a.get("mar").get(0).get("id").asText();
    mvc.perform(as(post(base + "/mar/" + dose), nurse1).content("{\"status\":\"Held\"}")).andExpect(status().isUnprocessableEntity());
    mvc.perform(as(post(base + "/mar/" + dose), nurse1).content("{\"status\":\"Given\"}"))
        .andExpect(jsonPath("$.mar[0].status").value("Given")).andExpect(jsonPath("$.mar[0].by").value("nurse BR1"));
    mvc.perform(as(post(base + "/mar/" + dose), nurse1).content("{\"status\":\"Given\"}")).andExpect(status().isConflict());

    mvc.perform(as(post(base + "/notes"), nurse1).content("{\"type\":\"Doctor round\",\"text\":\"Seen\"}")).andExpect(status().isForbidden());
    mvc.perform(as(post(base + "/notes"), desk1).content("{\"type\":\"Progress\",\"text\":\"Seen\"}")).andExpect(status().isForbidden());
    mvc.perform(as(post(base + "/notes"), doctor1).content("{\"type\":\"Doctor round\",\"text\":\"Chest clearer. Continue IV antibiotics.\"}"))
        .andExpect(jsonPath("$.notes[0].type").value("Doctor round"));
    mvc.perform(as(post(base + "/notes"), nurse1).content("{\"type\":\"Handover\",\"text\":\"S: stable\\nB: CAP\\nA: NEWS 2\\nR: obs 4-hourly\"}"))
        .andExpect(status().isOk());
    mvc.perform(as(post(base + "/care-plan"), nurse1).content("{\"text\":\"Monitor vitals every 4 hours\"}"))
        .andExpect(jsonPath("$.carePlan[0]").value("Monitor vitals every 4 hours"));
    mvc.perform(as(post(base + "/io"), nurse1).content("{\"kind\":\"Intake\",\"type\":\"IV fluids\",\"ml\":500}"))
        .andExpect(jsonPath("$.io[0].ml").value(500)).andExpect(jsonPath("$.io[0].time").value("10:00"));

    // Billing staff see the admission but not the clinical record.
    var b = body(mvc.perform(as(get(base), billing1)).andExpect(status().isOk()).andReturn());
    assertThat(b.get("notes").size()).isZero();
    assertThat(b.get("obs").size()).isZero();
    assertThat(b.get("diagnosis").asText()).isEqualTo("Community-acquired pneumonia");
  }

  @Test @Order(5)
  void transfersAndChargesBuildTheRunningBill() throws Exception {
    String base = "/api/ipd/admissions/" + adm;
    at(1, 11); // next day 11:00, moved to ICU
    mvc.perform(as(post(base + "/transfer"), nurse1).content("{\"bedId\":\"BR1-W1-B1\"}")).andExpect(status().isBadRequest());
    mvc.perform(as(post(base + "/transfer"), nurse1).content("{\"bedId\":\"BR1-W2-B1\"}")).andExpect(status().isConflict());
    var a = body(mvc.perform(as(post(base + "/transfer"), nurse1).content("{\"bedId\":\"BR1-W3-B1\"}")).andExpect(status().isOk()).andReturn());
    assertThat(a.get("bedLabel").asText()).isEqualTo("ICU-01");
    assertThat(a.get("notes").get(0).get("text").asText()).isEqualTo("Transferred from GA-01 to ICU-01.");
    assertThat(bedStatus("BR1-W1-B1")).isEqualTo("Cleaning");
    assertThat(bedStatus("BR1-W3-B1")).isEqualTo("Occupied");

    mvc.perform(as(post(base + "/charges"), billing1).content("{\"tariffCode\":\"PRC-ECG\",\"qty\":1}"))
        .andExpect(jsonPath("$.charges[0].description").value("ECG")).andExpect(jsonPath("$.charges[0].rate").value(400));
    mvc.perform(as(post(base + "/charges"), nurse1).content("{\"description\":\"Oxygen therapy (per day)\",\"category\":\"PROCEDURE\",\"qty\":2,\"rate\":500}"))
        .andExpect(status().isOk());
    var bad = body(mvc.perform(as(post(base + "/charges"), nurse1).content("{\"description\":\"Mistake\",\"category\":\"OTHER\",\"qty\":1,\"rate\":50}"))
        .andReturn()).get("charges");
    String wrong = bad.get(bad.size() - 1).get("id").asText();
    mvc.perform(as(delete(base + "/charges/" + wrong), nurse1)).andExpect(status().isForbidden());
    mvc.perform(as(delete(base + "/charges/" + wrong), billing1)).andExpect(jsonPath("$.charges.length()").value(2));
    mvc.perform(as(post(base + "/deposits"), nurse1).content("{\"amount\":5000}")).andExpect(status().isForbidden());

    at(2, 15); // discharged the day after, 15:00: two midnights, one in each ward
    var bill = body(mvc.perform(as(get(base + "/bill"), billing1)).andExpect(status().isOk()).andReturn());
    assertThat(bill.get("days").asInt()).isEqualTo(2);
    var lines = bill.get("lines");
    assertThat(lines.get(0).get("description").asText()).isEqualTo("General ward A bed charges (1 day)");
    assertThat(lines.get(1).get("description").asText()).isEqualTo("ICU bed charges (1 day)");
    assertThat(lines.get(1).get("rate").decimalValue()).isEqualByComparingTo("9000");
    assertThat(lines.get(2).get("tariffCode").asText()).isEqualTo("NUR-DAY");
    assertThat(lines.get(3).get("qty").decimalValue()).as("one doctor round").isEqualByComparingTo("1");
    // 1800 + 9000 + 2 x 800 + 600 + 400 + 2 x 500
    assertThat(bill.get("subtotal").decimalValue()).isEqualByComparingTo("14400");
    assertThat(bill.get("estimatedDue").decimalValue()).isEqualByComparingTo("4400");
  }

  @Test @Order(6)
  void dischargeRaisesTheFinalBillAndAdjustsTheAdvance() throws Exception {
    String base = "/api/ipd/admissions/" + adm;
    String req = "{\"summary\":\"Treated for pneumonia with IV antibiotics. Stable at discharge.\",\"checklist\":[\"Final medicines reconciled\"]}";
    mvc.perform(as(post(base + "/plan-discharge"), nurse1)).andExpect(jsonPath("$.status").value("Discharge planned"));
    mvc.perform(as(post(base + "/discharge"), nurse1).content(req)).andExpect(status().isForbidden());
    mvc.perform(as(post(base + "/discharge"), doctor1).content("{\"summary\":\"Too short\"}")).andExpect(status().isBadRequest());
    var a = body(mvc.perform(as(post(base + "/discharge"), doctor1).content(req)).andExpect(status().isOk()).andReturn());
    assertThat(a.get("status").asText()).isEqualTo("Discharged");
    assertThat(a.get("dischargeDate").asText()).isEqualTo("2026-11-07");
    assertThat(a.get("dischargeChecklist").get(0).asText()).isEqualTo("Final medicines reconciled");
    assertThat(a.get("depositBalance").decimalValue()).isEqualByComparingTo("0");
    assertThat(bedStatus("BR1-W3-B1")).isEqualTo("Cleaning");

    var inv = body(mvc.perform(as(get("/api/billing/invoices/" + a.get("invoiceId").asText()), billing1)).andExpect(status().isOk()).andReturn());
    assertThat(inv.get("kind").asText()).isEqualTo("IPD");
    assertThat(inv.get("admissionRef").asText()).isEqualTo(adm);
    assertThat(inv.get("total").decimalValue()).isEqualByComparingTo("14400");
    assertThat(inv.get("paid").decimalValue()).isEqualByComparingTo("10000");
    assertThat(inv.get("due").decimalValue()).isEqualByComparingTo("4400");

    mvc.perform(as(post(base + "/notes"), doctor1).content("{\"type\":\"Progress\",\"text\":\"Late note\"}")).andExpect(status().isConflict());
    mvc.perform(as(post(base + "/discharge"), doctor1).content(req)).andExpect(status().isConflict());
    mvc.perform(as(post(base + "/refund-deposit"), billing1).content("{}")).andExpect(status().isConflict());
    mvc.perform(as(get("/api/ipd/admissions?status=discharged"), nurse1)).andExpect(jsonPath("$.length()").value(1));
    mvc.perform(as(get("/api/ipd/admissions"), nurse1)).andExpect(jsonPath("$.length()").value(2));

    // The patient can be admitted again, and the cleaned bed reused.
    mvc.perform(as(post("/api/ipd/beds/BR1-W1-B1/status"), nurse1).content("{\"status\":\"Available\"}")).andExpect(status().isOk());
    mvc.perform(as(post("/api/ipd/admissions"), desk1).content("{\"patientId\":\"" + p1 + "\",\"doctorId\":\"D01\",\"bedId\":\"BR1-W1-B1\","
        + "\"type\":\"Day care\",\"reason\":\"Iron infusion\",\"consent\":true}")).andExpect(status().isCreated());
  }

  @Test @Order(7)
  void unusedDepositIsRefundedAfterDischarge() throws Exception {
    // Insured patient: big advance, short stay.
    String id = db.sql("select id from admission where patient_id = ?").param(p3).query(String.class).single();
    String base = "/api/ipd/admissions/" + id;
    mvc.perform(as(post(base + "/deposits"), desk1).content("{\"amount\":50000,\"mode\":\"CARD\"}")).andExpect(jsonPath("$.advance").value(50000));
    at(3, 9);
    var a = body(mvc.perform(as(post(base + "/discharge"), doctor1).content("{\"summary\":\"Planned procedure postponed; discharged for review.\"}"))
        .andExpect(status().isOk()).andReturn());
    // Admitted on day 0 at 10:00, discharged on day 3: 3 days x (4500 + 800)
    assertThat(a.get("depositBalance").decimalValue()).isEqualByComparingTo("34100");
    mvc.perform(as(post(base + "/refund-deposit"), desk1).content("{}")).andExpect(status().isForbidden());
    a = body(mvc.perform(as(post(base + "/refund-deposit"), billing1).content("{\"mode\":\"BANK_TRANSFER\",\"reference\":\"NEFT-9\"}"))
        .andExpect(status().isOk()).andReturn());
    assertThat(a.get("depositBalance").decimalValue()).isEqualByComparingTo("0");
    var kinds = a.get("deposits");
    assertThat(kinds.get(kinds.size() - 1).get("kind").asText()).isEqualTo("REFUND");
    assertThat(kinds.get(kinds.size() - 1).get("amount").decimalValue()).isEqualByComparingTo("34100");
  }
}
