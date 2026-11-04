package com.hospitos.clinical.prescription;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Same JSON shape as the Angular Prescription model, plus version, signing and override details. */
public record PrescriptionRecord(UUID id, String branchId, UUID consultationId, String patientId, String doctorId, LocalDate date,
                                 String diagnosis, List<Item> items, String status, String notes, int version,
                                 UUID signedBy, Instant signedAt, List<Override> overrides) {

  public record Item(UUID id, String medId, String name, String generic, String strength, String dose, String route,
                     String frequency, String duration, int qty, String food, String instructions, int refills) {}

  public record Override(String code, String kind, String title, String reason, UUID by, Instant at) {}

  public static final String DRAFT = "Draft", SIGNED = "Signed", SENT = "Sent to pharmacy",
      PARTIAL = "Partially dispensed", DISPENSED = "Dispensed";
}
