package com.hospitos.billing.api;

import java.math.BigDecimal;
import java.util.UUID;

public record InvoiceRef(UUID id, String number, BigDecimal total, BigDecimal due) {}
