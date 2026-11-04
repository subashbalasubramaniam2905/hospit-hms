package com.hospitos.clinical;

import com.hospitos.clinical.safety.SafetyAlert;
import java.util.List;

/** Signing was refused because critical safety alerts have no override reason. */
public class SafetyBlockedException extends RuntimeException {
  private final List<SafetyAlert> alerts;
  public SafetyBlockedException(List<SafetyAlert> alerts) {
    super("This prescription has critical safety alerts. Give an override reason or change the medicines");
    this.alerts = alerts;
  }
  public List<SafetyAlert> alerts() { return alerts; }
}
