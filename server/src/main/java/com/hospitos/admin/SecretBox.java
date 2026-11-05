package com.hospitos.admin;

import com.hospitos.config.AppProperties;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** AES-256-GCM for secrets kept in the database (integration API keys and tokens). */
@Component
public class SecretBox {
  private static final Logger log = LoggerFactory.getLogger(SecretBox.class);
  private static final SecureRandom RNG = new SecureRandom();
  private final SecretKeySpec key;

  public SecretBox(AppProperties props) {
    String material = props.secretKey();
    if (material == null || material.isBlank()) {
      log.warn("SECRET_KEY is not set; integration secrets are encrypted with a key derived from JWT_SECRET. Set SECRET_KEY before storing real credentials.");
      material = "integration-secrets:" + props.jwtSecret();
    }
    try {
      key = new SecretKeySpec(MessageDigest.getInstance("SHA-256").digest(material.getBytes(StandardCharsets.UTF_8)), "AES");
    } catch (Exception e) { throw new IllegalStateException(e); }
  }

  public String seal(String plain) {
    try {
      byte[] iv = new byte[12]; RNG.nextBytes(iv);
      var c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
      byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
      byte[] out = new byte[iv.length + ct.length];
      System.arraycopy(iv, 0, out, 0, iv.length); System.arraycopy(ct, 0, out, iv.length, ct.length);
      return Base64.getEncoder().encodeToString(out);
    } catch (Exception e) { throw new IllegalStateException("Could not encrypt", e); }
  }

  public String open(String sealed) {
    try {
      byte[] in = Base64.getDecoder().decode(sealed);
      var c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, in, 0, 12));
      return new String(c.doFinal(in, 12, in.length - 12), StandardCharsets.UTF_8);
    } catch (Exception e) { throw new IllegalStateException("Could not decrypt integration secrets. Was SECRET_KEY changed?", e); }
  }
}
