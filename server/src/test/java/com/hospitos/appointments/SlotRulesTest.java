package com.hospitos.appointments;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class SlotRulesTest {
    static final LocalDate WED = LocalDate.of(2026, 11, 4);
    static final List<SlotRules.Schedule> WEEKDAYS = List.of(DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY, DayOfWeek.FRIDAY)
            .stream().map(d -> new SlotRules.Schedule(d, LocalTime.of(9, 0), LocalTime.of(17, 0), 15, LocalTime.of(13, 0), LocalTime.of(14, 0))).toList();

    SlotRules rules(LocalDate day, List<SlotRules.Booked> booked, Optional<String> leave, LocalDateTime now) {
        return new SlotRules("Dr. Sana Iqbal", day, WEEKDAYS, leave, booked, now);
    }

    SlotRules rules(List<SlotRules.Booked> booked) {
        return rules(WED, booked, Optional.empty(), WED.minusDays(1).atTime(12, 0));
    }

    @Test
    void freeSlotInsideHoursIsOk() {
        assertThat(rules(List.of()).check(LocalTime.of(10, 0), 15).ok()).isTrue();
    }

    @Test
    void outsideHoursBreakAndRunningPastCloseAreRefused() {
        var r = rules(List.of());
        assertThat(r.check(LocalTime.of(8, 45), 15).reason()).contains("consults between 09:00 and 17:00");
        assertThat(r.check(LocalTime.of(16, 50), 15).reason()).contains("consults between");
        assertThat(r.check(LocalTime.of(13, 15), 15).reason()).contains("break");
        // Starts before the break but runs into it.
        assertThat(r.check(LocalTime.of(12, 50), 15).reason()).contains("break");
        assertThat(r.check(LocalTime.of(12, 45), 15).ok()).isTrue();
    }

    @Test
    void overlappingBookingIsAClashButBackToBackIsFine() {
        var r = rules(List.of(new SlotRules.Booked("AP1", "Lakshmi Iyer", LocalTime.of(10, 0), 20)));
        assertThat(r.check(LocalTime.of(10, 15), 15).reason()).isEqualTo("Dr. Sana Iqbal already sees Lakshmi Iyer at 10:00.");
        assertThat(r.check(LocalTime.of(9, 50), 15).ok()).isFalse();
        assertThat(r.check(LocalTime.of(10, 20), 15).ok()).isTrue();
        assertThat(r.check(LocalTime.of(9, 45), 15).ok()).isTrue();
        // Rescheduling the same appointment ignores its own slot.
        assertThat(r.check(LocalTime.of(10, 5), 15, "AP1").ok()).isTrue();
    }

    @Test
    void weekendLeaveAndPastDaysBlockTheWholeDay() {
        LocalDate sat = WED.plusDays(3);
        assertThat(rules(sat, List.of(), Optional.empty(), WED.atTime(9, 0)).dayBlock())
                .hasValue("Dr. Sana Iqbal does not consult on Sat. Available Mon, Tue, Wed, Thu, Fri.");
        assertThat(rules(WED, List.of(), Optional.of("Conference"), WED.minusDays(1).atTime(9, 0)).dayBlock())
                .hasValue("Dr. Sana Iqbal is on leave on this day (Conference).");
        assertThat(rules(WED.minusDays(1), List.of(), Optional.empty(), WED.atTime(9, 0)).dayBlock()).isPresent();
        assertThat(rules(sat, List.of(), Optional.empty(), WED.atTime(9, 0)).grid(15)).isEmpty();
    }

    @Test
    void earlierTodayIsRefusedWithAFewMinutesGrace() {
        var r = rules(WED, List.of(), Optional.empty(), WED.atTime(11, 0));
        assertThat(r.check(LocalTime.of(10, 0), 15).reason()).contains("already passed");
        assertThat(r.check(LocalTime.of(10, 56), 15).ok()).isTrue();
    }

    @Test
    void gridMarksEverySlotOfTheDay() {
        var grid = rules(List.of(new SlotRules.Booked("AP1", "Lakshmi Iyer", LocalTime.of(9, 30), 15))).grid(15);
        assertThat(grid).hasSize(32);
        assertThat(grid.get(0)).isEqualTo(new SlotRules.Slot("09:00", true, null));
        assertThat(grid.get(2).ok()).isFalse();
        assertThat(grid.stream().filter(s -> s.time().startsWith("13:")).allMatch(s -> !s.ok())).isTrue();
        assertThat(grid.stream().filter(SlotRules.Slot::ok)).hasSize(32 - 1 - 4);
    }
}
