package com.hospitos.appointments;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hospitos.CleanDatabase;
import java.time.Clock;
import java.time.Duration;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({CleanDatabase.class, AppointmentsQueueTest.Clocks.class})
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AppointmentsQueueTest {

    /** Wednesday 4 Nov 2026, 09:30 in Udumalpet. */
    static final ZonedDateTime START = ZonedDateTime.of(2026, 11, 4, 9, 30, 0, 0, TestClock.IST);

    @TestConfiguration
    static class Clocks {
        @Bean @Primary
        Clock testClock() { return new TestClock(START); }
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcClient db;
    @Autowired Clock clock;

    String admin, desk, desk2, hr;

    @BeforeAll
    void setUp() throws Exception {
        admin = login("admin@test.local", "AdminPass123");
        createUser("appt-desk@test.local", "receptionist", "[\"BR1\"]");
        createUser("appt-desk2@test.local", "receptionist", "[\"BR2\"]");
        createUser("appt-hr@test.local", "hr", "[\"BR1\"]");
        desk = firstLogin("appt-desk@test.local");
        desk2 = firstLogin("appt-desk2@test.local");
        hr = firstLogin("appt-hr@test.local");
        db.sql("insert into department (id, branch_id, name) values ('GM','BR1','General medicine'), ('CA','BR1','Cardiology'), ('PE','BR2','Pediatrics')").update();
        db.sql("""
                insert into doctor (id, branch_id, dept_id, name, room, days, start_time, end_time, slot_min, status) values
                  ('D01','BR1','GM','Dr. Sana Iqbal','OPD-3','{Mon,Tue,Wed,Thu,Fri,Sat}','09:00','17:00',15,'Available'),
                  ('D02','BR1','CA','Dr. Vikram Rao','OPD-1','{Mon,Tue,Wed,Thu,Fri}','09:00','17:00',20,'Available'),
                  ('D09','BR1','GM','Dr. Deepa Krishnan','OPD-2','{Mon,Tue,Wed,Thu,Fri}','09:00','17:00',15,'On leave'),
                  ('D03','BR2','PE','Dr. Anjali Desai','OPD-5','{Mon,Tue,Wed,Thu,Fri}','09:00','17:00',15,'Available')""").update();
        db.sql("""
                insert into patient (id, branch_id, name, dob, gender, mobile) values
                  ('HS-26-00001','BR1','Lakshmi Iyer','1961-02-10','Female','+91 90000 00001'),
                  ('HS-26-00002','BR1','Rohit Menon','1988-07-21','Male','+91 90000 00002'),
                  ('HS-26-00003','BR1','Kavya Raman','1995-03-03','Female','+91 90000 00003'),
                  ('HS-26-00004','BR2','Joseph Thomas','1979-12-30','Male','+91 90000 00004')""").update();
    }

    @BeforeEach
    void resetClock() {
        ((TestClock) clock).set(START);
        db.sql("delete from queue_event").update();
        db.sql("delete from queue_entry").update();
        db.sql("delete from appointment").update();
        db.sql("delete from token_counter").update();
        db.sql("delete from doctor_leave").update();
    }

    // ------------------------------------------------------------------ booking and slots

    @Test
    void bookingShowsUpInTheSlotGridAndTheCalendar() throws Exception {
        JsonNode r = body(book(desk, "HS-26-00001", "D01", "2026-11-05", "10:00", 15).andExpect(status().isCreated()));
        JsonNode a = r.get("appointment");
        assertThat(a.get("id").asText()).startsWith("AP");
        assertThat(a.get("status").asText()).isEqualTo("Scheduled");
        assertThat(a.get("deptId").asText()).isEqualTo("GM");
        assertThat(a.get("room").asText()).isEqualTo("OPD-3");
        assertThat(a.has("token")).as("tokens are issued on the day").isFalse();

        JsonNode slots = body(mvc.perform(get("/api/appointments/slots?doctorId=D01&date=2026-11-05").header("Authorization", desk)).andExpect(status().isOk()));
        assertThat(slots.get("slotMinutes").asInt()).isEqualTo(15);
        JsonNode ten = find(slots.get("slots"), "time", "10:00");
        assertThat(ten.get("ok").asBoolean()).isFalse();
        assertThat(ten.get("reason").asText()).isEqualTo("Dr. Sana Iqbal already sees Lakshmi Iyer at 10:00.");
        assertThat(find(slots.get("slots"), "time", "13:00").get("reason").asText()).contains("break");

        mvc.perform(get("/api/appointments?from=2026-11-01&to=2026-11-30").header("Authorization", desk))
                .andExpect(jsonPath("$.length()").value(1)).andExpect(jsonPath("$[0].time").value("10:00"));
    }

    @Test
    void clashesClosedDaysAndPastTimesAreRefusedWithAReason() throws Exception {
        book(desk, "HS-26-00001", "D01", "2026-11-05", "10:00", 15).andExpect(status().isCreated());
        book(desk, "HS-26-00002", "D01", "2026-11-05", "10:10", 15).andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value("Dr. Sana Iqbal already sees Lakshmi Iyer at 10:00."));
        book(desk, "HS-26-00002", "D02", "2026-11-07", "10:00", 20).andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("does not consult on Sat")));
        book(desk, "HS-26-00002", "D01", "2026-11-04", "09:00", 15).andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value("This time has already passed today."));
        book(desk, "HS-26-00002", "D09", "2026-11-04", "11:00", 15).andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("on leave")));
        db.sql("insert into doctor_leave (doctor_id, leave_date, reason) values ('D01', '2026-11-06', 'Conference')").update();
        book(desk, "HS-26-00002", "D01", "2026-11-06", "11:00", 15).andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value("Dr. Sana Iqbal is on leave on this day (Conference)."));
        book(desk, "HS-26-00002", "D01", "2026-11-05", "25:00", 15).andExpect(status().isBadRequest());
    }

    @Test
    void parallelBookingsForTheSameSlotOnlyOneWins() throws Exception {
        var pool = Executors.newFixedThreadPool(6);
        List<Future<Integer>> results = new ArrayList<>();
        String[] patients = {"HS-26-00001", "HS-26-00002", "HS-26-00003"};
        for (int i = 0; i < 6; i++) {
            String p = patients[i % 3];
            Callable<Integer> c = () -> book(desk, p, "D01", "2026-11-05", "11:00", 15).andReturn().getResponse().getStatus();
            results.add(pool.submit(c));
        }
        int created = 0, conflicts = 0;
        for (Future<Integer> f : results) {
            int s = f.get();
            if (s == 201) created++;
            else if (s == 409) conflicts++;
        }
        pool.shutdown();
        assertThat(created).isEqualTo(1);
        assertThat(conflicts).isEqualTo(5);
    }

    @Test
    void repeatingBookingsSkipDatesThatAreTaken() throws Exception {
        book(desk, "HS-26-00002", "D01", "2026-11-19", "10:00", 15).andExpect(status().isCreated());
        JsonNode r = body(mvc.perform(post("/api/appointments").header("Authorization", desk).contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"patientId":"HS-26-00001","doctorId":"D01","date":"2026-11-05","time":"10:00","duration":15,
                         "type":"Follow-up","recurring":"Weekly"}""")).andExpect(status().isCreated()));
        assertThat(r.get("repeats")).hasSize(2);
        assertThat(r.get("repeats").get(0).get("date").asText()).isEqualTo("2026-11-12");
        assertThat(r.get("skipped")).hasSize(1);
        assertThat(r.get("skipped").get(0).asText()).startsWith("2026-11-19");
    }

    @Test
    void rescheduleChecksTheNewSlotAndCancelFreesIt() throws Exception {
        String a = body(book(desk, "HS-26-00001", "D01", "2026-11-05", "10:00", 15)).get("appointment").get("id").asText();
        String b = body(book(desk, "HS-26-00002", "D01", "2026-11-05", "10:30", 15)).get("appointment").get("id").asText();
        reschedule(b, "2026-11-05", "10:00").andExpect(status().isConflict());
        reschedule(b, "2026-11-05", "10:15").andExpect(status().isOk()).andExpect(jsonPath("$.time").value("10:15"));
        // Moving to today issues a token straight away.
        reschedule(a, "2026-11-04", "11:00").andExpect(status().isOk()).andExpect(jsonPath("$.token").value("G-001"));
        setStatus(a, "Cancelled").andExpect(status().isOk());
        book(desk, "HS-26-00003", "D01", "2026-11-04", "11:00", 15).andExpect(status().isCreated());
        setStatus(a, "Confirmed").andExpect(status().isConflict());
        reschedule(a, "2026-11-06", "11:00").andExpect(status().isConflict());
    }

    @Test
    void leaveBlocksTheDayAndListsBookingsToMove() throws Exception {
        String a = body(book(desk, "HS-26-00001", "D01", "2026-11-10", "10:00", 15)).get("appointment").get("id").asText();
        mvc.perform(post("/api/appointments/leave").header("Authorization", desk).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"doctorId\":\"D01\",\"date\":\"2026-11-10\",\"reason\":\"Conference\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].id").value(a));
        mvc.perform(get("/api/appointments/slots?doctorId=D01&date=2026-11-10").header("Authorization", desk))
                .andExpect(jsonPath("$.dayBlock").value("Dr. Sana Iqbal is on leave on this day (Conference)."))
                .andExpect(jsonPath("$.slots.length()").value(0));
        mvc.perform(get("/api/appointments/leave?doctorId=D01&from=2026-11-01&to=2026-11-30").header("Authorization", desk))
                .andExpect(jsonPath("$.length()").value(1));
        mvc.perform(delete("/api/appointments/leave/D01/2026-11-10").header("Authorization", desk)).andExpect(status().isNoContent());
        mvc.perform(delete("/api/appointments/leave/D01/2026-11-10").header("Authorization", desk)).andExpect(status().isNotFound());
    }

    // ------------------------------------------------------------------ queue journey

    @Test
    void checkInIssuesATokenAndTheJourneyKeepsTheAppointmentInStep() throws Exception {
        String a = body(book(desk, "HS-26-00001", "D01", "2026-11-04", "10:00", 15)).get("appointment").get("id").asText();
        JsonNode appt = body(mvc.perform(get("/api/appointments/" + a).header("Authorization", desk)));
        assertThat(appt.get("token").asText()).isEqualTo("G-001");

        setStatus(a, "Arrived").andExpect(status().isOk());
        JsonNode q = body(mvc.perform(get("/api/queue").header("Authorization", desk))).get(0);
        long id = q.get("id").asLong();
        assertThat(q.get("token").asText()).isEqualTo("G-001");
        assertThat(q.get("patientName").asText()).isEqualTo("Lakshmi Iyer");
        assertThat(q.get("step").asInt()).isEqualTo(1);
        assertThat(q.get("arrivedAt").asText()).isEqualTo("09:30");

        ((TestClock) clock).advance(Duration.ofMinutes(12));
        mvc.perform(get("/api/queue/" + id).header("Authorization", desk)).andExpect(jsonPath("$.since").value(12));

        move(id, null).andExpect(jsonPath("$.step").value(2)).andExpect(jsonPath("$.since").value(0));
        assertThat(apptStatus(a)).isEqualTo("Waiting");
        move(id, 3);
        assertThat(apptStatus(a)).isEqualTo("In consultation");
        move(id, 5);
        assertThat(apptStatus(a)).isEqualTo("Completed");
        move(id, 6).andExpect(jsonPath("$.step").value(6))
                .andExpect(jsonPath("$.history.length()").value(5))
                .andExpect(jsonPath("$.history[0].step").value(0));
        assertThat(apptStatus(a)).isEqualTo("Completed");
        // A finished visit can't be checked in again.
        setStatus(a, "Arrived").andExpect(status().isConflict());
    }

    @Test
    void walkInsGetTheNextTokenAndCallNextPicksEmergencyThenPriorityThenLongestWait() throws Exception {
        JsonNode w1 = walkIn("HS-26-00001", "D01", false, false);
        assertThat(w1.get("queue").get("token").asText()).isEqualTo("G-001");
        assertThat(w1.get("appointment").get("type").asText()).isEqualTo("Walk-in");
        assertThat(w1.get("appointment").get("status").asText()).isEqualTo("Arrived");
        ((TestClock) clock).advance(Duration.ofMinutes(5));
        JsonNode w2 = walkIn("HS-26-00002", "D01", true, false);
        ((TestClock) clock).advance(Duration.ofMinutes(5));
        JsonNode w3 = walkIn("HS-26-00003", "D02", false, false);
        assertThat(w2.get("queue").get("token").asText()).isEqualTo("G-002");
        assertThat(w3.get("queue").get("token").asText()).isEqualTo("C-001");

        for (JsonNode w : List.of(w1, w2, w3)) move(w.get("queue").get("id").asLong(), 2);
        // Priority beats the earlier arrival.
        callNext(null).andExpect(status().isOk()).andExpect(jsonPath("$.token").value("G-002")).andExpect(jsonPath("$.step").value(3));
        mvc.perform(patch("/api/queue/" + w3.get("queue").get("id").asLong()).header("Authorization", desk)
                .contentType(MediaType.APPLICATION_JSON).content("{\"emergency\":true}")).andExpect(jsonPath("$.emergency").value(true));
        callNext(null).andExpect(jsonPath("$.token").value("C-001"));
        callNext("{\"doctorId\":\"D02\"}").andExpect(status().isNoContent());
        callNext(null).andExpect(jsonPath("$.token").value("G-001"));
        callNext(null).andExpect(status().isNoContent());
    }

    @Test
    void reassignLeftWithoutBeingSeenAndCancelTidyTheQueue() throws Exception {
        long id = walkIn("HS-26-00001", "D01", false, false).get("queue").get("id").asLong();
        mvc.perform(patch("/api/queue/" + id).header("Authorization", desk).contentType(MediaType.APPLICATION_JSON).content("{\"doctorId\":\"D09\"}"))
                .andExpect(status().isConflict());
        mvc.perform(patch("/api/queue/" + id).header("Authorization", desk).contentType(MediaType.APPLICATION_JSON).content("{\"doctorId\":\"D03\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(patch("/api/queue/" + id).header("Authorization", desk).contentType(MediaType.APPLICATION_JSON).content("{\"doctorId\":\"D02\"}"))
                .andExpect(jsonPath("$.doctorId").value("D02")).andExpect(jsonPath("$.deptId").value("CA"));

        mvc.perform(post("/api/queue/" + id + "/left").header("Authorization", desk)).andExpect(status().isNoContent());
        mvc.perform(get("/api/queue").header("Authorization", desk)).andExpect(jsonPath("$.length()").value(0));
        String apptId = db.sql("select appointment_id from queue_entry where id = :id").param("id", id).query(String.class).single();
        assertThat(apptStatus(apptId)).isEqualTo("No-show");
        mvc.perform(post("/api/queue/" + id + "/move").header("Authorization", desk)).andExpect(status().isConflict());

        String b = body(book(desk, "HS-26-00002", "D01", "2026-11-04", "11:00", 15)).get("appointment").get("id").asText();
        setStatus(b, "Arrived");
        setStatus(b, "Cancelled").andExpect(status().isOk());
        mvc.perform(get("/api/queue").header("Authorization", desk)).andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void markingInConsultationFromTheCalendarMovesTheQueueToo() throws Exception {
        String a = body(book(desk, "HS-26-00001", "D01", "2026-11-04", "10:00", 15)).get("appointment").get("id").asText();
        setStatus(a, "In consultation").andExpect(status().isOk()).andExpect(jsonPath("$.status").value("In consultation"));
        mvc.perform(get("/api/queue").header("Authorization", desk)).andExpect(jsonPath("$[0].step").value(3));
        String b = body(book(desk, "HS-26-00002", "D01", "2026-11-05", "10:00", 15)).get("appointment").get("id").asText();
        setStatus(b, "Arrived").andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value("Only today's appointments can be checked in."));
    }

    // ------------------------------------------------------------------ access

    @Test
    void branchesAndRolesAreEnforced() throws Exception {
        String a = body(book(desk, "HS-26-00001", "D01", "2026-11-05", "10:00", 15)).get("appointment").get("id").asText();
        mvc.perform(get("/api/appointments/" + a).header("Authorization", desk2)).andExpect(status().isNotFound());
        mvc.perform(get("/api/appointments?from=2026-11-01&to=2026-11-30").header("Authorization", desk2)).andExpect(jsonPath("$.length()").value(0));
        mvc.perform(get("/api/appointments?from=2026-11-01&to=2026-11-30&branch=BR1").header("Authorization", desk2)).andExpect(status().isForbidden());
        book(desk2, "HS-26-00004", "D01", "2026-11-05", "11:00", 15).andExpect(status().isNotFound());
        // A patient registered in another branch can't be booked from here.
        book(desk, "HS-26-00004", "D01", "2026-11-05", "11:00", 15).andExpect(status().isNotFound());
        setStatus(a, "Cancelled", desk2).andExpect(status().isNotFound());
        mvc.perform(get("/api/appointments?from=2026-11-01&to=2026-11-30").header("Authorization", hr)).andExpect(status().isForbidden());
        mvc.perform(get("/api/queue").header("Authorization", hr)).andExpect(status().isForbidden());
        mvc.perform(get("/api/queue")).andExpect(status().isUnauthorized());
        // Every change is in the audit trail.
        int audited = db.sql("select count(*) from audit_log where entity = 'Appointment' and entity_id = :id").param("id", a).query(Integer.class).single();
        assertThat(audited).isEqualTo(1);
    }

    // ------------------------------------------------------------------ helpers

    private ResultActions book(String auth, String patient, String doctor, String date, String time, int duration) throws Exception {
        return mvc.perform(post("/api/appointments").header("Authorization", auth).contentType(MediaType.APPLICATION_JSON)
                .content("{\"patientId\":\"%s\",\"doctorId\":\"%s\",\"date\":\"%s\",\"time\":\"%s\",\"duration\":%d}"
                        .formatted(patient, doctor, date, time, duration)));
    }

    private ResultActions reschedule(String id, String date, String time) throws Exception {
        return mvc.perform(post("/api/appointments/" + id + "/reschedule").header("Authorization", desk).contentType(MediaType.APPLICATION_JSON)
                .content("{\"date\":\"%s\",\"time\":\"%s\"}".formatted(date, time)));
    }

    private ResultActions setStatus(String id, String status) throws Exception {
        return setStatus(id, status, desk);
    }

    private ResultActions setStatus(String id, String status, String auth) throws Exception {
        return mvc.perform(post("/api/appointments/" + id + "/status").header("Authorization", auth).contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"" + status + "\"}"));
    }

    private JsonNode walkIn(String patient, String doctor, boolean priority, boolean emergency) throws Exception {
        return body(mvc.perform(post("/api/appointments/walk-in").header("Authorization", desk).contentType(MediaType.APPLICATION_JSON)
                .content("{\"patientId\":\"%s\",\"doctorId\":\"%s\",\"priority\":%s,\"emergency\":%s}".formatted(patient, doctor, priority, emergency)))
                .andExpect(status().isCreated()));
    }

    private ResultActions move(long id, Integer step) throws Exception {
        return mvc.perform(post("/api/queue/" + id + "/move").header("Authorization", desk).contentType(MediaType.APPLICATION_JSON)
                .content(step == null ? "{}" : "{\"step\":" + step + "}")).andExpect(status().isOk());
    }

    private ResultActions callNext(String bodyJson) throws Exception {
        var req = post("/api/queue/call-next").header("Authorization", desk);
        if (bodyJson != null) req = req.contentType(MediaType.APPLICATION_JSON).content(bodyJson);
        return mvc.perform(req);
    }

    private String apptStatus(String id) {
        return db.sql("select status from appointment where id = :id").param("id", id).query(String.class).single();
    }

    private String login(String email, String pw) throws Exception {
        MvcResult res = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"" + pw + "\"}")).andExpect(status().isOk()).andReturn();
        return "Bearer " + json.readTree(res.getResponse().getContentAsString()).get("token").asText();
    }

    /** New accounts must change their temporary password before anything else. */
    private String firstLogin(String email) throws Exception {
        String temp = login(email, "TempPass1234");
        MvcResult r = mvc.perform(post("/api/auth/password").header("Authorization", temp).contentType(MediaType.APPLICATION_JSON)
                .content("{\"currentPassword\":\"TempPass1234\",\"newPassword\":\"RealPass5678\"}")).andExpect(status().isOk()).andReturn();
        return "Bearer " + json.readTree(r.getResponse().getContentAsString()).get("token").asText();
    }

    private void createUser(String email, String role, String branches) throws Exception {
        mvc.perform(post("/api/users").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"name\":\"" + role + " user\",\"role\":\"" + role + "\",\"branches\":" + branches
                        + ",\"temporaryPassword\":\"TempPass1234\"}")).andExpect(status().isCreated());
    }

    private JsonNode body(ResultActions r) throws Exception {
        return json.readTree(r.andReturn().getResponse().getContentAsString());
    }

    private static JsonNode find(JsonNode arr, String field, String value) {
        for (JsonNode n : arr) if (n.get(field).asText().equals(value)) return n;
        throw new AssertionError("No " + field + "=" + value);
    }
}
