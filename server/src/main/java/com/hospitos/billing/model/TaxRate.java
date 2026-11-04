package com.hospitos.billing.model;

import com.hospitos.billing.api.LineCategory;
import java.math.BigDecimal;

public record TaxRate(LineCategory category, BigDecimal gstPct, String hsnSac, String note) {}
