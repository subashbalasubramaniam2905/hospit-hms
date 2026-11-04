package com.hospitos.auth;

import com.hospitos.config.AppProperties;
import com.hospitos.users.UserRecord;
import java.time.Duration;
import java.time.Instant;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;

@Service
public class TokenService {
  private final JwtEncoder encoder;
  private final AppProperties props;
  public TokenService(JwtEncoder encoder, AppProperties props) { this.encoder = encoder; this.props = props; }

  public record Issued(String token, Instant expiresAt) {}

  public Issued issue(UserRecord u) {
    Instant now = Instant.now(), exp = now.plus(Duration.ofHours(props.tokenHours()));
    var claims = JwtClaimsSet.builder()
        .issuer("hospitos").subject(u.id().toString()).issuedAt(now).expiresAt(exp)
        .claim("name", u.name()).claim("email", u.email()).claim("role", u.role()).claim("branches", u.branches())
        .build();
    String token = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
    return new Issued(token, exp);
  }
}
