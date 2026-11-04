package com.hospitos.users;

import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class UserRepository {
  private static final String COLS = "id, email, name, role, branches, password_hash, status, must_change_pw, failed_logins, locked_until, last_login, created_at";
  private final JdbcClient db;
  public UserRepository(JdbcClient db) { this.db = db; }

  static List<String> arr(Array a) throws SQLException { return a == null ? List.of() : Arrays.asList((String[]) a.getArray()); }

  private static UserRecord map(ResultSet r, int i) throws SQLException {
    return new UserRecord(r.getObject("id", UUID.class), r.getString("email"), r.getString("name"), r.getString("role"),
        arr(r.getArray("branches")), r.getString("password_hash"), r.getString("status"), r.getBoolean("must_change_pw"),
        r.getInt("failed_logins"), r.getObject("locked_until", java.time.OffsetDateTime.class),
        r.getObject("last_login", java.time.OffsetDateTime.class), r.getObject("created_at", java.time.OffsetDateTime.class));
  }

  public Optional<UserRecord> byEmail(String email) {
    return db.sql("select " + COLS + " from app_user where lower(email) = lower(?)").param(email.trim()).query(UserRepository::map).optional();
  }
  public Optional<UserRecord> byId(UUID id) {
    return db.sql("select " + COLS + " from app_user where id = ?").param(id).query(UserRepository::map).optional();
  }
  public List<UserRecord> all() {
    return db.sql("select " + COLS + " from app_user order by name").query(UserRepository::map).list();
  }
  public long count() { return db.sql("select count(*) from app_user").query(Long.class).single(); }

  public UUID create(String email, String name, String role, List<String> branches, String hash, boolean mustChange) {
    return db.sql("insert into app_user (email, name, role, branches, password_hash, must_change_pw) values (?, ?, ?, ?, ?, ?) returning id")
        .params(email.trim(), name.trim(), role, branches.toArray(String[]::new), hash, mustChange).query(UUID.class).single();
  }
  public void update(UUID id, String name, String role, List<String> branches, String status) {
    db.sql("update app_user set name = ?, role = ?, branches = ?, status = ?, updated_at = now() where id = ?")
        .params(name, role, branches.toArray(String[]::new), status, id).update();
  }
  public void setPassword(UUID id, String hash, boolean mustChange) {
    db.sql("update app_user set password_hash = ?, must_change_pw = ?, failed_logins = 0, locked_until = null, updated_at = now() where id = ?")
        .params(hash, mustChange, id).update();
  }
  public void loginOk(UUID id) {
    db.sql("update app_user set failed_logins = 0, locked_until = null, last_login = now() where id = ?").param(id).update();
  }
  /** Counts a failed attempt and locks the account for 15 minutes after the fifth in a row. */
  public void loginFailed(UUID id) {
    db.sql("""
        update app_user set failed_logins = failed_logins + 1,
          locked_until = case when failed_logins + 1 >= 5 then now() + interval '15 minutes' else locked_until end
        where id = ?""").param(id).update();
  }
}
