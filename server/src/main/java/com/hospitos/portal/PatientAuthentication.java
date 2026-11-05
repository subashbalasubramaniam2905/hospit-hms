package com.hospitos.portal;

import java.util.List;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

/**
 * A patient signed in to the portal with a one-time code sent to their mobile. They can see the patients registered with that
 * mobile number (a family often shares one), re-read on every request. This is never a staff authentication.
 */
public class PatientAuthentication extends AbstractAuthenticationToken {
  private final String mobile10;
  private final List<String> patientIds;

  public PatientAuthentication(String mobile10, List<String> patientIds) {
    super(List.of(new SimpleGrantedAuthority("ROLE_patient")));
    this.mobile10 = mobile10;
    this.patientIds = List.copyOf(patientIds);
    setAuthenticated(true);
  }

  public String mobile10() { return mobile10; }
  public List<String> patientIds() { return patientIds; }
  @Override public Object getCredentials() { return ""; }
  @Override public Object getPrincipal() { return "patient:" + mobile10; }
}
