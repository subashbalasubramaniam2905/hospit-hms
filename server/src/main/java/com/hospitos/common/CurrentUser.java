package com.hospitos.common;

import java.util.List;
import java.util.UUID;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * The signed-in staff member. Role and branches come from the database on every request,
 * so suspensions and role or branch changes take effect immediately.
 */
public record CurrentUser(UUID id, String name, String role, List<String> branches, boolean mustChangePw) {

  public static CurrentUser get() {
    var auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth instanceof StaffAuthentication s) return s.user();
    throw new ApiException(401, "Not signed in");
  }

  public boolean superAdmin() { return "super-admin".equals(role); }

  /** Super administrators see every branch; everyone else only the branches on their account. */
  public boolean canSee(String branchId) { return superAdmin() || branches.contains(branchId); }

  /** The branch to attribute actions to when no record branch applies. */
  public String homeBranch() { return branches.isEmpty() ? null : branches.get(0); }
}
