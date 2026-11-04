package com.hospitos.patients;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/** Same JSON shape as the Angular Patient model, so screens can switch from mock data without changes. */
public record PatientRecord(String id, String name, LocalDate dob, String gender, String mobile, String email,
                            Map<String, Object> address, String blood, List<String> allergies, List<String> conditions,
                            String history, String surgicalHistory, String familyHistory, String medications,
                            Map<String, Object> emergency, Map<String, Object> insurance, String abha, String consent,
                            LocalDate registered, String primaryDoctorId, List<Object> documents, String branchId,
                            int version) {}
