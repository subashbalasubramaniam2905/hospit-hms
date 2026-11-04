package com.hospitos.clinical.consultation;

import com.hospitos.clinical.prescription.PrescriptionInput;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

public final class ConsultationInput {
  private ConsultationInput() {}

  /** doctorId may be left out by a doctor whose account is linked to a doctor profile. */
  public record Open(@NotBlank String patientId, String doctorId, String appointmentId) {}

  public record Vitals(
      @Pattern(regexp = "^$|^\\d{2,3}/\\d{2,3}$", message = "Blood pressure looks like 120/80") String bp,
      @Min(20) @Max(300) Integer hr,
      @DecimalMin("85") @DecimalMax("115") BigDecimal temp,
      @Min(4) @Max(80) Integer rr,
      @Min(40) @Max(100) Integer spo2,
      @DecimalMin("20") @DecimalMax("260") BigDecimal height,
      @DecimalMin("0.5") @DecimalMax("400") BigDecimal weight) {}

  public record Diagnosis(@NotBlank @Size(max = 10) String code, @NotBlank @Size(max = 255) String label) {}

  /** A prescription saved together with the consultation as its draft. */
  public record Rx(@Size(max = 2000) String notes, @Valid @Size(max = 40) List<PrescriptionInput.Line> items) {}

  public record Update(Integer version, @Size(max = 80) String template, @Valid Vitals vitals,
                       @Size(max = 2000) String cc, @Size(max = 8000) String hpi, @Size(max = 4000) String pmh,
                       @Size(max = 4000) String fh, @Size(max = 4000) String sh, @Size(max = 4000) String meds,
                       @Size(max = 1000) String allergyNote, @Size(max = 8000) String exam,
                       @Valid @Size(max = 20) List<Diagnosis> dx, @Size(max = 8000) String assessment,
                       @Size(max = 8000) String plan, @Size(max = 8000) String notes, @Size(max = 200) String followUp,
                       LocalDate followUpDate, @Valid Rx prescription) {}

  public record Complete(Integer version, @Valid Rx prescription, @Size(max = 500) String overrideReason) {}
}
