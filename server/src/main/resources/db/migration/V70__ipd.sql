-- Inpatients (IPD): wards, beds, admissions, bed stays, nursing records, deposits and charges.

create table ward (
  id         text primary key,
  branch_id  text not null references branch(id),
  name       text not null,
  type       text not null check (type in ('General','Semi-private','Private','ICU','Maternity','Pediatric')),
  floor      text not null default '',
  rate       numeric(12,2) not null check (rate >= 0),
  position   int not null default 0,
  active     boolean not null default true
);
create index ward_branch_idx on ward (branch_id);

create sequence admission_seq start 2500;

create table admission (
  id                  text primary key,
  branch_id           text not null references branch(id),
  patient_id          text not null references patient(id),
  doctor_id           text not null references doctor(id),
  dept_id             text not null references department(id),
  bed_id              text not null,
  type                text not null check (type in ('Planned','Emergency','Day care','Maternity')),
  status              text not null default 'Admitted' check (status in ('Admitted','Discharge planned','Discharged')),
  reason              text not null,
  diagnosis           text not null,
  expected_discharge  date not null,
  admitted_at         timestamptz not null,
  admitted_by         uuid references app_user(id),
  er_case_id          text,
  claim_id            uuid,
  discharged_at       timestamptz,
  discharged_by       uuid references app_user(id),
  discharged_by_name  text,
  discharge_summary   text,
  discharge_checklist text[] not null default '{}',
  invoice_id          uuid,
  invoice_number      text,
  version             int not null default 1
);
-- One open admission per patient.
create unique index admission_open_patient_uq on admission (patient_id) where status <> 'Discharged';
create index admission_branch_status_idx on admission (branch_id, status);

create table bed (
  id            text primary key,
  ward_id       text not null references ward(id),
  label         text not null,
  status        text not null default 'Available' check (status in ('Available','Occupied','Reserved','Cleaning','Maintenance')),
  admission_id  text unique references admission(id),
  position      int not null default 0,
  active        boolean not null default true,
  check ((status = 'Occupied') = (admission_id is not null))
);
create index bed_ward_idx on bed (ward_id);
alter table admission add constraint admission_bed_fk foreign key (bed_id) references bed(id);

-- Every bed the patient has been in, with the ward rate at the time. Room charges are worked out from these.
create table bed_stay (
  id            uuid primary key default gen_random_uuid(),
  admission_id  text not null references admission(id),
  bed_id        text not null references bed(id),
  ward_id       text not null references ward(id),
  ward_name     text not null,
  rate          numeric(12,2) not null,
  from_at       timestamptz not null,
  to_at         timestamptz
);
create index bed_stay_admission_idx on bed_stay (admission_id, from_at);

create table ipd_note (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint generated always as identity,
  admission_id  text not null references admission(id),
  type          text not null check (type in ('Progress','Nursing','Handover','Doctor round')),
  text          text not null,
  author        text not null,
  author_id     uuid references app_user(id),
  at            timestamptz not null
);
create index ipd_note_admission_idx on ipd_note (admission_id, at desc);

create table ipd_care_plan (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint generated always as identity,
  admission_id  text not null references admission(id),
  text          text not null,
  added_by      text not null,
  at            timestamptz not null
);
create index ipd_care_plan_admission_idx on ipd_care_plan (admission_id, at);

-- Medication administration record: one row per scheduled dose.
create table ipd_mar (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint generated always as identity,
  admission_id  text not null references admission(id),
  med           text not null,
  dose          text not null,
  route         text not null,
  date          date not null,
  time          text not null check (time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  status        text not null default 'Due' check (status in ('Due','Given','Held','Missed')),
  ordered_by    text not null,
  ordered_by_id uuid references app_user(id),
  done_by       text,
  done_by_id    uuid references app_user(id),
  done_at       timestamptz,
  note          text,
  created_at    timestamptz not null
);
create index ipd_mar_admission_idx on ipd_mar (admission_id, date, time);

create table ipd_obs (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint generated always as identity,
  admission_id  text not null references admission(id),
  at            timestamptz not null,
  bp            text not null,
  hr            int not null,
  temp          numeric(4,1) not null,
  spo2          int not null,
  rr            int not null,
  pain          int not null check (pain between 0 and 10),
  news          int not null,
  by_name       text not null,
  by_id         uuid references app_user(id)
);
create index ipd_obs_admission_idx on ipd_obs (admission_id, at);

create table ipd_io (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint generated always as identity,
  admission_id  text not null references admission(id),
  at            timestamptz not null,
  kind          text not null check (kind in ('Intake','Output')),
  type          text not null,
  ml            int not null check (ml > 0 and ml <= 10000),
  by_name       text not null,
  by_id         uuid references app_user(id)
);
create index ipd_io_admission_idx on ipd_io (admission_id, at);

-- Advance deposits received and deposit balances refunded. Deposits are adjusted against the final bill at discharge.
create sequence ipd_receipt_seq;
create table ipd_deposit (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint generated always as identity,
  admission_id  text not null references admission(id),
  kind          text not null check (kind in ('DEPOSIT','REFUND','ADJUSTED')),
  receipt_no    text not null unique,
  amount        numeric(12,2) not null check (amount > 0),
  mode          text not null check (mode in ('CASH','UPI','CARD','BANK_TRANSFER','ONLINE','ADVANCE')),
  reference     text,
  by_name       text not null,
  by_id         uuid references app_user(id),
  at            timestamptz not null
);
create index ipd_deposit_admission_idx on ipd_deposit (admission_id, at);

-- Services used during the stay (procedures, consumables, visits) that go on the final bill.
create table ipd_charge (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint generated always as identity,
  admission_id  text not null references admission(id),
  tariff_code   text,
  description   text not null,
  category      text not null check (category in ('CONSULTATION','PROCEDURE','LABORATORY','IMAGING','PHARMACY','ROOM','NURSING','OT','OTHER')),
  qty           numeric(10,2) not null check (qty > 0),
  rate          numeric(12,2) check (rate >= 0),
  by_name       text not null,
  by_id         uuid references app_user(id),
  at            timestamptz not null,
  cancelled     boolean not null default false
);
create index ipd_charge_admission_idx on ipd_charge (admission_id);

-- Daily inpatient charges in the billing tariff, so the billing desk can change them there.
insert into billing_tariff_items (code, name, category, price, tax_pct) values
  ('IPD-VISIT', 'Consultant visit, inpatient', 'CONSULTATION', 600, null)
on conflict (code) do nothing;
