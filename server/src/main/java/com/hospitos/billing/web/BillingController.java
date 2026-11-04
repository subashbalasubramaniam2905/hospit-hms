package com.hospitos.billing.web;

import com.hospitos.billing.api.InvoiceKind;
import com.hospitos.billing.api.LineCategory;
import com.hospitos.billing.api.NewInvoice;
import com.hospitos.billing.api.PayMode;
import com.hospitos.billing.model.BillingSettings;
import com.hospitos.billing.model.Invoice;
import com.hospitos.billing.model.TariffItem;
import com.hospitos.billing.model.TaxRate;
import com.hospitos.billing.service.InvoiceService;
import com.hospitos.billing.service.SettingsService;
import com.hospitos.billing.service.SummaryService;
import com.hospitos.billing.service.TariffService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** Invoices, receipts, refunds, tariff and GST settings. */
@RestController
@RequestMapping("/api/billing")
@PreAuthorize(BillingController.READERS)
public class BillingController {
  static final String READERS = "hasAnyRole('super-admin','admin','billing','receptionist','pharmacist','lab-tech','radiologist')";
  static final String CASHIERS = "hasAnyRole('super-admin','admin','billing','receptionist')";
  static final String MANAGERS = "hasAnyRole('super-admin','admin')";

  private final InvoiceService invoices;
  private final TariffService tariff;
  private final SettingsService settings;
  private final SummaryService summary;

  public BillingController(InvoiceService invoices, TariffService tariff, SettingsService settings, SummaryService summary) {
    this.invoices = invoices; this.tariff = tariff; this.settings = settings; this.summary = summary;
  }

  // ---- settings and tariff

  public record SettingsView(BillingSettings settings, List<TaxRate> taxRates, String branchGstin) {}

  @GetMapping("/settings")
  public SettingsView settings(@RequestParam(required = false) String branchId) {
    var s = settings.get();
    var me = CurrentUser.get();
    String br = branchId != null && me.canSee(branchId) ? branchId : me.branches().isEmpty() ? null : me.branches().get(0);
    return new SettingsView(s, settings.taxRates(), br == null ? s.gstin() : settings.gstinFor(br, s));
  }

  public record SettingsInput(@NotBlank @Size(max = 200) String legalName, @NotBlank @Size(max = 200) String tradeName,
      @NotBlank @Size(min = 15, max = 15) String gstin, @NotBlank @Pattern(regexp = "\\d{2}") String stateCode,
      @NotBlank @Size(max = 60) String stateName, @NotBlank @Size(max = 400) String address, @Size(max = 40) String phone,
      @Size(max = 120) String email, @DecimalMin("0") @DecimalMax("100") BigDecimal discountApprovalPct,
      @DecimalMin("0") @DecimalMax("100") BigDecimal defaultCopayPct, @Size(max = 500) String invoiceFooter,
      @NotNull Integer version) {}

  @PutMapping("/settings")
  @PreAuthorize(MANAGERS)
  public BillingSettings updateSettings(@Valid @RequestBody SettingsInput in) {
    return settings.update(new SettingsService.SettingsUpdate(in.legalName(), in.tradeName(), in.gstin(), in.stateCode(),
        in.stateName(), in.address(), in.phone(), in.email(), in.discountApprovalPct(), in.defaultCopayPct(),
        in.invoiceFooter(), in.version()));
  }

  public record RateInput(@NotNull @DecimalMin("0") @DecimalMax("28") BigDecimal gstPct, @Size(max = 8) String hsnSac,
      @Size(max = 200) String note) {}

  @PutMapping("/tax-rates/{category}")
  @PreAuthorize(MANAGERS)
  public TaxRate updateRate(@PathVariable LineCategory category, @Valid @RequestBody RateInput in) {
    return settings.updateRate(category, in.gstPct(), in.hsnSac(), in.note());
  }

  @GetMapping("/tariff")
  public List<TariffItem> tariff(@RequestParam(defaultValue = "") String q, @RequestParam(required = false) LineCategory category,
                                 @RequestParam(defaultValue = "false") boolean includeInactive) {
    return tariff.search(q, includeInactive, category == null ? null : category.name());
  }

