-- Clinical module: consultations with vitals and diagnoses.
-- appointment_id is plain text: the appointment table belongs to the appointments module.

create table consultation (
  id               uuid primary key default gen_random_uuid(),
  branch_id        text not null references branch(id),
  patient_id       text not null references patient(id),
  doctor_id        text not null references doctor(id),
  appointment_id   text,
  template         text not null default 'General medicine',
  chief_complaint  text not null default '',
  hpi              text not null default '',
  past_history     text not null default '',
  family_history   text not null default '',
  social_history   text not null default '',
  current_meds     text not null default '',
  allergy_note     text not null default '',
  examination      text not null default '',
  assessment       text not null default '',
  plan             text not null default '',
  notes            text not null default '',
  follow_up        text not null default '',
  follow_up_date   date,
  status           text not null default 'Draft' check (status in ('Draft','Completed')),
  version          int not null default 1,
  created_by       uuid references app_user(id),
  completed_by     uuid references app_user(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create index consultation_patient_idx on consultation (patient_id, created_at desc);
create index consultation_branch_idx on consultation (branch_id, status, created_at desc);
create index consultation_doctor_idx on consultation (doctor_id, created_at desc);
-- At most one open draft per patient and doctor.
create unique index consultation_one_draft_uq on consultation (patient_id, doctor_id) where status = 'Draft';

-- Several readings can be taken during one visit; the latest is the current one.
create table consultation_vitals (
  id               uuid primary key default gen_random_uuid(),
  consultation_id  uuid not null references consultation(id) on delete cascade,
  bp_systolic      int check (bp_systolic between 40 and 300),
  bp_diastolic     int check (bp_diastolic between 20 and 200),
  heart_rate       int check (heart_rate between 20 and 300),
  temperature_f    numeric(4,1) check (temperature_f between 85 and 115),
  resp_rate        int check (resp_rate between 4 and 80),
  spo2             int check (spo2 between 40 and 100),
  height_cm        numeric(5,1) check (height_cm between 20 and 260),
  weight_kg        numeric(5,1) check (weight_kg between 0.5 and 400),
  recorded_by      uuid references app_user(id),
  recorded_at      timestamptz not null default now()
);
create index consultation_vitals_idx on consultation_vitals (consultation_id, recorded_at desc);

create table consultation_diagnosis (
  consultation_id  uuid not null references consultation(id) on delete cascade,
  position         int not null,
  code             text not null,
  label            text not null,
  primary key (consultation_id, code)
);
create index consultation_diagnosis_code_idx on consultation_diagnosis (code);
