package com.hospitos.clinical.safety;

import java.util.Locale;

/** The part of a prescription line the safety screen looks at. */
public record DrugLine(String name, String generic) {
  String text() { return (nz(generic) + " " + nz(name)).trim(); }
  String label() { return nz(name).isBlank() ? nz(generic) : name; }
  String ingredientLabel() { return nz(generic).isBlank() ? nz(name) : generic; }
  String ingredient() { return ingredientLabel().trim().toLowerCase(Locale.ROOT); }
  private static String nz(String s) { return s == null ? "" : s; }
}
