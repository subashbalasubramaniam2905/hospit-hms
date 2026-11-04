package com.hospitos.billing;

import static org.assertj.core.api.Assertions.assertThat;

import com.hospitos.billing.gst.GstCalculator;
import com.hospitos.billing.gst.GstCalculator.LineInput;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class GstCalculatorTest {
  private static BigDecimal d(String s) { return new BigDecimal(s); }

  @Test
  void exemptServicesCarryNoTax() {
    var r = GstCalculator.compute(List.of(new LineInput(d("1"), d("600"), d("0")), new LineInput(d("2"), d("350"), d("0"))), d("0"), false);
    assertThat(r.subtotal()).isEqualByComparingTo("1300");
    assertThat(r.tax()).isEqualByComparingTo("0");
    assertThat(r.total()).isEqualByComparingTo("1300");
    assertThat(r.roundOff()).isEqualByComparingTo("0");
  }

  @Test
  void intraStateSplitsIntoCgstAndSgstOnTheDiscountedValue() {
    // Pharmacy Rs 1,000 at 12% with 10% discount: taxable 900, CGST 54, SGST 54, total 1,008.
    var r = GstCalculator.compute(List.of(new LineInput(d("4"), d("250"), d("12"))), d("10"), false);
    assertThat(r.discount()).isEqualByComparingTo("100");
    assertThat(r.taxable()).isEqualByComparingTo("900");
    assertThat(r.cgst()).isEqualByComparingTo("54");
    assertThat(r.sgst()).isEqualByComparingTo("54");
    assertThat(r.igst()).isEqualByComparingTo("0");
    assertThat(r.total()).isEqualByComparingTo("1008");
  }

  @Test
  void interStateUsesIgst() {
    var r = GstCalculator.compute(List.of(new LineInput(d("1"), d("1000"), d("18"))), d("0"), true);
    assertThat(r.igst()).isEqualByComparingTo("180");
    assertThat(r.cgst()).isEqualByComparingTo("0");
  }

  @Test
  void totalIsRoundedToTheRupeeWithRoundOff() {
    // 3 x 33.33 = 99.99 at 5% -> CGST 2.50 + SGST 2.50 -> 104.99 -> 105.00, round-off +0.01
    var r = GstCalculator.compute(List.of(new LineInput(d("3"), d("33.33"), d("5"))), d("0"), false);
    assertThat(r.cgst()).isEqualByComparingTo("2.50");
    assertThat(r.total()).isEqualByComparingTo("105");
    assertThat(r.roundOff()).isEqualByComparingTo("0.01");
    assertThat(r.lines().get(0).amount()).isEqualByComparingTo("104.99");
  }

  @Test
  void financialYearRunsAprilToMarch() {
    assertThat(GstCalculator.finYear(LocalDate.of(2026, 11, 4))).isEqualTo("2627");
    assertThat(GstCalculator.finYear(LocalDate.of(2027, 3, 31))).isEqualTo("2627");
    assertThat(GstCalculator.finYear(LocalDate.of(2027, 4, 1))).isEqualTo("2728");
  }

  @Test
  void gstinCheckDigitIsVerified() {
    assertThat(GstCalculator.isValidGstin("33AAACH0000A1ZY")).isTrue();
    assertThat(GstCalculator.isValidGstin("33AAACH0000A1Z5")).isFalse();
    assertThat(GstCalculator.isValidGstin("27AAPFU0939F1ZV")).isTrue();
    assertThat(GstCalculator.isValidGstin("not-a-gstin")).isFalse();
  }
}
