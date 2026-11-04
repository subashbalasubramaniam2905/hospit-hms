package com.hospitos.appointments;

import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
class JdbcDirectory implements Directory {
    private final JdbcClient db;
    private final AuditService audit;

    JdbcDirectory(JdbcClient db, AuditService audit) {
        this.db = db;
        this.audit = audit;
    }

    @Override
    public Optional<DoctorInfo> doctor(String doctorId) {
        return db.sql("select * from doctor where id = :id and active").param("id", doctorId)
                .query((rs, i) -> new DoctorInfo(rs.getString("id"), rs.getString("name"), rs.getString("branch_id"), rs.getString("dept_id"),
                        rs.getString("room"), rs.getString("status"), Arrays.asList((String[]) rs.getArray("days").getArray()),
                        time(rs.getString("start_time")), time(rs.getString("end_time")), rs.getInt("slot_min"),
                        time(rs.getString("break_start")), time(rs.getString("break_end"))))
                .optional();
    }

    private static LocalTime time(String s) {
        return s == null || s.isBlank() ? null : LocalTime.parse(s);
    }

    @Override
    public Optional<String> patientName(String patientId) {
        // Same rule as the patient API: staff only see patients registered in their branches.
        CurrentUser u = CurrentUser.get();
        return db.sql("select name, branch_id from patient where id = :id").param("id", patientId)
                .query((rs, i) -> u.canSee(rs.getString("branch_id")) ? rs.getString("name") : null).optional()
                .filter(n -> n != null);
    }

    @Override
    public boolean canSee(String branchId) {
        return CurrentUser.get().canSee(branchId);
    }

    @Override
    public List<String> scope(String requested) {
        CurrentUser u = CurrentUser.get();
        if (requested != null && !requested.isBlank()) {
            if (!u.canSee(requested)) throw new ApiException(403, "You don't work in branch " + requested + ".");
            return List.of(requested);
        }
        if (u.superAdmin()) return List.of();
        if (u.branches().isEmpty()) throw new ApiException(403, "Your account isn't linked to a branch yet.");
        return u.branches();
    }

    @Override
    public UUID userId() {
        return CurrentUser.get().id();
    }

    @Override
    public void audit(String branchId, String action, String entity, String entityId, String detail) {
        audit.logForBranch(branchId, action, entity, entityId, detail);
    }
}
