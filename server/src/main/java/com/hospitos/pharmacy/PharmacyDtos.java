package com.hospitos.pharmacy;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/** Request and response shapes for the pharmacy API. Field names follow the Angular models. */
public final class PharmacyDtos {
  private PharmacyDtos() {}

  public record Batch(UUID id, String batch, LocalDate expiry, int qty, String supplierId, BigDecimal cost, LocalDate received) {}

  /** A medicine with its stock in one branch. */
  public record Medicine(String id, String generic, String brand, String strength, String form, String category, String route,
                         BigDecimal price, BigDecimal gstPct, int reorder, String rack, String schedule, boolean active, int version,
                         String branchId, int stock, List<Batch> batches) {}

  public record MedicineInput(@NotBlank @Size(max = 120) String generic, @NotBlank @Size(max = 120) String brand,
                              @Size(max = 60) String strength, @NotBlank @Size(max = 40) String form,
                              @NotBlank @Size(max = 60) String category, @Size(max = 40) String route,
                              @NotNull @DecimalMin("0") BigDecimal price, @DecimalMin("0") BigDecimal gstPct,
                              @Min(0) Integer reorder, @Size(max = 20) String rack, @Size(max = 10) String schedule,
                              Boolean active, Integer version) {}

  public record Supplier(String id, String name, String contact, String phone, String gst, String city, String type, BigDecimal rating) {}

  public record FefoPick(UUID batchId, String batch, LocalDate expiry, int take) {}

  public record ReceiveInput(String branchId, @NotBlank @Size(max = 40) String batch, @NotNull LocalDate expiry,
                             @NotNull @Min(1) Integer qty, String supplierId, @DecimalMin("0") BigDecimal cost,
                             @Size(max = 60) String ref) {}

  public record AdjustInput(@NotNull UUID batchId, @NotNull Integer delta, @NotBlank @Size(max = 200) String note,
                            Boolean returnToSupplier) {}

  public record TransferInput(@NotBlank String medicineId, String fromBranchId, @NotBlank String toBranchId, @NotNull @Min(1) Integer qty) {}

  public record StockMove(UUID id, OffsetDateTime at, String branchId, String itemId, String name, UUID batchId, String batch,
                          String kind, int qty, String ref, String by, String note) {}

  public record DispenseLineInput(@NotBlank String medicineId, @NotNull @Min(0) Integer qty, String substitutedFor) {}

  public record DispenseInput(@NotNull UUID prescriptionId, @NotBlank String payMode, Boolean counselled,
                              @NotEmpty @Valid List<DispenseLineInput> lines) {}

  public record DispensedLine(String medicineId, String name, String substitutedFor, int requested, int qty, BigDecimal rate,
                              BigDecimal gstPct, BigDecimal amount, List<FefoPick> batches) {}

  public record LowStock(String medicineId, String name, int stock, int reorder) {}

  public record DispenseResult(UUID id, UUID prescriptionId, String patientId, String branchId, String status, boolean partial,
                               String payMode, BigDecimal total, UUID invoiceId, String invoiceNumber, List<DispensedLine> lines,
                               List<LowStock> lowStock, OffsetDateTime at, String by) {}

  public record DispenseSummary(UUID id, UUID prescriptionId, String patientId, String patientName, String branchId, boolean partial,
                                String payMode, BigDecimal total, String invoiceNumber, OffsetDateTime at, String by) {}
}
