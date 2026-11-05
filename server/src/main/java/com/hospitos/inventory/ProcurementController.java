package com.hospitos.inventory;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.BranchScope;
import com.hospitos.common.CurrentUser;
import com.hospitos.pharmacy.PharmacyDtos.ReceiveInput;
import com.hospitos.pharmacy.StockService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/**
 * Requisition → approval → issue from store, and purchase order → approval → sent to supplier → goods receipt.
 * Receiving an Inventory order adds to general stores; receiving a Pharmacy order adds medicine batches to pharmacy stock.
 * Nothing is emailed to suppliers yet.
 */
@RestController
@RequestMapping("/api/procurement")
@PreAuthorize(InventoryController.READERS)
public class ProcurementController {
  static final String BUYERS = "hasAnyRole('super-admin','admin','inventory','pharmacist')";
  static final String APPROVERS = "hasAnyRole('super-admin','admin')";
  /** Orders above this need a super administrator, and nobody approves their own order. */
  static final BigDecimal SECOND_APPROVAL = new BigDecimal("100000");
  private final JdbcClient db;
  private final ObjectMapper json;
  private final AuditService audit;
  private final InventoryService stores;
  private final StockService pharmacy;
  private final Clock clock;
  public ProcurementController(JdbcClient db, ObjectMapper json, AuditService audit, InventoryService stores, StockService pharmacy, Clock clock) {
    this.db = db; this.json = json; this.audit = audit; this.stores = stores; this.pharmacy = pharmacy; this.clock = clock;
  }

  private String write(Object o) { try { return json.writeValueAsString(o); } catch (JsonProcessingException e) { throw new IllegalStateException(e); } }
  private <T> T read(String s, TypeReference<T> t) { try { return json.readValue(s, t); } catch (JsonProcessingException e) { throw new IllegalStateException(e); } }

  // ------------------------------------------------------------------ suppliers

  public record Supplier(String id, String name, String contact, String phone, String gst, String city, String type, BigDecimal rating) {}

  @GetMapping("/suppliers")
  public List<Supplier> suppliers() {
    return db.sql("select id, name, contact, phone, gst, city, type, rating from supplier where active order by name").query(Supplier.class).list();
  }

  // ------------------------------------------------------------------ requisitions

  public record ReqItem(String itemId, String name, int qty) {}
  public record Requisition(String id, String branchId, String dept, List<ReqItem> items, String status, String requestedBy, String decidedBy, OffsetDateTime createdAt) {}
  public record ReqLine(@NotBlank String itemId, @Min(1) int qty) {}
  public record ReqInput(@NotBlank @Size(max = 60) String dept, @NotEmpty @Size(max = 50) List<@Valid ReqLine> items, String branchId) {}
  public record Decision(@NotBlank String status) {}

  private Requisition req(java.sql.ResultSet r) throws java.sql.SQLException {
    return new Requisition(r.getString("id"), r.getString("branch_id"), r.getString("dept"), read(r.getString("items"), new TypeReference<List<ReqItem>>() {}),
        r.getString("status"), r.getString("requested_by"), r.getString("decided_by"), r.getObject("created_at", OffsetDateTime.class));
  }

  private Requisition req(String id, boolean lock) {
    var q = db.sql("select * from requisition where id = ?" + (lock ? " for update" : "")).param(id).query((r, i) -> req(r)).optional()
        .orElseThrow(() -> new ApiException(404, "Requisition not found"));
    BranchScope.check(q.branchId(), "Requisition");
    return q;
  }

  @GetMapping("/requisitions")
  public List<Requisition> requisitions() {
    var me = CurrentUser.get();
    return db.sql("select * from requisition where :all or branch_id = any(:branches) order by created_at desc limit 500")
        .param("all", me.superAdmin()).param("branches", me.branches().toArray(String[]::new)).query((r, i) -> req(r)).list();
  }

