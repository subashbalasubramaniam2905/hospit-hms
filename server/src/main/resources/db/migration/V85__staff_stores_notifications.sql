-- Staff and HR, general stores (consumables and assets), procurement, and notifications.

-- ---------------------------------------------------------------- staff and HR

create table staff_member (
  id          text primary key,
  branch_id   text not null references branch(id),
  name        text not null,
  role        text not null,
  category    text not null check (category in ('Doctor','Nurse','Technician','Admin','Support','Pharmacist')),
  dept_id     text not null default '',
  phone       text not null default '',
  email       text not null default '',
  shift       text not null default 'General' check (shift in ('Morning','Evening','Night','General')),
  status      text not null default 'Off duty' check (status in ('On duty','Off duty','On leave')),
  joined      date not null default current_date,
  salary      numeric(12,2) not null default 0 check (salary >= 0),
  user_id     uuid references app_user(id),
  doctor_id   text references doctor(id),
  active      boolean not null default true,
  version     int not null default 1,
  created_at  timestamptz not null default now()
);
create index staff_branch_idx on staff_member (branch_id);
create sequence staff_seq start 1001;

create table leave_request (
  id          text primary key,
  staff_id    text not null references staff_member(id),
  from_date   date not null,
  to_date     date not null,
  type        text not null check (type in ('Casual','Sick','Earned','Maternity')),
  reason      text not null default '',
  status      text not null default 'Pending' check (status in ('Pending','Approved','Rejected')),
  decided_by  text,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  check (to_date >= from_date)
);
create sequence leave_seq start 1001;

-- One shift per person per day. Days without a row fall back to the person's usual shift.
create table roster_shift (
  staff_id  text not null references staff_member(id),
  day       date not null,
  shift     text not null check (shift in ('Morning','Evening','Night','Off')),
  primary key (staff_id, day)
);

create table attendance (
  staff_id   text not null references staff_member(id),
  day        date not null,
  status     text not null check (status in ('Present','Absent','Half day','Leave')),
  marked_by  text not null,
  primary key (staff_id, day)
);

create table payroll_run (
  id         bigserial primary key,
  branch_id  text not null references branch(id),
  month      text not null check (month ~ '^\d{4}-\d{2}$'),
  staff      int not null,
  gross      numeric(14,2) not null,
  net        numeric(14,2) not null,
  lines      jsonb not null,
  run_by     text not null,
  run_at     timestamptz not null default now(),
  unique (branch_id, month)
);

-- ---------------------------------------------------------------- general stores

create table inventory_item (
  id           text primary key,
  branch_id    text not null references branch(id),
  name         text not null,
  category     text not null check (category in ('Consumables','Surgical supplies','Medical equipment','General supplies','Linen','Housekeeping')),
  unit         text not null default 'pcs',
  stock        int not null default 0 check (stock >= 0),
  reorder      int not null default 0 check (reorder >= 0),
  location     text not null default '',
  cost         numeric(12,2) not null default 0,
  expiry       date,
  supplier_id  text references supplier(id),
  active       boolean not null default true
);
create index inventory_branch_idx on inventory_item (branch_id);
create sequence inventory_seq start 1001;

create table inventory_move (
  id        bigserial primary key,
  branch_id text not null references branch(id),
  item_id   text not null references inventory_item(id),
  at        timestamptz not null default now(),
  kind      text not null check (kind in ('Receipt','Issue','Adjustment','Return')),
  qty       int not null,
  ref       text not null default '',
  by_name   text not null,
  note      text
);
create index inventory_move_item_idx on inventory_move (item_id, at desc);

create table asset (
  id            text primary key,
  branch_id     text not null references branch(id),
  name          text not null,
  category      text not null,
  tag           text not null unique,
  location      text not null default '',
  status        text not null default 'In use' check (status in ('In use','Available','Under maintenance','Retired')),
  purchased     date,
  value         numeric(14,2) not null default 0,
  next_service  date
);

-- ---------------------------------------------------------------- procurement

create table requisition (
  id            text primary key,
  branch_id     text not null references branch(id),
  dept          text not null,
  items         jsonb not null,          -- [{itemId, name, qty}]
  status        text not null default 'Pending' check (status in ('Pending','Approved','Issued','Rejected')),
  requested_by  text not null,
  decided_by    text,
  created_at    timestamptz not null default now()
);
create sequence requisition_seq start 1001;

create table purchase_order (
  id            text primary key,
  branch_id     text not null references branch(id),
  supplier_id   text not null references supplier(id),
  kind          text not null check (kind in ('Pharmacy','Inventory')),
  status        text not null default 'Requested' check (status in ('Requested','Approved','Ordered','Received','Cancelled')),
  items         jsonb not null,          -- [{itemId, name, qty, cost, received, batch, expiry}]
  requested_by  text not null,
  approved_by   text,
  expected      date,
  received_at   timestamptz,
  created_at    timestamptz not null default now(),
  version       int not null default 1
);
create sequence po_seq start 4101;

-- ---------------------------------------------------------------- notifications

-- Outgoing messages to patients. No SMS, email or WhatsApp provider is connected yet, so they stay Queued.
create table notification_msg (
  id          bigserial primary key,
  branch_id   text references branch(id),
  at          timestamptz not null default now(),
  channel     text not null check (channel in ('SMS','Email','WhatsApp','In-app')),
  type        text not null,
  patient_id  text references patient(id),
  to_text     text not null,
  message     text not null,
  status      text not null default 'Queued' check (status in ('Queued','Sent','Delivered','Read','Failed')),
  error       text,
  sent_by     text not null
);
create index notification_at_idx on notification_msg (at desc);

-- Staff inbox. A note goes to one account, to everyone with a role, or to everyone; optionally only in one branch.
create table inbox_note (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  user_id     uuid references app_user(id),
  role        text,
  branch_id   text references branch(id),
  title       text not null,
  body        text not null default '',
  link        text,
  icon        text not null default 'bell',
  tone        text not null default 'b' check (tone in ('g','a','r','b','v'))
);
create index inbox_at_idx on inbox_note (at desc);

create table inbox_read (
  note_id  bigint not null references inbox_note(id),
  user_id  uuid not null references app_user(id),
  at       timestamptz not null default now(),
  primary key (note_id, user_id)
);
