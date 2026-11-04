package com.hospitos.billing.model;

import com.hospitos.billing.api.LineCategory;
import java.math.BigDecimal;

public record InvoiceLine(int lineNo, String tariffCode, String description, LineCategory category, String hsnSac,
    BigDecimal qty, BigDecimal rate, BigDecimal gross, BigDecimal discount, BigDecimal taxable, BigDecimal taxPct,
    BigDecimal cgst, BigDecimal sgst, BigDecimal igst, BigDecimal amount, String refType, String refId) {}
