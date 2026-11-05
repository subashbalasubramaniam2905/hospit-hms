package com.hospitos.kiosk;

import com.hospitos.appointments.AppointmentService;
import com.hospitos.appointments.Dtos;
import com.hospitos.audit.AuditService;
import com.hospitos.common.ActingAs;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import com.hospitos.patients.PatientInput;
import com.hospitos.patients.PatientRepository;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Lobby kiosk: find today's booking by mobile or UHID, check in, take a walk-in token or register. A kiosk shows only first names
 * and works only for its own branch. Actions are recorded in the audit trail under the kiosk's name.
 */
@Service
public class KioskService {
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final String CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  private final JdbcClient db;
  private final AppointmentService appointments;
  private final PatientRepository patients;
  private final AuditService audit;
  private final PasswordEncoder encoder;
  private final KioskTokens tokens;
  private final Clock clock;

  public KioskService(JdbcClient db, AppointmentService appointments, PatientRepository patients, AuditService audit,
                      PasswordEncoder encoder, KioskTokens tokens, Clock clock) {
    this.db = db; this.appointments = appointments; this.patients = patients; this.audit = audit; this.encoder = encoder;
    this.tokens = tokens; this.clock = clock;
  }

  // ---------------------------------------------------------------- devices (administrators)

  public record Device(UUID id, String branchId, String name, boolean active, boolean paired, OffsetDateTime lastSeen) {}
  public record PairCode(UUID id, String code, OffsetDateTime expiresAt) {}
  public record Paired(String token, String branchId, String branchName, String name) {}

