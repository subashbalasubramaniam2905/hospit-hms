package com.hospitos.auth;

import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import com.hospitos.users.PasswordPolicy;
import com.hospitos.users.UserRecord;
import com.hospitos.users.UserRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.time.Instant;
import java.time.OffsetDateTime;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
  private final UserRepository users;
  private final PasswordEncoder encoder;
  private final TokenService tokens;
  private final AuditService audit;
  static final String BAD_LOGIN = "Email or password is incorrect. After five failed attempts the account is locked for 15 minutes";
  /** Compared against when the email is unknown, so response time does not reveal which accounts exist. */
  private final String dummyHash;

  public AuthController(UserRepository users, PasswordEncoder encoder, TokenService tokens, AuditService audit) {
    this.users = users; this.encoder = encoder; this.tokens = tokens; this.audit = audit;
    this.dummyHash = encoder.encode("not-a-real-password-0");
  }

  public record LoginRequest(@NotBlank String email, @NotBlank String password) {}
  public record LoginResponse(String token, Instant expiresAt, UserRecord user) {}
  public record ChangePassword(@NotBlank String currentPassword, @NotBlank String newPassword) {}

  @PostMapping("/login")
  public LoginResponse login(@Valid @RequestBody LoginRequest req) {
    var found = users.byEmail(req.email());
    // Unknown, locked and wrong-password attempts all get the same answer after the same bcrypt work,
    // so the response does not reveal which emails have accounts.
    if (found.isEmpty()) {
      encoder.matches(req.password(), dummyHash);
      throw new ApiException(401, BAD_LOGIN);
    }
    UserRecord u = found.get();
    String branch = u.branches().isEmpty() ? null : u.branches().get(0);
    boolean locked = u.lockedUntil() != null && u.lockedUntil().isAfter(OffsetDateTime.now());
    boolean ok = encoder.matches(req.password(), u.passwordHash());
    if (locked || !ok) {
      if (!locked) users.loginFailed(u.id());
      audit.write(u.id(), u.name(), u.role(), branch, locked ? "Sign-in blocked (locked)" : "Sign-in failed", "User", u.id().toString(), u.email());
      throw new ApiException(401, BAD_LOGIN);
    }
    if (!"Active".equals(u.status())) throw new ApiException(403, "This account is suspended. Contact your administrator");
    users.loginOk(u.id());
    audit.write(u.id(), u.name(), u.role(), branch, "Signed in", "User", u.id().toString(), u.email());
    var t = tokens.issue(u);
    return new LoginResponse(t.token(), t.expiresAt(), users.byId(u.id()).orElseThrow());
  }

  @GetMapping("/me")
  public UserRecord me() {
    return users.byId(CurrentUser.get().id()).orElseThrow(() -> new ApiException(401, "Account not found"));
  }

  @PostMapping("/password")
  /** Changing the password signs out every other session, so the response carries a fresh token. */
  public LoginResponse changePassword(@Valid @RequestBody ChangePassword req) {
    var me = me();
    if (!encoder.matches(req.currentPassword(), me.passwordHash())) throw new ApiException(400, "Current password is incorrect");
    if (req.currentPassword().equals(req.newPassword())) throw new ApiException(400, "Choose a password different from the current one");
    PasswordPolicy.check(req.newPassword());
    users.setPassword(me.id(), encoder.encode(req.newPassword()), false);
    audit.logForBranch(CurrentUser.get().homeBranch(), "Changed password", "User", me.id().toString(), "");
    var u = users.byId(me.id()).orElseThrow();
    var t = tokens.issue(u);
    return new LoginResponse(t.token(), t.expiresAt(), u);
  }
}
