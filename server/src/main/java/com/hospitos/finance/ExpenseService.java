package com.hospitos.finance;

import com.hospitos.audit.AuditService;
import com.hospitos.billing.service.BillingTime;
import com.hospitos.common.ApiException;
import com.hospitos.common.BranchScope;
import com.hospitos.common.CurrentUser;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Money the hospital spends outside pharmacy and store purchases: rent, salaries, utilities, repairs and so on.
 * An entry can be corrected, and a wrong one is cancelled (never deleted) so the audit trail stays whole. Every change is audited.
 */
@Service
public class ExpenseService {
  public static final Set<String> PAY_MODES = Set.of("CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE", "UNPAID");
  public static final Set<String> GROUPS = Set.of("Direct Expenses", "Indirect Expenses", "Fixed Assets", "Current Assets", "Loans (Liability)");
  /** Expenses older than this cannot be backdated, so a typo in the year is caught. */
  private static final int MAX_BACKDATE_DAYS = 400;

  private final JdbcClient db;
  private final AuditService audit;
  public ExpenseService(JdbcClient db, AuditService audit) { this.db = db; this.audit = audit; }

  public record Category(String id, String name, String tallyLedger, String tallyGroup, boolean active, int sortOrder, int version) {}

  public record Expense(UUID id, String number, String branchId, LocalDate date, String categoryId, String categoryName, String payee,
      String description, String billNo, BigDecimal amount, BigDecimal gstAmount, boolean interstate, BigDecimal tdsAmount, BigDecimal total,
      BigDecimal paid, String payMode, String reference, String status, String cancelReason, String createdBy, OffsetDateTime createdAt, int version) {}

  public record Input(LocalDate date, String categoryId, String payee, String description, String billNo, BigDecimal amount,
      BigDecimal gstAmount, Boolean interstate, BigDecimal tdsAmount, String payMode, String reference, String branchId, Integer version) {}

  public record Filter(LocalDate from, LocalDate to, String categoryId, String status, String q, String branchId) {}

  // ------------------------------------------------------------------ categories

  public List<Category> categories(boolean includeInactive) {
    return db.sql("select * from expense_category where active or :all order by sort_order, name").param("all", includeInactive)
        .query((r, i) -> new Category(r.getString("id"), r.getString("name"), r.getString("tally_ledger"), r.getString("tally_group"),
            r.getBoolean("active"), r.getInt("sort_order"), r.getInt("version"))).list();
  }

  public record CategoryInput(String name, String tallyLedger, String tallyGroup, Boolean active, Integer version) {}

  @Transactional
  public Category createCategory(CategoryInput in) {
    checkGroup(in.tallyGroup());
    String base = in.name().trim().toUpperCase().replaceAll("[^A-Z0-9]+", "_").replaceAll("^_|_$", "");
    if (base.isEmpty()) base = "CAT";
    if (base.length() > 24) base = base.substring(0, 24);
    String id = base; int n = 2;
    while (db.sql("select count(*) from expense_category where id = ?").param(id).query(Integer.class).single() > 0) id = base + "_" + n++;
    if (db.sql("select count(*) from expense_category where lower(name) = lower(?)").param(in.name().trim()).query(Integer.class).single() > 0)
      throw new ApiException(409, "A category called " + in.name().trim() + " already exists");
    db.sql("insert into expense_category (id, name, tally_ledger, tally_group, sort_order) values (?, ?, ?, ?, 500)")
        .params(id, in.name().trim(), in.tallyLedger().trim(), in.tallyGroup()).update();
    audit.log("Created", "ExpenseCategory", id, in.name().trim() + " -> " + in.tallyLedger().trim());
    return category(id);
  }

