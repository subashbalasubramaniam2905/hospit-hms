package com.hospitos.billing.model;

import com.hospitos.billing.api.InvoiceKind;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** A GST tax invoice as returned by the API. {@code due} is total less money kept (payments minus refunds). */
public record Invoice(
    UUID id, String number, String branchId, String gstin, String patientId, String patientName, String patientMobile,
    InvoiceKind kind, String status, LocalDate invoiceDate, String placeOfSupply, BigDecimal discountPct,
    BigDecimal subtotal, BigDecimal discountAmount, BigDecimal taxableAmount, BigDecimal cgst, BigDecimal sgst,
    BigDecimal igst, BigDecimal roundOff, BigDecimal total, BigDecimal paid, BigDecimal refunded, BigDecimal due,
    UUID claimId, String claimNumber, String admissionRef, String sourceType, String sourceId, String notes,
    String cancelReason, String createdBy, Instant createdAt, int version,
    List<InvoiceLine> lines, List<Payment> payments) {

  public Invoice withDetail(List<InvoiceLine> l, List<Payment> p) {
    return new Invoice(id, number, branchId, gstin, patientId, patientName, patientMobile, kind, status, invoiceDate,
        placeOfSupply, discountPct, subtotal, discountAmount, taxableAmount, cgst, sgst, igst, roundOff, total, paid,
        refunded, due, claimId, claimNumber, admissionRef, sourceType, sourceId, notes, cancelReason, createdBy, createdAt,
        version, l, p);
  }

  public BigDecimal tax() { return cgst.add(sgst).add(igst); }
}