  @PostMapping("/requisitions")
  @ResponseStatus(HttpStatus.CREATED)
  public Requisition requisition(@Valid @RequestBody ReqInput in) {
    String br = BranchScope.pick(in.branchId());
    var items = new ArrayList<ReqItem>();
    for (var l : in.items()) {
      var it = stores.item(l.itemId());
      if (!it.branchId().equals(br)) throw new ApiException(400, it.name() + " is stocked in another branch");
      items.add(new ReqItem(it.id(), it.name(), l.qty()));
    }
    String id = "RQ-" + db.sql("select nextval('requisition_seq')").query(Long.class).single();
    db.sql("insert into requisition (id, branch_id, dept, items, requested_by) values (?, ?, ?, ?::jsonb, ?)")
        .params(id, br, in.dept().trim(), write(items), CurrentUser.get().name()).update();
    audit.logForBranch(br, "Created", "Requisition", id, in.dept() + ": " + items.size() + " item(s)");
    return req(id, false);
  }

  @PostMapping("/requisitions/{id}/decide")
  @PreAuthorize(InventoryController.MANAGERS)
  @Transactional
  public Requisition decide(@PathVariable String id, @Valid @RequestBody Decision in) {
    if (!Set.of("Approved", "Rejected").contains(in.status())) throw new ApiException(400, "Status must be Approved or Rejected");
    var r = req(id, true);
    if (!"Pending".equals(r.status())) throw new ApiException(409, "This requisition is already " + r.status().toLowerCase());
    db.sql("update requisition set status = ?, decided_by = ? where id = ?").params(in.status(), CurrentUser.get().name(), id).update();
    audit.logForBranch(r.branchId(), in.status(), "Requisition", id, r.dept());
    return req(id, false);
  }

  /** Issues every line from store. If any line is short, nothing is issued. */
  @PostMapping("/requisitions/{id}/issue")
  @PreAuthorize(InventoryController.MANAGERS)
  @Transactional
  public Requisition issue(@PathVariable String id) {
    var r = req(id, true);
    if (!"Approved".equals(r.status())) throw new ApiException(409, "Only approved requisitions can be issued");
    for (var l : r.items()) stores.issue(l.itemId(), l.qty(), r.dept(), id);
    db.sql("update requisition set status = 'Issued' where id = ?").param(id).update();
    audit.logForBranch(r.branchId(), "Issued", "Requisition", id, r.dept());
    return req(id, false);
  }

  // ------------------------------------------------------------------ purchase orders

  public record PoItem(String itemId, String name, int qty, BigDecimal cost, Integer received, String batch, LocalDate expiry) {}
  public record PurchaseOrder(String id, String branchId, String supplierId, String supplierName, String kind, String status, List<PoItem> items,
                              BigDecimal total, String requestedBy, String approvedBy, LocalDate expected, OffsetDateTime receivedAt,
                              OffsetDateTime createdAt, int version) {}
  public record PoLine(@NotBlank String itemId, @Min(1) int qty, @NotNull @DecimalMin("0") BigDecimal cost) {}
  public record PoInput(@NotBlank String kind, @NotBlank String supplierId, @NotEmpty @Size(max = 100) List<@Valid PoLine> items, String branchId) {}
  public record PoStatus(@NotBlank String status, @NotNull Integer version, LocalDate expected) {}
  public record ReceiptLine(@NotBlank String itemId, @Min(0) int received, @Size(max = 40) String batch, LocalDate expiry) {}
  public record Receipt(@NotNull @Size(max = 100) List<@Valid ReceiptLine> lines, @NotNull Integer version) {}

  private static BigDecimal total(List<PoItem> items) {
    return items.stream().map(i -> i.cost().multiply(BigDecimal.valueOf(i.received() != null ? i.received() : i.qty())))
        .reduce(BigDecimal.ZERO, BigDecimal::add).setScale(2, RoundingMode.HALF_UP);
  }

