-- Appointments, doctor leave and the OPD queue (module: com.hospitos.appointments).
-- Dates and times are clinic-local (Asia/Kolkata); event timestamps are timestamptz.

create extension if not exists btree_gist;

-- Weekly hours live on doctor (days, start_time, end_time, slot_min). Add the daily break.
alter table doctor add column break_start text default '13:00';
alter table doctor add column break_end   text default '14:00';
alter table doctor add constraint doctor_break_pair check ((break_start is null) = (break_end is null));

-- Days a doctor is not consulting (leave, conference, OT day).
create table doctor_leave (
  doctor_id   text not null references doctor(id),
  leave_date  date not null,
  reason      text not null default '',
  created_by  uuid references app_user(id),
  primary key (doctor_id, leave_date)
);

create sequence appointment_no_seq start 10001;

create table appointment (
  id             text primary key,
  branch_id      text not null references branch(id),
  patient_id     text not null references patient(id),
  doctor_id      text not null references doctor(id),
  dept_id        text not null references department(id),
  appt_date      date not null,
  start_time     time not null,
  duration_min   int  not null check (duration_min between 5 and 240),
  type           text not null check (type in ('New consultation','Follow-up','Procedure','Walk-in','Teleconsult','Review')),
  status         text not null default 'Scheduled'
                 check (status in ('Scheduled','Confirmed','Arrived','Waiting','In consultation','Completed','Cancelled','No-show')),
  room           text not null default '',
  token          text,
  notes          text,
  recurring      text check (recurring in ('Weekly','Every 2 weeks','Monthly')),
  series_id      text,
  reminder_sent  boolean not null default false,
  created_by     uuid references app_user(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  span tsrange generated always as (
    tsrange(appt_date + start_time, appt_date + start_time + make_interval(mins => duration_min), '[)')
  ) stored,
  -- Backstop for the booking check: a doctor never holds two upcoming bookings that overlap. Once a patient
  -- is in the building the queue decides who goes next, so arrived visits and walk-ins are left out.
  constraint appointment_no_double_booking exclude using gist (doctor_id with =, span with &&)
    where (status in ('Scheduled','Confirmed') and type <> 'Walk-in')
);
create index appointment_doctor_day_idx on appointment (doctor_id, appt_date);
create index appointment_patient_idx on appointment (patient_id, appt_date);
create index appointment_branch_day_idx on appointment (branch_id, appt_date);

-- The day's token numbers per branch and department, issued with an atomic upsert.
create table token_counter (
  branch_id   text not null references branch(id),
  dept_id     text not null,
  visit_date  date not null,
  last_no     int  not null,
  primary key (branch_id, dept_id, visit_date)
);

-- One patient's journey through one visit.
-- step: 0 Registration, 1 Billing, 2 Triage, 3 Consultation, 4 Lab / imaging, 5 Pharmacy, 6 Discharge.
create table queue_entry (
  id              bigserial primary key,
  branch_id       text not null references branch(id),
  visit_date      date not null,
  token           text not null,
  appointment_id  text references appointment(id),
  patient_id      text not null references patient(id),
  doctor_id       text not null references doctor(id),
  dept_id         text not null references department(id),
  step            int  not null default 1 check (step between 0 and 6),
  step_since      timestamptz not null default now(),
  arrived_at      timestamptz not null default now(),
  priority        boolean not null default false,
  emergency       boolean not null default false,
  state           text not null default 'Active' check (state in ('Active','Done','Left')),
  unique (branch_id, visit_date, token)
);
create unique index queue_entry_appointment_uq on queue_entry (appointment_id) where appointment_id is not null;
create index queue_entry_branch_day_idx on queue_entry (branch_id, visit_date, state);

create table queue_event (
  id              bigserial primary key,
  queue_entry_id  bigint not null references queue_entry(id) on delete cascade,
  from_step       int,
  to_step         int,
  note            text,
  at              timestamptz not null default now(),
  by_user         uuid references app_user(id)
);
create index queue_event_entry_idx on queue_event (queue_entry_id, at);
