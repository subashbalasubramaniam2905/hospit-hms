package com.hospitos.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hospitos.CleanDatabase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(CleanDatabase.class)
// Billing creates patients and users; close the context afterwards so the next test class starts from a clean schema.
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class BillingTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired JdbcClient db;

  private String admin, cashier, cashier2, nurse;
  private static int seq;

  private String login(String email, String pw) throws Exception {
    var res = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"" + email + "\",\"password\":\"" + pw + "\"}")).andExpect(status().isOk()).andReturn();
    return "Bearer " + json.readTree(res.getResponse().getContentAsString()).get("token").asText();
  }

  private String user(String role, String branch) throws Exception {
    String email = "bill-" + role + "-" + branch.toLowerCase() + "@test.local";
    boolean exists = db.sql("select count(*) > 0 from app_user where lower(email) = ?").param(email).query(Boolean.class).single();
    if (exists) return login(email, "RealPass5678");
    mvc.perform(post("/api/users").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON)
          .content("{\"email\":\"" + email + "\",\"name\":\"" + role + " " + branch + "\",\"role\":\"" + role + "\",\"branches\":[\"" + branch
              + "\"],\"temporaryPassword\":\"TempPass1234\"}")).andExpect(status().isCreated());
    String temp = login(email, "TempPass1234");
    var r = mvc.perform(post("/api/auth/password").header("Authorization", temp).contentType(MediaType.APPLICATION_JSON)
        .content("{\"currentPassword\":\"TempPass1234\",\"newPassword\":\"RealPass5678\"}")).andExpect(status().isOk()).andReturn();
    return "Bearer " + json.readTree(r.getResponse().getContentAsString()).get("token").asText();
  }

  private ResultActions send(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder b, String token, String body) throws Exception {
    return mvc.perform(b.header("Authorization", token).contentType(MediaType.APPLICATION_JSON).content(body == null ? "" : body));
  }

  private JsonNode body(ResultActions r) throws Exception { return json.readTree(r.andReturn().getResponse().getContentAsString()); }

  private String patient(String token) throws Exception {
    seq++;
    return body(send(post("/api/patients"), token, """
        {"name":"Bill Patient %d","dob":"1985-02-01","gender":"Male","mobile":"+91 98000 0%04d","consent":"Given",
         "address":{"line":"1 Bazaar St","city":"Udumalpet","state":"Tamil Nadu","pin":"642126"}}""".formatted(seq, seq))
        .andExpect(status().isCreated())).get("id").asText();
  }

  @BeforeEach
  void setUp() throws Exception {
    admin = login("admin@test.local", "AdminPass123");
    cashier = user("billing", "BR1");
    cashier2 = user("billing", "BR2");
    nurse = user("nurse", "BR1");
  }

  @Test
  void invoiceWithGstPaymentsRefundAndReceipts() throws Exception {
    String pid = patient(admin);
    var inv = body(send(post("/api/billing/invoices"), cashier, """
        {"patientId":"%s","kind":"OPD","discountPct":5,"lines":[
          {"tariffCode":"CON-GEN","qty":1,"refType":"CONSULTATION","refId":"c-1"},
          {"tariffCode":"LAB-CBC","qty":1},
          {"description":"Paracetamol 650 strip","category":"PHARMACY","qty":2,"rate":"30.50"},
          {"tariffCode":"OTH-CERT","qty":1}]}""".formatted(pid)).andExpect(status().isCreated()));
    // 500 + 350 exempt; pharmacy 61 @12%; certificate 300 @18%; all less 5%.
    assertThat(inv.get("number").asText()).matches("INV-\\d{4}-\\d{6}");
    assertThat(inv.get("gstin").asText()).isEqualTo("33AAACH0000A1ZY");
    assertThat(inv.get("subtotal").decimalValue()).isEqualByComparingTo("1211");
    assertThat(inv.get("discountAmount").decimalValue()).isEqualByComparingTo("60.55");
    // pharmacy taxable 57.95 -> 6% = 3.48 each; certificate taxable 285 -> 9% = 25.65 each
    assertThat(inv.get("cgst").decimalValue()).isEqualByComparingTo("29.13");
    assertThat(inv.get("sgst").decimalValue()).isEqualByComparingTo("29.13");
    assertThat(inv.get("total").decimalValue()).isEqualByComparingTo("1209");
    assertThat(inv.get("status").asText()).isEqualTo("UNPAID");
    assertThat(inv.get("lines").get(2).get("hsnSac").asText()).isEqualTo("3004");
    assertThat(inv.get("lines").get(0).get("taxPct").decimalValue()).isEqualByComparingTo("0");
    String id = inv.get("id").asText();

    // Overpayment is refused, part payment works and issues a receipt.
    send(post("/api/billing/invoices/" + id + "/payments"), cashier, "{\"mode\":\"UPI\",\"amount\":5000}").andExpect(status().isUnprocessableEntity());
    var after = body(send(post("/api/billing/invoices/" + id + "/payments"), cashier, "{\"mode\":\"UPI\",\"amount\":1000,\"reference\":\"UPI123\"}")
        .andExpect(status().isCreated()));
    assertThat(after.get("status").asText()).isEqualTo("PARTIALLY_PAID");
    assertThat(after.get("due").decimalValue()).isEqualByComparingTo("209");
    assertThat(after.get("payments").get(0).get("receiptNumber").asText()).matches("RCT-\\d{4}-\\d{6}");
    after = body(send(post("/api/billing/invoices/" + id + "/payments"), cashier, "{\"mode\":\"CASH\",\"amount\":209}"));
    assertThat(after.get("status").asText()).isEqualTo("PAID");

    // Refunds need a reason and cannot exceed what was paid.
    send(post("/api/billing/invoices/" + id + "/refunds"), cashier, "{\"amount\":100,\"reason\":\"\"}").andExpect(status().isBadRequest());
    send(post("/api/billing/invoices/" + id + "/refunds"), cashier, "{\"amount\":2000,\"reason\":\"x\"}").andExpect(status().isUnprocessableEntity());
    after = body(send(post("/api/billing/invoices/" + id + "/refunds"), cashier, "{\"amount\":350,\"reason\":\"CBC cancelled\"}").andExpect(status().isCreated()));
    assertThat(after.get("status").asText()).isEqualTo("PARTIALLY_PAID");
    assertThat(after.get("payments").get(2).get("receiptNumber").asText()).startsWith("RFD-");

    mvc.perform(get("/api/billing/billed?refType=CONSULTATION&refIds=c-1,c-2").header("Authorization", cashier))
        .andExpect(jsonPath("$.length()").value(1)).andExpect(jsonPath("$[0]").value("c-1"));
    mvc.perform(get("/api/billing/summary").header("Authorization", cashier))
        .andExpect(jsonPath("$.collectedToday").value(1209.0)).andExpect(jsonPath("$.refundsThisMonth").value(350.0))
        .andExpect(jsonPath("$.byModeToday.UPI").value(1000.0)).andExpect(jsonPath("$.last7Days.length()").value(7));
    mvc.perform(get("/api/billing/invoices?q=" + pid).header("Authorization", cashier)).andExpect(jsonPath("$[0].id").value(id));
    assertThat(db.sql("select count(*) from audit_log where entity in ('Invoice','Payment')").query(Integer.class).single()).isGreaterThanOrEqualTo(4);
  }

  @Test
  void branchesRolesAndDiscountLimits() throws Exception {
    String pid = patient(admin);
    String line = "\"lines\":[{\"tariffCode\":\"PRC-ECG\",\"qty\":1}]";
    // Other branch cannot see or bill it; nurses cannot use billing.
    send(post("/api/billing/invoices"), cashier2, "{\"patientId\":\"" + pid + "\",\"kind\":\"OPD\",\"branchId\":\"BR1\"," + line + "}").andExpect(status().isForbidden());
    send(post("/api/billing/invoices"), nurse, "{\"patientId\":\"" + pid + "\",\"kind\":\"OPD\"," + line + "}").andExpect(status().isForbidden());
    // Big discount needs an admin.
    send(post("/api/billing/invoices"), cashier, "{\"patientId\":\"" + pid + "\",\"kind\":\"OPD\",\"discountPct\":25," + line + "}").andExpect(status().isForbidden());
    String id = body(send(post("/api/billing/invoices"), admin, "{\"patientId\":\"" + pid + "\",\"kind\":\"OPD\",\"discountPct\":25," + line + "}")
        .andExpect(status().isCreated())).get("id").asText();
    mvc.perform(get("/api/billing/invoices/" + id).header("Authorization", cashier)).andExpect(jsonPath("$.total").value(300.0));
    mvc.perform(get("/api/billing/invoices/" + id).header("Authorization", cashier2)).andExpect(status().isNotFound());
    mvc.perform(get("/api/billing/invoices").header("Authorization", cashier2)).andExpect(jsonPath("$[?(@.id == '" + id + "')]").isEmpty());
    // Unknown tariff and empty invoices are rejected.
    send(post("/api/billing/invoices"), cashier, "{\"patientId\":\"" + pid + "\",\"kind\":\"OPD\",\"lines\":[{\"tariffCode\":\"NOPE\",\"qty\":1}]}").andExpect(status().isUnprocessableEntity());
    send(post("/api/billing/invoices"), cashier, "{\"patientId\":\"" + pid + "\",\"kind\":\"OPD\",\"lines\":[]}").andExpect(status().isBadRequest());

    // Cancel: cashier no, admin yes when unpaid; paid invoices must be refunded first.
    send(post("/api/billing/invoices/" + id + "/cancel"), cashier, "{\"reason\":\"wrong patient\"}").andExpect(status().isForbidden());
    send(post("/api/billing/invoices/" + id + "/payments"), cashier, "{\"mode\":\"CASH\",\"amount\":100}").andExpect(status().isCreated());
    send(post("/api/billing/invoices/" + id + "/cancel"), admin, "{\"reason\":\"wrong patient\"}").andExpect(status().isUnprocessableEntity());
    send(post("/api/billing/invoices/" + id + "/refunds"), cashier, "{\"amount\":100,\"reason\":\"wrong patient\"}").andExpect(status().isCreated());
    send(post("/api/billing/invoices/" + id + "/cancel"), admin, "{\"reason\":\"wrong patient\"}")
        .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CANCELLED")).andExpect(jsonPath("$.due").value(0.0));
    send(post("/api/billing/invoices/" + id + "/payments"), cashier, "{\"mode\":\"CASH\",\"amount\":10}").andExpect(status().isUnprocessableEntity());
  }

  @Test
  void tariffIncludesDoctorsAndIsEditableByAdmins() throws Exception {
    mvc.perform(get("/api/billing/tariff?q=ecg").header("Authorization", cashier)).andExpect(jsonPath("$[0].code").value("PRC-ECG"))
        .andExpect(jsonPath("$[0].effectiveTaxPct").value(0.0));
    String body = "{\"code\":\"prc-test\",\"name\":\"Test procedure\",\"category\":\"PROCEDURE\",\"price\":999}";
    send(post("/api/billing/tariff"), cashier, body).andExpect(status().isForbidden());
    var t = body(send(post("/api/billing/tariff"), admin, body).andExpect(status().isCreated()));
    assertThat(t.get("code").asText()).isEqualTo("PRC-TEST");
    send(post("/api/billing/tariff"), admin, body).andExpect(status().isConflict());
    String upd = "{\"code\":\"PRC-TEST\",\"name\":\"Test procedure\",\"category\":\"PROCEDURE\",\"price\":1200,\"version\":1}";
    send(put("/api/billing/tariff/" + t.get("id").asText()), admin, upd).andExpect(status().isOk()).andExpect(jsonPath("$.price").value(1200.0));
    send(put("/api/billing/tariff/" + t.get("id").asText()), admin, upd).andExpect(status().isConflict());
    send(post("/api/billing/tariff"), admin, body.replace("prc-test", "DOC-1")).andExpect(status().isUnprocessableEntity());
    int doctors = db.sql("select count(*) from doctor where active").query(Integer.class).single();
    var docs = body(mvc.perform(get("/api/billing/tariff?category=CONSULTATION").header("Authorization", cashier)));
    int fromDoctor = 0;
    for (var x : docs) if (x.get("fromDoctor").asBoolean()) fromDoctor++;
    assertThat(fromDoctor).isEqualTo(doctors);
  }

  @Test
  void settingsValidateGstinAndAreAdminOnly() throws Exception {
    var s = body(mvc.perform(get("/api/billing/settings").header("Authorization", cashier)));
    assertThat(s.get("settings").get("sampleData").asBoolean()).isTrue();
    int v = s.get("settings").get("version").asInt();
    String good = """
        {"legalName":"Real Hospital Pvt Ltd","tradeName":"Real Hospital","gstin":"33AAACH0000A1ZY","stateCode":"33","stateName":"Tamil Nadu",
         "address":"Udumalpet","version":%d}""".formatted(v);
    send(put("/api/billing/settings"), cashier, good).andExpect(status().isForbidden());
    send(put("/api/billing/settings"), admin, good.replace("1ZY", "1Z5")).andExpect(status().isUnprocessableEntity());
    send(put("/api/billing/settings"), admin, good).andExpect(status().isOk()).andExpect(jsonPath("$.sampleData").value(false));
    send(put("/api/billing/settings"), admin, good).andExpect(status().isConflict());
    send(put("/api/billing/tax-rates/PHARMACY"), admin, "{\"gstPct\":5,\"hsnSac\":\"3004\"}").andExpect(status().isOk());
    String pid = patient(admin);
    var inv = body(send(post("/api/billing/invoices"), cashier, "{\"patientId\":\"" + pid + "\",\"kind\":\"PHARMACY\",\"lines\":[{\"description\":\"Syrup\",\"category\":\"PHARMACY\",\"qty\":1,\"rate\":100}]}"));
    assertThat(inv.get("total").decimalValue()).isEqualByComparingTo("105");
    send(put("/api/billing/tax-rates/PHARMACY"), admin, "{\"gstPct\":12,\"hsnSac\":\"3004\"}").andExpect(status().isOk());
  }

  @Test
  void claimWorkflowSettlesIntoTheInvoice() throws Exception {
    String pid = patient(admin);
    var inv = body(send(post("/api/billing/invoices"), cashier, "{\"patientId\":\"" + pid + "\",\"kind\":\"IPD\",\"lines\":[{\"tariffCode\":\"ROOM-PVT\",\"qty\":4}]}"));
    String invId = inv.get("id").asText();
    var c = body(send(post("/api/billing/claims"), cashier, "{\"invoiceId\":\"" + invId + "\",\"providerId\":\"IP2\",\"policyNo\":\"POL-1\",\"documents\":[\"Invoice\"]}")
        .andExpect(status().isCreated()));
    assertThat(c.get("claimed").decimalValue()).isEqualByComparingTo("16200"); // 18,000 less 10% co-pay
    assertThat(c.get("status").asText()).isEqualTo("DRAFT");
    String cid = c.get("id").asText();
    send(post("/api/billing/claims"), cashier, "{\"invoiceId\":\"" + invId + "\",\"providerId\":\"IP2\",\"policyNo\":\"POL-1\"}").andExpect(status().isConflict());
    mvc.perform(get("/api/billing/invoices/" + invId).header("Authorization", cashier)).andExpect(jsonPath("$.claimNumber").value(c.get("number").asText()));

    String st = "{\"status\":\"%s\",\"version\":%d%s}";
    send(post("/api/billing/claims/" + cid + "/status"), cashier, st.formatted("SUBMITTED", 1, "")).andExpect(status().isUnprocessableEntity()); // 1 doc
    c = body(send(put("/api/billing/claims/" + cid + "/documents"), cashier, "{\"documents\":[\"Invoice\",\"Doctor notes\"],\"version\":1}"));
    c = body(send(post("/api/billing/claims/" + cid + "/status"), cashier, st.formatted("SUBMITTED", c.get("version").asInt(), "")).andExpect(status().isOk()));
    send(post("/api/billing/claims/" + cid + "/status"), cashier, st.formatted("SETTLED", c.get("version").asInt(), "")).andExpect(status().isUnprocessableEntity());
    c = body(send(post("/api/billing/claims/" + cid + "/status"), cashier, st.formatted("UNDER_REVIEW", c.get("version").asInt(), "")));
    send(post("/api/billing/claims/" + cid + "/status"), cashier, st.formatted("APPROVED", c.get("version").asInt(), ",\"approved\":20000")).andExpect(status().isUnprocessableEntity());
    c = body(send(post("/api/billing/claims/" + cid + "/status"), cashier, st.formatted("APPROVED", c.get("version").asInt(), ",\"approved\":15000")));
    mvc.perform(get("/api/billing/summary").header("Authorization", cashier)).andExpect(jsonPath("$.insuranceReceivable").isNumber());
    c = body(send(post("/api/billing/claims/" + cid + "/status"), cashier, st.formatted("SETTLED", c.get("version").asInt(), ",\"settlementRef\":\"UTR998\""))
        .andExpect(status().isOk()));
    assertThat(c.get("history").size()).isEqualTo(5);
    var after = body(mvc.perform(get("/api/billing/invoices/" + invId).header("Authorization", cashier)));
    assertThat(after.get("paid").decimalValue()).isEqualByComparingTo("15000");
    assertThat(after.get("due").decimalValue()).isEqualByComparingTo("3000");
    assertThat(after.get("payments").get(0).get("mode").asText()).isEqualTo("INSURANCE");
    // Manual "insurance" payments are not allowed; they come from settlement.
    send(post("/api/billing/invoices/" + invId + "/payments"), cashier, "{\"mode\":\"INSURANCE\",\"amount\":10}").andExpect(status().isUnprocessableEntity());
    // Claims are for the insurance desk, not other branches.
    mvc.perform(get("/api/billing/claims/" + cid).header("Authorization", cashier2)).andExpect(status().isNotFound());
    mvc.perform(get("/api/billing/claims").header("Authorization", nurse)).andExpect(status().isForbidden());
  }
}
