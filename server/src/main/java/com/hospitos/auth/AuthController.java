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
    if (found.isEmpty()) {
      encoder.matches(req.password(), dummyHash);
      throw new ApiException(401, "Email or password is incorrect");
    }
    UserRecord u = found.get();
    if (u.lockedUntil() != null && u.lockedUntil().isAfter(OffsetDateTime.now()))
      throw new ApiException(423, "Too many failed attempts. Try again in 15 minutes or ask an administrator to reset your password");
    if (!encoder.matches(req.password(), u.passwordHash())) {
      users.loginFailed(u.id());
      audit.write(u.id(), u.name(), u.role(), "Sign-in failed", "User", u.id().toString(), u.email());
      throw new ApiException(401, "Email or password is incorrect");
    }
    if (!"Active".equals(u.status())) throw new ApiException(403, "This account is suspended. Contact your administrator");
    users.loginOk(u.id());
    audit.write(u.id(), u.name(), u.role(), "Signed in", "User", u.id().toString(), u.email());
    var t = tokens.issue(u);
    return new LoginResponse(t.token(), t.expiresAt(), users.byId(u.id()).orElseThrow());
  }

  @GetMapping("/me")
  public UserRecord me() {
    return users.byId(CurrentUser.get().id()).orElseThrow(() -> new ApiException(401, "Account not found"));
  }

  @PostMapping("/password")
  public void changePassword(@Valid @RequestBody ChangePassword req) {
    var me = me();
    if (!encoder.matches(req.currentPassword(), me.passwordHash())) throw new ApiException(400, "Current password is incorrect");
    PasswordPolicy.check(req.newPassword());
    users.setPassword(me.id(), encoder.encode(req.newPassword()), false);
    audit.log("Changed password", "User", me.id().toString(), "");
  }
}
