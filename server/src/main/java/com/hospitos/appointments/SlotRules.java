package com.hospitos.appointments;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Pure booking rules for one doctor on one day: consulting hours, breaks, leave, past times and clashes.
 * Kept free of Spring and SQL so it can be unit tested directly.
 */
public final class SlotRules {

    /** One weekday of a doctor's schedule. */
    public record Schedule(DayOfWeek day, LocalTime start, LocalTime end, int slotMinutes, LocalTime breakStart, LocalTime breakEnd) {}

    /** A live booking that blocks time. */
    public record Booked(String appointmentId, String patientName, LocalTime start, int durationMin) {
        LocalTime end() { return start.plusMinutes(durationMin); }
    }

    /** The answer for one candidate time. */
    public record Check(boolean ok, String reason) {
        static final Check OK = new Check(true, null);
        static Check no(String reason) { return new Check(false, reason); }
    }

    public record Slot(String time, boolean ok, String reason) {}

    /** How far into the past a same-day booking may start (clocks and walk-ups drift). */
    static final int PAST_GRACE_MIN = 5;

    private final String doctorName;
    private final LocalDate date;
    private final List<Schedule> week;
    private final Optional<String> leaveReason;
    private final List<Booked> booked;
    private final LocalDateTime now;

    public SlotRules(String doctorName, LocalDate date, List<Schedule> week, Optional<String> leaveReason, List<Booked> booked, LocalDateTime now) {
        this.doctorName = doctorName;
        this.date = date;
        this.week = week;
        this.leaveReason = leaveReason;
        this.booked = booked;
        this.now = now;
    }

    private Optional<Schedule> today() {
        return week.stream().filter(s -> s.day() == date.getDayOfWeek()).findFirst();
    }

    /** A reason the whole day is closed, or empty when the doctor consults that day. */
    public Optional<String> dayBlock() {
        if (date.isBefore(now.toLocalDate())) return Optional.of("This date has already passed.");
        if (leaveReason.isPresent()) {
            String why = leaveReason.get();
            return Optional.of(doctorName + " is on leave on this day" + (why.isBlank() ? "." : " (" + why + ")."));
        }
        if (today().isEmpty()) {
            String days = week.stream().sorted((a, b) -> a.day().compareTo(b.day()))
                    .map(s -> s.day().getDisplayName(TextStyle.SHORT, Locale.ENGLISH)).reduce((a, b) -> a + ", " + b).orElse("no days");
            return Optional.of(doctorName + " does not consult on " + date.getDayOfWeek().getDisplayName(TextStyle.SHORT, Locale.ENGLISH)
                    + ". Available " + days + ".");
        }
        return Optional.empty();
    }

    public Check check(LocalTime start, int durationMin) {
        return check(start, durationMin, null);
    }

    /** Checks one candidate booking. {@code ignoreId} skips the appointment being rescheduled. */
    public Check check(LocalTime start, int durationMin, String ignoreId) {
        Optional<String> block = dayBlock();
        if (block.isPresent()) return Check.no(block.get());
        if (durationMin < 5 || durationMin > 240) return Check.no("Duration must be between 5 and 240 minutes.");
        Schedule s = today().orElseThrow();
        LocalTime end = start.plusMinutes(durationMin);
        if (start.isBefore(s.start()) || end.isAfter(s.end()) || end.isBefore(start)) {
            return Check.no(doctorName + " consults between " + s.start() + " and " + s.end() + ".");
        }
        if (s.breakStart() != null && start.isBefore(s.breakEnd()) && end.isAfter(s.breakStart())) {
            return Check.no("This slot falls in the " + s.breakStart() + "–" + s.breakEnd() + " break.");
        }
        if (date.equals(now.toLocalDate()) && start.isBefore(now.toLocalTime().minusMinutes(PAST_GRACE_MIN))) {
            return Check.no("This time has already passed today.");
        }
        for (Booked b : booked) {
            if (b.appointmentId().equals(ignoreId)) continue;
            if (b.start().isBefore(end) && b.end().isAfter(start)) {
                return Check.no(doctorName + " already sees " + b.patientName() + " at " + b.start() + ".");
            }
        }
        return Check.OK;
    }

    /** The day's slot grid at the doctor's slot length, each marked free or not with a reason. */
    public List<Slot> grid(int durationMin) {
        List<Slot> out = new ArrayList<>();
        Optional<Schedule> s = today();
        if (s.isEmpty() || dayBlock().isPresent()) return out;
        for (LocalTime t = s.get().start(); t.isBefore(s.get().end()); t = t.plusMinutes(s.get().slotMinutes())) {
            Check c = check(t, durationMin);
            out.add(new Slot(t.toString(), c.ok(), c.reason()));
            if (t.plusMinutes(s.get().slotMinutes()).isBefore(t)) break; // wrapped past midnight
        }
        return out;
    }

    public Optional<Schedule> schedule() {
        return today();
    }
}
