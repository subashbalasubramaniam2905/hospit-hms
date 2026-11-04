package com.hospitos.common;

import java.util.List;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

public class StaffAuthentication extends JwtAuthenticationToken {
  private final CurrentUser user;
  public StaffAuthentication(Jwt jwt, CurrentUser user) {
    super(jwt, List.of(new SimpleGrantedAuthority("ROLE_" + user.role())), user.id().toString());
    this.user = user;
  }
  public CurrentUser user() { return user; }
}
