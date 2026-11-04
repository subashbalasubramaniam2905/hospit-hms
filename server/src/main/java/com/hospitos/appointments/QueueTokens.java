package com.hospitos.appointments;

import java.time.LocalDate;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Issues the day's queue tokens, e.g. G-001, per branch and department. Safe under concurrent check-ins. */
@Service
public class QueueTokens {

    /** Letter shown on the token for each department. Other departments use their own code, so tokens stay unique. */
    static final Map<String, String> PREFIX = Map.of("GM", "G", "CA", "C", "PE", "P", "OR", "O", "DE", "D", "GY", "Y", "EN", "E", "EM", "X");

    private final JdbcClient db;

    public QueueTokens(JdbcClient db) {
        this.db = db;
    }

    public String next(String branchId, String deptId, LocalDate day) {
        int n = db.sql("""
                insert into token_counter (branch_id, dept_id, visit_date, last_no) values (:b, :d, :day, 1)
                on conflict (branch_id, dept_id, visit_date) do update set last_no = token_counter.last_no + 1
                returning last_no""")
                .param("b", branchId).param("d", deptId).param("day", day).query(Integer.class).single();
        return format(deptId, n);
    }

    static String format(String deptId, int n) {
        return PREFIX.getOrDefault(deptId, deptId.toUpperCase()) + "-" + String.format("%03d", n);
    }
}
