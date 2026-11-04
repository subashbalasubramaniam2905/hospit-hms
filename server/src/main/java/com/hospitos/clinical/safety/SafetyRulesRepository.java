package com.hospitos.clinical.safety;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Reads the demo rules seeded by V22. The tables are tiny, so they are read on every check. */
@Repository
public class SafetyRulesRepository {
  private final JdbcClient db;
  public SafetyRulesRepository(JdbcClient db) { this.db = db; }

  public SafetyRules load() {
    var allergy = db.sql("select allergen, drug_pattern, level, message from drug_allergy_rule order by id")
        .query((r, i) -> new SafetyRules.AllergyRule(r.getString(1), SafetyRules.compile(r.getString(2)), r.getString(3), r.getString(4)))
        .list();
    var interaction = db.sql("select drug_a_pattern, drug_b_pattern, level, message from drug_interaction_rule order by id")
        .query((r, i) -> new SafetyRules.InteractionRule(SafetyRules.compile(r.getString(1)), SafetyRules.compile(r.getString(2)),
            r.getString(3), r.getString(4)))
        .list();
    return new SafetyRules(allergy, interaction);
  }
}
