package com.hospitos.common;

import java.util.List;
import java.util.UUID;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

/** The signed-in staff member, read from the verified token. */
public record CurrentUser(UUID id, String name, String role, List<String> branches) {

  public static CurrentUser get() {
    var auth = SecurityContextHolder.getContext().getAuthentication();
    if (!(auth instanceof JwtAuthenticationToken t)) throw new ApiException(401, "Not signed in");
    Jwt jwt = t.getToken();
    List<String> br = jwt.getClaimAsStringList("branches");
    return new CurrentUser(UUID.fromString(jwt.getSubject()), jwt.getClaimAsString("name"), jwt.getClaimAsString("role"),
        br == null ? List.of() : br);
  }

  public boolean superAdmin() { return "super-admin".equals(role); }

  /** Super administrators see every branch; everyone else only the branches on their account. */
  public boolean canSee(String branchId) { return superAdmin() || branches.contains(branchId); }
}
