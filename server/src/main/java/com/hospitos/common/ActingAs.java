package com.hospitos.common;

import java.time.Instant;
import java.util.List;
import java.util.function.Supplier;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Runs module code on behalf of someone who is not a staff account (a patient in the portal, a lobby kiosk), so the
 * module's own checks and audit trail apply. The stand-in user has no account id: records it creates have no created_by, and
 * the audit trail names the portal or kiosk. Only the calling service decides what the stand-in may do; it is never the
 * authentication of the HTTP request itself, so it cannot reach staff endpoints.
 */
public final class ActingAs {
  private ActingAs() {}

  public static <T> T run(String name, String role, List<String> branches, Supplier<T> work) {
    var ctx = SecurityContextHolder.getContext();
    var previous = ctx.getAuthentication();
    var jwt = Jwt.withTokenValue("internal").header("alg", "none").subject(name).issuedAt(Instant.now()).build();
    ctx.setAuthentication(new StaffAuthentication(jwt, new CurrentUser(null, name, role, List.copyOf(branches), false)));
    try {
      return work.get();
    } finally {
      ctx.setAuthentication(previous);
    }
  }
}
