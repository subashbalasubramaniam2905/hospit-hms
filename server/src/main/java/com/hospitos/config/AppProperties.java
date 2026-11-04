package com.hospitos.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "hospitos")
public record AppProperties(String jwtSecret, int tokenHours, List<String> corsOrigins, BootstrapAdmin bootstrapAdmin) {
  public record BootstrapAdmin(String email, String password, String name) {}
}
