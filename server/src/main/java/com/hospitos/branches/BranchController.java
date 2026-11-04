package com.hospitos.branches;

import com.hospitos.common.CurrentUser;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/branches")
public class BranchController {
  private final JdbcClient db;
  public BranchController(JdbcClient db) { this.db = db; }

  public record Branch(String id, String name, String city, String address, String phone, String gstin) {}

  @GetMapping
  public List<Branch> list() {
    var me = CurrentUser.get();
    return db.sql("select id, name, city, address, phone, gstin from branch where active order by id")
        .query(Branch.class).list().stream().filter(b -> me.canSee(b.id())).toList();
  }
}
