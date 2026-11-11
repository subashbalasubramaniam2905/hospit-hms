package com.hospitos.config;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import com.hospitos.common.CurrentUser;
import com.hospitos.common.StaffAuthentication;
import com.hospitos.users.UserRepository;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.InvalidBearerTokenException;
import java.util.List;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/** Stateless API security: every request except sign-in and health needs a valid signed token. */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

  private final Converter<Jwt, AbstractAuthenticationToken> staffConverter;

  public SecurityConfig(UserRepository users, org.springframework.jdbc.core.simple.JdbcClient db) {
    // Every request re-reads the account, so suspension, role and branch changes and password resets apply immediately.
    // Patient portal and kiosk tokens carry a "typ" claim and get their own authentication, which no staff endpoint accepts.
    this.staffConverter = jwt -> {
      Object typ = jwt.getClaim("typ");
      if ("patient".equals(typ)) return com.hospitos.portal.PortalTokens.authenticate(db, jwt);
      if ("kiosk".equals(typ)) return com.hospitos.kiosk.KioskTokens.authenticate(db, jwt);
      if (typ != null) throw new InvalidBearerTokenException("Invalid token");
      UUID id;
      try { id = UUID.fromString(jwt.getSubject()); } catch (RuntimeException e) { throw new InvalidBearerTokenException("Invalid token"); }
      var a = users.access(id).orElseThrow(() -> new InvalidBearerTokenException("Account no longer exists"));
      if (!"Active".equals(a.status())) throw new InvalidBearerTokenException("Account is suspended");
      Object tv = jwt.getClaim("tv");
      if (!(tv instanceof Number n) || n.intValue() != a.tokenVersion()) throw new InvalidBearerTokenException("Session has been signed out");
      return new StaffAuthentication(jwt, new CurrentUser(id, a.name(), a.role(), a.branches(), a.mustChangePw()));
    };
  }

  @Bean
  SecurityFilterChain api(HttpSecurity http) throws Exception {
    http.csrf(c -> c.disable())
        .cors(c -> {})
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .headers(h -> h.contentSecurityPolicy(c -> c.policyDirectives("default-src 'none'; frame-ancestors 'none'")))
        .authorizeHttpRequests(a -> a
            .requestMatchers(HttpMethod.POST, "/api/auth/login").permitAll()
            .requestMatchers("/actuator/health", "/actuator/info").permitAll()
            .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
            // Meta's delivery receipts; the controller checks the verify token and the request signature.
            .requestMatchers("/api/webhooks/whatsapp").permitAll()
            .requestMatchers("/api/auth/me", "/api/auth/password").access((auth, ctx) -> new AuthorizationDecision(auth.get() instanceof StaffAuthentication))
            // Patient portal: sign-in with a code sent to the registered mobile, then patient tokens only.
            .requestMatchers(HttpMethod.POST, "/api/portal/otp", "/api/portal/verify").permitAll()
            .requestMatchers("/api/portal/**").access((auth, ctx) -> new AuthorizationDecision(auth.get() instanceof com.hospitos.portal.PatientAuthentication))
            // Kiosks pair with a one-time code; device management is for staff (role checks on the controller).
            .requestMatchers(HttpMethod.POST, "/api/kiosk/pair").permitAll()
            .requestMatchers("/api/kiosk/devices/**", "/api/kiosk/devices").access((auth, ctx) -> new AuthorizationDecision(
                auth.get() instanceof StaffAuthentication s && !s.user().mustChangePw()))
            .requestMatchers("/api/kiosk/**").access((auth, ctx) -> new AuthorizationDecision(auth.get() instanceof com.hospitos.kiosk.KioskAuthentication))
            // Accounts still on a temporary password can only change it.
            .anyRequest().access((auth, ctx) -> new AuthorizationDecision(
                auth.get() instanceof StaffAuthentication s && !s.user().mustChangePw())))
        .exceptionHandling(e -> e.accessDeniedHandler((req, res, ex) -> {
          var a = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
          boolean pw = a instanceof StaffAuthentication s && s.user().mustChangePw();
          res.setStatus(403);
          res.setContentType("application/problem+json");
          res.getWriter().write(pw
              ? "{\"status\":403,\"title\":\"Forbidden\",\"code\":\"PASSWORD_CHANGE_REQUIRED\",\"detail\":\"Change your temporary password first\"}"
              : "{\"status\":403,\"title\":\"Forbidden\",\"detail\":\"Your role does not allow this action\"}");
        }))
        .oauth2ResourceServer(o -> o.jwt(j -> j.jwtAuthenticationConverter(staffConverter)));
    return http.build();
  }

  private SecretKey key(AppProperties props) {
    byte[] bytes = props.jwtSecret().getBytes(StandardCharsets.UTF_8);
    if (bytes.length < 32) throw new IllegalStateException("JWT_SECRET must be at least 32 characters");
    if (props.jwtSecret().startsWith("dev-only"))
      org.slf4j.LoggerFactory.getLogger(SecurityConfig.class).warn("Using the development JWT secret. Set JWT_SECRET before handling real data.");
    return new SecretKeySpec(bytes, "HmacSHA256");
  }

  @Bean
  JwtEncoder jwtEncoder(AppProperties props) {
    return new NimbusJwtEncoder(new ImmutableSecret<>(key(props)));
  }

  @Bean
  JwtDecoder jwtDecoder(AppProperties props) {
    return NimbusJwtDecoder.withSecretKey(key(props)).macAlgorithm(MacAlgorithm.HS256).build();
  }

  @Bean
  PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder(12);
  }

  @Bean
  CorsConfigurationSource corsConfigurationSource(AppProperties props) {
    var cfg = new CorsConfiguration();
    cfg.setAllowedOrigins(props.corsOrigins());
    cfg.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
    cfg.setAllowedHeaders(List.of("Authorization", "Content-Type"));
    cfg.setMaxAge(3600L);
    var src = new UrlBasedCorsConfigurationSource();
    src.registerCorsConfiguration("/**", cfg);
    return src;
  }
}
