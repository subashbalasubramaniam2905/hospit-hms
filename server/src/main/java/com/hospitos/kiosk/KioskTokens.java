package com.hospitos.kiosk;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.server.resource.InvalidBearerTokenException;
import org.springframework.stereotype.Component;

/** Long-lived kiosk device tokens. Revoking the device or re-pairing it (token_version) signs the old token out. */
@Component
public class KioskTokens {
  private final JwtEncoder encoder;
  public KioskTokens(JwtEncoder encoder) { this.encoder = encoder; }

  public record Issued(String token, Instant expiresAt) {}

  public Issued issue(UUID deviceId, int tokenVersion) {
    Instant now = Instant.now(), exp = now.plus(Duration.ofDays(365));
    var claims = JwtClaimsSet.builder().issuer("hospitos").subject(deviceId.toString()).issuedAt(now).expiresAt(exp)
        .claim("typ", "kiosk").claim("tv", tokenVersion).build();
    return new Issued(encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue(), exp);
  }

  public static KioskAuthentication authenticate(JdbcClient db, Jwt jwt) {
    UUID id;
    try { id = UUID.fromString(jwt.getSubject()); } catch (RuntimeException e) { throw new InvalidBearerTokenException("Invalid token"); }
    record Dev(String branch, String name, boolean active, int tv) {}
    var d = db.sql("select branch_id, name, active, token_version from kiosk_device where id = :id").param("id", id)
        .query((rs, n) -> new Dev(rs.getString(1), rs.getString(2), rs.getBoolean(3), rs.getInt(4))).optional()
        .orElseThrow(() -> new InvalidBearerTokenException("This kiosk is no longer registered"));
    Object tv = jwt.getClaim("tv");
    if (!d.active() || !(tv instanceof Number n) || n.intValue() != d.tv()) throw new InvalidBearerTokenException("This kiosk has been signed out");
    db.sql("update kiosk_device set last_seen = now() where id = :id and (last_seen is null or last_seen < now() - interval '5 minutes')").param("id", id).update();
    return new KioskAuthentication(id, d.branch(), d.name());
  }
}
