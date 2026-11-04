package com.hospitos.lab;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Request and response shapes for the laboratory API. Field names follow the Angular LabTest and LabOrder models. */
public final class LabDtos {
  private LabDtos() {}

  public record Param(String name, String unit, BigDecimal low, BigDecimal high, BigDecimal critLow, BigDecimal critHigh) {}

  public record LabTest(String id, String code, String name, String category, String sample, BigDecimal price, int tatHours,
                        List<Param> params, List<String> profile) {}

  /**
   * A lab order. {@code date} and {@code time} are the order time in India Standard Time; {@code results} maps
   * test id to parameter name to value, and {@code flags} uses the same keys with N, L, H or C (critical).
   */
  public record LabOrder(String id, String branchId, String patientId, String patientName, String doctorId, String doctorName,
                         List<String> testIds, LocalDate date, String time, OffsetDateTime orderedAt, String status, String priority,
                         String sampleId, String collectedAt, String collectedBy, Map<String, Map<String, BigDecimal>> results,
                         Map<String, Map<String, String>> flags, String verifiedBy, OffsetDateTime verifiedAt, boolean billed,
                         UUID invoiceId, String invoiceNumber, String comments, int version) {}

  public record NewOrder(@NotBlank String patientId, String doctorId, @NotEmpty @Size(max = 30) List<String> testIds,
                         String priority, Boolean bill, String branchId, @Size(max = 500) String comments) {}

  public record ResultsInput(@NotNull Map<String, Map<String, BigDecimal>> results, @Size(max = 2000) String comments,
                             @NotNull Integer version, Boolean submit) {}

  public record RejectInput(@NotBlank @Size(max = 300) String reason) {}

  public record Critical(String testId, String test, String param, BigDecimal value, String unit, String flag) {}

  public record Verified(LabOrder order, List<Critical> criticals) {}

  public record ReportParam(String name, String unit, BigDecimal low, BigDecimal high, BigDecimal value, String flag,
                            BigDecimal previous, LocalDate previousDate) {}

  public record ReportTest(String id, String code, String name, String category, String sample, List<ReportParam> params) {}

  public record ReportPatient(String id, String name, LocalDate dob, String gender, String mobile) {}

  public record Report(LabOrder order, ReportPatient patient, List<ReportTest> tests, List<Critical> criticals) {}
}
