package com.hospitos.config;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.List;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/** Stateless API security: every request except sign-in and health needs a valid signed token. */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

  @Bean
  SecurityFilterChain api(HttpSecurity http) throws Exception {
    http.csrf(c -> c.disable())
        .cors(c -> {})
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .headers(h -> h.contentSecurityPolicy(c -> c.policyDirectives("default-src 'none'; frame-ancestors 'none'")))
        .authorizeHttpRequests(a -> a
            .requestMatchers(HttpMethod.POST, "/api/auth/login").permitAll()
            .requestMatchers("/actuator/health").permitAll()
            .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
            .anyRequest().authenticated())
        .oauth2ResourceServer(o -> o.jwt(j -> j.jwtAuthenticationConverter(roleConverter())));
    return http.build();
  }

  private JwtAuthenticationConverter roleConverter() {
    var c = new JwtAuthenticationConverter();
    c.setJwtGrantedAuthoritiesConverter(jwt -> {
      String role = jwt.getClaimAsString("role");
      Collection<GrantedAuthority> out = role == null ? List.of() : List.of(new SimpleGrantedAuthority("ROLE_" + role));
      return out;
    });
    return c;
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
