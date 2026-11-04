package com.hospitos.billing.api;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * The billing module's in-process API for other modules. Calls join the caller's transaction, so an
 * invoice raised while dispensing rolls back with the dispense if that fails.
 */
public interface BillingApi {

    /** Raise a tax invoice. GST is worked out from the tariff and the configured category rates. */
    InvoiceRef createInvoice(NewInvoice invoice);

    /** Record money received against an invoice. Fails if the amount is more than the balance due. */
    PaymentRef recordPayment(UUID invoiceId, PayMode mode, BigDecimal amount, String reference);

    /** True when a non-cancelled invoice has a line for this reference (e.g. "CONSULTATION", id). */
    boolean isBilled(String refType, String refId);
}
