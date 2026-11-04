package com.hospitos.clinical.safety;

import java.util.List;

/**
 * One medication safety alert. {@code code} is stable for the same finding, so a doctor's override
 * can be matched to it when the prescription is signed.
 */
public record SafetyAlert(String code, String level, String kind, String title, String detail, List<String> medicines) {
  public static final String CRITICAL = "Critical", WARNING = "Warning", INFO = "Info";

  public boolean critical() { return CRITICAL.equals(level); }
}
