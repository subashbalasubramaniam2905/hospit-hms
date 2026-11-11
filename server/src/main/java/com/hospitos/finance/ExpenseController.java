package com.hospitos.finance;

import com.hospitos.finance.ExpenseService.Category;
import com.hospitos.finance.ExpenseService.Expense;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** Hospital expenses other than pharmacy and store purchases, with their categories. */
@RestController
@RequestMapping("/api/expenses")
@PreAuthorize(ExpenseController.ACCOUNTS)
public class ExpenseController {
  /** Accounts staff record and correct expenses. */
  static final String ACCOUNTS = "hasAnyRole('super-admin','admin','billing')";
  /** Managers cancel expenses, change categories and Tally ledgers. */
  static final String MANAGERS = "hasAnyRole('super-admin','admin')";

  private final ExpenseService expenses;
  public ExpenseController(ExpenseService expenses) { this.expenses = expenses; }

  public record ExpenseBody(@NotNull LocalDate date, @NotBlank String categoryId, @NotBlank @Size(max = 120) String payee,
      @Size(max = 300) String description, @Size(max = 40) String billNo,
      @NotNull @DecimalMin(value = "0", inclusive = false) @Digits(integer = 10, fraction = 2) BigDecimal amount,
      @DecimalMin("0") @Digits(integer = 10, fraction = 2) BigDecimal gstAmount, Boolean interstate,
      @DecimalMin("0") @Digits(integer = 10, fraction = 2) BigDecimal tdsAmount,
      @NotBlank String payMode, @Size(max = 100) String reference, String branchId, Integer version) {
    ExpenseService.Input input() {
      return new ExpenseService.Input(date, categoryId, payee, description, billNo, amount, gstAmount, interstate, tdsAmount, payMode, reference, branchId, version);
    }
  }

  @GetMapping
  public List<Expense> list(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
      @RequestParam(required = false) String category, @RequestParam(required = false) String status,
      @RequestParam(defaultValue = "") String q, @RequestParam(required = false) String branchId,
      @RequestParam(defaultValue = "500") int limit, @RequestParam(defaultValue = "0") int offset) {
    String st = status == null || status.isBlank() ? null : status.toUpperCase();
    return expenses.search(new ExpenseService.Filter(from, to, category, st, q, branchId), Math.min(Math.max(limit, 1), 2000), Math.max(offset, 0));
  }

  @GetMapping("/summary")
  public ExpenseService.Summary summary(@RequestParam(required = false) String branchId) { return expenses.summary(branchId); }

  @GetMapping("/{id}")
  public Expense get(@PathVariable UUID id) { return expenses.get(id); }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public Expense create(@Valid @RequestBody ExpenseBody in) { return expenses.create(in.input()); }

  @PutMapping("/{id}")
  public Expense update(@PathVariable UUID id, @Valid @RequestBody ExpenseBody in) { return expenses.update(id, in.input()); }

  public record CancelBody(@NotBlank @Size(max = 300) String reason, @NotNull Integer version) {}

  @PostMapping("/{id}/cancel")
  @PreAuthorize(MANAGERS)
  public Expense cancel(@PathVariable UUID id, @Valid @RequestBody CancelBody in) { return expenses.cancel(id, in.reason(), in.version()); }

  // ---- categories

  @GetMapping("/categories")
  public List<Category> categories(@RequestParam(defaultValue = "false") boolean includeInactive) { return expenses.categories(includeInactive); }

  public record CategoryBody(@NotBlank @Size(max = 80) String name, @NotBlank @Size(max = 120) String tallyLedger,
      @NotBlank String tallyGroup, Boolean active, Integer version) {
    ExpenseService.CategoryInput input() { return new ExpenseService.CategoryInput(name, tallyLedger, tallyGroup, active, version); }
  }

  @PostMapping("/categories")
  @PreAuthorize(MANAGERS)
  @ResponseStatus(HttpStatus.CREATED)
  public Category createCategory(@Valid @RequestBody CategoryBody in) { return expenses.createCategory(in.input()); }

  @PutMapping("/categories/{id}")
  @PreAuthorize(MANAGERS)
  public Category updateCategory(@PathVariable String id, @Valid @RequestBody CategoryBody in) { return expenses.updateCategory(id, in.input()); }
}
