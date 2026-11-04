package com.hospitos.appointments;

import java.util.Arrays;
import java.util.Set;

/** Appointment statuses. The labels are stored as-is and match the Angular ApptStatus type. */
public enum ApptStatus {
    SCHEDULED("Scheduled"),
    CONFIRMED("Confirmed"),
    ARRIVED("Arrived"),
    WAITING("Waiting"),
    IN_CONSULTATION("In consultation"),
    COMPLETED("Completed"),
    CANCELLED("Cancelled"),
    NO_SHOW("No-show");

    public static final Set<ApptStatus> CLOSED = Set.of(COMPLETED, CANCELLED, NO_SHOW);

    private final String label;

    ApptStatus(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    public static ApptStatus of(String label) {
        return Arrays.stream(values())
                .filter(s -> s.label.equalsIgnoreCase(label) || s.name().equalsIgnoreCase(label))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unknown appointment status: " + label));
    }

    /** Statuses that mean the patient is in the building today. */
    public boolean onSite() {
        return this == ARRIVED || this == WAITING || this == IN_CONSULTATION;
    }

    /** Which status changes the front desk may make by hand. */
    public boolean canMoveTo(ApptStatus next) {
        if (this == next) return true;
        return switch (this) {
            case SCHEDULED -> next != COMPLETED;
            case CONFIRMED -> next != SCHEDULED && next != COMPLETED;
            case ARRIVED, WAITING, IN_CONSULTATION -> next != SCHEDULED && next != CONFIRMED;
            case COMPLETED, CANCELLED, NO_SHOW -> false;
        };
    }
}
