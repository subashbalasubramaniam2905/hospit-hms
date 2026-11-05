-- Insights (com.hospitos.insights): alerts centre, follow-up reminders, leakage and safety reviews.
-- Most figures are computed live from the other modules' tables; these tables only hold what people decide.

-- Alerts raised by the rules in AlertRules. dedupe_key makes raising idempotent: a rule that still fires
-- does not create a second alert, and an alert someone resolved is not raised again for the same finding.
create table insight_alert (
  id           bigserial primary key,
  branch_id    text not null references branch(id),
  dedupe_key   text not null unique,
  category     text not null check (category in ('Clinical','Lab','Pharmacy','Billing','Operations','Bed','Safety','System')),
  priority     text not null check (priority in ('Critical','High','Medium','Low')),
  title        text not null,
  detail       text not null default '',
  dept         text not null default '',
  link         text,
  status       text not null default 'Open' check (status in ('Open','Acknowledged','Resolved')),
  assignee     text not null default 'Unassigned',
  resolution   text,
  raised_at    timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references app_user(id)
);
create index insight_alert_branch_status_idx on insight_alert (branch_id, status, raised_at desc);

-- Follow-ups come from consultation.follow_up_date. This records the reminders sent for them.
create table followup_reminder (
  consultation_id  uuid not null references consultation(id) on delete cascade,
  sent_at          timestamptz not null default now(),
  channel          text not null default 'WhatsApp',
  sent_by          uuid references app_user(id)
);
create index followup_reminder_idx on followup_reminder (consultation_id, sent_at desc);

-- A leakage finding someone looked at: waived (with a reason) or approved. Reviewed findings drop off the list.
create table leakage_review (
  finding_key  text primary key,
  branch_id    text not null references branch(id),
  kind         text not null,
  action       text not null check (action in ('Waived','Approved')),
  reason       text not null,
  amount       numeric(12,2) not null default 0,
  reviewed_by  uuid references app_user(id),
  reviewed_at  timestamptz not null default now()
);

-- A pharmacist's or doctor's review of one safety alert on one prescription.
create table safety_review (
  prescription_id  uuid not null references prescription(id) on delete cascade,
  alert_code       text not null,
  outcome          text not null,
  note             text not null default '',
  reviewed_by      uuid references app_user(id),
  reviewed_at      timestamptz not null default now(),
  primary key (prescription_id, alert_code)
);

-- Patient portal sign-in codes (one-time passwords sent to the registered mobile).
create table portal_otp (
  id          bigserial primary key,
  mobile10    text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    int not null default 0,
  used        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index portal_otp_mobile_idx on portal_otp (mobile10, created_at desc);

create table portal_feedback (
  id          bigserial primary key,
  patient_id  text not null references patient(id),
  branch_id   text not null references branch(id),
  rating      int not null check (rating between 1 and 5),
  dept        text not null default '',
  comment     text not null default '',
  created_at  timestamptz not null default now()
);

-- Self-service kiosks. A device is paired once with a short code an administrator generates; the kiosk then holds
-- a device token. Bumping token_version or deactivating the device signs it out.
create table kiosk_device (
  id             uuid primary key default gen_random_uuid(),
  branch_id      text not null references branch(id),
  name           text not null,
  active         boolean not null default true,
  token_version  int not null default 0,
  pair_code_hash text,
  pair_expires   timestamptz,
  paired_at      timestamptz,
  last_seen      timestamptz,
  created_by     uuid references app_user(id),
  created_at     timestamptz not null default now()
);
