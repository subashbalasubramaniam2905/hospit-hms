-- Laboratory: test catalogue with reference ranges, orders, samples and results.

create table lab_test (
  id         text primary key,
  code       text not null unique,
  name       text not null,
  category   text not null,
  sample     text not null,
  price      numeric(12,2) not null check (price >= 0),
  tat_hours  int not null default 6 check (tat_hours > 0),
  active     boolean not null default true
);

create table lab_test_param (
  test_id    text not null references lab_test(id) on delete cascade,
  position   int not null,
  name       text not null,
  unit       text not null default '',
  low        numeric not null,
  high       numeric not null,
  crit_low   numeric,
  crit_high  numeric,
  primary key (test_id, position),
  unique (test_id, name)
);

-- A profile (for example a master health check) is a test whose members are other tests.
create table lab_test_profile (
  profile_id  text not null references lab_test(id) on delete cascade,
  member_id   text not null references lab_test(id),
  position    int not null,
  primary key (profile_id, member_id)
);

create sequence lab_order_seq start 5200;
create sequence lab_sample_seq start 89000;

create table lab_order (
  id               text primary key,
  branch_id        text not null references branch(id),
  patient_id       text not null references patient(id),
  doctor_id        text references doctor(id),
  status           text not null default 'Awaiting sample'
                   check (status in ('Ordered','Awaiting sample','Sample collected','Processing','Result ready','Verified','Delivered')),
  priority         text not null default 'Routine' check (priority in ('Routine','Urgent','STAT')),
  ordered_at       timestamptz not null default now(),
  ordered_by       uuid references app_user(id),
  sample_id        text unique,
  collected_at     timestamptz,
  collected_by     text,
  results_at       timestamptz,
  results_by       text,
  verified_at      timestamptz,
  verified_by      text,
  verified_by_user uuid references app_user(id),
  delivered_at     timestamptz,
  billed           boolean not null default false,
  invoice_id       uuid,
  invoice_number   text,
  comments         text,
  version          int not null default 1,
  updated_at       timestamptz not null default now()
);
create index lab_order_branch_status_idx on lab_order (branch_id, status);
create index lab_order_patient_idx on lab_order (patient_id, ordered_at desc);

create table lab_order_test (
  order_id  text not null references lab_order(id) on delete cascade,
  test_id   text not null references lab_test(id),
  position  int not null,
  price     numeric(12,2) not null,
  primary key (order_id, test_id)
);

create table lab_result (
  order_id  text not null,
  test_id   text not null,
  param     text not null,
  value     numeric,
  flag      text not null default '' check (flag in ('', 'N', 'L', 'H', 'C')),
  primary key (order_id, test_id, param),
  foreign key (order_id, test_id) references lab_order_test(order_id, test_id) on delete cascade
);

