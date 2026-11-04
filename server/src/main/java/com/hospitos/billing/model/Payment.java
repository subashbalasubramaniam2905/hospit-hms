package com.hospitos.billing.model;

import com.hospitos.billing.api.PayMode;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** A receipt (type PAYMENT) or a refund voucher (type REFUND). */
public record Payment(UUID id, UUID invoiceId, String receiptNumber, String type, PayMode mode, BigDecimal amount,
    String reference, String reason, Instant receivedAt, String receivedBy) {}
