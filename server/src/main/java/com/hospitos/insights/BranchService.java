package com.hospitos.insights;

import com.hospitos.common.CurrentUser;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.TextStyle;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Month-to-date comparison of the branches the user works in. */
@Service
public class BranchService {
  private final JdbcClient db;
  private final Scope scope;
  public BranchService(JdbcClient db, Scope scope) { this.db = db; this.scope = scope; }

  public record BranchStats(String id, String name, String city, BigDecimal revenueMonth, BigDecimal collectedMonth, int visitsMonth,
                            int doctors, int doctorsAvailable, int beds, int occupancy, Map<String, Integer> utilisation,
                            int patients, BigDecimal outstanding) {}

  public List<BranchStats> list() {
    var me = CurrentUser.get();
    LocalDate t = scope.today(), m = t.withDayOfMonth(1);
    String day = t.getDayOfWeek().getDisplayName(TextStyle.SHORT, Locale.ENGLISH);
    record B(String id, String name, String city) {}
    var branches = db.sql("select id, name, city from branch where active order by id").query((rs, n) -> new B(rs.getString(1), rs.getString(2), rs.getString(3)))
        .list().stream().filter(b -> me.canSee(b.id())).toList();
    return branches.stream().map(b -> {
      Map<String, Object> p = Map.of("b", b.id(), "m", m, "t", t);
      BigDecimal revenue = db.sql("select coalesce(sum(total),0) from billing_invoices where branch_id = :b and status <> 'CANCELLED' and invoice_date between :m and :t")
          .params(p).query(BigDecimal.class).single();
      BigDecimal collected = db.sql("select coalesce(sum(case when p.type = 'REFUND' then -p.amount else p.amount end),0) from billing_payments p " +
              "join billing_invoices i on i.id = p.invoice_id where i.branch_id = :b and p.received_at >= :s")
          .param("b", b.id()).param("s", scope.startOf(m)).query(BigDecimal.class).single();
      BigDecimal outstanding = db.sql("select coalesce(sum(total - paid + refunded),0) from billing_invoices where branch_id = :b and status in ('UNPAID','PARTIALLY_PAID')")
          .param("b", b.id()).query(BigDecimal.class).single();
      int visits = db.sql("select count(*) from appointment where branch_id = :b and appt_date between :m and :t and status not in ('Cancelled','No-show')")
          .params(p).query(Integer.class).single();
      int patients = db.sql("select count(*) from patient where branch_id = :b").param("b", b.id()).query(Integer.class).single();
      var docs = db.sql("""
          select id, status, days, start_time, end_time, slot_min, break_start, break_end,
                 exists (select 1 from doctor_leave l where l.doctor_id = d.id and l.leave_date = :t)
            from doctor d where branch_id = :b and active""")
          .param("b", b.id()).param("t", t)
          .query((rs, n) -> new Doc(rs.getString(1), rs.getString(2), (String[]) rs.getArray(3).getArray(), rs.getString(4), rs.getString(5),
              rs.getInt(6), rs.getString(7), rs.getString(8), rs.getBoolean(9))).list();
      int avail = (int) docs.stream().filter(d -> !d.leave() && List.of("Available", "In OPD", "Running late").contains(d.status())).count();
      // OPD utilisation today: booked minutes against the consulting minutes of the doctors working today.
      long capacity = docs.stream().filter(d -> !d.leave() && Arrays.asList(d.days()).contains(day)).mapToLong(BranchService::minutes).sum();
      long booked = db.sql("select coalesce(sum(duration_min),0) from appointment where branch_id = :b and appt_date = :t and status not in ('Cancelled','No-show')")
          .param("b", b.id()).param("t", t).query(Long.class).single();
      int opd = capacity == 0 ? 0 : (int) Math.min(100, Math.round(booked * 100.0 / capacity));
      return new BranchStats(b.id(), b.name(), b.city(), revenue, collected, visits, docs.size(), avail, 0, 0, Map.of("OPD", opd), patients, outstanding);
    }).toList();
  }

  record Doc(String id, String status, String[] days, String start, String end, int slot, String bs, String be, boolean leave) {}

  /** Consulting minutes in a doctor's day, less the break. */
  static long minutes(Doc d) {
    try {
      long m = Duration.between(LocalTime.parse(d.start()), LocalTime.parse(d.end())).toMinutes();
      if (d.bs() != null && d.be() != null) m -= Duration.between(LocalTime.parse(d.bs()), LocalTime.parse(d.be())).toMinutes();
      return Math.max(0, m);
    } catch (RuntimeException e) {
      return 0;
    }
  }
}
