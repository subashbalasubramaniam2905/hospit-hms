package com.hospitos.insights;

import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Revenue leakage: services delivered without a live invoice, discounts above the approval limit, balances unpaid after three days
 * and rejected insurance claims. A finding someone waived or approved (leakage_review) drops off the list.
 */
@Service
public class LeakageService {
  private final JdbcClient db;
  private final Scope scope;
  private final AuditService audit;
  public LeakageService(JdbcClient db, Scope scope, AuditService audit) { this.db = db; this.scope = scope; this.audit = audit; }

  public static final String CONSULTATION = "Consultation not billed", LAB = "Lab test not billed", DISCOUNT = "High discount",
      UNPAID = "Unpaid over 3 days", CLAIM = "Claim rejected";

  public record Finding(String key, String kind, String branchId, String patientId, String patientName, LocalDate date, String detail,
                        BigDecimal amount, String ref) {}

  private static final String NOT_REVIEWED = " not exists (select 1 from leakage_review r where r.finding_key = %s) ";

  public List<Finding> list(String branch) {
    String[] br = scope.branches(branch);
    LocalDate t = scope.today();
    var out = new ArrayList<Finding>();
    db.sql("""
        select c.id, c.branch_id, c.patient_id, p.name, cast(c.completed_at as date), d.name, d.fee
          from consultation c join patient p on p.id = c.patient_id join doctor d on d.id = c.doctor_id
         where c.status = 'Completed' and c.completed_at >= :since and""" + DashboardService.UNBILLED_CONSULTATION + " and" + Scope.in("c"))
        .param("since", scope.startOf(t.minusDays(90))).param("br", br)
        .query(rs -> { out.add(new Finding("CONS:" + rs.getString(1), CONSULTATION, rs.getString(2), rs.getString(3), rs.getString(4),
            rs.getObject(5, LocalDate.class), "Consultation with " + rs.getString(6), rs.getBigDecimal(7), rs.getString(1))); });
    db.sql("""
        select o.id, o.branch_id, o.patient_id, p.name, cast(o.ordered_at as date),
               (select string_agg(t.name, ', ' order by ot.position) from lab_order_test ot join lab_test t on t.id = ot.test_id where ot.order_id = o.id),
               (select coalesce(sum(price),0) from lab_order_test ot where ot.order_id = o.id)
          from lab_order o join patient p on p.id = o.patient_id
         where not o.billed and""" + String.format(NOT_REVIEWED, "'LAB:' || o.id") + " and" + Scope.in("o"))
        .param("br", br)
        .query(rs -> { out.add(new Finding("LAB:" + rs.getString(1), LAB, rs.getString(2), rs.getString(3), rs.getString(4),
            rs.getObject(5, LocalDate.class), rs.getString(1) + ": " + rs.getString(6), rs.getBigDecimal(7), rs.getString(1))); });
    db.sql("""
        select i.id, i.branch_id, i.patient_id, p.name, i.invoice_date, i.number, i.discount_pct, i.discount_amount
          from billing_invoices i join patient p on p.id = i.patient_id
         where i.status <> 'CANCELLED' and i.discount_pct > (select discount_approval_pct from billing_settings where id = 1)
           and i.invoice_date >= :since and""" + String.format(NOT_REVIEWED, "'DISC:' || i.id::text") + " and" + Scope.in("i"))
        .param("since", t.minusDays(90)).param("br", br)
        .query(rs -> { out.add(new Finding("DISC:" + rs.getString(1), DISCOUNT, rs.getString(2), rs.getString(3), rs.getString(4),
            rs.getObject(5, LocalDate.class), rs.getString(6) + ": " + rs.getBigDecimal(7).stripTrailingZeros().toPlainString() + "% discount",
            rs.getBigDecimal(8), rs.getString(1))); });
    db.sql("""
        select i.id, i.branch_id, i.patient_id, p.name, i.invoice_date, i.number, i.total - i.paid + i.refunded
          from billing_invoices i join patient p on p.id = i.patient_id
         where i.status in ('UNPAID','PARTIALLY_PAID') and i.invoice_date < :cut
           and not exists (select 1 from billing_claims c where c.invoice_id = i.id and c.status <> 'REJECTED')
           and""" + String.format(NOT_REVIEWED, "'UNPAID:' || i.id::text") + " and" + Scope.in("i"))
        .param("cut", t.minusDays(3)).param("br", br)
        .query(rs -> { out.add(new Finding("UNPAID:" + rs.getString(1), UNPAID, rs.getString(2), rs.getString(3), rs.getString(4),
            rs.getObject(5, LocalDate.class), rs.getString(6) + " balance due", rs.getBigDecimal(7), rs.getString(1))); });
    db.sql("""
        select c.id, c.branch_id, c.patient_id, p.name, cast(c.updated_at as date), c.number, coalesce(c.rejection_reason, 'Rejected'), c.claimed
          from billing_claims c join patient p on p.id = c.patient_id
         where c.status = 'REJECTED' and""" + String.format(NOT_REVIEWED, "'CLAIM:' || c.id::text") + " and" + Scope.in("c"))
        .param("br", br)
        .query(rs -> { out.add(new Finding("CLAIM:" + rs.getString(1), CLAIM, rs.getString(2), rs.getString(3), rs.getString(4),
            rs.getObject(5, LocalDate.class), rs.getString(6) + ": " + rs.getString(7), rs.getBigDecimal(8), rs.getString(1))); });
    out.sort(Comparator.comparing(Finding::date, Comparator.nullsLast(Comparator.reverseOrder())));
    return out;
  }

  /** Waives an unbilled charge or approves a discount, with a reason that goes to the audit trail. */
  @Transactional
  public void review(String key, String action, String reason) {
    if (!List.of("Waived", "Approved").contains(action)) throw new ApiException(400, "action must be Waived or Approved");
    if (reason == null || reason.trim().length() < 3) throw new ApiException(400, "Give a reason");
    var f = list(null).stream().filter(x -> x.key().equals(key)).findFirst()
        .orElseThrow(() -> new ApiException(404, "That finding is not open any more"));
    if (action.equals("Waived") && !List.of(CONSULTATION, LAB).contains(f.kind())) throw new ApiException(400, "Only unbilled services can be waived");
    var me = CurrentUser.get();
    db.sql("insert into leakage_review (finding_key, branch_id, kind, action, reason, amount, reviewed_by) values (:k, :b, :kind, :a, :r, :amt, :by)")
        .param("k", key).param("b", f.branchId()).param("kind", f.kind()).param("a", action).param("r", reason.trim()).param("amt", f.amount())
        .param("by", me.id()).update();
    audit.logForBranch(f.branchId(), action, "Revenue leakage", key, f.detail() + " ₹" + f.amount().toPlainString() + ": " + reason.trim());
  }
}
