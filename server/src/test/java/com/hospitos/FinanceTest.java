package com.hospitos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.jupiter.api.Test;
import org.springframework.test.annotation.DirtiesContext;
import org.w3c.dom.Element;

/** Hospital expenses and the Tally / Excel export of billing and expenses. */
// Creates patients; close the context afterwards so tests that expect the first patient number start from a clean schema.
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class FinanceTest extends ApiTestBase {
  private static final LocalDate TODAY = LocalDate.now(ZoneId.of("Asia/Kolkata"));
  private static int seq;

  private String expense(String token, String body) throws Exception {
    return send(post("/api/expenses"), token, body).andReturn().getResponse().getContentAsString();
  }

  private String patient() throws Exception {
    seq++;
    return body(send(post("/api/patients"), root, """
        {"name":"Tally Patient %d","dob":"1980-03-01","gender":"Female","mobile":"+91 97000 1%04d","consent":"Given","branchId":"BR1",
         "address":{"line":"2 Market Rd","city":"Udumalpet","state":"Tamil Nadu","pin":"642126"}}""".formatted(seq, seq))
        .andExpect(status().isCreated())).get("id").asText();
  }

  @Test
  void expensesCategoriesRolesAndSummary() throws Exception {
    String accounts = user("fin-billing@test.local", "billing", "[\"BR1\"]");
    String accounts2 = user("fin-billing2@test.local", "billing", "[\"BR2\"]");
    String nurse = user("fin-nurse@test.local", "nurse", "[\"BR1\"]");

    var cats = get("/api/expenses/categories", accounts);
    assertThat(cats.size()).isGreaterThan(20);
    assertThat(cats.toString()).contains("Electricity Charges").contains("Salaries and Wages");

    // A nurse cannot see or record expenses.
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/expenses").header("Authorization", nurse)).andExpect(status().isForbidden());

    // Validation: future dates, GST bigger than the amount, unknown modes.
    send(post("/api/expenses"), accounts, "{\"date\":\"" + TODAY.plusDays(1) + "\",\"categoryId\":\"RENT\",\"payee\":\"Owner\",\"amount\":1000,\"payMode\":\"CASH\"}")
        .andExpect(status().isUnprocessableEntity());
    send(post("/api/expenses"), accounts, "{\"date\":\"" + TODAY + "\",\"categoryId\":\"RENT\",\"payee\":\"Owner\",\"amount\":100,\"gstAmount\":500,\"payMode\":\"CASH\"}")
        .andExpect(status().isUnprocessableEntity());
    send(post("/api/expenses"), accounts, "{\"date\":\"" + TODAY + "\",\"categoryId\":\"RENT\",\"payee\":\"Owner\",\"amount\":100,\"payMode\":\"BARTER\"}")
        .andExpect(status().isBadRequest());

    var e = json.readTree(expense(accounts, "{\"date\":\"" + TODAY + "\",\"categoryId\":\"ELECTRICITY\",\"payee\":\"TANGEDCO\",\"description\":\"Main block\","
        + "\"billNo\":\"EB-7781\",\"amount\":18000,\"payMode\":\"BANK_TRANSFER\",\"reference\":\"NEFT991\"}"));
    assertThat(e.get("number").asText()).matches("EXP-\\d+");
    assertThat(e.get("branchId").asText()).isEqualTo("BR1");
    assertThat(e.get("total").decimalValue()).isEqualByComparingTo("18000");
    String id = e.get("id").asText();

    // Another branch cannot see it, and a stale version is refused.
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/expenses/" + id).header("Authorization", accounts2)).andExpect(status().isNotFound());
    String upd = "{\"date\":\"" + TODAY + "\",\"categoryId\":\"ELECTRICITY\",\"payee\":\"TANGEDCO\",\"amount\":18500,\"payMode\":\"BANK_TRANSFER\",\"version\":%d}";
    send(put("/api/expenses/" + id), accounts, upd.formatted(9)).andExpect(status().isConflict());
    var u = body(send(put("/api/expenses/" + id), accounts, upd.formatted(1)).andExpect(status().isOk()));
    assertThat(u.get("amount").decimalValue()).isEqualByComparingTo("18500");

    // Only managers cancel.
    send(post("/api/expenses/" + id + "/cancel"), accounts, "{\"reason\":\"Duplicate\",\"version\":2}").andExpect(status().isForbidden());

    var unpaid = json.readTree(expense(accounts, "{\"date\":\"" + TODAY + "\",\"categoryId\":\"REPAIRS\",\"payee\":\"Kumar AC Service\",\"amount\":5000,"
        + "\"gstAmount\":900,\"tdsAmount\":100,\"payMode\":\"UNPAID\"}"));
    assertThat(unpaid.get("paid").decimalValue()).isEqualByComparingTo("5800");

    var s = get("/api/expenses/summary?branchId=BR1", accounts);
    assertThat(s.get("thisMonth").decimalValue()).isGreaterThanOrEqualTo(new BigDecimal("24400"));
    assertThat(s.get("unpaidCount").asInt()).isGreaterThanOrEqualTo(1);
    assertThat(s.get("last6Months").size()).isEqualTo(6);
    assertThat(s.get("byCategoryThisMonth").toString()).contains("Electricity");

    var c = body(send(post("/api/expenses/" + id + "/cancel"), root, "{\"reason\":\"Entered twice\",\"version\":2}").andExpect(status().isOk()));
    assertThat(c.get("status").asText()).isEqualTo("CANCELLED");
    send(put("/api/expenses/" + id), accounts, upd.formatted(3)).andExpect(status().isConflict());

    // Categories: managers add and rename; a hidden category cannot take new expenses.
    send(post("/api/expenses/categories"), accounts, "{\"name\":\"Pest control\",\"tallyLedger\":\"Pest Control\",\"tallyGroup\":\"Indirect Expenses\"}").andExpect(status().isForbidden());
    var cat = body(send(post("/api/expenses/categories"), root, "{\"name\":\"Pest control\",\"tallyLedger\":\"Pest Control\",\"tallyGroup\":\"Indirect Expenses\"}")
        .andExpect(status().isCreated()));
    assertThat(cat.get("id").asText()).isEqualTo("PEST_CONTROL");
    send(post("/api/expenses/categories"), root, "{\"name\":\"pest control\",\"tallyLedger\":\"X\",\"tallyGroup\":\"Indirect Expenses\"}").andExpect(status().isConflict());
    send(post("/api/expenses/categories"), root, "{\"name\":\"Odd\",\"tallyLedger\":\"X\",\"tallyGroup\":\"Sundry Debtors\"}").andExpect(status().isBadRequest());
    send(put("/api/expenses/categories/PEST_CONTROL"), root, "{\"name\":\"Pest control\",\"tallyLedger\":\"Pest Control\",\"tallyGroup\":\"Indirect Expenses\",\"active\":false,\"version\":1}")
        .andExpect(status().isOk());
    send(post("/api/expenses"), accounts, "{\"date\":\"" + TODAY + "\",\"categoryId\":\"PEST_CONTROL\",\"payee\":\"X\",\"amount\":100,\"payMode\":\"CASH\"}")
        .andExpect(status().isUnprocessableEntity());
  }

  @Test
  void tallyExportBalancesEveryVoucher() throws Exception {
    String accounts = user("fin-tally@test.local", "billing", "[\"BR1\"]");
    String pid = patient();
    var inv = body(send(post("/api/billing/invoices"), accounts, """
        {"patientId":"%s","kind":"OPD","branchId":"BR1","discountPct":5,"lines":[
          {"tariffCode":"CON-GEN","qty":1},{"description":"Paracetamol 650 strip","category":"PHARMACY","qty":2,"rate":"30.50"},
          {"tariffCode":"OTH-CERT","qty":1}]}""".formatted(pid)).andExpect(status().isCreated()));
    String invNo = inv.get("number").asText(), invId = inv.get("id").asText();
    send(post("/api/billing/invoices/" + invId + "/payments"), accounts, "{\"mode\":\"UPI\",\"amount\":500,\"reference\":\"UPI-1\"}").andExpect(status().isCreated());
    send(post("/api/billing/invoices/" + invId + "/payments"), accounts, "{\"mode\":\"CASH\",\"amount\":100}").andExpect(status().isCreated());
    send(post("/api/billing/invoices/" + invId + "/refunds"), accounts, "{\"amount\":50,\"reason\":\"Certificate not needed\"}").andExpect(status().isCreated());
    var exp = json.readTree(expense(accounts, "{\"date\":\"" + TODAY + "\",\"categoryId\":\"REPAIRS\",\"payee\":\"Sri & Sons <Lifts>\",\"amount\":1001,"
        + "\"gstAmount\":180.18,\"tdsAmount\":20,\"payMode\":\"CHEQUE\",\"reference\":\"CHQ 000123\"}"));
    String expNo = exp.get("number").asText();

    String q = "?from=" + TODAY.withDayOfMonth(1) + "&to=" + TODAY + "&branchId=BR1";
    var p = get("/api/tally/preview" + q, accounts);
    assertThat(p.get("bySource").get("INVOICE").get("count").asInt()).isGreaterThanOrEqualTo(1);
    assertThat(p.get("bySource").get("EXPENSE").get("count").asInt()).isGreaterThanOrEqualTo(1);
    for (JsonNode v : p.get("sample")) {
      BigDecimal sum = BigDecimal.ZERO;
      for (JsonNode e : v.get("entries")) sum = sum.add(e.get("amount").decimalValue());
      assertThat(sum).as("voucher " + v.get("number").asText()).isEqualByComparingTo("0");
    }

    // Other branches' data never leaks, and dates are checked.
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/tally/preview?from=" + TODAY + "&to=" + TODAY + "&branchId=BR2")
        .header("Authorization", accounts)).andExpect(status().isForbidden());
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/tally/preview?from=" + TODAY + "&to=" + TODAY.minusDays(1))
        .header("Authorization", accounts)).andExpect(status().isBadRequest());

    // Vouchers XML parses, each voucher balances, and the invoice is split into income, GST and patient lines.
    var res = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/tally/export" + q + "&format=xml").header("Authorization", accounts))
        .andExpect(status().isOk()).andExpect(header().string("Content-Disposition", org.hamcrest.Matchers.containsString("tally-vouchers-"))).andReturn();
    byte[] xml = res.getResponse().getContentAsByteArray();
    var doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(new ByteArrayInputStream(xml));
    var vouchers = doc.getElementsByTagName("VOUCHER");
    boolean sawInvoice = false, sawExpense = false;
    for (int i = 0; i < vouchers.getLength(); i++) {
      var v = (Element) vouchers.item(i);
      String no = v.getElementsByTagName("VOUCHERNUMBER").item(0).getTextContent();
      var entries = v.getElementsByTagName("ALLLEDGERENTRIES.LIST");
      BigDecimal sum = BigDecimal.ZERO;
      var ledgers = new StringBuilder();
      for (int k = 0; k < entries.getLength(); k++) {
        var e = (Element) entries.item(k);
        BigDecimal amt = new BigDecimal(e.getElementsByTagName("AMOUNT").item(0).getTextContent());
        boolean deemed = e.getElementsByTagName("ISDEEMEDPOSITIVE").item(0).getTextContent().equals("Yes");
        assertThat(deemed).isEqualTo(amt.signum() < 0);
        sum = sum.add(amt);
        ledgers.append(e.getElementsByTagName("LEDGERNAME").item(0).getTextContent()).append('|');
      }
      assertThat(sum).as("voucher " + no).isEqualByComparingTo("0");
      if (no.equals(invNo)) {
        sawInvoice = true;
        assertThat(v.getAttribute("VCHTYPE")).isEqualTo("Sales");
        assertThat(v.getAttribute("REMOTEID")).isEqualTo("hospitos-" + invId);
        assertThat(ledgers.toString()).contains("Patient Receivables|").contains("OPD Consultation Income|").contains("Pharmacy Sales|")
            .contains("Other Operating Income|").contains("Output CGST|").contains("Output SGST|");
      }
      if (no.equals(expNo)) {
        sawExpense = true;
        assertThat(v.getAttribute("VCHTYPE")).isEqualTo("Payment");
        assertThat(ledgers.toString()).contains("Repairs and Maintenance|").contains("Input CGST|").contains("TDS Payable|").contains("Bank Account|");
        assertThat(v.getElementsByTagName("NARRATION").item(0).getTextContent()).contains("Sri & Sons <Lifts>");
      }
    }
    assertThat(sawInvoice).isTrue();
    assertThat(sawExpense).isTrue();

    // Ledger masters for every ledger used, GST ledgers flagged as GST.
    String masters = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/tally/export" + q + "&format=masters").header("Authorization", accounts))
        .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    assertThat(masters).contains("<REPORTNAME>All Masters</REPORTNAME>").contains("LEDGER NAME=\"Repairs and Maintenance\"").contains("<GSTDUTYHEAD>Central Tax</GSTDUTYHEAD>");

    // CSV day book: debits equal credits.
    String csv = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/tally/export" + q + "&format=csv").header("Authorization", accounts))
        .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
    assertThat(csv).startsWith("﻿Date,Voucher type");
    assertThat(csv).contains(invNo).contains(expNo);

    var hist = get("/api/tally/history", accounts);
    assertThat(hist.size()).isGreaterThanOrEqualTo(3);

    // Accountants rename ledgers to match their Tally company; only managers can.
    String put = "{\"companyName\":\"HospitOS Healthcare\",\"ledgers\":[{\"key\":\"MODE_UPI\",\"ledgerName\":\"HDFC Current A/c\",\"tallyGroup\":\"Bank Accounts\"}]}";
    send(put("/api/tally/settings"), accounts, put).andExpect(status().isForbidden());
    var st = body(send(put("/api/tally/settings"), root, put).andExpect(status().isOk()));
    assertThat(st.get("companyName").asText()).isEqualTo("HospitOS Healthcare");
    send(put("/api/tally/settings"), root, "{\"companyName\":\"X\",\"ledgers\":[{\"key\":\"MODE_CARD\",\"ledgerName\":\"HDFC Current A/c\",\"tallyGroup\":\"Cash-in-Hand\"}]}")
        .andExpect(status().isUnprocessableEntity());
    String xml2 = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/tally/export" + q + "&format=xml").header("Authorization", accounts))
        .andReturn().getResponse().getContentAsString();
    assertThat(xml2).contains("<SVCURRENTCOMPANY>HospitOS Healthcare</SVCURRENTCOMPANY>").contains("HDFC Current A/c");
    // Put the default back for other tests.
    send(put("/api/tally/settings"), root, "{\"companyName\":\"\",\"ledgers\":[{\"key\":\"MODE_UPI\",\"ledgerName\":\"Bank Account\",\"tallyGroup\":\"Bank Accounts\"}]}").andExpect(status().isOk());
  }
}
