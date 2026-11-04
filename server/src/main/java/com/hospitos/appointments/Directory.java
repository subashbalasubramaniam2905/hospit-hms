package com.hospitos.appointments;

import java.time.LocalTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * What this module needs from the shared tables and the signed-in user. {@link JdbcDirectory} is the real one.
 */
public interface Directory {

    record DoctorInfo(String id, String name, String branchId, String deptId, String room, String status, List<String> days,
                      LocalTime start, LocalTime end, int slotMin, LocalTime breakStart, LocalTime breakEnd) {}

    Optional<DoctorInfo> doctor(String doctorId);

    /** The patient's name, or empty when there is no such patient in the signed-in user's branches. */
    Optional<String> patientName(String patientId);

    /** Whether the signed-in user works in this branch. */
    boolean canSee(String branchId);

    /**
     * The branches a list query covers: the requested one (if the user can see it), or all of the user's branches.
     * Empty means every branch (super administrators only).
     */
    List<String> scope(String requestedBranch);

    UUID userId();

    /** Audits a change to a record of {@code branchId}, so that branch's administrators can review it. */
    void audit(String branchId, String action, String entity, String entityId, String detail);
}
