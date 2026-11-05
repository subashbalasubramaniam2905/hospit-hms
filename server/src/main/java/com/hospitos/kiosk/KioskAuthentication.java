package com.hospitos.kiosk;

import java.util.List;
import java.util.UUID;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

/** A paired lobby kiosk. It can only use the kiosk endpoints, for its own branch. Never a staff authentication. */
public class KioskAuthentication extends AbstractAuthenticationToken {
  private final UUID deviceId;
  private final String branchId;
  private final String name;

  public KioskAuthentication(UUID deviceId, String branchId, String name) {
    super(List.of(new SimpleGrantedAuthority("ROLE_kiosk")));
    this.deviceId = deviceId; this.branchId = branchId; this.name = name;
    setAuthenticated(true);
  }

  public UUID deviceId() { return deviceId; }
  public String branchId() { return branchId; }
  public String name() { return name; }
  @Override public Object getCredentials() { return ""; }
  @Override public Object getPrincipal() { return "kiosk:" + deviceId; }
}
