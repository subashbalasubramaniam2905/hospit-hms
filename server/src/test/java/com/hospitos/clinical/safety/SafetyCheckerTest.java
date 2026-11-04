package com.hospitos.clinical.safety;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class SafetyCheckerTest {
  private static final SafetyRules RULES = new SafetyRules(
      List.of(new SafetyRules.AllergyRule("Penicillin", SafetyRules.compile("amoxicillin|clavulan"), SafetyAlert.CRITICAL, "pen"),
          new SafetyRules.AllergyRule("Penicillin", SafetyRules.compile("cefixime"), SafetyAlert.WARNING, "ceph")),
      List.of(new SafetyRules.InteractionRule(SafetyRules.compile("clopidogrel"), SafetyRules.compile("omeprazole"),
          SafetyAlert.WARNING, "ppi")));

  @Test
  void flagsClassAllergyCrossSensitivityInteractionAndDuplicate() {
    var alerts = SafetyChecker.check(RULES, List.of("penicillin"), List.of(
        new DrugLine("Mox 500", "Amoxicillin"), new DrugLine("Taxim-O", "Cefixime"),
        new DrugLine("Clopilet", "Clopidogrel"), new DrugLine("Omez", "Omeprazole"), new DrugLine("Omez DSR", "Omeprazole")));
    assertThat(alerts).extracting(SafetyAlert::code).containsExactly(
        "allergy:penicillin:amoxicillin", "allergy:penicillin:cefixime", "interaction:clopidogrel+omeprazole", "duplicate:omeprazole");
    assertThat(alerts.get(0).critical()).isTrue();
    assertThat(alerts.get(1).level()).isEqualTo(SafetyAlert.WARNING);
  }

  @Test
  void allergyRecordedAsADrugNameStillBlocksThatDrug() {
    var alerts = SafetyChecker.check(RULES, List.of("Metformin"), List.of(new DrugLine("Glycomet 500", "Metformin")));
    assertThat(alerts).singleElement().satisfies(a -> {
      assertThat(a.critical()).isTrue();
      assertThat(a.kind()).isEqualTo("Allergy");
    });
  }

  @Test
  void noAllergiesAndUnrelatedDrugsGiveNoAlerts() {
    assertThat(SafetyChecker.check(RULES, List.of(), List.of(new DrugLine("Dolo 650", "Paracetamol")))).isEmpty();
    assertThat(SafetyChecker.check(RULES, List.of("Penicillin"), List.of(new DrugLine("Dolo 650", "Paracetamol")))).isEmpty();
  }
}
