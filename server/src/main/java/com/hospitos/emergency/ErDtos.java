package com.hospitos.emergency;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;

public final class ErDtos {
  private ErDtos() {}

  public record Vitals(@Size(max = 9) @Pattern(regexp = "^$|^\\d{2,3}/\\d{2,3}$", message = "Enter blood pressure like 120/80") String bp,
                       @Min(0) @Max(300) Integer hr, @Min(0) @Max(100) Integer spo2, @Min(3) @Max(15) Integer gcs,
                       @DecimalMin("80") @DecimalMax("110") BigDecimal temp) {}

  public record Event(String at, String by, String event) {}

  /** One ER case, shaped like the Angular ERCase plus names, timestamps and the timeline. */
  public record ErCase(String id, String branchId, String patientId, String label, Integer age, String gender, String arrival,
                       OffsetDateTime arrivedAt, String mode, String triage, String suggestedTriage, String complaint, String bay,
                       String doctorId, String doctorName, Vitals vitals, String status, List<String> orders, List<Event> timeline,
                       String admissionId, OffsetDateTime closedAt, String dispositionNote, int version) {}

  /** A treatment bay and the open case in it, if any. */
  public record Bay(String name, String kind, String caseId) {}

  public record NewCase(String branchId, String patientId, @Min(0) @Max(130) Integer age, @Size(max = 10) String gender,
                        @NotBlank String mode, @NotBlank String triage, @NotBlank @Size(max = 300) String complaint,
                        @Size(max = 40) String bay, String doctorId, @Valid Vitals vitals) {}

  /** Partial update: fields left out stay as they are. An empty bay moves the patient to the corridor. */
  public record Update(String triage, String doctorId, @Size(max = 40) String bay, @Valid Vitals vitals) {}

  public record OrderInput(@NotBlank @Size(max = 80) String name) {}
  public record LinkInput(@NotBlank String patientId) {}
  public record StatusInput(@NotBlank String status, @Size(max = 500) String note) {}
  public record AdmittedInput(@Size(max = 40) String admissionId) {}
}
