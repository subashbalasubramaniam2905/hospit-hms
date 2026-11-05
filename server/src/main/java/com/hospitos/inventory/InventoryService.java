package com.hospitos.inventory;

import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.BranchScope;
import com.hospitos.common.CurrentUser;
import com.hospitos.notifications.NotificationService;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * General stores stock (not medicines, which live in pharmacy). Other modules can call {@link #issue} to take consumables
 * out of stock, for example for an operation or a ward. Every change writes a movement and an audit entry.
 */
@Service
public class InventoryService {
  private final JdbcClient db;
  private final AuditService audit;
  private final NotificationService notes;
  public InventoryService(JdbcClient db, AuditService audit, NotificationService notes) { this.db = db; this.audit = audit; this.notes = notes; }

  public record Item(String id, String branchId, String name, String category, String unit, int stock, int reorder, String location,
                     BigDecimal cost, LocalDate expiry, String supplierId) {}
  public record Move(long id, String itemId, String itemName, java.time.OffsetDateTime at, String kind, int qty, String ref, String byName, String note) {}

  static final String ITEM_COLS = "id, branch_id, name, category, unit, stock, reorder, location, cost, expiry, supplier_id";

  public List<Item> items(String branchId) {
    var me = CurrentUser.get();
    return db.sql("select " + ITEM_COLS + " from inventory_item where active and (:b::text is null or branch_id = :b) and (:all or branch_id = any(:branches)) order by name")
        .param("b", branchId).param("all", me.superAdmin()).param("branches", me.branches().toArray(String[]::new)).query(Item.class).list();
  }

  public Item item(String id) {
    var i = db.sql("select " + ITEM_COLS + " from inventory_item where id = ? and active").param(id).query(Item.class).optional()
        .orElseThrow(() -> new ApiException(404, "Item not found"));
    BranchScope.check(i.branchId(), "Item");
    return i;
  }

  private Item lock(String id) {
    item(id);
    return db.sql("select " + ITEM_COLS + " from inventory_item where id = ? for update").param(id).query(Item.class).single();
  }

  private void move(Item i, String kind, int qty, String ref, String note) {
    db.sql("insert into inventory_move (branch_id, item_id, kind, qty, ref, by_name, note) values (?, ?, ?, ?, ?, ?, ?)")
        .params(i.branchId(), i.id(), kind, qty, ref == null ? "" : ref, CurrentUser.get().name(), note).update();
  }

  private void lowStock(Item before, int after) {
    if (before.stock() > before.reorder() && after <= before.reorder())
      notes.inApp("inventory", before.branchId(), new NotificationService.Note(before.name() + " below reorder level",
          after + " " + before.unit() + " left at " + before.location() + " (reorder at " + before.reorder() + ").", "/inventory", "triangle-alert", "a"));
  }

  /** Takes stock out to a department. Joins the caller's transaction. */
  @Transactional
  public Item issue(String itemId, int qty, String dept, String ref) {
    if (qty <= 0) throw new ApiException(400, "Quantity must be at least 1");
    var i = lock(itemId);
    if (qty > i.stock()) throw new ApiException(409, "Only " + i.stock() + " " + i.unit() + " of " + i.name() + " in stock");
    db.sql("update inventory_item set stock = stock - ? where id = ?").params(qty, itemId).update();
    move(i, "Issue", -qty, dept + (ref == null || ref.isBlank() ? "" : " · " + ref), null);
    audit.logForBranch(i.branchId(), "Issued", "Inventory", itemId, qty + " " + i.unit() + " " + i.name() + " to " + dept);
    lowStock(i, i.stock() - qty);
    return item(itemId);
  }

  @Transactional
  public Item receive(String itemId, int qty, BigDecimal cost, String ref) {
    if (qty <= 0) throw new ApiException(400, "Quantity must be at least 1");
    var i = lock(itemId);
    db.sql("update inventory_item set stock = stock + ?, cost = coalesce(?, cost) where id = ?").params(qty, cost, itemId).update();
    move(i, "Receipt", qty, ref, null);
    audit.logForBranch(i.branchId(), "Received", "Inventory", itemId, "+" + qty + " " + i.unit() + " " + i.name() + (ref == null ? "" : " against " + ref));
    return item(itemId);
  }

  /** Sets the counted quantity and records the difference as an adjustment. */
  @Transactional
  public Item count(String itemId, int counted, String note) {
    if (counted < 0) throw new ApiException(400, "A count cannot be negative");
    var i = lock(itemId);
    int diff = counted - i.stock();
    if (diff == 0) return i;
    db.sql("update inventory_item set stock = ? where id = ?").params(counted, itemId).update();
    move(i, "Adjustment", diff, "Stock count", note);
    audit.logForBranch(i.branchId(), "Changed", "Inventory", itemId, i.name() + " count corrected by " + (diff > 0 ? "+" : "") + diff);
    lowStock(i, counted);
    return item(itemId);
  }

  public List<Move> moves(String itemId, String branchId, int limit) {
    var me = CurrentUser.get();
    return db.sql("""
        select m.id, m.item_id, i.name as item_name, m.at, m.kind, m.qty, m.ref, m.by_name, m.note
        from inventory_move m join inventory_item i on i.id = m.item_id
        where (:item::text is null or m.item_id = :item) and (:b::text is null or m.branch_id = :b) and (:all or m.branch_id = any(:branches))
        order by m.id desc limit :limit""")
        .param("item", itemId).param("b", branchId).param("all", me.superAdmin()).param("branches", me.branches().toArray(String[]::new))
        .param("limit", Math.min(Math.max(limit, 1), 1000)).query(Move.class).list();
  }
}
