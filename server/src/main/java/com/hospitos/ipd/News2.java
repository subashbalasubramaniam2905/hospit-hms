package com.hospitos.ipd;

import java.math.BigDecimal;

/**
 * NEWS2 early-warning score from respiration, SpO2 (scale 1), systolic BP, pulse and temperature, the same rule the
 * Angular screens show. Consciousness and supplemental oxygen are not captured yet, so this is a partial score and
 * must not replace clinical judgement.
 */
final class News2 {
  private News2() {}

  static int score(int rr, int spo2, String bp, int hr, BigDecimal tempF) {
    int sys = Integer.parseInt(bp.split("/")[0].trim());
    double c = (tempF.doubleValue() - 32) * 5 / 9;
    int s = 0;
    s += rr <= 8 ? 3 : rr <= 11 ? 1 : rr <= 20 ? 0 : rr <= 24 ? 2 : 3;
    s += spo2 <= 91 ? 3 : spo2 <= 93 ? 2 : spo2 <= 95 ? 1 : 0;
    s += sys <= 90 ? 3 : sys <= 100 ? 2 : sys <= 110 ? 1 : sys <= 219 ? 0 : 3;
    s += hr <= 40 ? 3 : hr <= 50 ? 1 : hr <= 90 ? 0 : hr <= 110 ? 1 : hr <= 130 ? 2 : 3;
    s += c <= 35 ? 3 : c <= 36 ? 1 : c <= 38 ? 0 : c <= 39 ? 1 : 2;
    return s;
  }
}
