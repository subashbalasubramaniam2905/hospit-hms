package com.hospitos.branches;

import com.hospitos.common.CurrentUser;
import java.math.BigDecimal;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Read-only departments and doctors for the signed-in user's branches. */
@RestController
@RequestMapping("/api")
public class DirectoryController {
  private final JdbcClient db;
  public DirectoryController(JdbcClient db) { this.db = db; }

  public record Department(String id, String branchId, String name, String icon, String floor) {}
  public record Doctor(String id, String branchId, String deptId, String name, String qualification, int experience,
                       BigDecimal fee, String room, String phone, String email, List<String> days, String start, String end,
                       int slotMin, String status, String regNo) {}

  @GetMapping("/departments")
  public List<Department> departments() {
    var me = CurrentUser.get();
    return db.sql("select id, branch_id, name, icon, floor from department where active order by name")
        .query(Department.class).list().stream().filter(d -> me.canSee(d.branchId())).toList();
  }

  @GetMapping("/doctors")
  public List<Doctor> doctors() {
    var me = CurrentUser.get();
    return db.sql("""
        select id, branch_id, dept_id, name, qualification, experience, fee, room, phone, email, days,
               start_time, end_time, slot_min, status, reg_no from doctor where active order by name""")
        .query((r, i) -> new Doctor(r.getString("id"), r.getString("branch_id"), r.getString("dept_id"), r.getString("name"),
            r.getString("qualification"), r.getInt("experience"), r.getBigDecimal("fee"), r.getString("room"), r.getString("phone"),
            r.getString("email"), java.util.Arrays.asList((String[]) r.getArray("days").getArray()), r.getString("start_time"),
            r.getString("end_time"), r.getInt("slot_min"), r.getString("status"), r.getString("reg_no")))
        .list().stream().filter(d -> me.canSee(d.branchId())).toList();
  }
}
