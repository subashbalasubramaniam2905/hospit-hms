package com.hospitos.ipd;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;

/**
 * Works out bed-days per ward with a midnight census: the stay is charged for each midnight the patient spends in
 * hospital, in the ward they were in at that midnight. A stay that crosses no midnight (day care, same-day discharge)
 * is one day in the ward they leave from.
 */
final class RoomDays {
  private RoomDays() {}

  record Stay(String wardName, BigDecimal rate, Instant from) {}

  record WardDays(String wardName, BigDecimal rate, int days) {}

  static int days(Instant admitted, Instant until, ZoneId zone) {
    long n = ChronoUnit.DAYS.between(LocalDate.ofInstant(admitted, zone), LocalDate.ofInstant(until, zone));
    return (int) Math.max(1, n);
  }

  /** Stays must be in time order; the first starts at admission. */
  static List<WardDays> split(List<Stay> stays, Instant admitted, Instant until, ZoneId zone) {
    if (stays.isEmpty()) return List.of();
    LocalDate first = LocalDate.ofInstant(admitted, zone);
    long midnights = ChronoUnit.DAYS.between(first, LocalDate.ofInstant(until, zone));
    var counts = new LinkedHashMap<String, WardDays>();
    if (midnights <= 0) {
      add(counts, at(stays, until));
    } else {
      for (long i = 1; i <= midnights; i++) {
        // Just before midnight at the end of day i: where the patient slept that night.
        Instant census = first.plusDays(i).atStartOfDay(zone).toInstant().minusNanos(1);
        add(counts, at(stays, census));
      }
    }
    return new ArrayList<>(counts.values());
  }

  private static Stay at(List<Stay> stays, Instant t) {
    Stay cur = stays.get(0);
    for (var s : stays) if (!s.from().isAfter(t)) cur = s;
    return cur;
  }

  private static void add(LinkedHashMap<String, WardDays> counts, Stay s) {
    String key = s.wardName() + "|" + s.rate().stripTrailingZeros().toPlainString();
    counts.merge(key, new WardDays(s.wardName(), s.rate(), 1), (a, b) -> new WardDays(a.wardName(), a.rate(), a.days() + 1));
  }
}