  @Transactional
  public Category updateCategory(String id, CategoryInput in) {
    checkGroup(in.tallyGroup());
    category(id);
    if (db.sql("select count(*) from expense_category where lower(name) = lower(?) and id <> ?").params(in.name().trim(), id).query(Integer.class).single() > 0)
      throw new ApiException(409, "A category called " + in.name().trim() + " already exists");
    int n = db.sql("update expense_category set name = ?, tally_ledger = ?, tally_group = ?, active = coalesce(?, active), version = version + 1 where id = ? and version = ?")
        .params(in.name().trim(), in.tallyLedger().trim(), in.tallyGroup(), in.active(), id, in.version() == null ? -1 : in.version()).update();
    if (n == 0) throw new ApiException(409, "This category was changed by someone else. Reload and try again");
    audit.log("Updated", "ExpenseCategory", id, in.name().trim() + " -> " + in.tallyLedger().trim() + (Boolean.FALSE.equals(in.active()) ? " (hidden)" : ""));
    return category(id);
  }

  private void checkGroup(String g) {
    if (!GROUPS.contains(g)) throw new ApiException(400, "Tally group must be one of " + String.join(", ", GROUPS));
  }

  public Category category(String id) {
    return categories(true).stream().filter(c -> c.id().equals(id)).findFirst().orElseThrow(() -> new ApiException(404, "Expense category not found"));
  }

  // ------------------------------------------------------------------ expenses

  private static final String SELECT = """
      select e.*, c.name as category_name from expense e join expense_category c on c.id = e.category_id""";

  private static Expense map(ResultSet r, int i) throws SQLException {
    BigDecimal amount = r.getBigDecimal("amount"), gst = r.getBigDecimal("gst_amount"), tds = r.getBigDecimal("tds_amount");
    return new Expense(r.getObject("id", UUID.class), r.getString("number"), r.getString("branch_id"), r.getObject("expense_date", LocalDate.class),
        r.getString("category_id"), r.getString("category_name"), r.getString("payee"), r.getString("description"), r.getString("bill_no"),
        amount, gst, r.getBoolean("interstate"), tds, amount.add(gst), amount.add(gst).subtract(tds), r.getString("pay_mode"), r.getString("reference"),
        r.getString("status"), r.getString("cancel_reason"), r.getString("created_by_name"), r.getObject("created_at", OffsetDateTime.class), r.getInt("version"));
  }

  /** Branches the signed-in user may see, or null for every branch (super administrator). */
  static String[] scope(String branchId) {
    var me = CurrentUser.get();
    if (branchId != null && !branchId.isBlank()) {
      if (!me.canSee(branchId)) throw new ApiException(403, "You do not have access to this branch");
      return new String[] { branchId };
    }
    return me.superAdmin() ? null : me.branches().toArray(String[]::new);
  }

  public List<Expense> search(Filter f, int limit, int offset) {
    String q = f.q() == null ? "" : f.q().trim();
    return db.sql(SELECT + """
         where (cast(:br as text[]) is null or e.branch_id = any(cast(:br as text[])))
           and (cast(:from as date) is null or e.expense_date >= cast(:from as date))
           and (cast(:to as date) is null or e.expense_date <= cast(:to as date))
           and (cast(:cat as text) is null or e.category_id = cast(:cat as text))
           and (cast(:st as text) is null or e.status = cast(:st as text))
           and (:q = '' or e.number ilike :like or e.payee ilike :like or coalesce(e.description, '') ilike :like or coalesce(e.bill_no, '') ilike :like)
         order by e.expense_date desc, e.created_at desc limit :lim offset :off""")
        .param("br", scope(f.branchId())).param("from", f.from()).param("to", f.to()).param("cat", blank(f.categoryId()))
        .param("st", blank(f.status())).param("q", q).param("like", "%" + q.replace("%", "\\%").replace("_", "\\_") + "%")
        .param("lim", limit).param("off", offset).query(ExpenseService::map).list();
  }

  public Expense get(UUID id) {
    var e = db.sql(SELECT + " where e.id = ?").param(id).query(ExpenseService::map).optional().orElseThrow(() -> new ApiException(404, "Expense not found"));
    BranchScope.check(e.branchId(), "Expense");
    return e;
  }