insert into lab_test (id, code, name, category, sample, price, tat_hours) values
  ('L01', 'CBC', 'Complete blood count', 'Haematology', 'EDTA blood', 350, 4),
  ('L02', 'FBS', 'Fasting blood glucose', 'Biochemistry', 'Fluoride plasma', 120, 2),
  ('L03', 'PPBS', 'Post-prandial blood glucose', 'Biochemistry', 'Fluoride plasma', 120, 2),
  ('L04', 'HBA1C', 'HbA1c', 'Biochemistry', 'EDTA blood', 550, 6),
  ('L05', 'LIPID', 'Lipid profile', 'Biochemistry', 'Serum', 650, 6),
  ('L06', 'TFT', 'Thyroid profile', 'Immunoassay', 'Serum', 600, 8),
  ('L07', 'LFT', 'Liver function test', 'Biochemistry', 'Serum', 700, 6),
  ('L08', 'KFT', 'Kidney function test', 'Biochemistry', 'Serum', 650, 6),
  ('L09', 'URINE', 'Urine routine analysis', 'Clinical pathology', 'Urine', 200, 3),
  ('L10', 'ESR', 'Erythrocyte sedimentation rate', 'Haematology', 'EDTA blood', 150, 2),
  ('L11', 'CRP', 'C-reactive protein', 'Immunoassay', 'Serum', 450, 4),
  ('L12', 'VITD', 'Vitamin D (25-OH)', 'Immunoassay', 'Serum', 1400, 24),
  ('L13', 'B12', 'Vitamin B12', 'Immunoassay', 'Serum', 900, 24),
  ('L14', 'TROP', 'Troponin I', 'Immunoassay', 'Serum', 1200, 1),
  ('L15', 'PTINR', 'Prothrombin time / INR', 'Haematology', 'Citrate plasma', 400, 3),
  ('L16', 'DENG', 'Dengue NS1 antigen', 'Serology', 'Serum', 600, 4),
  ('L17', 'WIDAL', 'Widal test', 'Serology', 'Serum', 250, 4),
  ('L18', 'MAL', 'Malaria parasite (smear)', 'Haematology', 'EDTA blood', 200, 2),
  ('L19', 'ELEC', 'Serum electrolytes', 'Biochemistry', 'Serum', 450, 3),
  ('L20', 'CALC', 'Serum calcium', 'Biochemistry', 'Serum', 250, 4),
  ('L21', 'IRON', 'Iron studies', 'Biochemistry', 'Serum', 900, 8),
  ('L22', 'UACR', 'Urine albumin-creatinine ratio', 'Biochemistry', 'Urine', 550, 6),
  ('L23', 'BHCG', 'Beta hCG', 'Immunoassay', 'Serum', 750, 6),
  ('L24', 'PSA', 'Prostate specific antigen', 'Immunoassay', 'Serum', 800, 8),
  ('L25', 'HBSAG', 'HBsAg', 'Serology', 'Serum', 350, 4),
  ('L26', 'HIV', 'HIV 1 & 2 antibodies', 'Serology', 'Serum', 450, 4),
  ('L27', 'STOOL', 'Stool routine', 'Clinical pathology', 'Stool', 200, 4),
  ('L28', 'CULT', 'Urine culture', 'Microbiology', 'Urine', 700, 48),
  ('L29', 'ABG', 'Arterial blood gas', 'Biochemistry', 'Arterial blood', 900, 1),
  ('L30', 'MHC', 'Master health check (profile)', 'Profile', 'Blood + urine', 2999, 24);

