package com.hospitos.patients;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Past;
import jakarta.validation.constraints.Pattern;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

public record PatientInput(
    @NotBlank String name,
    @NotNull @Past LocalDate dob,
    @NotBlank @Pattern(regexp = "Female|Male|Other") String gender,
    @NotBlank @Pattern(regexp = "^[+0-9 ()-]{10,20}$", message = "Enter a valid mobile number") String mobile,
    String email,
    Map<String, Object> address,
    String blood,
    List<String> allergies,
    List<String> conditions,
    String history,
    String surgicalHistory,
    String familyHistory,
    String medications,
    Map<String, Object> emergency,
    Map<String, Object> insurance,
    @Pattern(regexp = "^$|^\\d{2}-\\d{4}-\\d{4}-\\d{4}$", message = "ABHA number looks like 12-3456-7890-1234") String abha,
    @Pattern(regexp = "Given|Pending|Withdrawn") String consent,
    String primaryDoctorId,
    String branchId,
    /** Required on update: the version the client last saw, so concurrent edits are not silently overwritten. */
    Integer version) {}
