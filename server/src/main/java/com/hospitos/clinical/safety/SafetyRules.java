package com.hospitos.clinical.safety;

import java.util.List;
import java.util.regex.Pattern;

/** Compiled allergy and interaction rules. */
public record SafetyRules(List<AllergyRule> allergy, List<InteractionRule> interaction) {
  public record AllergyRule(String allergen, Pattern drugs, String level, String message) {}
  public record InteractionRule(Pattern a, Pattern b, String level, String message) {}

  static Pattern compile(String regex) { return Pattern.compile(regex, Pattern.CASE_INSENSITIVE); }
}
