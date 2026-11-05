package com.hospitos.insights;

import com.hospitos.common.ApiException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Operational and financial reports over a date range, from the live tables. Column names are what the screen shows. */
@Service
public class ReportService {
  private final JdbcClient db;
  private final Scope scope;
  public ReportService(JdbcClient db, Scope scope) { this.db = db; this.scope = scope; }

  public static final List<String> IDS = List.of("opd", "revenue", "doctor", "lab", "pharmacy", "claims", "noshow", "beds");

  public record Report(String id, LocalDate from, LocalDate to, List<Map<String, Object>> rows, List<String> labels, List<Number> data,
                       String chart, String note) {}

  public Report get(String id, int days, String deptId, String branch) {
    if (!IDS.contains(id)) throw new ApiException(404, "Unknown report " + id);
    if (days < 1 || days > 366) throw new ApiException(400, "Choose between 1 and 366 days");
    String[] br = scope.branches(branch);
    LocalDate to = scope.today(), from = to.minusDays(days - 1L);
    String dept = deptId == null || deptId.isBlank() ? null : deptId;
    return switch (id) {
      case "opd" -> opd(br, from, to, dept);
      case "revenue" -> revenue(br, from, to);
      case "doctor" -> doctors(br, from, to, dept);
      case "lab" -> lab(br, from, to);
      case "pharmacy" -> pharmacy(br, from, to);
      case "claims" -> claims(br, from, to);
      case "noshow" -> noShows(br, from, to, dept);
      default -> new Report(id, from, to, List.of(), List.of(), List.of(), "line", "Bed occupancy appears here once the inpatient module is live.");
    };
  }

  private Report opd(String[] br, LocalDate from, LocalDate to, String dept) {
    var rows = new ArrayList<Map<String, Object>>();
    db.sql("""
        select dp.name, count(*) filter (where a.status not in ('Cancelled','No-show')) as visits,
               count(*) filter (where a.status not in ('Cancelled','No-show') and a.type = 'New consultation') as new_,
               count(*) filter (where a.type = 'Walk-in') as walkins
          from appointment a join department dp on dp.id = a.dept_id
         where a.appt_date between :f and :t and (cast(:dept as text) is null or a.dept_id = :dept) and""" + Scope.in("a") + """
         group by dp.name order by 2 desc""")
        .param("f", from).param("t", to).param("dept", dept).param("br", br)
        .query(rs -> {
          int v = rs.getInt(2);
          if (v == 0) return;
          rows.add(row("Department", rs.getString(1), "Visits", v, "New %", pct(rs.getInt(3), v), "Walk-ins", rs.getInt(4)));
        });
    return chart("opd", from, to, rows, "Department", "Visits", "bar", null);
  }

