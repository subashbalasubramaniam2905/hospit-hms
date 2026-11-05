package com.hospitos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;

/** Staff and HR, general stores, procurement and notifications. */
class OrgTest extends ApiTestBase {

  private JsonNode staff(String name, String salary) throws Exception {
    return body(send(post("/api/staff"), root, "{\"name\":\"" + name + "\",\"role\":\"Staff nurse\",\"category\":\"Nurse\",\"deptId\":\"GM\",\"shift\":\"Morning\",\"salary\":"
        + salary + ",\"branchId\":\"BR1\"}").andExpect(status().isCreated()));
  }

  @Test
  void staffLeaveRosterAttendanceAndPayroll() throws Exception {
    LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));
    var s = staff("Rekha Test", "30000");
    String id = s.get("id").asText();
    assertThat(s.has("attendancePct")).isFalse();
    // Update with a stale version is refused.
    send(put("/api/staff/" + id), root, "{\"name\":\"Rekha T\",\"role\":\"Senior nurse\",\"category\":\"Nurse\",\"shift\":\"Night\",\"salary\":31000,\"version\":99}")
        .andExpect(status().isConflict());
    var u = body(send(put("/api/staff/" + id), root, "{\"name\":\"Rekha T\",\"role\":\"Senior nurse\",\"category\":\"Nurse\",\"shift\":\"Night\",\"salary\":30000,\"version\":1}")
        .andExpect(status().isOk()));
    assertThat(u.get("shift").asText()).isEqualTo("Night");

    // Leave that covers today makes the person On leave once approved.
    var l = body(send(post("/api/staff/leave"), root, "{\"staffId\":\"" + id + "\",\"from\":\"" + today + "\",\"to\":\"" + today.plusDays(1) + "\",\"type\":\"Sick\",\"reason\":\"Fever\"}")
        .andExpect(status().isCreated()));
    send(post("/api/staff/leave/" + l.get("id").asText() + "/decide"), root, "{\"status\":\"Approved\"}").andExpect(status().isOk());
    send(post("/api/staff/leave/" + l.get("id").asText() + "/decide"), root, "{\"status\":\"Rejected\"}").andExpect(status().isConflict());
    assertThat(find(get("/api/staff?branch=BR1", root), id).get("status").asText()).isEqualTo("On leave");

    // Roster defaults to the usual shift with Sunday off, and saves what is published.
    var r = get("/api/staff/roster?branch=BR1", root);
    JsonNode row = null; for (var x : r.get("rows")) if (x.get("staffId").asText().equals(id)) row = x;
    assertThat(row.get("shifts").get(0).asText()).isEqualTo("Night");
    assertThat(row.get("shifts").get(6).asText()).isEqualTo("Off");
    var pub = body(send(put("/api/staff/roster"), root, "{\"week\":\"" + r.get("week").asText() + "\",\"branchId\":\"BR1\",\"rows\":[{\"staffId\":\"" + id
        + "\",\"shifts\":[\"Morning\",\"Morning\",\"Off\",\"Evening\",\"Evening\",\"Night\",\"Off\"]}]}").andExpect(status().isOk()));
    assertThat(pub.toString()).contains("\"Morning\",\"Morning\",\"Off\",\"Evening\"");
    send(put("/api/staff/roster"), root, "{\"week\":\"" + r.get("week").asText() + "\",\"rows\":[{\"staffId\":\"" + id
        + "\",\"shifts\":[\"Lunch\",\"Morning\",\"Off\",\"Evening\",\"Evening\",\"Night\",\"Off\"]}]}").andExpect(status().isBadRequest());

    // Attendance: one absent day means loss of pay of a day's salary.
    send(put("/api/staff/attendance"), root, "{\"date\":\"" + today + "\",\"entries\":[{\"staffId\":\"" + id + "\",\"status\":\"Absent\"}]}").andExpect(status().isOk());
    send(put("/api/staff/attendance"), root, "{\"date\":\"" + today.plusDays(1) + "\",\"entries\":[]}").andExpect(status().isBadRequest());
    assertThat(find(get("/api/staff?branch=BR1", root), id).get("attendancePct").asInt()).isZero();
    String month = YearMonth.from(today).toString();
    var pay = get("/api/staff/payroll?branch=BR1&month=" + month, root);
    JsonNode line = null; for (var x : pay.get("lines")) if (x.get("staffId").asText().equals(id)) line = x;
    int days = YearMonth.from(today).lengthOfMonth();
    assertThat(line.get("lop").asInt()).isEqualTo(Math.round(30000f / days));
    assertThat(line.get("pf").asInt()).isEqualTo(3600);
    send(post("/api/staff/payroll"), root, "{\"month\":\"" + month + "\",\"branchId\":\"BR1\"}").andExpect(status().isOk());
    send(post("/api/staff/payroll"), root, "{\"month\":\"" + month + "\",\"branchId\":\"BR1\"}").andExpect(status().isConflict());

    // HR data is not for nurses; branch HR sees only their branch.
    String nurse = user("nurse.org@test.local", "nurse", "[\"BR1\"]");
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/staff").header("Authorization", nurse)).andExpect(status().isForbidden());
    String hr2 = user("hr2.org@test.local", "hr", "[\"BR2\"]");
    assertThat(get("/api/staff", hr2).findValuesAsText("id")).doesNotContain(id);
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/staff/payroll?branch=BR1").header("Authorization", hr2)).andExpect(status().isForbidden());
  }

  @Test
  void storesIssueCountAndRequisitions() throws Exception {
    var it = body(send(post("/api/inventory/items"), root, """
        {"name":"Surgical gloves 7.5","category":"Surgical supplies","unit":"pairs","reorder":20,"location":"Main store","cost":18.5,"supplierId":"SP3","branchId":"BR1","openingStock":30}""")
        .andExpect(status().isCreated()));
    String id = it.get("id").asText();
    assertThat(it.get("stock").asInt()).isEqualTo(30);
    send(post("/api/inventory/items/" + id + "/issue"), root, "{\"qty\":31,\"dept\":\"OT\"}").andExpect(status().isConflict());
    var after = body(send(post("/api/inventory/items/" + id + "/issue"), root, "{\"qty\":12,\"dept\":\"OT\",\"ref\":\"OT0701\"}").andExpect(status().isOk()));
    assertThat(after.get("stock").asInt()).isEqualTo(18);
    // Falling below reorder alerts the stores team in-app.
    String store = user("store.org@test.local", "inventory", "[\"BR1\"]");
    var inbox = get("/api/notifications/inbox", store);
    assertThat(inbox.findValuesAsText("title")).contains("Surgical gloves 7.5 below reorder level");
    long noteId = inbox.get(0).get("id").asLong();
    mvc.perform(post("/api/notifications/inbox/" + noteId + "/read").header("Authorization", store)).andExpect(status().isNoContent());
    assertThat(get("/api/notifications/inbox", store).get(0).get("read").asBoolean()).isTrue();
    // A nurse in BR1 does not get the stores note.
    String nurse = user("nurse.st@test.local", "nurse", "[\"BR1\"]");
    assertThat(get("/api/notifications/inbox", nurse).findValuesAsText("title")).doesNotContain("Surgical gloves 7.5 below reorder level");

    var counted = body(send(post("/api/inventory/items/" + id + "/count"), store, "{\"count\":16,\"note\":\"Monthly count\"}").andExpect(status().isOk()));
    assertThat(counted.get("stock").asInt()).isEqualTo(16);
    var moves = get("/api/inventory/moves?itemId=" + id, root);
    assertThat(moves.findValuesAsText("kind")).containsExactly("Adjustment", "Issue", "Receipt");

    // Nurses can ask; stores approve and issue; a short line issues nothing.
    var rq = body(send(post("/api/procurement/requisitions"), nurse, "{\"dept\":\"General ward A\",\"items\":[{\"itemId\":\"" + id + "\",\"qty\":20}]}")
        .andExpect(status().isCreated()));
    String rid = rq.get("id").asText();
    send(post("/api/procurement/requisitions/" + rid + "/decide"), nurse, "{\"status\":\"Approved\"}").andExpect(status().isForbidden());
    send(post("/api/procurement/requisitions/" + rid + "/decide"), store, "{\"status\":\"Approved\"}").andExpect(status().isOk());
    send(post("/api/procurement/requisitions/" + rid + "/issue"), store, "").andExpect(status().isConflict());
    assertThat(get("/api/inventory/items?branch=BR1", root).toString()).contains("\"stock\":16");

    var asset = body(send(post("/api/inventory/assets"), store, "{\"name\":\"Infusion pump\",\"category\":\"Medical equipment\",\"tag\":\"bme-0091\",\"value\":85000,\"nextService\":\"2026-01-01\"}")
        .andExpect(status().isCreated()));
    send(post("/api/inventory/assets/" + asset.get("id").asText() + "/status"), store, "{\"status\":\"Under maintenance\"}").andExpect(status().isOk());
    var svc = body(send(post("/api/inventory/assets/" + asset.get("id").asText() + "/service"), store, "{}").andExpect(status().isOk()));
    assertThat(svc.get("status").asText()).isEqualTo("In use");
    assertThat(svc.get("tag").asText()).isEqualTo("BME-0091");
  }

  @Test
  void purchaseOrdersFlowIntoStock() throws Exception {
    var it = body(send(post("/api/inventory/items"), root, "{\"name\":\"Gauze roll\",\"category\":\"Consumables\",\"unit\":\"rolls\",\"reorder\":10,\"cost\":40,\"branchId\":\"BR1\"}")
        .andExpect(status().isCreated()));
    String item = it.get("id").asText();
    String store = user("store.po@test.local", "inventory", "[\"BR1\"]");
    String admin = user("admin.po@test.local", "admin", "[\"BR1\"]");
    var po = body(send(post("/api/procurement/orders"), store, "{\"kind\":\"Inventory\",\"supplierId\":\"SP3\",\"items\":[{\"itemId\":\"" + item + "\",\"qty\":50,\"cost\":38}]}")
        .andExpect(status().isCreated()));
    String id = po.get("id").asText();
    assertThat(po.get("total").asDouble()).isEqualTo(1900.0);
    send(post("/api/procurement/orders/" + id + "/status"), store, "{\"status\":\"Approved\",\"version\":1}").andExpect(status().isForbidden());
    send(post("/api/procurement/orders/" + id + "/receive"), store, "{\"lines\":[],\"version\":1}").andExpect(status().isConflict());
    send(post("/api/procurement/orders/" + id + "/status"), admin, "{\"status\":\"Approved\",\"version\":1}").andExpect(status().isOk());
    var ordered = body(send(post("/api/procurement/orders/" + id + "/status"), store, "{\"status\":\"Ordered\",\"version\":2}").andExpect(status().isOk()));
    assertThat(ordered.get("expected").asText()).isNotEmpty();
    send(post("/api/procurement/orders/" + id + "/receive"), store, "{\"lines\":[{\"itemId\":\"" + item + "\",\"received\":60}],\"version\":3}").andExpect(status().isBadRequest());
    var got = body(send(post("/api/procurement/orders/" + id + "/receive"), store, "{\"lines\":[{\"itemId\":\"" + item + "\",\"received\":45}],\"version\":3}").andExpect(status().isOk()));
    assertThat(got.get("status").asText()).isEqualTo("Received");
    assertThat(got.get("total").asDouble()).isEqualTo(1710.0);
    assertThat(get("/api/inventory/items?branch=BR1", root).toString()).contains("\"id\":\"" + item + "\"");
    JsonNode stocked = null; for (var x : get("/api/inventory/items?branch=BR1", root)) if (x.get("id").asText().equals(item)) stocked = x;
    assertThat(stocked.get("stock").asInt()).isEqualTo(45);

    // Big orders need a super administrator.
    var big = body(send(post("/api/procurement/orders"), store, "{\"kind\":\"Inventory\",\"supplierId\":\"SP3\",\"items\":[{\"itemId\":\"" + item + "\",\"qty\":5000,\"cost\":40}]}")
        .andExpect(status().isCreated()));
    send(post("/api/procurement/orders/" + big.get("id").asText() + "/status"), admin, "{\"status\":\"Approved\",\"version\":1}").andExpect(status().isForbidden());
    send(post("/api/procurement/orders/" + big.get("id").asText() + "/status"), root, "{\"status\":\"Approved\",\"version\":1}").andExpect(status().isOk());

    // A pharmacy order needs batch and expiry and lands in pharmacy stock.
    String med = db.sql("select id from medicine order by id limit 1").query(String.class).single();
    int before = db.sql("select coalesce(sum(qty),0) from medicine_batch where medicine_id = ? and branch_id = 'BR1'").param(med).query(Integer.class).single();
    var rx = body(send(post("/api/procurement/orders"), store, "{\"kind\":\"Pharmacy\",\"supplierId\":\"SP1\",\"items\":[{\"itemId\":\"" + med + "\",\"qty\":100,\"cost\":1.5}]}")
        .andExpect(status().isCreated()));
    String rid = rx.get("id").asText();
    send(post("/api/procurement/orders/" + rid + "/status"), admin, "{\"status\":\"Approved\",\"version\":1}").andExpect(status().isOk());
    send(post("/api/procurement/orders/" + rid + "/status"), store, "{\"status\":\"Ordered\",\"version\":2}").andExpect(status().isOk());
    send(post("/api/procurement/orders/" + rid + "/receive"), store, "{\"lines\":[],\"version\":3}").andExpect(status().isBadRequest());
    send(post("/api/procurement/orders/" + rid + "/receive"), store, "{\"lines\":[{\"itemId\":\"" + med + "\",\"received\":100,\"batch\":\"po4101a\",\"expiry\":\"2029-06-30\"}],\"version\":3}")
        .andExpect(status().isOk());
    int after = db.sql("select coalesce(sum(qty),0) from medicine_batch where medicine_id = ? and branch_id = 'BR1'").param(med).query(Integer.class).single();
    assertThat(after - before).isEqualTo(100);
  }

  @Test
  void patientMessagesAreQueuedNotSent() throws Exception {
    var p = body(send(post("/api/patients"), root, """
        {"name":"Notify Test","dob":"1985-01-01","gender":"Female","mobile":"+91 90000 77777","consent":"Given","branchId":"BR1"}""").andExpect(status().isCreated()));
    String pid = p.get("id").asText();
    var r = body(send(post("/api/notifications/messages"), root, "{\"channel\":\"WhatsApp\",\"type\":\"Follow-up reminder\",\"patientIds\":[\"" + pid
        + "\",\"HS-00-99999\"],\"message\":\"Your follow-up is due.\",\"branchId\":\"BR1\"}").andExpect(status().isCreated()));
    assertThat(r.get("queued").asInt()).isEqualTo(1);
    assertThat(r.get("skipped").get(0).asText()).contains("HS-00-99999");
    assertThat(r.get("messages").get(0).get("status").asText()).isEqualTo("Queued");
    assertThat(r.get("messages").get(0).get("error").asText()).contains("No WhatsApp provider");
    // Email needs an email address on file.
    var e = body(send(post("/api/notifications/messages"), root, "{\"channel\":\"Email\",\"type\":\"System\",\"patientIds\":[\"" + pid + "\"],\"message\":\"Hello\"}")
        .andExpect(status().isCreated()));
    assertThat(e.get("queued").asInt()).isZero();
    send(post("/api/notifications/messages"), root, "{\"channel\":\"Pigeon\",\"type\":\"System\",\"patientIds\":[\"" + pid + "\"],\"message\":\"Hi\"}").andExpect(status().isBadRequest());
    assertThat(get("/api/notifications/messages", root).findValuesAsText("patientId")).contains(pid);
    String lab = user("lab.nt@test.local", "lab-tech", "[\"BR1\"]");
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/notifications/messages").header("Authorization", lab)).andExpect(status().isForbidden());
  }

  private static JsonNode find(JsonNode list, String id) {
    for (var n : list) if (n.get("id").asText().equals(id)) return n;
    throw new AssertionError("missing " + id);
  }
}