  private PurchaseOrder po(java.sql.ResultSet r) throws java.sql.SQLException {
    var items = read(r.getString("items"), new TypeReference<List<PoItem>>() {});
    return new PurchaseOrder(r.getString("id"), r.getString("branch_id"), r.getString("supplier_id"), r.getString("supplier_name"), r.getString("kind"),
        r.getString("status"), items, total(items), r.getString("requested_by"), r.getString("approved_by"), r.getObject("expected", LocalDate.class),
        r.getObject("received_at", OffsetDateTime.class), r.getObject("created_at", OffsetDateTime.class), r.getInt("version"));
  }

  private static final String PO_SQL = "select p.*, s.name as supplier_name from purchase_order p join supplier s on s.id = p.supplier_id";

  private PurchaseOrder po(String id, boolean lock) {
    var p = db.sql(PO_SQL + " where p.id = ?" + (lock ? " for update of p" : "")).param(id).query((r, i) -> po(r)).optional()
        .orElseThrow(() -> new ApiException(404, "Purchase order not found"));
    BranchScope.check(p.branchId(), "Purchase order");
    return p;
  }

  @GetMapping("/orders")
  public List<PurchaseOrder> orders() {
    var me = CurrentUser.get();
    return db.sql(PO_SQL + " where :all or p.branch_id = any(:branches) order by p.created_at desc limit 500")
        .param("all", me.superAdmin()).param("branches", me.branches().toArray(String[]::new)).query((r, i) -> po(r)).list();
  }

  @PostMapping("/orders")
  @PreAuthorize(BUYERS)
  @ResponseStatus(HttpStatus.CREATED)
  public PurchaseOrder create(@Valid @RequestBody PoInput in) {
    if (!Set.of("Pharmacy", "Inventory").contains(in.kind())) throw new ApiException(400, "Type must be Pharmacy or Inventory");
    var me = CurrentUser.get();
    if ("pharmacist".equals(me.role()) && !"Pharmacy".equals(in.kind())) throw new ApiException(403, "Pharmacists raise pharmacy orders only");
    String br = BranchScope.pick(in.branchId());
    if (db.sql("select count(*) from supplier where id = ? and active").param(in.supplierId()).query(Integer.class).single() == 0)
      throw new ApiException(400, "Unknown supplier");
    var items = new ArrayList<PoItem>();
    for (var l : in.items()) {
      String name;
      if ("Pharmacy".equals(in.kind())) {
        name = db.sql("select brand || ' ' || strength from medicine where id = ?").param(l.itemId()).query(String.class).optional()
            .orElseThrow(() -> new ApiException(400, "Unknown medicine " + l.itemId()));
      } else {
        var it = stores.item(l.itemId());
        if (!it.branchId().equals(br)) throw new ApiException(400, it.name() + " is stocked in another branch");
        name = it.name();
      }
      if (items.stream().anyMatch(x -> x.itemId().equals(l.itemId()))) throw new ApiException(400, name + " is listed twice");
      items.add(new PoItem(l.itemId(), name, l.qty(), l.cost(), null, null, null));
    }
    String id = "PO-" + db.sql("select nextval('po_seq')").query(Long.class).single();
    db.sql("insert into purchase_order (id, branch_id, supplier_id, kind, items, requested_by) values (?, ?, ?, ?, ?::jsonb, ?)")
        .params(id, br, in.supplierId(), in.kind(), write(items), me.name()).update();
    audit.logForBranch(br, "Created", "Purchase order", id, in.kind() + " · " + items.size() + " line(s) · ₹" + total(items));
    return po(id, false);
  }