  public record TariffBody(@NotBlank @Size(max = 30) @Pattern(regexp = "[A-Za-z0-9-]+") String code,
      @NotBlank @Size(max = 200) String name, @NotNull LineCategory category, @NotNull @DecimalMin("0") BigDecimal price,
      @DecimalMin("0") @DecimalMax("28") BigDecimal taxPct, @Size(max = 8) String hsnSac, @Size(max = 60) String department,
      Boolean active, Integer version) {
    TariffService.TariffInput input() {
      return new TariffService.TariffInput(code, name, category, price, taxPct, hsnSac, department, active, version);
    }
  }

  @PostMapping("/tariff")
  @PreAuthorize(MANAGERS)
  @ResponseStatus(HttpStatus.CREATED)
  public TariffItem createTariff(@Valid @RequestBody TariffBody in) { return tariff.create(in.input()); }

  @PutMapping("/tariff/{id}")
  @PreAuthorize(MANAGERS)
  public TariffItem updateTariff(@PathVariable UUID id, @Valid @RequestBody TariffBody in) { return tariff.update(id, in.input()); }

  // ---- invoices

  @GetMapping("/summary")
  public SummaryService.Summary summary(@RequestParam(required = false) String branchId) {
    if (branchId != null && !CurrentUser.get().canSee(branchId)) throw new ApiException(403, "You cannot see this branch");
    return summary.get(branchId);
  }

  private static final Set<String> STATUSES = Set.of("UNPAID", "PARTIALLY_PAID", "PAID", "REFUNDED", "CANCELLED", "OUTSTANDING");

  @GetMapping("/invoices")
  public List<Invoice> list(@RequestParam(required = false) String patientId, @RequestParam(required = false) String status,
      @RequestParam(required = false) InvoiceKind kind,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
      @RequestParam(defaultValue = "") String q, @RequestParam(required = false) String branchId,
      @RequestParam(defaultValue = "200") int limit, @RequestParam(defaultValue = "0") int offset) {
    String st = status == null || status.isBlank() ? null : status.toUpperCase();
    if (st != null && !STATUSES.contains(st)) throw new ApiException(400, "Unknown status " + status);
    return invoices.search(new InvoiceService.Filter(patientId, st, kind, from, to, q, branchId),
        Math.min(Math.max(limit, 1), 1000), Math.max(offset, 0));
  }

  @GetMapping("/invoices/{id}")
  public Invoice get(@PathVariable UUID id) { return invoices.get(id); }

  @PostMapping("/invoices")
  @PreAuthorize(CASHIERS)
  @ResponseStatus(HttpStatus.CREATED)
  public Invoice create(@Valid @RequestBody NewInvoice in) { return invoices.create(in); }

  public record PaymentInput(@NotNull PayMode mode, @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal amount,
      @Size(max = 100) String reference) {}

  @PostMapping("/invoices/{id}/payments")
  @PreAuthorize(CASHIERS)
  @ResponseStatus(HttpStatus.CREATED)
  public Invoice pay(@PathVariable UUID id, @Valid @RequestBody PaymentInput in) {
    if (in.mode() == PayMode.INSURANCE) throw new ApiException(422, "Insurance money is posted by settling the claim");
    invoices.pay(id, in.mode(), in.amount(), in.reference());
    return invoices.get(id);
  }

  public record RefundInput(@NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal amount, PayMode mode,
      @NotBlank @Size(max = 300) String reason) {}

  @PostMapping("/invoices/{id}/refunds")
  @PreAuthorize(CASHIERS)
  @ResponseStatus(HttpStatus.CREATED)
  public Invoice refund(@PathVariable UUID id, @Valid @RequestBody RefundInput in) {
    invoices.refund(id, in.amount(), in.mode(), in.reason());
    return invoices.get(id);
  }

  public record CancelInput(@NotBlank @Size(max = 300) String reason) {}

  @PostMapping("/invoices/{id}/cancel")
  @PreAuthorize(MANAGERS)
  public Invoice cancel(@PathVariable UUID id, @Valid @RequestBody CancelInput in) { return invoices.cancel(id, in.reason()); }

  /** Which of the given references (e.g. consultation ids) are already on a live invoice. */
  @GetMapping("/billed")
  public Set<String> billed(@RequestParam String refType, @RequestParam List<String> refIds) {
    return invoices.billedRefs(refType, refIds.size() > 1000 ? refIds.subList(0, 1000) : refIds);
  }
}
