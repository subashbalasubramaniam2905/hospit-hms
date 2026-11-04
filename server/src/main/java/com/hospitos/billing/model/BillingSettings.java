package com.hospitos.billing.model;

import java.math.BigDecimal;
import java.time.Instant;

/** Hospital GST identity and billing rules. {@code sampleData} stays true until an admin saves real details. */
public record BillingSettings(String legalName, String tradeName, String gstin, String stateCode, String stateName,
    String address, String phone, String email, String invoicePrefix, String receiptPrefix, String refundPrefix,
    String claimPrefix, BigDecimal discountApprovalPct, BigDecimal defaultCopayPct, String invoiceFooter,
    boolean sampleData, Instant updatedAt, String updatedBy, int version) {}
