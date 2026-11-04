package com.hospitos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
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
// Close this context afterwards so suites that run later start from a clean schema (they expect fresh UHIDs).
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class PharmacyLabTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired JdbcClient db;

  String admin, pharm1, pharm2, nurse1, lab1, lab2, desk1;
  String patient, newMed;

  private JsonNode body(MvcResult r) throws Exception { return json.readTree(r.getResponse().getContentAsString()); }

  private String login(String email, String pw) throws Exception {
    var res = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"" + email + "\",\"password\":\"" + pw + "\"}")).andExpect(status().isOk()).andReturn();
    return "Bearer " + body(res).get("token").asText();
  }

  /** Creates an account, signs in with the temporary password and changes it, returning the new token. */
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

  private int stock(String token, String med, String branch) throws Exception {
    return body(mvc.perform(as(get("/api/pharmacy/medicines/" + med + "?branchId=" + branch), token)).andExpect(status().isOk()).andReturn())
        .get("stock").asInt();
  }

  /** A signed prescription that has been sent to the pharmacy, written straight to the clinical module's tables. */
  private UUID sentToPharmacy(String branch, String patientId, String doctorId, String[] meds, int[] qty) {
    UUID rx = db.sql("insert into prescription (branch_id, patient_id, doctor_id, status) values (?, ?, ?, 'Sent to pharmacy') returning id")
        .params(branch, patientId, doctorId).query(UUID.class).single();
    for (int i = 0; i < meds.length; i++)
      db.sql("insert into prescription_item (prescription_id, position, medicine_id, name, qty) values (?, ?, ?, ?, ?)")
          .params(rx, i + 1, meds[i], meds[i], qty[i]).update();
    return rx;
  }

  private String rxStatus(UUID rx) {
    return db.sql("select status from prescription where id = ?").param(rx).query(String.class).single();
  }

  @BeforeAll
  void setUp() throws Exception {
    admin = login("admin@test.local", "AdminPass123");
    pharm1 = staff("pl-pharm1@test.local", "pharmacist", "BR1");
    pharm2 = staff("pl-pharm2@test.local", "pharmacist", "BR2");
    nurse1 = staff("pl-nurse1@test.local", "nurse", "BR1");
    lab1 = staff("pl-lab1@test.local", "lab-tech", "BR1");
    lab2 = staff("pl-lab2@test.local", "lab-tech", "BR2");
    desk1 = staff("pl-desk1@test.local", "receptionist", "BR1");
    db.sql("insert into department (id, branch_id, name) values ('DP1', 'BR1', 'General medicine') on conflict do nothing").update();
    db.sql("insert into doctor (id, branch_id, dept_id, name) values ('D01', 'BR1', 'DP1', 'Dr. Test Doctor') on conflict do nothing").update();
    patient = body(mvc.perform(as(post("/api/patients"), desk1).content("""
        {"name":"Sample Patient","dob":"1980-02-03","gender":"Male","mobile":"+91 90000 22222","consent":"Given"}"""))
        .andExpect(status().isCreated()).andReturn()).get("id").asText();
  }

  // ---------- pharmacy ----------

  @Test @Order(1)
  void formularyAndStockAreScopedToBranches() throws Exception {
    var list = body(mvc.perform(as(get("/api/pharmacy/medicines"), pharm1)).andExpect(status().isOk()).andReturn());
    assertThat(list.size()).isEqualTo(50);
    assertThat(list.get(0).get("branchId").asText()).isEqualTo("BR1");
    var mox = body(mvc.perform(as(get("/api/pharmacy/medicines/M007"), pharm1)).andReturn());
    assertThat(mox.get("stock").asInt()).isEqualTo(38);
    assertThat(mox.get("batches").get(0).get("batch").asText()).isEqualTo("MOX2411");

    mvc.perform(as(get("/api/pharmacy/medicines?branchId=BR1"), pharm2)).andExpect(status().isForbidden());
    mvc.perform(as(get("/api/pharmacy/medicines?q=calpol"), pharm1)).andExpect(jsonPath("$.length()").value(2));
    mvc.perform(as(get("/api/pharmacy/medicines/M007/fefo?qty=37"), pharm1))
        .andExpect(jsonPath("$[0].batch").value("MOX2411")).andExpect(jsonPath("$[0].take").value(36))
        .andExpect(jsonPath("$[1].take").value(1));
    mvc.perform(as(get("/api/lab/tests"), pharm1)).andExpect(status().isForbidden());
  }

  @Test @Order(2)
  void catalogueChangesNeedPharmacyStaffAndTheCurrentVersion() throws Exception {
    String in = """
        {"generic":"Cetirizine","brand":"Testcet","strength":"10 mg","form":"Tablet","category":"Antihistamine","price":2.5,"reorder":50}""";
    mvc.perform(as(post("/api/pharmacy/medicines"), nurse1).content(in)).andExpect(status().isForbidden());
    var m = body(mvc.perform(as(post("/api/pharmacy/medicines"), pharm1).content(in)).andExpect(status().isCreated()).andReturn());
    newMed = m.get("id").asText();
    assertThat(newMed).matches("M\\d{3}");
    assertThat(m.get("gstPct").decimalValue()).isEqualByComparingTo("12");
    String upd = in.replace("2.5", "2.8").replace("}", ",\"version\":1}");
    mvc.perform(as(put("/api/pharmacy/medicines/" + newMed), pharm1).content(upd)).andExpect(jsonPath("$.price").value(2.8));
    mvc.perform(as(put("/api/pharmacy/medicines/" + newMed), pharm1).content(upd)).andExpect(status().isConflict());
  }

  @Test @Order(3)
  void receiveAdjustAndTransferWriteStockMovements() throws Exception {
    mvc.perform(as(post("/api/pharmacy/medicines/" + newMed + "/batches"), pharm1)
        .content("{\"batch\":\"tst01\",\"expiry\":\"2020-01-01\",\"qty\":100}")).andExpect(status().isUnprocessableEntity());
    var m = body(mvc.perform(as(post("/api/pharmacy/medicines/" + newMed + "/batches"), pharm1)
        .content("{\"batch\":\"tst01\",\"expiry\":\"2030-01-01\",\"qty\":100,\"supplierId\":\"SP1\",\"cost\":1.8,\"ref\":\"PO-1\"}"))
        .andExpect(status().isCreated()).andReturn());
    assertThat(m.get("stock").asInt()).isEqualTo(100);
    String batchId = m.get("batches").get(0).get("id").asText();
    assertThat(m.get("batches").get(0).get("batch").asText()).isEqualTo("TST01");

    mvc.perform(as(post("/api/pharmacy/stock/adjust"), pharm1)
        .content("{\"batchId\":\"" + batchId + "\",\"delta\":-101,\"note\":\"Count\"}")).andExpect(status().isUnprocessableEntity());
    mvc.perform(as(post("/api/pharmacy/stock/adjust"), pharm2)
        .content("{\"batchId\":\"" + batchId + "\",\"delta\":-1,\"note\":\"Count\"}")).andExpect(status().isNotFound());
    mvc.perform(as(post("/api/pharmacy/stock/adjust"), pharm1)
        .content("{\"batchId\":\"" + batchId + "\",\"delta\":-2,\"note\":\"Damaged\"}")).andExpect(jsonPath("$.stock").value(98));

    mvc.perform(as(post("/api/pharmacy/stock/transfer"), pharm1)
        .content("{\"medicineId\":\"" + newMed + "\",\"toBranchId\":\"BR2\",\"qty\":500}")).andExpect(status().isUnprocessableEntity());
    mvc.perform(as(post("/api/pharmacy/stock/transfer"), pharm1)
        .content("{\"medicineId\":\"" + newMed + "\",\"toBranchId\":\"BR2\",\"qty\":30}")).andExpect(jsonPath("$.stock").value(68));
    assertThat(stock(pharm2, newMed, "BR2")).isEqualTo(30);

    var moves = body(mvc.perform(as(get("/api/pharmacy/stock/moves?medicineId=" + newMed), pharm1)).andReturn());
    assertThat(moves.size()).isEqualTo(3);
    assertThat(moves.get(0).get("kind").asText()).isEqualTo("Transfer");
    assertThat(moves.get(0).get("qty").asInt()).isEqualTo(-30);
    assertThat(moves.get(2).get("kind").asText()).isEqualTo("Receipt");
  }

  @Test @Order(4)
  void dispensingTakesFirstExpiryStockBillsAndUpdatesThePrescription() throws Exception {
    UUID rx = sentToPharmacy("BR1", patient, "D01", new String[] {"M001", "M007"}, new int[] {10, 50});
    String in = "{\"prescriptionId\":\"" + rx + "\",\"payMode\":\"UPI\",\"counselled\":true,\"lines\":[%s]}";

    mvc.perform(as(post("/api/pharmacy/dispense"), nurse1).content(in.formatted("{\"medicineId\":\"M001\",\"qty\":10}")))
        .andExpect(status().isForbidden());
    mvc.perform(as(post("/api/pharmacy/dispense"), pharm2).content(in.formatted("{\"medicineId\":\"M001\",\"qty\":10}")))
        .andExpect(status().isNotFound());
    mvc.perform(as(post("/api/pharmacy/dispense"), pharm1).content(in.formatted("{\"medicineId\":\"M002\",\"qty\":1}")))
        .andExpect(status().isBadRequest());
    mvc.perform(as(post("/api/pharmacy/dispense"), pharm1).content(in.formatted("{\"medicineId\":\"M001\",\"qty\":11}")))
        .andExpect(status().isUnprocessableEntity());
    // A substitute must have the same generic.
    mvc.perform(as(post("/api/pharmacy/dispense"), pharm1).content(in.formatted("{\"medicineId\":\"M002\",\"qty\":5,\"substitutedFor\":\"M001\"}")))
        .andExpect(status().isUnprocessableEntity());

    int calpolBefore = stock(pharm1, "M001", "BR1");
    var res = body(mvc.perform(as(post("/api/pharmacy/dispense"), pharm1)
        .content(in.formatted("{\"medicineId\":\"M001\",\"qty\":10},{\"medicineId\":\"M007\",\"qty\":50}")))
        .andExpect(status().isCreated()).andReturn());
    // Only 38 Mox are in stock, so the prescription is partly dispensed, earliest expiry batch first.
    assertThat(res.get("status").asText()).isEqualTo("Partially dispensed");
    assertThat(res.get("lines").get(1).get("qty").asInt()).isEqualTo(38);
    assertThat(res.get("lines").get(1).get("batches").get(0).get("batch").asText()).isEqualTo("MOX2411");
    // 10 x 2.20 x 1.12 + 38 x 7.40 x 1.12 (Mox price from the sample formulary)
    var moxPrice = db.sql("select price from medicine where id = 'M007'").query(java.math.BigDecimal.class).single();
    var expected = new java.math.BigDecimal("2.20").multiply(java.math.BigDecimal.TEN).add(moxPrice.multiply(java.math.BigDecimal.valueOf(38)))
        .multiply(new java.math.BigDecimal("1.12"));
    assertThat(res.get("total").decimalValue().subtract(expected).abs()).isLessThan(java.math.BigDecimal.ONE);
    assertThat(res.get("invoiceNumber").asText()).isNotBlank();
    assertThat(res.get("lowStock").toString()).contains("M007");
    assertThat(rxStatus(rx)).isEqualTo("Partially dispensed");
    assertThat(stock(pharm1, "M001", "BR1")).isEqualTo(calpolBefore - 10);
    assertThat(stock(pharm1, "M007", "BR1")).isZero();

    mvc.perform(as(get("/api/pharmacy/prescriptions/" + rx + "/remaining"), pharm1))
        .andExpect(jsonPath("$.M001").value(0)).andExpect(jsonPath("$.M007").value(12));
    mvc.perform(as(post("/api/pharmacy/dispense"), pharm1).content(in.formatted("{\"medicineId\":\"M001\",\"qty\":1}")))
        .andExpect(status().isUnprocessableEntity());
    mvc.perform(as(post("/api/pharmacy/dispense"), pharm1).content(in.formatted("{\"medicineId\":\"M007\",\"qty\":12}")))
        .andExpect(status().isUnprocessableEntity());
    mvc.perform(as(get("/api/pharmacy/dispenses"), pharm1)).andExpect(jsonPath("$.length()").value(1))
        .andExpect(jsonPath("$[0].patientName").value("Sample Patient"));
    assertThat(db.sql("select count(*) from audit_log where action = 'Dispensed' and branch_id = 'BR1'").query(Integer.class).single()).isEqualTo(1);
  }

  // ---------- laboratory ----------

  @Test @Order(10)
  void labOrderRunsFromSampleToVerifiedReport() throws Exception {
    mvc.perform(as(post("/api/lab/orders"), lab1).content("{\"patientId\":\"" + patient + "\",\"testIds\":[\"NOPE\"]}"))
        .andExpect(status().isBadRequest());
    mvc.perform(as(post("/api/lab/orders"), lab2).content("{\"patientId\":\"" + patient + "\",\"testIds\":[\"L08\"]}"))
        .andExpect(status().isBadRequest());
    var o = body(mvc.perform(as(post("/api/lab/orders"), nurse1)
        .content("{\"patientId\":\"" + patient + "\",\"doctorId\":\"D01\",\"testIds\":[\"L08\",\"L02\"],\"priority\":\"Urgent\"}"))
        .andExpect(status().isCreated()).andReturn());
    String id = o.get("id").asText();
    assertThat(id).matches("LO\\d{5}");
    assertThat(o.get("status").asText()).isEqualTo("Awaiting sample");
    assertThat(o.get("billed").asBoolean()).isTrue();
    assertThat(o.get("doctorName").asText()).isEqualTo("Dr. Test Doctor");
    assertThat(o.get("testIds").toString()).isEqualTo("[\"L08\",\"L02\"]");

    mvc.perform(as(get("/api/lab/orders/" + id), lab2)).andExpect(status().isNotFound());
    mvc.perform(as(post("/api/lab/orders/" + id + "/receive"), lab1)).andExpect(status().isConflict());
    var c = body(mvc.perform(as(post("/api/lab/orders/" + id + "/collect"), lab1)).andExpect(status().isOk()).andReturn());
    String sample = c.get("sampleId").asText();
    assertThat(sample).matches("SMP\\d{6}");
    mvc.perform(as(post("/api/lab/orders/" + id + "/collect"), lab1)).andExpect(status().isConflict());
    mvc.perform(as(get("/api/lab/scan/" + sample.toLowerCase()), lab1)).andExpect(jsonPath("$.id").value(id));

    // Reject and recollect.
    mvc.perform(as(post("/api/lab/orders/" + id + "/reject"), lab1).content("{\"reason\":\"Haemolysed\"}"))
        .andExpect(jsonPath("$.status").value("Awaiting sample")).andExpect(jsonPath("$.sampleId").doesNotExist());
    mvc.perform(as(post("/api/lab/orders/" + id + "/collect"), lab1)).andExpect(status().isOk());
    var r = body(mvc.perform(as(post("/api/lab/orders/" + id + "/receive"), lab1)).andExpect(jsonPath("$.status").value("Processing")).andReturn());
    int v = r.get("version").asInt();

    String partial = "{\"version\":" + v + ",\"submit\":true,\"results\":{\"L02\":{\"Glucose, fasting\":96}}}";
    mvc.perform(as(put("/api/lab/orders/" + id + "/results"), lab1).content(partial)).andExpect(status().isUnprocessableEntity());
    mvc.perform(as(put("/api/lab/orders/" + id + "/results"), lab1)
        .content("{\"version\":" + v + ",\"results\":{\"L02\":{\"Sugar\":96}}}")).andExpect(status().isBadRequest());
    var draft = body(mvc.perform(as(put("/api/lab/orders/" + id + "/results"), lab1).content(partial.replace("true", "false")))
        .andExpect(jsonPath("$.status").value("Processing")).andReturn());
    mvc.perform(as(put("/api/lab/orders/" + id + "/results"), lab1).content(partial.replace("true", "false")))
        .andExpect(status().isConflict());
    String full = """
        {"version":%d,"submit":true,"comments":"Sample fine","results":{"L02":{"Glucose, fasting":96},
         "L08":{"Urea":48,"Creatinine":1.6,"Uric acid":6.8,"Sodium":136,"Potassium":6.2}}}""".formatted(draft.get("version").asInt());
    var ready = body(mvc.perform(as(put("/api/lab/orders/" + id + "/results"), lab1).content(full))
        .andExpect(jsonPath("$.status").value("Result ready")).andReturn());
    assertThat(ready.get("flags").get("L08").get("Potassium").asText()).isEqualTo("C");
    assertThat(ready.get("flags").get("L08").get("Creatinine").asText()).isEqualTo("H");
    assertThat(ready.get("flags").get("L02").get("Glucose, fasting").asText()).isEqualTo("N");

    mvc.perform(as(post("/api/lab/orders/" + id + "/verify"), nurse1)).andExpect(status().isForbidden());
    mvc.perform(as(post("/api/lab/orders/" + id + "/reopen"), lab1)).andExpect(jsonPath("$.status").value("Processing"));
    var again = body(mvc.perform(as(get("/api/lab/orders/" + id), lab1)).andReturn());
    mvc.perform(as(put("/api/lab/orders/" + id + "/results"), lab1).content(full.replace("\"version\":" + draft.get("version").asInt(),
        "\"version\":" + again.get("version").asInt()))).andExpect(status().isOk());
    var verified = body(mvc.perform(as(post("/api/lab/orders/" + id + "/verify"), lab1)).andExpect(status().isOk()).andReturn());
    assertThat(verified.get("order").get("status").asText()).isEqualTo("Verified");
    assertThat(verified.get("criticals").size()).isEqualTo(1);
    assertThat(verified.get("criticals").get(0).get("flag").asText()).isEqualTo("Critical high");
    mvc.perform(as(put("/api/lab/orders/" + id + "/results"), lab1).content(full)).andExpect(status().isConflict());
    mvc.perform(as(post("/api/lab/orders/" + id + "/deliver"), lab1)).andExpect(jsonPath("$.status").value("Delivered"));
    assertThat(db.sql("select count(*) from audit_log where action = 'Critical value'").query(Integer.class).single()).isEqualTo(1);

    // A later order's report shows this one's values as the previous result.
    String id2 = body(mvc.perform(as(post("/api/lab/orders"), lab1)
        .content("{\"patientId\":\"" + patient + "\",\"testIds\":[\"L08\"],\"bill\":false}")).andReturn()).get("id").asText();
    var rep = body(mvc.perform(as(get("/api/lab/orders/" + id2 + "/report"), lab1)).andExpect(status().isOk()).andReturn());
    assertThat(rep.get("patient").get("name").asText()).isEqualTo("Sample Patient");
    assertThat(rep.get("order").get("billed").asBoolean()).isFalse();
    var potassium = rep.get("tests").get(0).get("params").get(4);
    assertThat(potassium.get("name").asText()).isEqualTo("Potassium");
    assertThat(potassium.get("previous").decimalValue()).isEqualByComparingTo("6.2");

    mvc.perform(as(get("/api/lab/orders?status=Delivered"), lab1)).andExpect(jsonPath("$.length()").value(1));
    mvc.perform(as(get("/api/lab/orders?patientId=" + patient), lab1)).andExpect(jsonPath("$.length()").value(2));
    mvc.perform(as(get("/api/lab/orders"), lab2)).andExpect(jsonPath("$.length()").value(0));
    mvc.perform(as(get("/api/lab/orders?q=sample"), lab1)).andExpect(jsonPath("$.length()").value(2));
  }
}