  public List<Device> devices() {
    var me = CurrentUser.get();
    return db.sql("select id, branch_id, name, active, paired_at is not null, last_seen from kiosk_device order by created_at")
        .query((rs, n) -> new Device(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), rs.getBoolean(4), rs.getBoolean(5),
            rs.getObject(6, OffsetDateTime.class))).list().stream().filter(d -> me.canSee(d.branchId())).toList();
  }

  @Transactional
  public PairCode create(String branchId, String name) {
    var me = CurrentUser.get();
    if (!me.canSee(branchId)) throw new ApiException(403, "You don't work in branch " + branchId);
    UUID id = db.sql("insert into kiosk_device (branch_id, name, created_by) values (:b, :n, :by) returning id")
        .param("b", branchId).param("n", name.trim()).param("by", me.id()).query(UUID.class).single();
    audit.logForBranch(branchId, "Created", "Kiosk", id.toString(), name.trim());
    return newCode(id);
  }

  /** A fresh 8-character pairing code, valid for 15 minutes. Pairing again signs out the kiosk's old token. */
  @Transactional
  public PairCode newCode(UUID id) {
    var d = device(id);
    var sb = new StringBuilder();
    for (int i = 0; i < 8; i++) sb.append(CODE_CHARS.charAt(RANDOM.nextInt(CODE_CHARS.length())));
    String code = sb.toString();
    var exp = OffsetDateTime.now(clock).plusMinutes(15);
    db.sql("update kiosk_device set pair_code_hash = :h, pair_expires = :e, active = true where id = :id")
        .param("h", encoder.encode(code)).param("e", exp).param("id", id).update();
    audit.logForBranch(d.branchId(), "Pairing code", "Kiosk", id.toString(), d.name());
    return new PairCode(id, code, exp);
  }

  @Transactional
  public void revoke(UUID id) {
    var d = device(id);
    db.sql("update kiosk_device set active = false, token_version = token_version + 1, pair_code_hash = null where id = :id").param("id", id).update();
    audit.logForBranch(d.branchId(), "Revoked", "Kiosk", id.toString(), d.name());
  }

  private Device device(UUID id) {
    var d = db.sql("select id, branch_id, name, active, paired_at is not null, last_seen from kiosk_device where id = :id").param("id", id)
        .query((rs, n) -> new Device(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), rs.getBoolean(4), rs.getBoolean(5),
            rs.getObject(6, OffsetDateTime.class))).optional();
    if (d.isEmpty() || !CurrentUser.get().canSee(d.get().branchId())) throw new ApiException(404, "Kiosk not found");
    return d.get();
  }

  /** The kiosk enters the code shown to the administrator and receives its device token. */
  @Transactional
  public Paired pair(String code) {
    String c = code == null ? "" : code.trim().toUpperCase().replaceAll("[^A-Z0-9]", "");
    if (c.length() != 8) throw new ApiException(400, "Enter the 8-character code from the admin screen");
    record P(UUID id, String hash, String branch, String name, int tv) {}
    var cands = db.sql("select id, pair_code_hash, branch_id, name, token_version from kiosk_device where pair_code_hash is not null and pair_expires > now() and active")
        .query((rs, n) -> new P(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), rs.getString(4), rs.getInt(5))).list();
    var hit = cands.stream().filter(p -> encoder.matches(c, p.hash())).findFirst()
        .orElseThrow(() -> new ApiException(401, "That code is wrong or has expired. Ask for a new one"));
    int tv = hit.tv() + 1;
    db.sql("update kiosk_device set pair_code_hash = null, pair_expires = null, paired_at = now(), token_version = :tv where id = :id")
        .param("tv", tv).param("id", hit.id()).update();
    audit.write(null, "Kiosk " + hit.name(), "kiosk", hit.branch(), "Paired", "Kiosk", hit.id().toString(), "");
    String branchName = db.sql("select name from branch where id = :b").param("b", hit.branch()).query(String.class).single();
    return new Paired(tokens.issue(hit.id(), tv).token(), hit.branch(), branchName, hit.name());
  }

  // ---------------------------------------------------------------- kiosk actions

  private KioskAuthentication kiosk() {
    if (SecurityContextHolder.getContext().getAuthentication() instanceof KioskAuthentication k) return k;
    throw new ApiException(401, "This kiosk is not paired");
  }

  private <T> T acting(String patientBranch, java.util.function.Supplier<T> work) {
    var k = kiosk();
    var branches = patientBranch == null || patientBranch.equals(k.branchId()) ? List.of(k.branchId()) : List.of(k.branchId(), patientBranch);
    return ActingAs.run("Kiosk " + k.name(), "kiosk", branches, work);
  }

  private LocalDate today() { return LocalDate.now(clock); }

  public record Dept(String id, String name, int waiting) {}
  public record Serving(String token, String deptName) {}
  public record Info(String branchId, String branchName, String kioskName, List<Dept> departments, List<Serving> serving) {}

  public Info info() {
    var k = kiosk();
    String name = db.sql("select name from branch where id = :b").param("b", k.branchId()).query(String.class).single();
    var depts = db.sql("""
        select dp.id, dp.name, (select count(*) from queue_entry q where q.dept_id = dp.id and q.visit_date = :t and q.state = 'Active' and q.step <= 3)
          from department dp where dp.branch_id = :b and dp.active
           and exists (select 1 from doctor d where d.dept_id = dp.id and d.active) order by dp.name""")
        .param("b", k.branchId()).param("t", today()).query((rs, n) -> new Dept(rs.getString(1), rs.getString(2), rs.getInt(3))).list();
    var serving = db.sql("""
        select q.token, dp.name from queue_entry q join department dp on dp.id = q.dept_id
         where q.branch_id = :b and q.visit_date = :t and q.state = 'Active' and q.step = 3 order by q.step_since desc limit 6""")
        .param("b", k.branchId()).param("t", today()).query((rs, n) -> new Serving(rs.getString(1), rs.getString(2))).list();
    return new Info(k.branchId(), name, k.name(), depts, serving);
  }

  public record KioskAppt(String id, String doctorName, String deptName, String time, String room, String status, String token) {}
  public record Match(String patientId, String displayName, String gender, int age, List<KioskAppt> today) {}

  /** Finds patients by mobile number or UHID. Only a first name and initial are shown on the screen. */
  public List<Match> find(String mobile, String uhid) {
    var k = kiosk();
    List<String> ids;
    if (uhid != null && !uhid.isBlank()) {
      String u = uhid.trim().toUpperCase();
      if (!u.startsWith("HS-")) u = "HS-" + u;
      ids = db.sql("select id from patient where id = :id").param("id", u).query(String.class).list();
    } else {
      String d = mobile == null ? "" : mobile.replaceAll("\\D", "");
      if (d.length() < 10) throw new ApiException(400, "Enter a 10 digit mobile number");
      ids = db.sql("select p.id from patient p where right(regexp_replace(p.mobile, '\\D', '', 'g'), 10) = :m order by p.id limit 6")
          .param("m", d.substring(d.length() - 10)).query(String.class).list();
    }
    LocalDate t = today();
    return ids.stream().map(id -> {
      record P(String name, String gender, LocalDate dob) {}
      var p = db.sql("select name, gender, dob from patient where id = :id").param("id", id)
          .query((rs, n) -> new P(rs.getString(1), rs.getString(2), rs.getObject(3, LocalDate.class))).single();
      var appts = db.sql("""
          select a.id, d.name, dp.name, to_char(a.start_time, 'HH24:MI'), a.room, a.status, a.token
            from appointment a join doctor d on d.id = a.doctor_id join department dp on dp.id = a.dept_id
           where a.patient_id = :p and a.appt_date = :t and a.branch_id = :b and a.status not in ('Cancelled','No-show') order by a.start_time""")
          .param("p", id).param("t", t).param("b", k.branchId())
          .query((rs, n) -> new KioskAppt(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7))).list();
      return new Match(id, display(p.name()), p.gender(), java.time.Period.between(p.dob(), t).getYears(), appts);
    }).toList();
  }

  static String display(String name) {
    String[] parts = name.trim().split("\\s+");
    return parts.length == 1 ? parts[0] : parts[0] + " " + parts[parts.length - 1].charAt(0) + ".";
  }

  public record Ticket(String token, String patientId, String displayName, String doctorName, String deptName, String room, String time, int ahead) {}

  @Transactional
  public Ticket checkIn(String patientId, String appointmentId) {
    var k = kiosk();
    record A(String patient, String branch, LocalDate date, String status) {}
    var a = db.sql("select patient_id, branch_id, appt_date, status from appointment where id = :id").param("id", appointmentId)
        .query((rs, n) -> new A(rs.getString(1), rs.getString(2), rs.getObject(3, LocalDate.class), rs.getString(4))).optional();
    if (a.isEmpty() || !a.get().patient().equals(patientId) || !a.get().branch().equals(k.branchId()) || !a.get().date().equals(today()))
      throw new ApiException(404, "No booking today for this patient here");
    if (!List.of("Scheduled", "Confirmed").contains(a.get().status())) throw new ApiException(409, "You are already checked in");
    String pBranch = db.sql("select branch_id from patient where id = :id").param("id", patientId).query(String.class).single();
    acting(pBranch, () -> appointments.setStatus(appointmentId, "Arrived"));
    return ticket(appointmentId);
  }

  @Transactional
  public Ticket walkIn(String patientId, String deptId) {
    var k = kiosk();
    String pBranch = db.sql("select branch_id from patient where id = :id").param("id", patientId).query(String.class).optional()
        .orElseThrow(() -> new ApiException(404, "Patient not found"));
    // The doctor in this department with the shortest queue who is consulting today.
    String day = today().getDayOfWeek().getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.ENGLISH);
    var doc = db.sql("""
        select d.id from doctor d where d.dept_id = :dept and d.branch_id = :b and d.active and d.status <> 'On leave' and :day = any(d.days)
           and not exists (select 1 from doctor_leave l where l.doctor_id = d.id and l.leave_date = :t)
         order by (select count(*) from queue_entry q where q.doctor_id = d.id and q.visit_date = :t and q.state = 'Active' and q.step <= 3), d.name limit 1""")
        .param("dept", deptId).param("b", k.branchId()).param("day", day).param("t", today()).query(String.class).optional()
        .orElseThrow(() -> new ApiException(409, "No doctor in this department is seeing walk-in patients today. Please ask at the desk"));
    var r = acting(pBranch, () -> appointments.walkIn(new Dtos.WalkInRequest(patientId, doc, false, false)));
    return ticket(r.appointment().id());
  }

  public record Register(String name, String mobile, LocalDate dob, String gender, String city, String abha, boolean consent) {}

  @Transactional
  public Match register(Register in) {
    var k = kiosk();
    if (!in.consent()) throw new ApiException(400, "Consent is needed to register");
    if (in.name() == null || in.name().trim().length() < 2) throw new ApiException(400, "Enter your full name");
    String d = in.mobile() == null ? "" : in.mobile().replaceAll("\\D", "");
    if (d.length() == 12 && d.startsWith("91")) d = d.substring(2);
    if (d.length() != 10) throw new ApiException(400, "Enter a 10 digit mobile number");
    if (in.dob() == null || !in.dob().isBefore(today())) throw new ApiException(400, "Enter your date of birth");
    if (!List.of("Female", "Male", "Other").contains(in.gender())) throw new ApiException(400, "Choose a gender");
    // Someone who taps "New patient" twice, or forgot they registered, should not get a second record.
    boolean known = db.sql("""
        select exists (select 1 from patient p where right(regexp_replace(p.mobile, '\\D', '', 'g'), 10) = :m and p.dob = :dob
                         and lower(regexp_replace(trim(p.name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim(:n), '\\s+', ' ', 'g')))""")
        .param("m", d).param("dob", in.dob()).param("n", in.name()).query(Boolean.class).single();
    if (known) throw new ApiException(409, "You are already registered. Go back and use your mobile number to check in or for a walk-in visit.");
    String abha = in.abha() == null ? "" : in.abha().replaceAll("\\D", "");
    if (!abha.isEmpty() && abha.length() != 14) throw new ApiException(400, "ABHA number has 14 digits");
    String abhaFmt = abha.isEmpty() ? null : abha.substring(0, 2) + "-" + abha.substring(2, 6) + "-" + abha.substring(6, 10) + "-" + abha.substring(10);
    var input = new PatientInput(in.name().trim(), in.dob(), in.gender(), "+91 " + d.substring(0, 5) + " " + d.substring(5), null,
        Map.of("city", in.city() == null ? "" : in.city().trim()), null, List.of(), List.of(), "", null, null, null, Map.of(), null, abhaFmt,
        "Given", null, k.branchId(), null);
    String id = patients.nextUhid();
    patients.insert(id, k.branchId(), input, null);
    audit.write(null, "Kiosk " + k.name(), "kiosk", k.branchId(), "Created", "Patient", id, "Self-registered at the kiosk; verify ID at the desk");
    return new Match(id, display(input.name()), input.gender(), java.time.Period.between(in.dob(), today()).getYears(), List.of());
  }

  private Ticket ticket(String appointmentId) {
    return db.sql("""
        select q.token, q.patient_id, p.name, d.name, dp.name, d.room, to_char(a.start_time, 'HH24:MI'),
               (select count(*) from queue_entry o where o.doctor_id = q.doctor_id and o.visit_date = q.visit_date and o.state = 'Active'
                   and o.step <= 3 and o.arrived_at < q.arrived_at)
          from queue_entry q join appointment a on a.id = q.appointment_id join patient p on p.id = q.patient_id
          join doctor d on d.id = q.doctor_id join department dp on dp.id = q.dept_id where q.appointment_id = :a""")
        .param("a", appointmentId)
        .query((rs, n) -> new Ticket(rs.getString(1), rs.getString(2), display(rs.getString(3)), rs.getString(4), rs.getString(5), rs.getString(6),
            rs.getString(7), rs.getInt(8))).single();
  }
}
