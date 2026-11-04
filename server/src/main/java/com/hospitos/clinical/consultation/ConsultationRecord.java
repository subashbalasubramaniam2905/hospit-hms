package com.hospitos.clinical.consultation;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Same JSON shape as the Angular Consultation model, plus version and the vitals history. */
public record ConsultationRecord(UUID id, String branchId, String appointmentId, String patientId, String doctorId, LocalDate date,
                                 String template, Vitals vitals, List<Vitals> vitalsHistory, String cc, String hpi, String pmh,
                                 String fh, String sh, String meds, String allergyNote, String exam, List<Diagnosis> dx,
                                 String assessment, String plan, String notes, String followUp, LocalDate followUpDate,
                                 String status, UUID prescriptionId, int version, Instant completedAt) {

  /** bp is "systolic/diastolic"; temperature is in °F, height in cm and weight in kg. */
  public record Vitals(String bp, Integer hr, BigDecimal temp, Integer rr, Integer spo2, BigDecimal height, BigDecimal weight,
                       Instant recordedAt) {}

  public record Diagnosis(String code, String label) {}

  /** Who, when and status only, for staff who must not read clinical notes. */
  public ConsultationRecord withoutClinicalText() {
    return new ConsultationRecord(id, branchId, appointmentId, patientId, doctorId, date, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null, null, null, status, prescriptionId, version, completedAt);
  }

  public static final String DRAFT = "Draft", COMPLETED = "Completed";
}
