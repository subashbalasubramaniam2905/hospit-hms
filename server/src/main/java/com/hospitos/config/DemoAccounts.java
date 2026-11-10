package com.hospitos.config;

import com.hospitos.audit.AuditService;
import com.hospitos.users.PasswordPolicy;
import com.hospitos.users.UserRepository;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * Online demo only: when DEMO_PASSWORD is set, makes sure one sign-in per staff role exists, all sharing that
 * password, so visitors can try each role. On every start the demo accounts are set back to their role, DEMO_PASSWORD,
 * active and unlocked, so a visitor who changes a password or locks an account only breaks it until the next restart, and
 * changing DEMO_PASSWORD on the host changes it for every demo account. Never set it for a real hospital.
 */
@Component
@Order(10)
public class DemoAccounts implements ApplicationRunner {
  private static final Logger log = LoggerFactory.getLogger(DemoAccounts.class);

  /** email, name, role, branches */
  static final List<String[]> ACCOUNTS = List.of(
      new String[] {"admin@hospitos.demo", "Demo Administrator", "admin", "BR1,BR2,BR3"},
      new String[] {"doctor@hospitos.demo", "Dr. Sana Iqbal (demo)", "doctor", "BR1"},
      new String[] {"nurse@hospitos.demo", "Demo Nurse", "nurse", "BR1"},
      new String[] {"reception@hospitos.demo", "Demo Receptionist", "receptionist", "BR1"},
      new String[] {"pharmacy@hospitos.demo", "Demo Pharmacist", "pharmacist", "BR1"},
      new String[] {"lab@hospitos.demo", "Demo Lab Technician", "lab-tech", "BR1"},
      new String[] {"radiology@hospitos.demo", "Demo Radiologist", "radiologist", "BR1"},
      new String[] {"billing@hospitos.demo", "Demo Billing Desk", "billing", "BR1"},
      new String[] {"hr@hospitos.demo", "Demo HR", "hr", "BR1"},
      new String[] {"stores@hospitos.demo", "Demo Stores", "inventory", "BR1"});

  private final String password;
  private final UserRepository users;
  private final PasswordEncoder encoder;
  private final AuditService audit;

  public DemoAccounts(@Value("${hospitos.demo.password:}") String password, UserRepository users, PasswordEncoder encoder,
                      AuditService audit) {
    this.password = password; this.users = users; this.encoder = encoder; this.audit = audit;
  }

  @Override
  public void run(ApplicationArguments args) {
    if (password == null || password.isBlank()) return;
    PasswordPolicy.check(password);
    String hash = encoder.encode(password);
    for (var a : ACCOUNTS) {
      var branches = List.of(a[3].split(","));
      var existing = users.byEmail(a[0]);
      if (existing.isPresent()) {
        var id = existing.get().id();
        users.update(id, a[1], a[2], branches, "Active");
        users.setPassword(id, hash, false);
        continue;
      }
      var id = users.create(a[0], a[1], a[2], branches, hash, false);
      audit.write(id, a[1], a[2], null, "Created", "User", id.toString(), "Demo account");
      log.info("Created demo account {}", a[0]);
    }
  }
}
