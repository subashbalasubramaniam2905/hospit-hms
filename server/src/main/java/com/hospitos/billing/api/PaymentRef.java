package com.hospitos.billing.api;

import java.math.BigDecimal;
import java.util.UUID;

public record PaymentRef(UUID id, String receiptNumber, BigDecimal amount, BigDecimal invoiceDue) {}
