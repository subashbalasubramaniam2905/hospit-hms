package com.hospitos.insights;

import com.hospitos.common.CurrentUser;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Live figures for the dashboards, computed from the appointments, queue, clinical, lab, pharmacy and billing tables.
 * Every figure is limited to the branches in scope. Inpatient beds, ER and HR are other modules and are left out until they exist.
 */
@Service
public class DashboardService {
  private final JdbcClient db;
  private final Scope scope;
  public DashboardService(JdbcClient db, Scope scope) { this.db = db; this.scope = scope; }

  public record Hour(int hour, int count) {}
  public record Month(String month, BigDecimal billed, BigDecimal collected) {}
  public record DeptRow(String deptId, String name, int visits, int completed, BigDecimal revenue, Integer avgWaitMin) {}
  public record DoctorToday(String doctorId, String name, String deptId, String status, int booked, int left) {}
  public record Upcoming(String id, String patientId, String patientName, String doctorId, String time, String status, String token, String type) {}
  public record Mine(String doctorId, int patientsToday, int completed, int waiting, int resultsToReview, int followUpsDue, String nextPatientId, String nextPatientName) {}

  public record Dashboard(
      LocalDate date, List<String> branches,
      int appointments, int completed, int toCome, int checkedIn, int cancelledOrNoShow,
      int waiting, int consulting, int[] queueByStep, int longWaits,
      int newRegistrations,
      BigDecimal collectedToday, BigDecimal outstanding, int outstandingCount, BigDecimal pharmacySalesToday,
      int labAwaitingSample, int labProcessing, int labToVerify, int labPending, int labCritical,
      int rxToDispense, int lowStock, int nearExpiry,
      int claimsInReview, int claimDrafts,
      int unbilledConsultations, int unbilledLab,
      int followUpsDue, int followUpsOverdue,
      int doctorsTotal, int doctorsAvailable, List<String> runningLateDepts,
      int openAlerts, int criticalAlerts,
      List<Hour> hourly, List<Month> revenue12m, List<DeptRow> departments, List<DoctorToday> doctors, List<Upcoming> upcoming,
      Mine me) {}

