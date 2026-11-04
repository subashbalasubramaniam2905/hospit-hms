package com.hospitos.billing.service;

import com.hospitos.common.CurrentUser;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Figures for the billing overview. Days run midnight to midnight IST. */
@Service
public class SummaryService {
  private final JdbcClient db;
  public SummaryService(JdbcClient db) { this.db = db; }

  public record Day(LocalDate date, Map<String, BigDecimal> byKind) {}
  public record Summary(LocalDate date, BigDecimal collectedToday, int invoicesToday, BigDecimal outstanding, int outstandingCount,
      BigDecimal insuranceReceivable, BigDecimal refundsThisMonth, Map<String, BigDecimal> byModeToday, List<Day> last7Days) {}

  public Summary get(String branchId) {
    var me = CurrentUser.get();
    String[] br = branchId != null ? new String[] { branchId } : me.superAdmin() ? null : me.branches().toArray(String[]::new);
    LocalDate today = BillingTime.today();
    OffsetDateTime start = BillingTime.startOf(today).toOffsetDateTime(), end = BillingTime.startOf(today.plusDays(1)).toOffsetDateTime();
    OffsetDateTime weekStart = BillingTime.startOf(today.minusDays(6)).toOffsetDateTime();
    OffsetDateTime monthStart = BillingTime.startOf(today.withDayOfMonth(1)).toOffsetDateTime();
    String scope = " (cast(:br as text[]) is null or i.branch_id = any(cast(:br as text[]))) ";

    var byMode = new LinkedHashMap<String, BigDecimal>();
    db.sql("select p.mode, sum(p.amount) from billing_payments p join billing_invoices i on i.id = p.invoice_id where p.type = 'PAYMENT' " +
            "and p.received_at >= :s and p.received_at < :e and " + scope + " group by p.mode order by 2 desc")
        .param("s", start).param("e", end).param("br", br)
        .query(rs -> { byMode.put(rs.getString(1), rs.getBigDecimal(2)); });
    BigDecimal collected = byMode.entrySet().stream().filter(e -> !e.getKey().equals("INSURANCE"))
        .map(Map.Entry::getValue).reduce(BigDecimal.ZERO, BigDecimal::add);

    var week = new LinkedHashMap<LocalDate, Map<String, BigDecimal>>();
    for (int d = 6; d >= 0; d--) week.put(today.minusDays(d), new LinkedHashMap<>(Map.of("OPD", BigDecimal.ZERO, "PHARMACY", BigDecimal.ZERO, "LAB", BigDecimal.ZERO, "IPD", BigDecimal.ZERO)));
    db.sql("select (p.received_at at time zone 'Asia/Kolkata')::date, i.kind, sum(p.amount) from billing_payments p join billing_invoices i on i.id = p.invoice_id " +
            "where p.type = 'PAYMENT' and p.mode not in ('ADVANCE','INSURANCE') and p.received_at >= :s and p.received_at < :e and " + scope + " group by 1, 2")
        .param("s", weekStart).param("e", end).param("br", br)
        .query(rs -> { var m = week.get(rs.getObject(1, LocalDate.class)); if (m != null) m.put(rs.getString(2), rs.getBigDecimal(3)); });
    var days = new ArrayList<Day>();
    week.forEach((d, m) -> days.add(new Day(d, m)));

    BigDecimal refunds = db.sql("select coalesce(sum(p.amount), 0) from billing_payments p join billing_invoices i on i.id = p.invoice_id " +
            "where p.type = 'REFUND' and p.received_at >= :s and " + scope).param("s", monthStart).param("br", br).query(BigDecimal.class).single();
    record Out(BigDecimal amount, int count) {}
    Out out = db.sql("select coalesce(sum(i.total - i.paid + i.refunded), 0), count(*) from billing_invoices i where i.status in ('UNPAID','PARTIALLY_PAID') and " + scope)
        .param("br", br).query((r, n) -> new Out(r.getBigDecimal(1), r.getInt(2))).single();
    int countToday = db.sql("select count(*) from billing_invoices i where i.invoice_date = :d and i.status <> 'CANCELLED' and " + scope)
        .param("d", today).param("br", br).query(Integer.class).single();
    BigDecimal ins = db.sql("select coalesce(sum(case when i.approved > 0 then i.approved else i.claimed end), 0) from billing_claims i " +
            "where i.status in ('SUBMITTED','UNDER_REVIEW','APPROVED') and " + scope).param("br", br).query(BigDecimal.class).single();
    return new Summary(today, collected, countToday, out.amount(), out.count(), ins, refunds, byMode, days);
  }
}
