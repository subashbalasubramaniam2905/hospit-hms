package com.hospitos.portal;

import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Portal sign-in with a six-digit code sent to the mobile number on the patient record. Codes last 10 minutes and allow five tries;
 * a number can ask for at most five codes an hour. Whether a number is registered is never revealed.
 *
 * No SMS gateway is connected yet. With {@code hospitos.portal.dev-otp=true} (local development only) the code is returned in the
 * response so the portal can be tried without one; otherwise it is only logged, masked.
 */
@Service
public class PortalSignIn {
  private static final Logger log = LoggerFactory.getLogger(PortalSignIn.class);
  private static final SecureRandom RANDOM = new SecureRandom();

  private final JdbcClient db;
  private final PasswordEncoder encoder;
  private final PortalTokens tokens;
  private final AuditService audit;
  private final boolean devOtp;

  public PortalSignIn(JdbcClient db, PasswordEncoder encoder, PortalTokens tokens, AuditService audit,
                      @Value("${hospitos.portal.dev-otp:false}") boolean devOtp) {
    this.db = db; this.encoder = encoder; this.tokens = tokens; this.audit = audit; this.devOtp = devOtp;
    if (devOtp) log.warn("Patient portal codes are returned in the API response (hospitos.portal.dev-otp). Never enable this with real patients.");
  }

  public record Sent(boolean sent, String devCode) {}
  public record SignedIn(String token, Instant expiresAt, int profiles) {}

  public static String mobile10(String raw) {
    String d = raw == null ? "" : raw.replaceAll("\\D", "");
    if (d.length() < 10) throw new ApiException(400, "Enter the 10 digit mobile number registered at the hospital");
    return d.substring(d.length() - 10);
  }

  @Transactional
  public Sent request(String rawMobile) {
    String m = mobile10(rawMobile);
    int recent = db.sql("select count(*) from portal_otp where mobile10 = :m and created_at > now() - interval '1 hour'").param("m", m).query(Integer.class).single();
    if (recent >= 5) throw new ApiException(429, "Too many codes requested. Try again in an hour");
    if (PortalTokens.patientIds(db, m).isEmpty()) {
      // Same answer as for a registered number, so the portal can't be used to find out who is a patient.
      return new Sent(true, null);
    }
    String code = String.format("%06d", RANDOM.nextInt(1_000_000));
    db.sql("update portal_otp set used = true where mobile10 = :m and not used").param("m", m).update();
    db.sql("insert into portal_otp (mobile10, code_hash, expires_at) values (:m, :h, :e)")
        .param("m", m).param("h", encoder.encode(code)).param("e", OffsetDateTime.now(ZoneOffset.UTC).plusMinutes(10)).update();
    log.info("Portal sign-in code for ******{} {}", m.substring(6), devOtp ? "is " + code : "created (no SMS gateway connected)");
    return new Sent(true, devOtp ? code : null);
  }

  @Transactional(noRollbackFor = ApiException.class)
  public SignedIn verify(String rawMobile, String code) {
    String m = mobile10(rawMobile);
    record Otp(long id, String hash, int attempts) {}
    var otp = db.sql("select id, code_hash, attempts from portal_otp where mobile10 = :m and not used and expires_at > now() order by id desc limit 1 for update")
        .param("m", m).query((rs, n) -> new Otp(rs.getLong(1), rs.getString(2), rs.getInt(3))).optional();
    if (otp.isEmpty()) throw new ApiException(401, "The code has expired. Ask for a new one");
    var o = otp.get();
    if (code == null || !code.matches("\\d{6}") || !encoder.matches(code, o.hash())) {
      int tries = o.attempts() + 1;
      db.sql("update portal_otp set attempts = :a, used = :u where id = :id").param("a", tries).param("u", tries >= 5).param("id", o.id()).update();
      throw new ApiException(401, tries >= 5 ? "Too many wrong codes. Ask for a new one" : "That code is not right");
    }
    db.sql("update portal_otp set used = true where id = :id").param("id", o.id()).update();
    var ids = PortalTokens.patientIds(db, m);
    var t = tokens.issue(m);
    String branch = db.sql("select branch_id from patient where id = :id").param("id", ids.get(0)).query(String.class).single();
    audit.write(null, "Patient portal ******" + m.substring(6), "patient", branch, "Signed in", "Patient portal", ids.get(0), ids.size() + " profile(s)");
    return new SignedIn(t.token(), t.expiresAt(), ids.size());
  }
}