insert into lab_test_param (test_id, position, name, unit, low, high, crit_low, crit_high) values
  ('L01', 1, 'Haemoglobin', 'g/dL', 12, 16, 7, null),
  ('L01', 2, 'Total WBC count', '×10³/µL', 4, 11, null, 30),
  ('L01', 3, 'Platelet count', '×10³/µL', 150, 410, 50, null),
  ('L01', 4, 'RBC count', '×10⁶/µL', 4.2, 5.4, null, null),
  ('L01', 5, 'Haematocrit', '%', 36, 46, null, null),
  ('L02', 1, 'Glucose, fasting', 'mg/dL', 70, 100, 50, 400),
  ('L03', 1, 'Glucose, 2 h post meal', 'mg/dL', 70, 140, null, 450),
  ('L04', 1, 'HbA1c', '%', 4, 5.6, null, null),
  ('L04', 2, 'Estimated average glucose', 'mg/dL', 68, 114, null, null),
  ('L05', 1, 'Total cholesterol', 'mg/dL', 0, 200, null, null),
  ('L05', 2, 'Triglycerides', 'mg/dL', 0, 150, null, null),
  ('L05', 3, 'HDL cholesterol', 'mg/dL', 40, 90, null, null),
  ('L05', 4, 'LDL cholesterol', 'mg/dL', 0, 100, null, null),
  ('L05', 5, 'VLDL cholesterol', 'mg/dL', 5, 40, null, null),
  ('L06', 1, 'T3', 'ng/dL', 80, 200, null, null),
  ('L06', 2, 'T4', 'µg/dL', 5.1, 14.1, null, null),
  ('L06', 3, 'TSH', 'µIU/mL', 0.27, 4.2, null, null),
  ('L07', 1, 'Total bilirubin', 'mg/dL', 0.3, 1.2, null, null),
  ('L07', 2, 'Direct bilirubin', 'mg/dL', 0, 0.3, null, null),
  ('L07', 3, 'SGOT (AST)', 'U/L', 5, 40, null, null),
  ('L07', 4, 'SGPT (ALT)', 'U/L', 7, 56, null, null),
  ('L07', 5, 'Alkaline phosphatase', 'U/L', 44, 147, null, null),
  ('L07', 6, 'Albumin', 'g/dL', 3.5, 5, null, null),
  ('L08', 1, 'Urea', 'mg/dL', 15, 40, null, null),
  ('L08', 2, 'Creatinine', 'mg/dL', 0.6, 1.2, null, 6),
  ('L08', 3, 'Uric acid', 'mg/dL', 3.4, 7, null, null),
  ('L08', 4, 'Sodium', 'mmol/L', 135, 145, 120, 160),
  ('L08', 5, 'Potassium', 'mmol/L', 3.5, 5.1, 2.8, 6),
  ('L09', 1, 'pH', '', 4.5, 8, null, null),
  ('L09', 2, 'Specific gravity', '', 1.005, 1.03, null, null),
  ('L09', 3, 'Pus cells', '/hpf', 0, 5, null, null),
  ('L09', 4, 'RBCs', '/hpf', 0, 2, null, null),
  ('L09', 5, 'Protein', 'mg/dL', 0, 14, null, null),
  ('L10', 1, 'ESR', 'mm/hr', 0, 20, null, null),
  ('L11', 1, 'CRP', 'mg/L', 0, 6, null, null),
  ('L12', 1, '25-OH vitamin D', 'ng/mL', 30, 100, null, null),
  ('L13', 1, 'Vitamin B12', 'pg/mL', 211, 911, null, null),
  ('L14', 1, 'Troponin I', 'ng/mL', 0, 0.04, null, 0.4),
  ('L15', 1, 'PT', 'sec', 11, 13.5, null, null),
  ('L15', 2, 'INR', '', 0.8, 1.2, null, 4.5),
  ('L16', 1, 'NS1 index', '', 0, 0.9, null, null),
  ('L17', 1, 'S. typhi O titre', '1:', 0, 80, null, null),
  ('L18', 1, 'Parasite index', '%', 0, 0, null, null),
  ('L19', 1, 'Sodium', 'mmol/L', 135, 145, 120, 160),
  ('L19', 2, 'Potassium', 'mmol/L', 3.5, 5.1, 2.8, 6),
  ('L19', 3, 'Chloride', 'mmol/L', 98, 107, null, null),
  ('L20', 1, 'Calcium', 'mg/dL', 8.6, 10.3, 6.5, 13),
  ('L21', 1, 'Serum iron', 'µg/dL', 60, 170, null, null),
  ('L21', 2, 'Ferritin', 'ng/mL', 20, 250, null, null),
  ('L22', 1, 'ACR', 'mg/g', 0, 30, null, null),
  ('L23', 1, 'Beta hCG', 'mIU/mL', 0, 5, null, null),
  ('L24', 1, 'Total PSA', 'ng/mL', 0, 4, null, null),
  ('L25', 1, 'HBsAg index', '', 0, 0.9, null, null),
  ('L26', 1, 'Index', '', 0, 0.9, null, null),
  ('L27', 1, 'Ova / cysts', '', 0, 0, null, null),
  ('L28', 1, 'Colony count', 'CFU/mL ×10³', 0, 10, null, null),
  ('L29', 1, 'pH', '', 7.35, 7.45, 7.2, 7.6),
  ('L29', 2, 'pO₂', 'mmHg', 80, 100, 55, null),
  ('L29', 3, 'pCO₂', 'mmHg', 35, 45, null, null);

insert into lab_test_profile (profile_id, member_id, position) values
  ('L30', 'L01', 1),
  ('L30', 'L02', 2),
  ('L30', 'L04', 3),
  ('L30', 'L05', 4),
  ('L30', 'L06', 5),
  ('L30', 'L07', 6),
  ('L30', 'L08', 7),
  ('L30', 'L09', 8);
