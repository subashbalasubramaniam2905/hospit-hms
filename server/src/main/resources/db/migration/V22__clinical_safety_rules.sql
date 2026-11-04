-- Demo medication safety rules. NOT validated clinical decision support: these rows only show
-- how the checks behave and must be replaced by a clinically reviewed drug knowledge base before real use.
-- Patterns are case-insensitive Java regular expressions matched against the line's generic and brand name.

create table drug_allergy_rule (
  id            serial primary key,
  allergen      text not null,
  drug_pattern  text not null,
  level         text not null check (level in ('Critical','Warning','Info')),
  message       text not null
);

create table drug_interaction_rule (
  id              serial primary key,
  drug_a_pattern  text not null,
  drug_b_pattern  text not null,
  level           text not null check (level in ('Critical','Warning','Info')),
  message         text not null
);

insert into drug_allergy_rule (allergen, drug_pattern, level, message) values
  ('Sulfonamides', 'sulfa|sulpha|trimethoprim', 'Critical', 'The patient record lists a sulfonamide allergy. Choose an alternative or document why the benefit outweighs the risk.'),
  ('Sulfonamides', 'glimepiride|furosemide', 'Info', 'Cross-reactivity with non-antibiotic sulfonamides is uncommon. Monitor for rash.'),
  ('Penicillin', 'amoxicillin|ampicillin|penicillin|clavulan|piperacillin', 'Critical', 'The patient record lists a penicillin allergy. Choose an alternative or document why the benefit outweighs the risk.'),
  ('Penicillin', 'cefalexin|cephalexin|cefuroxime|ceftriaxone|cefixime|cefpodoxime', 'Warning', 'Cephalosporins carry a small cross-reactivity risk in penicillin allergy.'),
  ('NSAIDs', 'ibuprofen|diclofenac|aceclofenac|naproxen|aspirin|ketorolac|mefenamic', 'Critical', 'The patient record lists an NSAID allergy. Choose an alternative or document why the benefit outweighs the risk.'),
  ('Iodinated contrast', 'contrast|iohexol|iopamidol', 'Critical', 'The patient record lists an iodinated contrast allergy.');

insert into drug_interaction_rule (drug_a_pattern, drug_b_pattern, level, message) values
  ('clopidogrel', 'omeprazole', 'Warning', 'Omeprazole may reduce the antiplatelet effect of clopidogrel. Pantoprazole is often preferred.'),
  ('aspirin', 'ibuprofen|diclofenac|aceclofenac', 'Warning', 'NSAIDs with aspirin raise bleeding risk and may blunt cardioprotection.'),
  ('enoxaparin', 'aspirin|clopidogrel|ibuprofen|diclofenac', 'Critical', 'Anticoagulant with antiplatelet or NSAID: high bleeding risk. Confirm indication.'),
  ('telmisartan', 'potassium', 'Warning', 'ARB with potassium supplements can raise serum potassium.'),
  ('ciprofloxacin', 'ondansetron|azithromycin', 'Warning', 'Both can prolong the QT interval.'),
  ('glimepiride', 'insulin', 'Warning', 'Sulfonylurea with insulin increases hypoglycaemia risk.');
