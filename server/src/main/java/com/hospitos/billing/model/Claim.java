package com.hospitos.billing.model;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record Claim(UUID id, String number, String branchId, String patientId, String patientName, UUID invoiceId,
    String invoiceNumber, String providerId, String providerName, String tpa, String policyNo, String type, String status,
    BigDecimal claimed, BigDecimal approved, BigDecimal settled, BigDecimal copayPct, List<String> documents,
    String rejectionReason, String settlementRef, String createdBy, Instant createdAt, int version, List<Event> history) {

  public record Event(String status, String note, Instant at, String by) {}

  public Claim withHistory(List<Event> h) {
    return new Claim(id, number, branchId, patientId, patientName, invoiceId, invoiceNumber, providerId, providerName, tpa,
        policyNo, type, status, claimed, approved, settled, copayPct, documents, rejectionReason, settlementRef, createdBy,
        createdAt, version, h);
  }
}
