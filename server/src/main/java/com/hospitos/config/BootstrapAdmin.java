package com.hospitos.config;

import com.hospitos.audit.AuditService;
import com.hospitos.users.PasswordPolicy;
import com.hospitos.users.UserRepository;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/** On an empty database, creates the first super administrator from ADMIN_EMAIL and ADMIN_PASSWORD. */
@Component
public class BootstrapAdmin implements ApplicationRunner {
  private static final Logger log = LoggerFactory.getLogger(BootstrapAdmin.class);
  private final AppProperties props;
  private final UserRepository users;
  private final PasswordEncoder encoder;
  private final AuditService audit;

  public BootstrapAdmin(AppProperties props, UserRepository users, PasswordEncoder encoder, AuditService audit) {
    this.props = props; this.users = users; this.encoder = encoder; this.audit = audit;
  }

  @Override
  public void run(ApplicationArguments args) {
    var a = props.bootstrapAdmin();
    if (users.count() > 0) return;
    if (a == null || a.email() == null || a.email().isBlank()) {
      log.warn("No staff accounts exist. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first super administrator.");
      return;
    }
    PasswordPolicy.check(a.password());
    var id = users.create(a.email(), a.name(), "super-admin", List.of("BR1", "BR2", "BR3"), encoder.encode(a.password()), false);
    audit.write(id, a.name(), "super-admin", "Created", "User", id.toString(), "First super administrator (bootstrap)");
    log.info("Created first super administrator {}", a.email());
  }
}
