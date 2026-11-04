package com.hospitos.clinical.safety;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Medication safety screen for allergies, interactions and duplicate ingredients.
 * Demo rules only. This is NOT validated clinical decision support.
 */
public final class SafetyChecker {
  private SafetyChecker() {}

  public static List<SafetyAlert> check(SafetyRules rules, List<String> allergies, List<DrugLine> lines) {
    Map<String, SafetyAlert> out = new LinkedHashMap<>();

    for (String raw : allergies) {
      if (raw == null || raw.isBlank()) continue;
      String allergy = raw.trim();
      boolean ruled = false;
      for (var rule : rules.allergy()) {
        if (!sameAllergen(rule.allergen(), allergy)) continue;
        ruled = true;
        for (DrugLine l : lines) {
          if (!rule.drugs().matcher(l.text()).find()) continue;
          String title = rule.level().equals(SafetyAlert.CRITICAL)
              ? l.label() + " conflicts with recorded " + rule.allergen() + " allergy"
              : l.label() + ": possible " + rule.allergen() + " cross-sensitivity";
          put(out, new SafetyAlert("allergy:" + key(rule.allergen()) + ":" + l.ingredient(), rule.level(), "Allergy", title,
              rule.message(), List.of(l.label())));
        }
      }
      // An allergy recorded as a drug name (for example "Amoxicillin") with no class rule still blocks that drug.
      if (!ruled && allergy.length() >= 4) {
        Pattern p = Pattern.compile(Pattern.quote(allergy), Pattern.CASE_INSENSITIVE);
        for (DrugLine l : lines) {
          if (!p.matcher(l.text()).find()) continue;
          put(out, new SafetyAlert("allergy:" + key(allergy) + ":" + l.ingredient(), SafetyAlert.CRITICAL, "Allergy",
              l.label() + " conflicts with recorded " + allergy + " allergy",
              "The patient record lists an allergy to " + allergy + ". Choose an alternative or document why the benefit outweighs the risk.",
              List.of(l.label())));
        }
      }
    }

    for (var rule : rules.interaction()) {
      for (DrugLine a : lines) {
        if (!rule.a().matcher(a.text()).find()) continue;
        for (DrugLine b : lines) {
          if (a == b || a.ingredient().equals(b.ingredient()) || !rule.b().matcher(b.text()).find()) continue;
          put(out, new SafetyAlert("interaction:" + a.ingredient() + "+" + b.ingredient(), rule.level(), "Interaction",
              a.label() + " + " + b.label(), rule.message(), List.of(a.label(), b.label())));
        }
      }
    }

    Map<String, DrugLine> seen = new HashMap<>();
    for (DrugLine l : lines) {
      String ing = l.ingredient();
      if (ing.isEmpty()) continue;
      DrugLine first = seen.putIfAbsent(ing, l);
      if (first != null)
        put(out, new SafetyAlert("duplicate:" + ing, SafetyAlert.WARNING, "Duplicate", l.ingredientLabel() + " prescribed twice",
            "Two lines contain the same active ingredient.", List.of(first.label(), l.label())));
    }
    return new ArrayList<>(out.values());
  }

  private static boolean sameAllergen(String allergen, String recorded) {
    String a = key(allergen), r = key(recorded);
    return r.equals(a) || r.contains(a) || (r.length() >= 4 && a.contains(r));
  }

  private static String key(String s) { return s.trim().toLowerCase(Locale.ROOT); }

  private static void put(Map<String, SafetyAlert> out, SafetyAlert a) { out.putIfAbsent(a.code(), a); }
}
