package com.hospitos.billing.api;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

/**
 * One line to bill. Either give a {@code tariffCode} (description, category, rate and GST are taken from the
 * tariff unless given here) or give description, category and rate directly.
 * A null {@code taxPct} means "use the GST rate configured for the category".
 * {@code refType}/{@code refId} link the line to the thing being billed, e.g. CONSULTATION / LAB_ORDER / PRESCRIPTION.
 */
public record NewInvoiceLine(
        @Size(max = 30) String tariffCode,
        @Size(max = 300) String description,
        LineCategory category,
        @NotNull @Positive BigDecimal qty,
        @DecimalMin("0") BigDecimal rate,
        @DecimalMin("0") @DecimalMax("28") BigDecimal taxPct,
        @Size(max = 20) String refType,
        @Size(max = 64) String refId) {

    public static NewInvoiceLine of(String description, LineCategory category, BigDecimal qty, BigDecimal rate,
                                    BigDecimal taxPct, String refType, String refId) {
        return new NewInvoiceLine(null, description, category, qty, rate, taxPct, refType, refId);
    }

    public static NewInvoiceLine tariff(String code, BigDecimal qty, String refType, String refId) {
        return new NewInvoiceLine(code, null, null, qty, null, null, refType, refId);
    }

    /** Validation helper: a line must name a tariff item or carry its own description/category/rate. */
    public boolean isComplete() {
        return (tariffCode != null && !tariffCode.isBlank())
                || (description != null && !description.isBlank() && category != null && rate != null);
    }

}
