-- Operation theatre: rooms, surgery bookings (no double booking of a room), WHO checklist and timeline.

create extension if not exists btree_gist;

create table ot_room (
  branch_id  text not null references branch(id),
  name       text not null,
  position   int not null,
  active     boolean not null default true,
  primary key (branch_id, name)
);

insert into ot_room (branch_id, name, position)
select b.id, x.name, x.position from branch b cross join (values ('OT-1', 1), ('OT-2', 2), ('OT-3', 3)) as x(name, position);

create sequence surgery_seq start 700;

create table surgery (
  id             text primary key,
  branch_id      text not null references branch(id),
  patient_id     text not null references patient(id),
  surgeon_id     text not null references doctor(id),
  anaesthetist   text not null default '',
  anaesthesia    text not null check (anaesthesia in ('General','Spinal','Regional block','Local with sedation')),
  room           text not null,
  -- Clinic-local wall-clock times.
  starts_at      timestamp not null,
  ends_at        timestamp not null,
  procedure      text not null,
  status         text not null default 'Scheduled'
                 check (status in ('Scheduled','Pre-op','In progress','Recovery','Completed','Cancelled')),
  post_op_notes  text,
  cancel_reason  text,
  admission_id   text,
  version        int not null default 1,
  created_by     uuid references app_user(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (branch_id, room) references ot_room(branch_id, name),
  check (ends_at > starts_at),
  -- Two live bookings can never overlap in the same room, even when booked at the same moment.
  constraint surgery_room_no_overlap exclude using gist (branch_id with =, room with =, tsrange(starts_at, ends_at) with &&)
    where (status <> 'Cancelled')
);
create index surgery_branch_day_idx on surgery (branch_id, (starts_at::date));
create index surgery_patient_idx on surgery (patient_id);

create table surgery_check (
  surgery_id  text not null references surgery(id) on delete cascade,
  position    int not null,
  item        text not null,
  done        boolean not null default false,
  done_by     text,
  done_at     timestamptz,
  primary key (surgery_id, position),
  unique (surgery_id, item)
);

create table surgery_event (
  id          bigserial primary key,
  surgery_id  text not null references surgery(id) on delete cascade,
  at          timestamptz not null default now(),
  by_name     text not null,
  event       text not null
);
create index surgery_event_idx on surgery_event (surgery_id, at);