  private Report revenue(String[] br, LocalDate from, LocalDate to) {
    var by = new LinkedHashMap<String, BigDecimal>();
    db.sql("""
        select l.category, sum(l.amount) from billing_invoice_lines l join billing_invoices i on i.id = l.invoice_id
         where i.status <> 'CANCELLED' and i.invoice_date between :f and :t and""" + Scope.in("i") + " group by 1 order by 2 desc")
        .param("f", from).param("t", to).param("br", br).query(rs -> { by.put(label(rs.getString(1)), rs.getBigDecimal(2)); });
    BigDecimal total = by.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);
    var rows = new ArrayList<Map<String, Object>>();
    by.forEach((k, v) -> rows.add(row("Category", k, "Revenue ₹", v, "Share %", total.signum() == 0 ? 0 : v.multiply(BigDecimal.valueOf(100)).divide(total, 0, RoundingMode.HALF_UP))));
    return chart("revenue", from, to, rows, "Category", "Revenue ₹", "doughnut", "Billed amounts including GST, cancelled invoices left out");
  }

  private Report doctors(String[] br, LocalDate from, LocalDate to, String dept) {
    var rows = new ArrayList<Map<String, Object>>();
    db.sql("""
        select d.name, dp.name,
               (select count(*) from appointment a where a.doctor_id = d.id and a.appt_date between :f and :t and a.status not in ('Cancelled','No-show')),
               (select count(*) from appointment a where a.doctor_id = d.id and a.appt_date between :f and :t and a.status = 'Completed'),
               (select coalesce(sum(l.amount),0) from billing_invoice_lines l join billing_invoices i on i.id = l.invoice_id
                 where l.tariff_code = 'DOC-' || d.id and i.status <> 'CANCELLED' and i.invoice_date between :f and :t),
               (select round(avg(extract(epoch from (e.at - q.arrived_at)) / 60))::int from queue_event e join queue_entry q on q.id = e.queue_entry_id
                 where q.doctor_id = d.id and e.to_step = 3 and q.visit_date between :f and :t)
          from doctor d join department dp on dp.id = d.dept_id
         where d.active and (cast(:dept as text) is null or d.dept_id = :dept) and""" + Scope.in("d") + " order by d.name")
        .param("f", from).param("t", to).param("dept", dept).param("br", br)
        .query(rs -> {
          Integer wait = (Integer) rs.getObject(6);
          rows.add(row("Doctor", rs.getString(1), "Department", rs.getString(2), "Visits", rs.getInt(3), "Completed", rs.getInt(4),
              "Consultation revenue ₹", rs.getBigDecimal(5), "Avg wait (min)", wait == null ? "—" : wait));
        });
    return chart("doctor", from, to, rows, "Doctor", "Visits", "bar", "Average wait is from arrival to the consultation room");
  }

  private Report lab(String[] br, LocalDate from, LocalDate to) {
    var rows = new ArrayList<Map<String, Object>>();
    db.sql("""
        select t.name, count(*), t.tat_hours,
               round(avg(extract(epoch from (o.verified_at - coalesce(o.collected_at, o.ordered_at))) / 3600)::numeric, 1),
               count(*) filter (where o.verified_at is not null),
               count(*) filter (where o.verified_at is not null and o.verified_at - coalesce(o.collected_at, o.ordered_at) <= make_interval(hours => t.tat_hours))
          from lab_order o join lab_order_test ot on ot.order_id = o.id join lab_test t on t.id = ot.test_id
         where o.ordered_at >= :s and o.ordered_at < :e and""" + Scope.in("o") + """
         group by t.id, t.name, t.tat_hours order by 2 desc limit 20""")
        .param("s", scope.startOf(from)).param("e", scope.startOf(to.plusDays(1))).param("br", br)
        .query(rs -> {
          BigDecimal actual = rs.getBigDecimal(4);
          int done = rs.getInt(5);
          rows.add(row("Test", rs.getString(1), "Orders", rs.getInt(2), "Target TAT hours", rs.getInt(3),
              "Actual TAT hours", actual == null ? "—" : actual, "Within target %", done == 0 ? "—" : pct(rs.getInt(6), done)));
        });
    var labels = rows.stream().filter(r -> r.get("Actual TAT hours") instanceof Number).map(r -> (String) r.get("Test")).toList();
    var data = rows.stream().filter(r -> r.get("Actual TAT hours") instanceof Number).map(r -> (Number) r.get("Actual TAT hours")).toList();
    return new Report("lab", from, to, rows, labels, data, "bar", "Turnaround is from sample collection to verification");
  }

  private Report pharmacy(String[] br, LocalDate from, LocalDate to) {
    var rows = new ArrayList<Map<String, Object>>();
    db.sql("""
        select m.brand || ' ' || m.strength, sum(l.qty), sum(l.amount)
          from dispense x join dispense_line l on l.dispense_id = x.id join medicine m on m.id = l.medicine_id
         where x.at >= :s and x.at < :e and""" + Scope.in("x") + " group by 1 order by 3 desc limit 15")
        .param("s", scope.startOf(from)).param("e", scope.startOf(to.plusDays(1))).param("br", br)
        .query(rs -> { rows.add(row("Medicine", rs.getString(1), "Qty sold", rs.getInt(2), "Value ₹", rs.getBigDecimal(3))); });
    return chart("pharmacy", from, to, rows, "Medicine", "Value ₹", "bar", null);
  }

  private Report claims(String[] br, LocalDate from, LocalDate to) {
    var rows = new ArrayList<Map<String, Object>>();
    db.sql("""
        select p.name, count(*), sum(c.claimed), sum(c.approved), sum(c.settled), count(*) filter (where c.status = 'REJECTED')
          from billing_claims c join billing_insurance_providers p on p.id = c.provider_id
         where c.created_at >= :s and c.created_at < :e and""" + Scope.in("c") + " group by p.name order by 3 desc")
        .param("s", scope.startOf(from)).param("e", scope.startOf(to.plusDays(1))).param("br", br)
        .query(rs -> {
          BigDecimal claimed = rs.getBigDecimal(3), approved = rs.getBigDecimal(4);
          rows.add(row("Insurer", rs.getString(1), "Claims", rs.getInt(2), "Claimed ₹", claimed, "Approved ₹", approved, "Settled ₹", rs.getBigDecimal(5),
              "Rejected", rs.getInt(6), "Approval %", claimed.signum() == 0 ? 0 : approved.multiply(BigDecimal.valueOf(100)).divide(claimed, 0, RoundingMode.HALF_UP)));
        });
    return chart("claims", from, to, rows, "Insurer", "Claimed ₹", "bar", null);
  }

  private Report noShows(String[] br, LocalDate from, LocalDate to, String dept) {
    var rows = new ArrayList<Map<String, Object>>();
    db.sql("""
        select d.name, count(*), count(*) filter (where a.status = 'No-show'), count(*) filter (where a.status = 'Cancelled')
          from appointment a join doctor d on d.id = a.doctor_id
         where a.appt_date between :f and :t and a.type <> 'Walk-in' and (cast(:dept as text) is null or a.dept_id = :dept) and""" + Scope.in("a") + """
         group by d.name order by d.name""")
        .param("f", from).param("t", to).param("dept", dept).param("br", br)
        .query(rs -> {
          int booked = rs.getInt(2), ns = rs.getInt(3), c = rs.getInt(4);
          rows.add(row("Doctor", rs.getString(1), "Booked", booked, "No-shows", ns, "Cancelled", c, "Rate %", pct(ns + c, booked)));
        });
    return chart("noshow", from, to, rows, "Doctor", "Rate %", "bar", null);
  }

  private static Report chart(String id, LocalDate from, LocalDate to, List<Map<String, Object>> rows, String labelCol, String dataCol, String type, String note) {
    return new Report(id, from, to, rows, rows.stream().map(r -> String.valueOf(r.get(labelCol))).toList(),
        rows.stream().map(r -> (Number) r.get(dataCol)).toList(), type, note);
  }

  private static Map<String, Object> row(Object... kv) {
    var m = new LinkedHashMap<String, Object>();
    for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
    return m;
  }

  static int pct(int n, int d) { return d == 0 ? 0 : Math.round(n * 100f / d); }

  private static String label(String category) {
    return switch (category) {
      case "CONSULTATION" -> "Consultation";
      case "LAB" -> "Laboratory";
      case "IMAGING" -> "Imaging";
      case "PHARMACY" -> "Pharmacy";
      case "ROOM" -> "Room";
      case "NURSING" -> "Nursing";
      case "PROCEDURE" -> "Procedure";
      default -> category.charAt(0) + category.substring(1).toLowerCase();
    };
  }
}
