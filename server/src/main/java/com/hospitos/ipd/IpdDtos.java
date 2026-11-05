package com.hospitos.ipd;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/** Request and response shapes for the inpatient API. Field names follow the Angular models (Ward, Bed, Admission). */
public final class IpdDtos {
  private IpdDtos() {}

  public record Ward(String id, String branchId, String name, String type, String floor, BigDecimal rate, boolean active) {}

  public record Bed(String id, String wardId, String branchId, String label, String status, String admissionId, boolean active) {}

  public record Note(UUID id, String date, String author, String type, String text) {}

  public record Mar(UUID id, String med, String dose, String route, String time, LocalDate date, String status, String by,
                    String orderedBy, String note) {}

  public record Io(UUID id, String time, OffsetDateTime at, String kind, String type, int ml, String by) {}

  public record Obs(UUID id, String time, OffsetDateTime at, String bp, int hr, BigDecimal temp, int spo2, int rr, int pain, int news,
                    String by) {}

  public record Deposit(UUID id, String kind, String receiptNo, BigDecimal amount, String mode, String reference, String by,
                        OffsetDateTime at) {}

  public record Charge(UUID id, String tariffCode, String description, String category, BigDecimal qty, BigDecimal rate, String by,
                       OffsetDateTime at) {}

  /**
   * An admission in the Angular shape. {@code advance} is the money deposited so far; {@code depositBalance} is what is
   * left after refunds and the amount adjusted against the final bill. Front desk and billing staff get the clinical
   * lists (notes, MAR, observations, intake/output, care plan, discharge summary) empty.
   */
  public record Admission(String id, String branchId, String patientId, String patientName, String doctorId, String doctorName,
                          String deptId, String bedId, String bedLabel, String wardId, String wardName, String admittedOn,
                          String reason, String diagnosis, String type, String status, LocalDate expectedDischarge,
                          String dischargeDate, String dischargeSummary, List<String> dischargeChecklist, String dischargedBy,
                          List<Note> notes, List<Mar> mar, List<Io> io, List<Obs> obs, List<String> carePlan,
                          BigDecimal advance, BigDecimal depositBalance, List<Deposit> deposits, List<Charge> charges,
                          String erCaseId, UUID claimId, UUID invoiceId, String invoiceNumber, int version) {}

  public record AdmitResult(Admission admission, String claimNumber, String warning) {}

  // ---------- inputs ----------

  public record WardInput(@NotBlank @Size(max = 60) String name,
                          @NotBlank @Pattern(regexp = "General|Semi-private|Private|ICU|Maternity|Pediatric") String type,
                          @Size(max = 40) String floor, @NotNull @DecimalMin("0") @DecimalMax("200000") BigDecimal rate,
                          @Size(max = 10) String branchId, Boolean active) {}

  public record BedInput(@NotBlank @Size(max = 20) String label) {}

  public record BedStatusInput(@NotBlank String status) {}

  public record AdmitInput(@NotBlank @Size(max = 20) String patientId, @NotBlank @Size(max = 20) String doctorId,
                           @NotBlank @Size(max = 40) String bedId,
                           @Pattern(regexp = "Planned|Emergency|Day care|Maternity") String type,
                           @NotBlank @Size(max = 300) String reason, @Size(max = 300) String diagnosis,
                           LocalDate expectedDischarge,
                           @DecimalMin("0") @DecimalMax("10000000") BigDecimal advance,
                           @Pattern(regexp = "CASH|UPI|CARD|BANK_TRANSFER|ONLINE") String advanceMode,
                           @Size(max = 60) String advanceReference,
                           Boolean consent, Boolean preauth, @Size(max = 40) String erCaseId) {}

  public record TransferInput(@NotBlank @Size(max = 40) String bedId) {}

  public record UpdateInput(@Size(max = 300) String diagnosis, LocalDate expectedDischarge, @NotNull Integer version) {}

  public record NoteInput(@NotBlank @Pattern(regexp = "Progress|Nursing|Handover|Doctor round") String type,
                          @NotBlank @Size(max = 4000) String text) {}

  public record CarePlanInput(@NotBlank @Size(max = 300) String text) {}

  public record MarInput(@NotBlank @Size(max = 120) String med, @Size(max = 40) String dose,
                         @NotBlank @Pattern(regexp = "PO|Oral|IV|IM|SC|SL|Topical|Inhaled|PR|Nasal") String route,
                         @NotBlank @Pattern(regexp = "([01][0-9]|2[0-3]):[0-5][0-9]") String time, LocalDate date) {}

  public record MarStatusInput(@NotBlank @Pattern(regexp = "Given|Held|Missed") String status, @Size(max = 300) String note) {}

  public record ObsInput(@NotBlank @Pattern(regexp = "\\d{2,3}/\\d{2,3}") String bp, @NotNull @Min(20) @Max(250) Integer hr,
                         @NotNull @DecimalMin("85") @DecimalMax("110") BigDecimal temp, @NotNull @Min(50) @Max(100) Integer spo2,
                         @NotNull @Min(4) @Max(60) Integer rr, @NotNull @Min(0) @Max(10) Integer pain) {}

  public record IoInput(@NotBlank @Pattern(regexp = "Intake|Output") String kind, @Size(max = 60) String type,
                        @NotNull @Min(1) @Max(10000) Integer ml) {}

  public record DepositInput(@NotNull @Positive @DecimalMax("10000000") BigDecimal amount,
                             @Pattern(regexp = "CASH|UPI|CARD|BANK_TRANSFER|ONLINE") String mode, @Size(max = 60) String reference) {}

  public record RefundInput(@Pattern(regexp = "CASH|UPI|CARD|BANK_TRANSFER|ONLINE") String mode, @Size(max = 60) String reference) {}

  public record ChargeInput(@Size(max = 30) String tariffCode, @Size(max = 200) String description,
                            @Pattern(regexp = "CONSULTATION|PROCEDURE|LABORATORY|IMAGING|PHARMACY|ROOM|NURSING|OT|OTHER") String category,
                            @NotNull @Positive @DecimalMax("1000") BigDecimal qty, @DecimalMin("0") @DecimalMax("10000000") BigDecimal rate) {}

  public record DischargeInput(@NotBlank @Size(min = 20, max = 20000) String summary, List<@Size(max = 120) String> checklist) {}

  // ---------- bill preview ----------

  public record BillLine(String description, String category, String tariffCode, BigDecimal qty, BigDecimal rate, BigDecimal amount) {}

  /** The running bill before GST: what the final invoice will hold if the patient is discharged now. */
  public record BillPreview(String admissionId, int days, List<BillLine> lines, BigDecimal subtotal, BigDecimal deposits,
                            BigDecimal depositBalance, BigDecimal estimatedDue, UUID invoiceId, String invoiceNumber) {}
}
