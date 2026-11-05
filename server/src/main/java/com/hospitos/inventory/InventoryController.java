package com.hospitos.inventory;

import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.BranchScope;
import com.hospitos.common.CurrentUser;
import com.hospitos.inventory.InventoryService.Item;
import com.hospitos.inventory.InventoryService.Move;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** General stores: consumables, supplies and equipment, with issues to departments, stock counts and assets. */
@RestController
@RequestMapping("/api/inventory")
@PreAuthorize(InventoryController.READERS)
public class InventoryController {
  static final String READERS = "hasAnyRole('super-admin','admin','inventory','nurse','pharmacist')";
  static final String MANAGERS = "hasAnyRole('super-admin','admin','inventory')";
  private static final Set<String> CATEGORIES = Set.of("Consumables", "Surgical supplies", "Medical equipment", "General supplies", "Linen", "Housekeeping");
  private static final Set<String> ASSET_STATUS = Set.of("In use", "Available", "Under maintenance", "Retired");
  private final InventoryService stock;
  private final JdbcClient db;
  private final AuditService audit;
  private final Clock clock;
  public InventoryController(InventoryService stock, JdbcClient db, AuditService audit, Clock clock) { this.stock = stock; this.db = db; this.audit = audit; this.clock = clock; }

  public record ItemInput(@NotBlank @Size(max = 120) String name, @NotBlank String category, @NotBlank @Size(max = 20) String unit,
                          @Min(0) int reorder, @Size(max = 60) String location, @NotNull @DecimalMin("0") BigDecimal cost, LocalDate expiry,
                          String supplierId, String branchId, @Min(0) Integer openingStock) {}
  public record IssueInput(@Min(1) int qty, @NotBlank @Size(max = 60) String dept, @Size(max = 60) String ref) {}
  public record CountInput(@Min(0) int count, @Size(max = 200) String note) {}

  @GetMapping("/items")
  public List<Item> items(@RequestParam(required = false) String branch) {
    if (branch != null && !branch.isBlank()) BranchScope.check(branch, "Branch");
    return stock.items(branch == null || branch.isBlank() ? null : branch);
  }

  private void check(ItemInput in) {
    if (!CATEGORIES.contains(in.category())) throw new ApiException(400, "Unknown category: " + in.category());
    if (in.supplierId() != null && !in.supplierId().isBlank()
        && db.sql("select count(*) from supplier where id = ?").param(in.supplierId()).query(Integer.class).single() == 0)
      throw new ApiException(400, "Unknown supplier");
  }

  @PostMapping("/items")
  @PreAuthorize(MANAGERS)
  @ResponseStatus(HttpStatus.CREATED)
  public Item create(@Valid @RequestBody ItemInput in) {
    check(in);
    String br = BranchScope.pick(in.branchId());
    String id = "INV" + db.sql("select nextval('inventory_seq')").query(Long.class).single();
    db.sql("insert into inventory_item (id, branch_id, name, category, unit, reorder, location, cost, expiry, supplier_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .params(id, br, in.name().trim(), in.category(), in.unit().trim(), in.reorder(), in.location() == null ? "" : in.location().trim(), in.cost(),
            in.expiry(), in.supplierId() == null || in.supplierId().isBlank() ? null : in.supplierId()).update();
    audit.logForBranch(br, "Created", "Inventory", id, in.name());
    if (in.openingStock() != null && in.openingStock() > 0) return stock.receive(id, in.openingStock(), null, "Opening stock");
    return stock.item(id);
  }

  @PutMapping("/items/{id}")
  @PreAuthorize(MANAGERS)
  public Item update(@PathVariable String id, @Valid @RequestBody ItemInput in) {
    check(in);
    var cur = stock.item(id);
    db.sql("update inventory_item set name = ?, category = ?, unit = ?, reorder = ?, location = ?, cost = ?, expiry = ?, supplier_id = ? where id = ?")
        .params(in.name().trim(), in.category(), in.unit().trim(), in.reorder(), in.location() == null ? "" : in.location().trim(), in.cost(), in.expiry(),
            in.supplierId() == null || in.supplierId().isBlank() ? null : in.supplierId(), id).update();
    audit.logForBranch(cur.branchId(), "Updated", "Inventory", id, in.name());
    return stock.item(id);
  }

  @PostMapping("/items/{id}/issue")
  @PreAuthorize(MANAGERS)
  public Item issue(@PathVariable String id, @Valid @RequestBody IssueInput in) { return stock.issue(id, in.qty(), in.dept().trim(), in.ref()); }

