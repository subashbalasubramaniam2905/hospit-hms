package com.hospitos.pharmacy;

import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import com.hospitos.pharmacy.PharmacyDtos.AdjustInput;
import com.hospitos.pharmacy.PharmacyDtos.DispenseInput;
import com.hospitos.pharmacy.PharmacyDtos.DispenseResult;
import com.hospitos.pharmacy.PharmacyDtos.DispenseSummary;
import com.hospitos.pharmacy.PharmacyDtos.FefoPick;
import com.hospitos.pharmacy.PharmacyDtos.Medicine;
import com.hospitos.pharmacy.PharmacyDtos.MedicineInput;
import com.hospitos.pharmacy.PharmacyDtos.ReceiveInput;
import com.hospitos.pharmacy.PharmacyDtos.StockMove;
import com.hospitos.pharmacy.PharmacyDtos.Supplier;
import com.hospitos.pharmacy.PharmacyDtos.TransferInput;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/**
 * Pharmacy formulary, branch stock and dispensing. Stock is held per branch; reads default to the user's first branch
 * and accept ?branchId= for any other branch the user can see.
 */
@RestController
@RequestMapping("/api/pharmacy")
@PreAuthorize("hasAnyRole('super-admin','admin','pharmacist','doctor','nurse','inventory')")
public class PharmacyController {
  static final String STAFF = "hasAnyRole('super-admin','admin','pharmacist')";
  private final PharmacyRepository repo;
  private final StockService stock;
  private final DispenseService dispensing;
  private final AuditService audit;

  public PharmacyController(PharmacyRepository repo, StockService stock, DispenseService dispensing, AuditService audit) {
    this.repo = repo; this.stock = stock; this.dispensing = dispensing; this.audit = audit;
  }

  @GetMapping("/medicines")
  public List<Medicine> medicines(@RequestParam(required = false) String branchId, @RequestParam(defaultValue = "") String q,
                                  @RequestParam(defaultValue = "false") boolean includeInactive) {
    return repo.list(StockService.branch(CurrentUser.get(), branchId), q, includeInactive);
  }

  @GetMapping("/medicines/{id}")
  public Medicine medicine(@PathVariable String id, @RequestParam(required = false) String branchId) {
    return repo.get(id, StockService.branch(CurrentUser.get(), branchId)).orElseThrow(() -> new ApiException(404, "Medicine not found"));
  }

  /** The batches a quantity would be taken from, first expiry first. Expired batches are skipped. */
  @GetMapping("/medicines/{id}/fefo")
  public List<FefoPick> fefo(@PathVariable String id, @RequestParam int qty, @RequestParam(required = false) String branchId) {
    if (repo.medicine(id).isEmpty()) throw new ApiException(404, "Medicine not found");
    return repo.plan(id, StockService.branch(CurrentUser.get(), branchId), Math.max(qty, 0));
  }

  @PostMapping("/medicines")
  @ResponseStatus(HttpStatus.CREATED)
  @PreAuthorize(STAFF)
  @Transactional
  public Medicine create(@Valid @RequestBody MedicineInput in) {
    var me = CurrentUser.get();
    String id = repo.nextMedicineId();
    repo.insert(id, in);
    audit.logForBranch(me.homeBranch(), "Created", "Medicine", id, in.brand().trim() + " " + (in.strength() == null ? "" : in.strength().trim()));
    return repo.get(id, StockService.branch(me, null)).orElseThrow();
  }

  @PutMapping("/medicines/{id}")
  @PreAuthorize(STAFF)
  @Transactional
  public Medicine update(@PathVariable String id, @Valid @RequestBody MedicineInput in) {
    var before = repo.medicine(id).orElseThrow(() -> new ApiException(404, "Medicine not found"));
    if (in.version() == null) throw new ApiException(400, "version is required");
    if (!repo.update(id, in)) throw new ApiException(409, "Someone else updated this medicine. Reload and try again");
    String detail = before.price().compareTo(in.price()) != 0 ? "Price " + before.price() + " to " + in.price() : "Details updated";
    audit.logForBranch(CurrentUser.get().homeBranch(), "Updated", "Medicine", id, before.label() + ": " + detail);
    return repo.get(id, StockService.branch(CurrentUser.get(), null)).orElseThrow();
  }

  @GetMapping("/suppliers")
  public List<Supplier> suppliers() { return repo.suppliers(); }

  @PostMapping("/medicines/{id}/batches")
  @ResponseStatus(HttpStatus.CREATED)
  @PreAuthorize(STAFF)
  public Medicine receive(@PathVariable String id, @Valid @RequestBody ReceiveInput in) { return stock.receive(id, in); }

  @PostMapping("/stock/adjust")
  @PreAuthorize(STAFF)
  public Medicine adjust(@Valid @RequestBody AdjustInput in) { return stock.adjust(in); }

  @PostMapping("/stock/transfer")
  @PreAuthorize(STAFF)
  public Medicine transfer(@Valid @RequestBody TransferInput in) { return stock.transfer(in); }

  @GetMapping("/stock/moves")
  public List<StockMove> moves(@RequestParam(required = false) String branchId, @RequestParam(required = false) String medicineId,
                               @RequestParam(defaultValue = "200") int limit) {
    return repo.moves(StockService.branch(CurrentUser.get(), branchId), medicineId, Math.min(Math.max(limit, 1), 1000));
  }

  @PostMapping("/dispense")
  @ResponseStatus(HttpStatus.CREATED)
  @PreAuthorize(STAFF)
  public DispenseResult dispense(@Valid @RequestBody DispenseInput in) { return dispensing.dispense(in); }

  /** Quantity of each prescribed medicine still to be handed out, after earlier partial dispenses. */
  @GetMapping("/prescriptions/{id}/remaining")
  @PreAuthorize(STAFF)
  public Map<String, Integer> remaining(@PathVariable UUID id) { return dispensing.remaining(id); }

  @GetMapping("/dispenses")
  @PreAuthorize(STAFF)
  public List<DispenseSummary> dispenses(@RequestParam(required = false) String branchId,
                                         @RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to,
                                         @RequestParam(defaultValue = "100") int limit) {
    LocalDate f = from == null ? LocalDate.now() : from, t = to == null ? f : to;
    return repo.dispenses(StockService.branch(CurrentUser.get(), branchId), f, t, Math.min(Math.max(limit, 1), 500));
  }
}
