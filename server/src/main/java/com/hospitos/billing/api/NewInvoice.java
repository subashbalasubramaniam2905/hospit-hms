package com.hospitos.billing.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;

/**
 * A request to raise a tax invoice. Used by the REST API and by other modules (pharmacy, lab, IPD) through
 * {@link BillingApi}. A null {@code branchId} means the patient's branch. {@code sourceType}/{@code sourceId} identify the workflow that raised it (optional).
 */
public record NewInvoice(
        @NotNull @Size(max = 20) String patientId,
        @NotNull InvoiceKind kind,
        @Size(max = 10) String branchId,
        @NotEmpty @Size(max = 200) List<@Valid @NotNull NewInvoiceLine> lines,
        @DecimalMin("0") @DecimalMax("100") BigDecimal discountPct,
        @Size(max = 40) String admissionRef,
        @Size(max = 20) String sourceType,
        @Size(max = 64) String sourceId,
        @Size(max = 500) String notes) {

    public NewInvoice(String patientId, InvoiceKind kind, List<NewInvoiceLine> lines) {
        this(patientId, kind, null, lines, BigDecimal.ZERO, null, null, null, null);
    }
}
