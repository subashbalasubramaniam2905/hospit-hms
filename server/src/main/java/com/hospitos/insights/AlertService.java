package com.hospitos.insights;

import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The alerts centre. Rules look at the live tables each time the list is read and raise an alert per finding; the dedupe key
 * stops a finding from being raised twice. When a finding clears (stock received, sample collected), its open alert is resolved
 * automatically and its key is released, so the same problem can be raised again later.
 */
@Service
public class AlertService {
  private final JdbcClient db;
  private final Scope scope;
  private final AuditService audit;
  public AlertService(JdbcClient db, Scope scope, AuditService audit) { this.db = db; this.scope = scope; this.audit = audit; }

  public record Alert(long id, String branchId, String category, String priority, String title, String detail, String dept, String link,
                      String status, String assignee, String resolution, OffsetDateTime time) {}

  record Candidate(String key, String branchId, String category, String priority, String title, String detail, String dept, String link) {}

  @Transactional
  public List<Alert> list(String branch, String status) {
    String[] br = scope.branches(branch);
    refresh(br);
    return db.sql("""
        select id, branch_id, category, priority, title, detail, dept, link, status, assignee, resolution, raised_at
          from insight_alert a where (cast(:st as text) is null or status = :st) and""" + Scope.in("a") + """
           and (status <> 'Resolved' or updated_at >= :recent)
         order by case priority when 'Critical' then 0 when 'High' then 1 when 'Medium' then 2 else 3 end, raised_at desc limit 500""")
        .param("st", status == null || status.isBlank() ? null : status).param("br", br).param("recent", scope.now().minusDays(7))
        .query((rs, n) -> new Alert(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6),
            rs.getString(7), rs.getString(8), rs.getString(9), rs.getString(10), rs.getString(11), rs.getObject(12, OffsetDateTime.class))).list();
  }

  /** Raises alerts for new findings and clears open alerts whose finding has gone. */
  void refresh(String[] br) {
    var found = candidates(br);
    Set<String> keys = new HashSet<>();
    for (var c : found) {
      keys.add(c.key());
      db.sql("""
          insert into insight_alert (branch_id, dedupe_key, category, priority, title, detail, dept, link)
          values (:b, :k, :c, :p, :t, :d, :dept, :link) on conflict (dedupe_key) do nothing""")
          .param("b", c.branchId()).param("k", c.key()).param("c", c.category()).param("p", c.priority()).param("t", c.title())
          .param("d", c.detail()).param("dept", c.dept()).param("link", c.link()).update();
    }
    // Rule-raised alerts carry a key with a colon; '#' marks a key that was already released. When a finding has gone,
    // an alert still open is cleared, and the key of any alert for it is released so the problem can be raised again.
    var live = db.sql("select id, dedupe_key, status from insight_alert a where dedupe_key like '%:%' and dedupe_key not like '%#%' and " + Scope.in("a"))
        .param("br", br).query((rs, n) -> new Object[] { rs.getLong(1), rs.getString(2), rs.getString(3) }).list();
    for (var o : live) {
      if (keys.contains((String) o[1])) continue;
      boolean resolved = "Resolved".equals(o[2]);
      db.sql(resolved
          ? "update insight_alert set dedupe_key = dedupe_key || '#' || id where id = :id"
          : """
            update insight_alert set status = 'Resolved', resolution = 'Cleared automatically: the condition no longer applies',
                   dedupe_key = dedupe_key || '#' || id, updated_at = now() where id = :id""").param("id", o[0]).update();
    }
  }

  List<Candidate> candidates(String[] br) {
    LocalDate t = scope.today();
    var out = new ArrayList<Candidate>();
    db.sql("""
        select o.id, o.branch_id, p.name, t.name, r.param, r.value, tp.unit
          from lab_order o join patient p on p.id = o.patient_id join lab_result r on r.order_id = o.id
          join lab_test t on t.id = r.test_id left join lab_test_param tp on tp.test_id = r.test_id and tp.name = r.param
         where r.flag = 'C' and o.status in ('Result ready','Verified') and""" + Scope.in("o"))
        .param("br", br).query(rs -> {
          out.add(new Candidate("LABCRIT:" + rs.getString(1) + ":" + rs.getString(5), rs.getString(2), "Lab", "Critical",
              "Critical result for " + rs.getString(3), rs.getString(4) + " " + rs.getString(5) + " " + rs.getBigDecimal(6).stripTrailingZeros().toPlainString()
              + " " + (rs.getString(7) == null ? "" : rs.getString(7)) + " on order " + rs.getString(1) + ". Inform the treating doctor.", "Laboratory", "/lab/results"));
        });
    db.sql("""
        select o.id, o.branch_id, p.name, o.ordered_at from lab_order o join patient p on p.id = o.patient_id
         where o.priority = 'STAT' and o.status in ('Ordered','Awaiting sample') and o.ordered_at < :cut and""" + Scope.in("o"))
        .param("cut", scope.now().minusMinutes(30)).param("br", br).query(rs -> {
          out.add(new Candidate("STAT:" + rs.getString(1), rs.getString(2), "Lab", "High", "STAT sample not collected",
              "Order " + rs.getString(1) + " for " + rs.getString(3) + " was placed more than 30 minutes ago.", "Laboratory", "/lab/samples"));
        });
    db.sql("""
        select m.id, b.id, m.brand || ' ' || m.strength, s.stock, m.reorder from medicine m cross join branch b
          cross join lateral (select coalesce(sum(qty),0) as stock from medicine_batch mb where mb.medicine_id = m.id and mb.branch_id = b.id and mb.expiry >= :t) s
         where m.active and b.active and m.reorder > 0 and s.stock < m.reorder
           and (cast(:br as text[]) is null or b.id = any(cast(:br as text[])))""")
        .param("t", t).param("br", br).query(rs -> {
          int stock = rs.getInt(4);
          out.add(new Candidate("LOW:" + rs.getString(2) + ":" + rs.getString(1), rs.getString(2), "Pharmacy", stock == 0 ? "High" : "Medium",
              (stock == 0 ? "Out of stock: " : "Low stock: ") + rs.getString(3), stock + " in stock, reorder level " + rs.getInt(5) + ".", "Pharmacy", "/pharmacy/inventory"));
        });
    db.sql("""
        select mb.id, mb.branch_id, m.brand || ' ' || m.strength, mb.batch, mb.expiry, mb.qty from medicine_batch mb join medicine m on m.id = mb.medicine_id
         where mb.qty > 0 and mb.expiry <= :lim and""" + Scope.in("mb"))
        .param("lim", t.plusDays(30)).param("br", br).query(rs -> {
          LocalDate exp = rs.getObject(5, LocalDate.class);
          boolean gone = exp.isBefore(t);
          out.add(new Candidate((gone ? "EXPD:" : "EXP:") + rs.getString(1), rs.getString(2), "Pharmacy", gone ? "High" : "Medium",
              (gone ? "Expired stock on the shelf: " : "Expires within 30 days: ") + rs.getString(3),
              "Batch " + rs.getString(4) + ", " + rs.getInt(6) + " units, expiry " + exp + "." + (gone ? " Remove it from sale." : ""), "Pharmacy", "/pharmacy/inventory"));
        });
    db.sql("""
        select q.id, q.branch_id, q.token, p.name, dp.name, q.step, q.step_since from queue_entry q join patient p on p.id = q.patient_id
          join department dp on dp.id = q.dept_id
         where q.visit_date = :t and q.state = 'Active' and q.step < 6 and q.step_since < :cut and""" + Scope.in("q"))
        .param("t", t).param("cut", scope.now().minusMinutes(45)).param("br", br).query(rs -> {
          long mins = java.time.Duration.between(rs.getObject(7, OffsetDateTime.class), scope.now()).toMinutes();
          out.add(new Candidate("WAIT:" + rs.getLong(1) + ":" + rs.getInt(6), rs.getString(2), "Operations", "High",
              "Long wait: token " + rs.getString(3), rs.getString(4) + " has waited " + mins + " minutes at " + STEPS[rs.getInt(6)] + ".", rs.getString(5), "/queue"));
        });
    db.sql("""
        select c.id, c.branch_id, c.number, p.name, coalesce(c.rejection_reason, '') from billing_claims c join patient p on p.id = c.patient_id
         where c.status = 'REJECTED' and c.updated_at >= :since and""" + Scope.in("c"))
        .param("since", scope.now().minusDays(30)).param("br", br).query(rs -> {
          out.add(new Candidate("CLAIMREJ:" + rs.getString(1), rs.getString(2), "Billing", "Medium", "Claim rejected: " + rs.getString(3),
              rs.getString(4) + " (" + rs.getString(5) + "). Review and resubmit or bill the patient.", "Billing", "/insurance"));
        });
    return out;
  }

  static final String[] STEPS = { "Registration", "Billing", "Triage", "Consultation", "Lab / imaging", "Pharmacy", "Discharge" };

  @Transactional
  public Alert setStatus(long id, String status, String note) {
    if (!List.of("Open", "Acknowledged", "Resolved").contains(status)) throw new ApiException(400, "Unknown status");
    var a = visible(id);
    var me = CurrentUser.get();
    db.sql("update insight_alert set status = :s, resolution = case when :s = 'Resolved' then :n else null end, updated_at = now(), updated_by = :by where id = :id")
        .param("s", status).param("n", note == null || note.isBlank() ? "Resolved by " + me.name() : note.trim()).param("by", me.id()).param("id", id).update();
    audit.logForBranch(a.branchId(), status.equals("Open") ? "Reopened" : status, "Alert", String.valueOf(id), a.title() + (note == null || note.isBlank() ? "" : ": " + note.trim()));
    return visible(id);
  }

  @Transactional
  public Alert assign(long id, String assignee) {
    if (assignee == null || assignee.isBlank() || assignee.length() > 120) throw new ApiException(400, "Name who should handle it");
    var a = visible(id);
    db.sql("update insight_alert set assignee = :a, updated_at = now(), updated_by = :by where id = :id")
        .param("a", assignee.trim()).param("by", CurrentUser.get().id()).param("id", id).update();
    audit.logForBranch(a.branchId(), "Assigned", "Alert", String.valueOf(id), a.title() + " → " + assignee.trim());
    return visible(id);
  }

  @Transactional
  public int acknowledgeLow(String branch) {
    String[] br = scope.branches(branch);
    int n = db.sql("update insight_alert a set status = 'Acknowledged', updated_at = now(), updated_by = :by where status = 'Open' and priority = 'Low' and " + Scope.in("a"))
        .param("by", CurrentUser.get().id()).param("br", br).update();
    if (n > 0) audit.logForBranch(br == null ? null : br[0], "Acknowledged", "Alert", null, n + " low priority alerts");
    return n;
  }

  private Alert visible(long id) {
    var a = db.sql("select id, branch_id, category, priority, title, detail, dept, link, status, assignee, resolution, raised_at from insight_alert where id = :id")
        .param("id", id).query((rs, n) -> new Alert(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6),
            rs.getString(7), rs.getString(8), rs.getString(9), rs.getString(10), rs.getString(11), rs.getObject(12, OffsetDateTime.class))).optional();
    if (a.isEmpty() || !CurrentUser.get().canSee(a.get().branchId())) throw new ApiException(404, "Alert not found");
    return a.get();
  }
}
