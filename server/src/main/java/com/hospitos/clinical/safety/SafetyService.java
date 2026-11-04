package com.hospitos.clinical.safety;

import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class SafetyService {
  private final SafetyRulesRepository rules;
  public SafetyService(SafetyRulesRepository rules) { this.rules = rules; }

  public List<SafetyAlert> check(List<String> allergies, List<DrugLine> lines) {
    return SafetyChecker.check(rules.load(), allergies == null ? List.of() : allergies, lines);
  }
}
