package com.hospitos.emergency;

/**
 * Suggests a triage level from the arrival vitals. It only suggests: the triaging nurse or doctor chooses the level,
 * and the suggestion is stored next to it so overrides can be reviewed. Missing values are ignored.
 */
public final class TriageRules {
  private TriageRules() {}

  public static String suggest(String bp, Integer hr, Integer spo2, Integer gcs) {
    Integer sys = systolic(bp);
    if (lt(gcs, 9) || lt(spo2, 88) || lt(sys, 80)) return "Red";
    if (lt(gcs, 13) || lt(spo2, 92) || gt(hr, 130) || lt(sys, 90)) return "Orange";
    if (gt(hr, 110) || gt(sys, 180)) return "Yellow";
    return "Green";
  }

  /** The systolic number of a "120/80" reading, or null when there is no usable reading. */
  static Integer systolic(String bp) {
    if (bp == null) return null;
    var m = java.util.regex.Pattern.compile("^\\s*(\\d{2,3})\\s*/\\s*\\d{2,3}\\s*$").matcher(bp);
    return m.matches() ? Integer.valueOf(m.group(1)) : null;
  }

  private static boolean lt(Integer v, int limit) { return v != null && v < limit; }
  private static boolean gt(Integer v, int limit) { return v != null && v > limit; }
}
