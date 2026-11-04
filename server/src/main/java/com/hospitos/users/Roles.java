package com.hospitos.users;

import java.util.Set;

public final class Roles {
  private Roles() {}
  public static final Set<String> STAFF = Set.of("super-admin", "admin", "doctor", "nurse", "receptionist", "pharmacist",
      "lab-tech", "radiologist", "billing", "hr", "inventory");
}
