package com.hospitos.clinical.prescription;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

public final class PrescriptionInput {
  private PrescriptionInput() {}

  public record Line(String medId, @NotBlank @Size(max = 200) String name, @Size(max = 200) String generic,
                     @Size(max = 60) String strength, @Size(max = 60) String dose, @Size(max = 40) String route,
                     @Size(max = 60) String frequency, @Size(max = 40) String duration, @Min(0) @Max(10000) Integer qty,
                     @Size(max = 40) String food, @Size(max = 500) String instructions, @Min(0) @Max(12) Integer refills) {}

  public record Create(@NotBlank String patientId, @NotBlank String doctorId, UUID consultationId,
                       @Size(max = 500) String diagnosis, @Size(max = 2000) String notes, @Valid @Size(max = 40) List<Line> items) {}

  public record Update(Integer version, @Size(max = 500) String diagnosis, @Size(max = 2000) String notes,
                       @Valid @Size(max = 40) List<Line> items) {}

  public record Sign(Integer version, Boolean sendToPharmacy, @Size(max = 500) String overrideReason) {}

  public record Check(@NotBlank String patientId, @Valid @Size(max = 40) List<Line> items) {}
}
