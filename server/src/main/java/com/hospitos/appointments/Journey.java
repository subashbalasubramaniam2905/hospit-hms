package com.hospitos.appointments;

import java.util.List;

/** The steps of an OPD visit, in order. Indexes match the Angular JOURNEY constant. */
public final class Journey {
    public static final List<String> STEPS =
            List.of("Registration", "Billing", "Triage", "Consultation", "Lab / imaging", "Pharmacy", "Discharge");
    public static final int REGISTRATION = 0;
    public static final int BILLING = 1;
    public static final int TRIAGE = 2;
    public static final int CONSULTATION = 3;
    public static final int DISCHARGE = 6;

    private Journey() {}

    public static String name(int step) {
        return STEPS.get(step);
    }

    public static boolean valid(int step) {
        return step >= 0 && step < STEPS.size();
    }
}