  private void validate(Input in, String currentCategory) {
    LocalDate today = BillingTime.today();
    if (in.date().isAfter(today)) throw new ApiException(422, "The expense date cannot be in the future");
    if (in.date().isBefore(today.minusDays(MAX_BACKDATE_DAYS))) throw new ApiException(422, "The expense date is more than a year ago. Check the year");
    if (!PAY_MODES.contains(in.payMode())) throw new ApiException(400, "Unknown payment mode " + in.payMode());
    var c = category(in.categoryId());
    // A hidden category takes no new entries, but older entries in it can still be corrected.
    if (!c.active() && !c.id().equals(currentCategory)) throw new ApiException(422, "The category " + c.name() + " is no longer in use");
    BigDecimal total = in.amount().add(zero(in.gstAmount()));
    if (zero(in.tdsAmount()).compareTo(total) > 0) throw new ApiException(422, "TDS cannot be more than the bill amount");
    if (zero(in.gstAmount()).compareTo(in.amount()) > 0) throw new ApiException(422, "GST is more than the amount before tax. Enter the amount before GST");
  }

  @Transactional
  public Expense create(Input in) {
    validate(in, null);
    var me = CurrentUser.get();
    String br = BranchScope.pick(in.branchId());
    String number = "EXP-" + db.sql("select nextval('expense_seq')").query(Long.class).single();
    UUID id = db.sql("""
        insert into expense (number, branch_id, expense_date, category_id, payee, description, bill_no, amount, gst_amount, interstate, tds_amount,
                             pay_mode, reference, created_by, created_by_name)
        values (:no, :br, :d, :cat, :payee, :desc, :bill, :amt, :gst, :inter, :tds, :mode, :ref, :uid, :uname) returning id""")
        .param("no", number).param("br", br).param("d", in.date()).param("cat", in.categoryId()).param("payee", in.payee().trim())
        .param("desc", trim(in.description())).param("bill", trim(in.billNo())).param("amt", money(in.amount())).param("gst", money(zero(in.gstAmount())))
        .param("inter", Boolean.TRUE.equals(in.interstate())).param("tds", money(zero(in.tdsAmount()))).param("mode", in.payMode())
        .param("ref", trim(in.reference())).param("uid", me.id()).param("uname", me.name()).query(UUID.class).single();
    audit.logForBranch(br, "Created", "Expense", number, in.payee().trim() + ", " + in.categoryId() + ", Rs " + money(in.amount().add(zero(in.gstAmount()))).toPlainString());
    return get(id);
  }

  @Transactional
  public Expense update(UUID id, Input in) {
    var cur = get(id);
    if (cur.status().equals("CANCELLED")) throw new ApiException(409, "A cancelled expense cannot be changed");
    validate(in, cur.categoryId());
    // An expense stays in its branch; moving it would hide it from the branch that paid.
    int n = db.sql("""
        update expense set expense_date = :d, category_id = :cat, payee = :payee, description = :desc, bill_no = :bill, amount = :amt,
          gst_amount = :gst, interstate = :inter, tds_amount = :tds, pay_mode = :mode, reference = :ref, updated_at = now(), version = version + 1
        where id = :id and version = :v""")
        .param("d", in.date()).param("cat", in.categoryId()).param("payee", in.payee().trim()).param("desc", trim(in.description()))
        .param("bill", trim(in.billNo())).param("amt", money(in.amount())).param("gst", money(zero(in.gstAmount())))
        .param("inter", Boolean.TRUE.equals(in.interstate())).param("tds", money(zero(in.tdsAmount()))).param("mode", in.payMode())
        .param("ref", trim(in.reference())).param("id", id).param("v", in.version() == null ? -1 : in.version()).update();
    if (n == 0) throw new ApiException(409, "This expense was changed by someone else. Reload and try again");
    audit.logForBranch(cur.branchId(), "Updated", "Expense", cur.number(), "Rs " + cur.total().toPlainString() + " -> Rs " + money(in.amount().add(zero(in.gstAmount()))).toPlainString());
    return get(id);
  }

