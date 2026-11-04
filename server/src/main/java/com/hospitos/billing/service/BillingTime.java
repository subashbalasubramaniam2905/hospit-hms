package com.hospitos.billing.service;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;

/** Invoice dates, day boundaries and financial years follow Indian Standard Time, whatever the server's zone. */
public final class BillingTime {
  public static final ZoneId IST = ZoneId.of("Asia/Kolkata");
  private BillingTime() {}
  public static LocalDate today() { return LocalDate.now(IST); }
  public static ZonedDateTime startOf(LocalDate d) { return d.atStartOfDay(IST); }
}
