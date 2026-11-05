-- Radiology: study catalogue, scanning rooms, imaging orders with scheduling, acquisition and reports.

create table imaging_modality (
  id            text primary key,          -- X-ray, Ultrasound, CT, MRI
  default_price numeric(12,2) not null check (default_price >= 0),
  default_min   int not null check (default_min between 5 and 240)
);

insert into imaging_modality (id, default_price, default_min) values
  ('X-ray', 450, 15),
  ('Ultrasound', 1200, 20),
  ('CT', 3800, 20),
  ('MRI', 7500, 45);

create table imaging_study (
  id            text primary key,
  code          text not null unique,
  name          text not null,
  modality      text not null references imaging_modality(id),
  price         numeric(12,2) not null check (price >= 0),
  duration_min  int not null check (duration_min between 5 and 240),
  contrast      boolean not null default false,
  active        boolean not null default true
);

-- Fictional sample tariff. Replace with the hospital's real imaging tariff before go-live.
insert into imaging_study (id, code, name, modality, price, duration_min, contrast) values
  ('R01', 'XR-CHEST', 'X-ray chest PA view', 'X-ray', 450, 10, false),
  ('R02', 'XR-KNEE', 'X-ray knee AP/lateral', 'X-ray', 700, 15, false),
  ('R03', 'XR-LSS', 'X-ray lumbosacral spine AP/lateral', 'X-ray', 700, 15, false),
  ('R04', 'XR-PNS', 'X-ray paranasal sinuses', 'X-ray', 500, 10, false),
  ('R05', 'XR-ABD', 'X-ray abdomen erect', 'X-ray', 550, 10, false),
  ('R06', 'US-ABD', 'Ultrasound abdomen and pelvis', 'Ultrasound', 1500, 20, false),
  ('R07', 'US-OBS', 'Obstetric ultrasound (anomaly scan)', 'Ultrasound', 2200, 30, false),
  ('R08', 'US-THY', 'Ultrasound thyroid', 'Ultrasound', 1400, 20, false),
  ('R09', 'US-KUB', 'Ultrasound KUB', 'Ultrasound', 1200, 20, false),
  ('R10', 'US-DOP', 'Doppler lower limb venous', 'Ultrasound', 2500, 30, false),
  ('R11', 'CT-BRAIN', 'CT brain plain', 'CT', 3500, 15, false),
  ('R12', 'CT-HRCT', 'HRCT chest', 'CT', 5200, 20, false),
  ('R13', 'CT-ABDC', 'CT abdomen with contrast', 'CT', 7500, 30, true),
  ('R14', 'CT-CORO', 'CT coronary angiography', 'CT', 9500, 40, true),
  ('R15', 'MR-LSP', 'MRI lumbar spine', 'MRI', 7500, 40, false),
  ('R16', 'MR-BRAIN', 'MRI brain plain', 'MRI', 7000, 40, false),
  ('R17', 'MR-BRAINC', 'MRI brain with contrast', 'MRI', 9000, 50, true),
  ('R18', 'MR-KNEE', 'MRI knee', 'MRI', 7500, 40, false);

create table imaging_room (
  branch_id  text not null references branch(id),
  code       text not null,
  modality   text not null references imaging_modality(id),
  name       text not null,
  active     boolean not null default true,
  primary key (branch_id, code)
);

insert into imaging_room (branch_id, code, modality, name) values
  ('BR1', 'XR-1', 'X-ray', 'X-ray room 1'),
  ('BR1', 'US-1', 'Ultrasound', 'Ultrasound room 1'),
  ('BR1', 'US-2', 'Ultrasound', 'Ultrasound room 2'),
  ('BR1', 'CT-1', 'CT', 'CT suite'),
  ('BR1', 'MR-1', 'MRI', 'MRI suite'),
  ('BR2', 'XR-1', 'X-ray', 'X-ray room 1'),
  ('BR2', 'US-1', 'Ultrasound', 'Ultrasound room 1'),
  ('BR2', 'CT-1', 'CT', 'CT suite'),
  ('BR3', 'XR-1', 'X-ray', 'X-ray room 1'),
  ('BR3', 'US-1', 'Ultrasound', 'Ultrasound room 1');

create sequence imaging_order_seq start 3400;

create table imaging_order (
  id               text primary key,
  branch_id        text not null references branch(id),
  patient_id       text not null references patient(id),
  doctor_id        text references doctor(id),
  study_id         text references imaging_study(id),
  modality         text not null references imaging_modality(id),
  study            text not null,
  contrast         boolean not null default false,
  price            numeric(12,2) not null check (price >= 0),
  duration_min     int not null,
  status           text not null default 'Ordered'
                   check (status in ('Ordered','Scheduled','In progress','Awaiting report','Reported','Verified','Cancelled')),
  priority         text not null default 'Routine' check (priority in ('Routine','Urgent')),
  -- Scheduled date and start time in clinic time, and the room code within the branch.
  scheduled_date   date,
  slot             time,
  room             text,
  ordered_at       timestamptz not null default now(),
  ordered_by       uuid references app_user(id),
  technician       text,
  started_at       timestamptz,
  acquired_at      timestamptz,
  findings         text,
  impression       text,
  radiologist      text,
  radiologist_user uuid references app_user(id),
  reported_at      timestamptz,
  verified_by      text,
  verified_by_user uuid references app_user(id),
  verified_at      timestamptz,
  contrast_override text,
  cancel_reason    text,
  billed           boolean not null default false,
  invoice_id       uuid,
  invoice_number   text,
  comments         text,
  version          int not null default 1,
  updated_at       timestamptz not null default now(),
  foreign key (branch_id, room) references imaging_room(branch_id, code),
  check ((scheduled_date is null) = (slot is null) and (slot is null) = (room is null))
);
create index imaging_order_branch_status_idx on imaging_order (branch_id, status);
create index imaging_order_room_day_idx on imaging_order (branch_id, room, scheduled_date);
create index imaging_order_patient_idx on imaging_order (patient_id, ordered_at desc);
