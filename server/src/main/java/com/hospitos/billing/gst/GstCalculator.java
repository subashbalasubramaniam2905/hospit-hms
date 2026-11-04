package com.hospitos.billing.gst;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/**
 * Pure GST arithmetic for an invoice, kept free of Spring and JPA so it is easy to test.
 *
 * <ul>
 *   <li>The invoice discount % is applied to every line's gross amount, and GST is charged on the discounted
 *       (taxable) value, as GST law requires for discounts shown on the invoice.</li>
 *   <li>Intra-state supply (place of supply = hospital's state) splits GST equally into CGST and SGST;
 *       inter-state supply charges IGST.</li>
 *   <li>Each line's amounts are rounded to paise (half-up). The invoice total is rounded to the nearest rupee
 *       and the difference is shown as round-off.</li>
 * </ul>
 */
public final class GstCalculator {

    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final BigDecimal TWO = BigDecimal.valueOf(2);

    private GstCalculator() {}

    public record LineInput(BigDecimal qty, BigDecimal rate, BigDecimal taxPct) {}

    public record LineResult(BigDecimal gross, BigDecimal discount, BigDecimal taxable, BigDecimal cgst,
                             BigDecimal sgst, BigDecimal igst, BigDecimal amount) {
        public BigDecimal tax() { return cgst.add(sgst).add(igst); }
    }

    public record Result(List<LineResult> lines, BigDecimal subtotal, BigDecimal discount, BigDecimal taxable,
                         BigDecimal cgst, BigDecimal sgst, BigDecimal igst, BigDecimal roundOff, BigDecimal total) {
        public BigDecimal tax() { return cgst.add(sgst).add(igst); }
    }

    public static Result compute(List<LineInput> inputs, BigDecimal discountPct, boolean interState) {
        BigDecimal dPct = discountPct == null ? BigDecimal.ZERO : discountPct;
        List<LineResult> out = new ArrayList<>(inputs.size());
        BigDecimal sub = BigDecimal.ZERO, disc = BigDecimal.ZERO, taxable = BigDecimal.ZERO;
        BigDecimal cgst = BigDecimal.ZERO, sgst = BigDecimal.ZERO, igst = BigDecimal.ZERO;
        for (LineInput in : inputs) {
            BigDecimal gross = money(in.qty().multiply(in.rate()));
            BigDecimal d = money(gross.multiply(dPct).divide(HUNDRED, 6, RoundingMode.HALF_UP));
            BigDecimal t = gross.subtract(d);
            BigDecimal pct = in.taxPct() == null ? BigDecimal.ZERO : in.taxPct();
            BigDecimal c = BigDecimal.ZERO.setScale(2), s = BigDecimal.ZERO.setScale(2), i = BigDecimal.ZERO.setScale(2);
            if (pct.signum() > 0) {
                if (interState) {
                    i = money(t.multiply(pct).divide(HUNDRED, 6, RoundingMode.HALF_UP));
                } else {
                    BigDecimal half = pct.divide(TWO, 6, RoundingMode.HALF_UP);
                    c = money(t.multiply(half).divide(HUNDRED, 6, RoundingMode.HALF_UP));
                    s = c;
                }
            }
            out.add(new LineResult(gross, d, t, c, s, i, t.add(c).add(s).add(i)));
            sub = sub.add(gross); disc = disc.add(d); taxable = taxable.add(t);
            cgst = cgst.add(c); sgst = sgst.add(s); igst = igst.add(i);
        }
        BigDecimal exact = taxable.add(cgst).add(sgst).add(igst);
        BigDecimal total = exact.setScale(0, RoundingMode.HALF_UP).setScale(2);
        return new Result(out, sub, disc, taxable, cgst, sgst, igst, total.subtract(exact), total);
    }

    public static BigDecimal money(BigDecimal v) { return v.setScale(2, RoundingMode.HALF_UP); }

    /** GST financial year label, e.g. 2026-11-04 -> "2627" (April to March). */
    public static String finYear(java.time.LocalDate d) {
        int start = d.getMonthValue() >= 4 ? d.getYear() : d.getYear() - 1;
        return String.format("%02d%02d", start % 100, (start + 1) % 100);
    }

    /** Basic GSTIN shape check: 2-digit state, 10-char PAN, entity digit, 'Z', checksum. */
    public static boolean isValidGstin(String gstin) {
        if (gstin == null || !gstin.matches("^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")) return false;
        String chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        int sum = 0;
        for (int k = 0; k < 14; k++) {
            int v = chars.indexOf(gstin.charAt(k)) * (k % 2 == 0 ? 1 : 2);
            sum += v / 36 + v % 36;
        }
        int check = (36 - sum % 36) % 36;
        return gstin.charAt(14) == chars.charAt(check);
    }
}
