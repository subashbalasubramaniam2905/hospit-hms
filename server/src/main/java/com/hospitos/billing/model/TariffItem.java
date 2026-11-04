package com.hospitos.billing.model;

import com.hospitos.billing.api.LineCategory;
import java.math.BigDecimal;

/**
 * A billable service. {@code taxPct} null means the category's GST rate applies; {@code effectiveTaxPct} is the
 * rate that will actually be charged. Doctor consultations are listed with code {@code DOC-<doctorId>} and the
 * doctor's fee, and cannot be edited here (change the fee on the doctor).
 */
public record TariffItem(String id, String code, String name, LineCategory category, BigDecimal price, BigDecimal taxPct,
    BigDecimal effectiveTaxPct, String hsnSac, String department, boolean active, boolean fromDoctor, Integer version) {}