  @Transactional
  public Expense cancel(UUID id, String reason, int version) {
    var cur = get(id);
    if (cur.status().equals("CANCELLED")) throw new ApiException(409, "This expense is already cancelled");
    int n = db.sql("update expense set status = 'CANCELLED', cancel_reason = ?, cancelled_at = now(), cancelled_by = ?, updated_at = now(), version = version + 1 where id = ? and version = ?")
        .params(reason.trim(), CurrentUser.get().name(), id, version).update();
    if (n == 0) throw new ApiException(409, "This expense was changed by someone else. Reload and try again");
    audit.logForBranch(cur.branchId(), "Cancelled", "Expense", cur.number(), reason.trim());
    return get(id);
  }

  // ------------------------------------------------------------------ summary

  public record Month(String month, BigDecimal total) {}
  public record CategoryTotal(String categoryId, String name, BigDecimal total, int count) {}
  public record Summary(BigDecimal thisMonth, BigDecimal lastMonth, int countThisMonth, BigDecimal unpaid, int unpaidCount,
      List<CategoryTotal> byCategoryThisMonth, List<Month> last6Months) {}

  public Summary summary(String branchId) {
    String[] br = scope(branchId);
    LocalDate today = BillingTime.today(), m0 = today.withDayOfMonth(1), m1 = m0.minusMonths(1), m5 = m0.minusMonths(5);
    String sc = " status = 'RECORDED' and (cast(:br as text[]) is null or branch_id = any(cast(:br as text[]))) ";
    var byCat = db.sql("select e.category_id, c.name, sum(e.amount + e.gst_amount), count(*) from expense e join expense_category c on c.id = e.category_id " +
            "where e.status = 'RECORDED' and (cast(:br as text[]) is null or e.branch_id = any(cast(:br as text[]))) and e.expense_date >= :s group by 1, 2 order by 3 desc")
        .param("br", br).param("s", m0).query((r, i) -> new CategoryTotal(r.getString(1), r.getString(2), r.getBigDecimal(3), r.getInt(4))).list();
    BigDecimal thisMonth = byCat.stream().map(CategoryTotal::total).reduce(BigDecimal.ZERO, BigDecimal::add);
    int count = byCat.stream().mapToInt(CategoryTotal::count).sum();
    BigDecimal last = db.sql("select coalesce(sum(amount + gst_amount), 0) from expense where " + sc + " and expense_date >= :s and expense_date < :e")
        .param("br", br).param("s", m1).param("e", m0).query(BigDecimal.class).single();
    record Unpaid(BigDecimal amount, int count) {}
    var unpaid = db.sql("select coalesce(sum(amount + gst_amount - tds_amount), 0), count(*) from expense where " + sc + " and pay_mode = 'UNPAID'")
        .param("br", br).query((r, i) -> new Unpaid(r.getBigDecimal(1), r.getInt(2))).single();
    var months = new LinkedHashMap<String, BigDecimal>();
    for (int k = 5; k >= 0; k--) months.put(m0.minusMonths(k).toString().substring(0, 7), BigDecimal.ZERO);
    db.sql("select to_char(expense_date, 'YYYY-MM'), sum(amount + gst_amount) from expense where " + sc + " and expense_date >= :s group by 1")
        .param("br", br).param("s", m5).query(rs -> { BigDecimal t = rs.getBigDecimal(2); months.computeIfPresent(rs.getString(1), (k, v) -> t); });
    var list = new ArrayList<Month>();
    for (Map.Entry<String, BigDecimal> e : months.entrySet()) list.add(new Month(e.getKey(), e.getValue()));
    return new Summary(thisMonth, last, count, unpaid.amount(), unpaid.count(), byCat, list);
  }

  // ------------------------------------------------------------------ helpers

  private static String blank(String s) { return s == null || s.isBlank() ? null : s.trim(); }
  private static String trim(String s) { return s == null || s.isBlank() ? null : s.trim(); }
  private static BigDecimal zero(BigDecimal b) { return b == null ? BigDecimal.ZERO : b; }
  private static BigDecimal money(BigDecimal b) { return b.setScale(2, RoundingMode.HALF_UP); }
}
