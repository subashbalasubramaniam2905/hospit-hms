package com.hospitos;

import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;

/** Each test run starts from an empty schema with all migrations applied. */
@TestConfiguration
public class CleanDatabase {
  @Bean
  FlywayMigrationStrategy cleanMigrate() {
    return f -> { f.clean(); f.migrate(); };
  }
}
