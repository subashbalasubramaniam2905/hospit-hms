package com.hospitos.ot;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

public final class OtDtos {
  private OtDtos() {}

  public record Event(String at, String by, String event) {}

  /** One booking, shaped like the Angular Surgery plus names, allergies and the version. Checklist keys keep their order. */
  public record Surgery(String id, String branchId, String patientId, String patientName, List<String> patientAllergies, String surgeonId,
                        String surgeonName, String anaesthetist, String anaesthesia, String room, LocalDate date, String start,
                        int durationMin, String procedure, String status, Map<String, Boolean> checklist, String postOpNotes,
                        String cancelReason, List<Event> timeline, String admissionId, int version) {}

  public record Room(String name) {}

  public record NewSurgery(String branchId, @NotBlank String patientId, @NotBlank @Size(max = 200) String procedure,
                           @NotBlank String surgeonId, @NotBlank String room, @NotNull LocalDate date,
                           @NotBlank @Pattern(regexp = "^([01]\\d|2[0-3]):[0-5]\\d$", message = "Enter the start time as HH:mm") String start,
                           @NotNull @Min(15) @Max(720) Integer durationMin, @NotBlank String anaesthesia,
                           @Size(max = 100) String anaesthetist, @Size(max = 40) String admissionId) {}

  public record CheckInput(@NotBlank String item, @NotNull Boolean done) {}
  /** The status the user saw, so a double click or a stale screen cannot skip a stage. */
  public record AdvanceInput(@NotBlank String from) {}
  public record CancelInput(@Size(max = 300) String reason) {}
  public record NotesInput(@NotNull @Size(max = 4000) String postOpNotes) {}
}