  @PostMapping("/items/{id}/count")
  @PreAuthorize(MANAGERS)
  public Item count(@PathVariable String id, @Valid @RequestBody CountInput in) { return stock.count(id, in.count(), in.note()); }

  @GetMapping("/moves")
  public List<Move> moves(@RequestParam(required = false) String itemId, @RequestParam(required = false) String branch,
                          @RequestParam(defaultValue = "200") int limit) {
    if (itemId != null) stock.item(itemId);
    if (branch != null && !branch.isBlank()) BranchScope.check(branch, "Branch");
    return stock.moves(itemId, branch == null || branch.isBlank() ? null : branch, limit);
  }

  // ------------------------------------------------------------------ assets

  public record Asset(String id, String branchId, String name, String category, String tag, String location, String status,
                      LocalDate purchased, BigDecimal value, LocalDate nextService) {}
  public record AssetInput(@NotBlank @Size(max = 120) String name, @NotBlank @Size(max = 60) String category, @NotBlank @Size(max = 40) String tag,
                           @Size(max = 60) String location, LocalDate purchased, @NotNull @DecimalMin("0") BigDecimal value, LocalDate nextService, String branchId) {}
  public record StatusInput(@NotBlank String status) {}
  public record ServiceInput(LocalDate nextService, @Size(max = 200) String note) {}

  private static final String ASSET_COLS = "id, branch_id, name, category, tag, location, status, purchased, value, next_service";

  private Asset asset(String id) {
    var a = db.sql("select " + ASSET_COLS + " from asset where id = ?").param(id).query(Asset.class).optional().orElseThrow(() -> new ApiException(404, "Asset not found"));
    BranchScope.check(a.branchId(), "Asset");
    return a;
  }

  @GetMapping("/assets")
  public List<Asset> assets(@RequestParam(required = false) String branch) {
    var me = CurrentUser.get();
    if (branch != null && !branch.isBlank()) BranchScope.check(branch, "Branch");
    return db.sql("select " + ASSET_COLS + " from asset where (:b::text is null or branch_id = :b) and (:all or branch_id = any(:branches)) order by name")
        .param("b", branch == null || branch.isBlank() ? null : branch).param("all", me.superAdmin()).param("branches", me.branches().toArray(String[]::new))
        .query(Asset.class).list();
  }

  @PostMapping("/assets")
  @PreAuthorize(MANAGERS)
  @ResponseStatus(HttpStatus.CREATED)
  public Asset createAsset(@Valid @RequestBody AssetInput in) {
    String br = BranchScope.pick(in.branchId());
    String id = "AS" + db.sql("select nextval('inventory_seq')").query(Long.class).single();
    db.sql("insert into asset (id, branch_id, name, category, tag, location, purchased, value, next_service) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .params(id, br, in.name().trim(), in.category().trim(), in.tag().trim().toUpperCase(), in.location() == null ? "" : in.location().trim(),
            in.purchased(), in.value(), in.nextService()).update();
    audit.logForBranch(br, "Created", "Asset", id, in.tag() + " " + in.name());
    return asset(id);
  }

  @PostMapping("/assets/{id}/status")
  @PreAuthorize(MANAGERS)
  public Asset setStatus(@PathVariable String id, @Valid @RequestBody StatusInput in) {
    if (!ASSET_STATUS.contains(in.status())) throw new ApiException(400, "Unknown asset status");
    var a = asset(id);
    db.sql("update asset set status = ? where id = ?").params(in.status(), id).update();
    audit.logForBranch(a.branchId(), "Updated", "Asset", id, a.tag() + ": " + a.status() + " → " + in.status());
    return asset(id);
  }

  /** Records a service done today. The next service defaults to six months from today. */
  @PostMapping("/assets/{id}/service")
  @PreAuthorize(MANAGERS)
  public Asset serviced(@PathVariable String id, @Valid @RequestBody(required = false) ServiceInput in) {
    var a = asset(id);
    LocalDate today = LocalDate.now(clock);
    LocalDate next = in != null && in.nextService() != null ? in.nextService() : today.plusMonths(6);
    if (!next.isAfter(today)) throw new ApiException(400, "The next service must be after today");
    db.sql("update asset set next_service = ?, status = case when status = 'Under maintenance' then 'In use' else status end where id = ?").params(next, id).update();
    audit.logForBranch(a.branchId(), "Serviced", "Asset", id, a.tag() + " serviced; next " + next + (in != null && in.note() != null ? " · " + in.note() : ""));
    return asset(id);
  }
}