  /** Requested → Approved → Ordered, or Cancelled before it is received. */
  @PostMapping("/orders/{id}/status")
  @PreAuthorize(BUYERS)
  @Transactional
  public PurchaseOrder status(@PathVariable String id, @Valid @RequestBody PoStatus in) {
    var p = po(id, true);
    var me = CurrentUser.get();
    if (p.version() != in.version()) throw new ApiException(409, "Someone else changed this order. Reload and try again");
    String to = in.status();
    switch (to) {
      case "Approved" -> {
        if (!"Requested".equals(p.status())) throw new ApiException(409, "Only requested orders can be approved");
        if (!Set.of("super-admin", "admin").contains(me.role())) throw new ApiException(403, "Only an administrator can approve purchase orders");
        if (p.requestedBy().equals(me.name()) && !me.superAdmin()) throw new ApiException(403, "Someone other than the requester must approve this order");
        if (p.total().compareTo(SECOND_APPROVAL) > 0 && !me.superAdmin()) throw new ApiException(403, "Orders above ₹1,00,000 need a super administrator's approval");
        db.sql("update purchase_order set status = 'Approved', approved_by = ?, version = version + 1 where id = ?").params(me.name(), id).update();
      }
      case "Ordered" -> {
        if (!"Approved".equals(p.status())) throw new ApiException(409, "Approve the order before sending it");
        LocalDate exp = in.expected() != null ? in.expected() : LocalDate.now(clock).plusDays(3);
        db.sql("update purchase_order set status = 'Ordered', expected = ?, version = version + 1 where id = ?").params(exp, id).update();
      }
      case "Cancelled" -> {
        if (Set.of("Received", "Cancelled").contains(p.status())) throw new ApiException(409, "This order is already " + p.status().toLowerCase());
        db.sql("update purchase_order set status = 'Cancelled', version = version + 1 where id = ?").param(id).update();
      }
      default -> throw new ApiException(400, "Status must be Approved, Ordered or Cancelled");
    }
    audit.logForBranch(p.branchId(), to, "Purchase order", id, p.supplierName() + " · ₹" + p.total());
    return po(id, false);
  }

  /** Records the goods received against an ordered PO and puts them into stock. Lines left out count as fully received. */
  @PostMapping("/orders/{id}/receive")
  @PreAuthorize(BUYERS)
  @Transactional
  public PurchaseOrder receive(@PathVariable String id, @Valid @RequestBody Receipt in) {
    var p = po(id, true);
    if (p.version() != in.version()) throw new ApiException(409, "Someone else changed this order. Reload and try again");
    if (!"Ordered".equals(p.status())) throw new ApiException(409, "Only orders sent to the supplier can be received");
    Map<String, ReceiptLine> got = in.lines().stream().collect(Collectors.toMap(ReceiptLine::itemId, Function.identity(), (a, b) -> b));
    for (String k : got.keySet()) if (p.items().stream().noneMatch(i -> i.itemId().equals(k))) throw new ApiException(400, k + " is not on this order");
    var done = new ArrayList<PoItem>();
    for (var i : p.items()) {
      var l = got.get(i.itemId());
      int qty = l == null ? i.qty() : l.received();
      if (qty > i.qty()) throw new ApiException(400, "More " + i.name() + " received than ordered (" + i.qty() + ")");
      String batch = null; LocalDate expiry = null;
      if (qty > 0) {
        if ("Pharmacy".equals(p.kind())) {
          if (l == null || l.batch() == null || l.batch().isBlank() || l.expiry() == null)
            throw new ApiException(400, "Enter the batch number and expiry for " + i.name());
          batch = l.batch().trim(); expiry = l.expiry();
          pharmacy.receive(i.itemId(), new ReceiveInput(p.branchId(), batch, expiry, qty, p.supplierId(), i.cost(), id));
        } else {
          stores.receive(i.itemId(), qty, i.cost(), id);
        }
      }
      done.add(new PoItem(i.itemId(), i.name(), i.qty(), i.cost(), qty, batch, expiry));
    }
    db.sql("update purchase_order set status = 'Received', items = ?::jsonb, received_at = now(), version = version + 1 where id = ?")
        .params(write(done), id).update();
    audit.logForBranch(p.branchId(), "Received", "Purchase order", id, p.supplierName() + " · ₹" + total(done));
    return po(id, false);
  }
}