  public Dashboard get(String branch) {
    String[] br = scope.branches(branch);
    LocalDate t = scope.today();
    var s = scope.startOf(t); var e = scope.startOf(t.plusDays(1));

    Map<String, Integer> appt = new LinkedHashMap<>();
    db.sql("select status, count(*) from appointment a where appt_date = :d and " + Scope.in("a") + " group by status")
        .param("d", t).param("br", br).query(rs -> { appt.put(rs.getString(1), rs.getInt(2)); });
    int all = appt.values().stream().mapToInt(Integer::intValue).sum();
    int cancelled = appt.getOrDefault("Cancelled", 0), noShow = appt.getOrDefault("No-show", 0);
    int completed = appt.getOrDefault("Completed", 0);
    int toCome = appt.getOrDefault("Scheduled", 0) + appt.getOrDefault("Confirmed", 0);
    int checkedIn = appt.getOrDefault("Arrived", 0) + appt.getOrDefault("Waiting", 0) + appt.getOrDefault("In consultation", 0) + completed;

    int[] steps = new int[7];
    db.sql("select step, count(*) from queue_entry q where visit_date = :d and state = 'Active' and " + Scope.in("q") + " group by step")
        .param("d", t).param("br", br).query(rs -> { steps[rs.getInt(1)] = rs.getInt(2); });
    int longWaits = count("select count(*) from queue_entry q where visit_date = :d and state = 'Active' and step < 6 and step_since < :cut and " + Scope.in("q"),
        Map.of("d", t, "cut", scope.now().minusMinutes(25)), br);

    int newRegs = count("select count(*) from patient p where registered = :d and " + Scope.in("p"), Map.of("d", t), br);

    BigDecimal collected = money("select coalesce(sum(p.amount),0) from billing_payments p join billing_invoices i on i.id = p.invoice_id " +
        "where p.type = 'PAYMENT' and p.mode <> 'INSURANCE' and p.received_at >= :s and p.received_at < :e and " + Scope.in("i"), Map.of("s", s, "e", e), br);
    BigDecimal pharmacy = money("select coalesce(sum(p.amount),0) from billing_payments p join billing_invoices i on i.id = p.invoice_id " +
        "where p.type = 'PAYMENT' and i.kind = 'PHARMACY' and p.mode <> 'INSURANCE' and p.received_at >= :s and p.received_at < :e and " + Scope.in("i"), Map.of("s", s, "e", e), br);
    BigDecimal outstanding = money("select coalesce(sum(i.total - i.paid + i.refunded),0) from billing_invoices i where i.status in ('UNPAID','PARTIALLY_PAID') and " + Scope.in("i"), Map.of(), br);
    int outstandingCount = count("select count(*) from billing_invoices i where i.status in ('UNPAID','PARTIALLY_PAID') and " + Scope.in("i"), Map.of(), br);

    Map<String, Integer> lab = new LinkedHashMap<>();
    db.sql("select status, count(*) from lab_order o where status <> 'Delivered' and " + Scope.in("o") + " group by status")
        .param("br", br).query(rs -> { lab.put(rs.getString(1), rs.getInt(2)); });
    int labAwait = lab.getOrDefault("Ordered", 0) + lab.getOrDefault("Awaiting sample", 0);
    int labProc = lab.getOrDefault("Sample collected", 0) + lab.getOrDefault("Processing", 0);
    int labVerify = lab.getOrDefault("Result ready", 0);
    int labCritical = count("select count(distinct o.id) from lab_order o join lab_result r on r.order_id = o.id where r.flag = 'C' and o.status <> 'Delivered' and " + Scope.in("o"), Map.of(), br);

    int rx = count("select count(*) from prescription x where status in ('Signed','Sent to pharmacy','Partially dispensed') and " + Scope.in("x"), Map.of(), br);
    int lowStock = count("""
        select count(*) from (select m.id, b.id as branch_id, coalesce((select sum(qty) from medicine_batch mb where mb.medicine_id = m.id and mb.branch_id = b.id and mb.expiry >= :d), 0) as stock, m.reorder
          from medicine m cross join branch b where m.active and b.active) b where stock < reorder and""" + Scope.in("b"), Map.of("d", t), br);
    int nearExpiry = count("select count(*) from medicine_batch b where qty > 0 and expiry <= :lim and " + Scope.in("b"), Map.of("lim", t.plusDays(60)), br);

    int claimsReview = count("select count(*) from billing_claims c where status in ('SUBMITTED','UNDER_REVIEW') and " + Scope.in("c"), Map.of(), br);
    int claimDrafts = count("select count(*) from billing_claims c where status = 'DRAFT' and " + Scope.in("c"), Map.of(), br);

    int unbilledCons = count("select count(*) from consultation c where status = 'Completed' and completed_at >= :since and " + UNBILLED_CONSULTATION + " and " + Scope.in("c"),
        Map.of("since", scope.startOf(t.minusDays(90))), br);
    int unbilledLab = count("select count(*) from lab_order o where not billed and " + Scope.in("o"), Map.of(), br);

    int fuOverdue = count("select count(*) from consultation c where " + FollowUpService.OPEN_FOLLOW_UP + " and c.follow_up_date < :d and " + Scope.in("c"), Map.of("d", t), br);
    int fuDue = count("select count(*) from consultation c where " + FollowUpService.OPEN_FOLLOW_UP + " and c.follow_up_date between :d and :w and " + Scope.in("c"), Map.of("d", t, "w", t.plusDays(7)), br);

    int docsTotal = count("select count(*) from doctor d where active and " + Scope.in("d"), Map.of(), br);
    int docsAvail = count("select count(*) from doctor d where active and status in ('Available','In OPD','Running late') and not exists " +
        "(select 1 from doctor_leave l where l.doctor_id = d.id and l.leave_date = :d) and " + Scope.in("d"), Map.of("d", t), br);
    List<String> late = db.sql("select distinct dp.name from doctor d join department dp on dp.id = d.dept_id where d.active and d.status = 'Running late' and " + Scope.in("d"))
        .param("br", br).query(String.class).list();

    int openAlerts = count("select count(*) from insight_alert a where status = 'Open' and " + Scope.in("a"), Map.of(), br);
    int critAlerts = count("select count(*) from insight_alert a where status = 'Open' and priority = 'Critical' and " + Scope.in("a"), Map.of(), br);

    var hourly = new ArrayList<Hour>();
    Map<Integer, Integer> byHour = new LinkedHashMap<>();
    db.sql("select extract(hour from start_time)::int, count(*) from appointment a where appt_date = :d and status <> 'Cancelled' and " + Scope.in("a") + " group by 1")
        .param("d", t).param("br", br).query(rs -> { byHour.put(rs.getInt(1), rs.getInt(2)); });
    for (int h = 8; h <= 19; h++) hourly.add(new Hour(h, byHour.getOrDefault(h, 0)));

    var months = new ArrayList<Month>();
    YearMonth cur = YearMonth.from(t);
    Map<String, BigDecimal> billed = new LinkedHashMap<>(), coll = new LinkedHashMap<>();
    LocalDate from = cur.minusMonths(11).atDay(1);
    db.sql("select to_char(invoice_date, 'YYYY-MM'), sum(total) from billing_invoices i where status <> 'CANCELLED' and invoice_date >= :f and " + Scope.in("i") + " group by 1")
        .param("f", from).param("br", br).query(rs -> { billed.put(rs.getString(1), rs.getBigDecimal(2)); });
    db.sql("select to_char(p.received_at at time zone cast(:tz as text), 'YYYY-MM'), sum(case when p.type = 'REFUND' then -p.amount else p.amount end) " +
            "from billing_payments p join billing_invoices i on i.id = p.invoice_id where p.received_at >= :f and " + Scope.in("i") + " group by 1")
        .param("tz", scope.zone()).param("f", scope.startOf(from)).param("br", br).query(rs -> { coll.put(rs.getString(1), rs.getBigDecimal(2)); });
    for (int i = 11; i >= 0; i--) {
      String k = cur.minusMonths(i).toString();
      months.add(new Month(k, billed.getOrDefault(k, BigDecimal.ZERO), coll.getOrDefault(k, BigDecimal.ZERO)));
    }

    var depts = departments(br, t.minusDays(29), t);

    var doctors = db.sql("""
        select d.id, d.name, d.dept_id, d.status,
               (select count(*) from appointment a where a.doctor_id = d.id and a.appt_date = :d and a.status <> 'Cancelled') as booked,
               (select count(*) from appointment a where a.doctor_id = d.id and a.appt_date = :d and a.status not in ('Completed','Cancelled','No-show')) as left_
          from doctor d where d.active and""" + Scope.in("d") + " order by d.name")
        .param("d", t).param("br", br)
        .query((rs, n) -> new DoctorToday(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getInt(5), rs.getInt(6))).list();

    var upcoming = db.sql("""
        select a.id, a.patient_id, p.name, a.doctor_id, to_char(a.start_time, 'HH24:MI'), a.status, a.token, a.type
          from appointment a join patient p on p.id = a.patient_id
         where a.appt_date = :d and a.status not in ('Completed','Cancelled','No-show') and""" + Scope.in("a") + " order by a.start_time limit 8")
        .param("d", t).param("br", br)
        .query((rs, n) -> new Upcoming(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8))).list();

