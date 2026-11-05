package com.hospitos.radiology;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/** Request and response shapes for the radiology API. Field names follow the Angular ImagingOrder model. */
public final class RadiologyDtos {
  private RadiologyDtos() {}

  public record Study(String id, String code, String name, String modality, BigDecimal price, int durationMin, boolean contrast) {}

  public record Room(String branchId, String code, String modality, String name) {}

  /**
   * An imaging order. {@code date} and {@code slot} are the scheduled day and start time in clinic time (null until
   * the study is scheduled); {@code room} is the room code within the branch.
   */
  public record ImagingOrder(String id, String branchId, String patientId, String patientName, String doctorId, String doctorName,
                             String studyId, String modality, String study, boolean contrast, BigDecimal price, int durationMin,
                             String status, String priority, LocalDate date, String slot, String room, OffsetDateTime orderedAt,
                             String technician, OffsetDateTime startedAt, OffsetDateTime acquiredAt, String findings, String impression,
                             String radiologist, OffsetDateTime reportedAt, String verifiedBy, OffsetDateTime verifiedAt,
                             String contrastOverride, String cancelReason, boolean billed, UUID invoiceId, String invoiceNumber,
                             String comments, int version) {}

  /**
   * A new order. Give a catalogue {@code studyId}, or a {@code modality} with a free-text {@code study} name (priced at
   * the modality's default rate unless the name matches a catalogue study). With {@code date} and {@code slot} the order
   * is scheduled straight away; {@code room} defaults to the first free room for the modality.
   */
  public record NewOrder(@NotBlank String patientId, String doctorId, String studyId, String modality, @Size(max = 200) String study,
                         String priority, LocalDate date, String slot, String room, Boolean bill, String branchId,
                         @Size(max = 500) String comments, @Size(max = 300) String contrastOverride) {}

  public record ScheduleInput(@NotNull LocalDate date, @NotBlank String slot, String room, @NotNull Integer version) {}

  public record StartInput(@Size(max = 100) String technician) {}

  public record ReportInput(@Size(max = 8000) String findings, @Size(max = 2000) String impression, @NotNull Integer version,
                            Boolean submit) {}

  public record CancelInput(@NotBlank @Size(max = 300) String reason) {}

  /** A booked slot in a room, for the scheduling view. */
  public record Booking(String orderId, String room, String slot, int durationMin, String patientName, String study, String status) {}

  public record ReportPatient(String id, String name, LocalDate dob, String gender, String mobile) {}

  public record Prior(String id, LocalDate date, String study, String impression) {}

  public record Report(ImagingOrder order, ReportPatient patient, List<Prior> priors) {}
}
