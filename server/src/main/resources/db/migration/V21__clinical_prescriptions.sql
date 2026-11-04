-- Clinical module: prescriptions and their lines.
-- medicine_id is plain text: the medicine table belongs to the pharmacy module.
-- Line columns snapshot the medicine so pharmacy can dispense without a join.

create table prescription (
  id               uuid primary key default gen_random_uuid(),
  branch_id        text not null references branch(id),
  patient_id       text not null references patient(id),
  doctor_id        text not null references doctor(id),
  consultation_id  uuid references consultation(id),
  diagnosis        text not null default '',
  notes            text not null default '',
  status           text not null default 'Draft'
                   check (status in ('Draft','Signed','Sent to pharmacy','Partially dispensed','Dispensed')),
  version          int not null default 1,
  signed_by        uuid references app_user(id),
  signed_at        timestamptz,
  created_by       uuid references app_user(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index prescription_patient_idx on prescription (patient_id, created_at desc);
create index prescription_branch_status_idx on prescription (branch_id, status, created_at desc);
create unique index prescription_consultation_uq on prescription (consultation_id) where consultation_id is not null;

create table prescription_item (
  id               uuid primary key default gen_random_uuid(),
  prescription_id  uuid not null references prescription(id) on delete cascade,
  position         int not null,
  medicine_id      text,
  name             text not null,
  generic          text not null default '',
  strength         text not null default '',
  dose             text not null default '',
  route            text not null default '',
  frequency        text not null default '',
  duration         text not null default '',
  qty              int not null default 0 check (qty >= 0),
  food             text not null default '',
  instructions     text not null default '',
  refills          int not null default 0 check (refills between 0 and 12),
  unique (prescription_id, position)
);

-- Critical safety alerts the doctor overrode when signing, with the reason given.
create table prescription_override (
  prescription_id  uuid not null references prescription(id) on delete cascade,
  alert_code       text not null,
  kind             text not null,
  title            text not null,
  reason           text not null,
  overridden_by    uuid references app_user(id),
  overridden_at    timestamptz not null default now(),
  primary key (prescription_id, alert_code)
);
