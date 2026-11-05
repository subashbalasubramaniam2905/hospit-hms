-- Emergency department: treatment bays, ER cases (triage board), orders and a per-case timeline.

create table er_bay (
  branch_id  text not null references branch(id),
  name       text not null,
  kind       text not null default 'Bay' check (kind in ('Resus','Bay','Minor')),
  position   int not null,
  active     boolean not null default true,
  primary key (branch_id, name)
);

insert into er_bay (branch_id, name, kind, position)
select b.id, x.name, x.kind, x.position
from branch b cross join (values
  ('Resus 1', 'Resus', 1), ('Resus 2', 'Resus', 2),
  ('Bay 1', 'Bay', 3), ('Bay 2', 'Bay', 4), ('Bay 3', 'Bay', 5), ('Bay 4', 'Bay', 6), ('Bay 5', 'Bay', 7), ('Bay 6', 'Bay', 8),
  ('Minor 1', 'Minor', 9), ('Minor 2', 'Minor', 10)) as x(name, kind, position);

create sequence er_case_seq start 910;

create table er_case (
  id               text primary key,
  branch_id        text not null references branch(id),
  -- Empty for an unknown patient until the case is linked to a registered record.
  patient_id       text references patient(id),
  label            text not null,
  age              int check (age between 0 and 130),
  gender           text not null default 'Unknown' check (gender in ('Male','Female','Other','Unknown')),
  arrival_mode     text not null check (arrival_mode in ('Walk-in','Ambulance','Referred','Police')),
  triage           text not null check (triage in ('Red','Orange','Yellow','Green')),
  -- What the vitals rule suggested at registration, kept so overrides can be reviewed.
  suggested_triage text not null check (suggested_triage in ('Red','Orange','Yellow','Green')),
  complaint        text not null,
  -- Null means the patient is waiting in the corridor without a bay.
  bay              text,
  doctor_id        text references doctor(id),
  bp               text not null default '',
  hr               int check (hr between 0 and 300),
  spo2             int check (spo2 between 0 and 100),
  gcs              int check (gcs between 3 and 15),
  temp             numeric(4,1),
  status           text not null default 'Waiting'
                   check (status in ('Waiting','Under treatment','Observation','Admitted','Discharged','Referred')),
  arrived_at       timestamptz not null default now(),
  closed_at        timestamptz,
  disposition_note text,
  admission_id     text,
  version          int not null default 1,
  created_by       uuid references app_user(id),
  updated_at       timestamptz not null default now(),
  foreign key (branch_id, bay) references er_bay(branch_id, name),
  check ((status in ('Admitted','Discharged','Referred')) = (closed_at is not null))
);
create index er_case_branch_status_idx on er_case (branch_id, status);
create index er_case_patient_idx on er_case (patient_id);
-- A bay holds one open case at a time.
create unique index er_case_bay_uq on er_case (branch_id, bay) where closed_at is null and bay is not null;

create table er_order (
  case_id     text not null references er_case(id) on delete cascade,
  position    int not null,
  name        text not null,
  ordered_at  timestamptz not null default now(),
  ordered_by  text not null,
  primary key (case_id, position),
  unique (case_id, name)
);

create table er_event (
  id        bigserial primary key,
  case_id   text not null references er_case(id) on delete cascade,
  at        timestamptz not null default now(),
  by_name   text not null,
  event     text not null
);
create index er_event_case_idx on er_event (case_id, at);
