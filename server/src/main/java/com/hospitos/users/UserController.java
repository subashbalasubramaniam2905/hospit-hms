package com.hospitos.users;

import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

/** Staff accounts. Administrators create accounts with a temporary password the user must change. */
@RestController
@RequestMapping("/api/users")
@PreAuthorize("hasAnyRole('super-admin','admin')")
public class UserController {
  private final UserRepository users;
  private final PasswordEncoder encoder;
  private final AuditService audit;
  public UserController(UserRepository users, PasswordEncoder encoder, AuditService audit) {
    this.users = users; this.encoder = encoder; this.audit = audit;
  }

  public record NewUser(@NotBlank @Email String email, @NotBlank String name, @NotBlank String role,
                        @NotNull List<String> branches, @NotBlank String temporaryPassword) {}
  public record UpdateUser(@NotBlank String name, @NotBlank String role, @NotNull List<String> branches, @NotBlank String status) {}
  public record ResetPassword(@NotBlank String temporaryPassword) {}

  @GetMapping
  public List<UserRecord> list() {
    var me = CurrentUser.get();
    return users.all().stream().filter(u -> me.superAdmin() || u.branches().stream().anyMatch(me::canSee)).toList();
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public UserRecord create(@Valid @RequestBody NewUser req) {
    checkRole(req.role(), req.branches());
    PasswordPolicy.check(req.temporaryPassword());
    if (users.byEmail(req.email()).isPresent()) throw new ApiException(409, "An account with this email already exists");
    UUID id = users.create(req.email(), req.name(), req.role(), req.branches(), encoder.encode(req.temporaryPassword()), true);
    audit.logForBranch(req.branches().isEmpty() ? null : req.branches().get(0), "Created", "User", id.toString(), req.name() + " as " + req.role());
    return users.byId(id).orElseThrow();
  }

  @PutMapping("/{id}")
  public UserRecord update(@PathVariable UUID id, @Valid @RequestBody UpdateUser req) {
    var existing = users.byId(id).orElseThrow(() -> new ApiException(404, "Account not found"));
    checkRole(existing.role(), existing.branches());
    checkRole(req.role(), req.branches());
    if (!List.of("Active", "Suspended").contains(req.status())) throw new ApiException(400, "Status must be Active or Suspended");
    if (id.equals(CurrentUser.get().id()) && !"Active".equals(req.status())) throw new ApiException(400, "You cannot suspend your own account");
    users.update(id, req.name(), req.role(), req.branches(), req.status());
    if (!"Active".equals(req.status())) users.revokeTokens(id);
    audit.logForBranch(req.branches().isEmpty() ? null : req.branches().get(0), "Updated", "User", id.toString(), req.name() + " · " + req.role() + " · " + req.status());
    return users.byId(id).orElseThrow();
  }

  @PostMapping("/{id}/reset-password")
  public void reset(@PathVariable UUID id, @Valid @RequestBody ResetPassword req) {
    var existing = users.byId(id).orElseThrow(() -> new ApiException(404, "Account not found"));
    checkRole(existing.role(), existing.branches());
    PasswordPolicy.check(req.temporaryPassword());
    users.setPassword(id, encoder.encode(req.temporaryPassword()), true);
    audit.logForBranch(existing.branches().isEmpty() ? null : existing.branches().get(0), "Reset password", "User", id.toString(), existing.name());
  }

  /** Branch administrators manage only their own branches and cannot create or edit super administrators. */
  private void checkRole(String role, List<String> branches) {
    var me = CurrentUser.get();
    if (!Roles.STAFF.contains(role)) throw new ApiException(400, "Unknown role: " + role);
    if (me.superAdmin()) return;
    if ("super-admin".equals(role)) throw new ApiException(403, "Only a super administrator can manage super administrators");
    if (branches.isEmpty() || !branches.stream().allMatch(me::canSee)) throw new ApiException(403, "You can only manage accounts in your own branches");
  }
}
