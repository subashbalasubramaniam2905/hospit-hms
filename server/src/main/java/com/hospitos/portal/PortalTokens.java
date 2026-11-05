package com.hospitos.portal;

import com.hospitos.config.AppProperties;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.server.resource.InvalidBearerTokenException;
import org.springframework.stereotype.Component;

/** Issues and checks patient portal tokens. A token names a mobile number; the patients behind it are looked up per request. */
@Component
public class PortalTokens {
  private final JwtEncoder encoder;
  private final AppProperties props;
  public PortalTokens(JwtEncoder encoder, AppProperties props) { this.encoder = encoder; this.props = props; }

  public record Issued(String token, Instant expiresAt) {}

  public Issued issue(String mobile10) {
    Instant now = Instant.now(), exp = now.plus(Duration.ofHours(Math.min(props.tokenHours(), 12)));
    var claims = JwtClaimsSet.builder().issuer("hospitos").subject("m:" + mobile10).issuedAt(now).expiresAt(exp).claim("typ", "patient").build();
    return new Issued(encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue(), exp);
  }

  /** SQL: patient p's mobile, as its last ten digits. */
  static final String MOBILE10 = "right(regexp_replace(p.mobile, '\\D', '', 'g'), 10)";

  public static List<String> patientIds(JdbcClient db, String mobile10) {
    return db.sql("select p.id from patient p where " + MOBILE10 + " = :m order by p.registered, p.id").param("m", mobile10).query(String.class).list();
  }

  public static PatientAuthentication authenticate(JdbcClient db, Jwt jwt) {
    String sub = jwt.getSubject();
    if (sub == null || !sub.matches("m:\\d{10}")) throw new InvalidBearerTokenException("Invalid token");
    String mobile = sub.substring(2);
    var ids = patientIds(db, mobile);
    if (ids.isEmpty()) throw new InvalidBearerTokenException("No patient is registered with this mobile number any more");
    return new PatientAuthentication(mobile, ids);
  }
}
