package com.hospitos.appointments;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;

/** A clock tests can set and move forward. */
public class TestClock extends Clock {
    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private Instant now;

    public TestClock(ZonedDateTime start) {
        now = start.toInstant();
    }

    public void set(ZonedDateTime t) { now = t.toInstant(); }

    public void advance(Duration d) { now = now.plus(d); }

    @Override public ZoneId getZone() { return IST; }

    @Override public Clock withZone(ZoneId zone) { throw new UnsupportedOperationException(); }

    @Override public Instant instant() { return now; }
}