    return new Dashboard(t, br == null ? List.of() : List.of(br),
        all - cancelled, completed, toCome, checkedIn, cancelled + noShow,
        steps[0] + steps[1] + steps[2], steps[3], steps, longWaits, newRegs,
        collected, outstanding, outstandingCount, pharmacy,
        labAwait, labProc, labVerify, labAwait + labProc + labVerify, labCritical,
        rx, lowStock, nearExpiry, claimsReview, claimDrafts, unbilledCons, unbilledLab, fuDue, fuOverdue,
        docsTotal, docsAvail, late, openAlerts, critAlerts, hourly, months, depts, doctors, upcoming, mine(t));
  }

  /** OPD visits, completions, consultation revenue and the average wait from arrival to the doctor, by department. */
  public List<DeptRow> departments(String[] br, LocalDate from, LocalDate to) {
    return db.sql("""
        select dp.id, dp.name,
               (select count(*) from appointment a where a.dept_id = dp.id and a.appt_date between :f and :t and a.status not in ('Cancelled','No-show')),
               (select count(*) from appointment a where a.dept_id = dp.id and a.appt_date between :f and :t and a.status = 'Completed'),
               (select coalesce(sum(l.amount), 0) from billing_invoice_lines l join billing_invoices i on i.id = l.invoice_id
                  join doctor d on 'DOC-' || d.id = l.tariff_code
                 where d.dept_id = dp.id and i.status <> 'CANCELLED' and i.invoice_date between :f and :t),
               (select round(avg(extract(epoch from (e.at - q.arrived_at)) / 60))::int from queue_event e join queue_entry q on q.id = e.queue_entry_id
                 where q.dept_id = dp.id and e.to_step = 3 and q.visit_date between :f and :t)
          from department dp where dp.active and""" + Scope.in("dp") + " order by dp.name")
        .param("f", from).param("t", to).param("br", br)
        .query((rs, n) -> new DeptRow(rs.getString(1), rs.getString(2), rs.getInt(3), rs.getInt(4), rs.getBigDecimal(5), (Integer) rs.getObject(6))).list();
  }

  /** The signed-in doctor's own figures, when the account is linked to a doctor profile. */
  private Mine mine(LocalDate t) {
    var me = CurrentUser.get();
    var docId = db.sql("select id from doctor where user_id = :u").param("u", me.id()).query(String.class).optional();
    if (docId.isEmpty()) return null;
    String d = docId.get();
    Map<String, Object> p = Map.of("doc", d, "d", t);
    int today = count("select count(*) from appointment where doctor_id = :doc and appt_date = :d and status <> 'Cancelled'", p, null);
    int done = count("select count(*) from appointment where doctor_id = :doc and appt_date = :d and status = 'Completed'", p, null);
    int waiting = count("select count(*) from queue_entry where doctor_id = :doc and visit_date = :d and state = 'Active' and step <= 3", p, null);
    int results = count("select count(*) from lab_order where doctor_id = :doc and status = 'Result ready'", p, null);
    int fu = count("select count(*) from consultation c where c.doctor_id = :doc and " + FollowUpService.OPEN_FOLLOW_UP + " and c.follow_up_date <= :d", p, null);
    record Next(String id, String name) {}
    var next = db.sql("select q.patient_id, pt.name from queue_entry q join patient pt on pt.id = q.patient_id where q.doctor_id = :doc and q.visit_date = :d " +
            "and q.state = 'Active' and q.step <= 3 order by q.step desc, q.emergency desc, q.priority desc, q.arrived_at limit 1")
        .param("doc", d).param("d", t).query((rs, n) -> new Next(rs.getString(1), rs.getString(2))).optional();
    return new Mine(d, today, done, waiting, results, fu, next.map(Next::id).orElse(null), next.map(Next::name).orElse(null));
  }

  /** A completed consultation with no line on a live invoice. */
  static final String UNBILLED_CONSULTATION = """
       not exists (select 1 from billing_invoice_lines l join billing_invoices i on i.id = l.invoice_id
                  where l.ref_type = 'CONSULTATION' and l.ref_id = c.id::text and i.status <> 'CANCELLED')
      and not exists (select 1 from leakage_review r where r.finding_key = 'CONS:' || c.id::text)""";

  int count(String sql, Map<String, ?> params, String[] br) {
    var q = db.sql(sql);
    for (var e : params.entrySet()) q = q.param(e.getKey(), e.getValue());
    if (sql.contains(":br")) q = q.param("br", br);
    return q.query(Integer.class).single();
  }

  BigDecimal money(String sql, Map<String, ?> params, String[] br) {
    var q = db.sql(sql);
    for (var e : params.entrySet()) q = q.param(e.getKey(), e.getValue());
    if (sql.contains(":br")) q = q.param("br", br);
    return q.query(BigDecimal.class).single();
  }
}
