-- Administration: screen access by role, audit review flags, hospital settings, workflows and integration settings.

-- Overrides of the default screen access for a role. A missing row means the app's built-in default applies.
create table role_access (
  role        text not null,
  path        text not null,
  level       text not null check (level in ('Full','View','None')),
  updated_by  text not null,
  updated_at  timestamptz not null default now(),
  primary key (role, path)
);

-- The audit trail itself is append-only, so review flags live beside it.
create table audit_flag (
  audit_id    bigint primary key references audit_log(id),
  flagged_by  uuid references app_user(id),
  by_name     text not null,
  note        text not null default '',
  at          timestamptz not null default now()
);

-- One row of hospital-wide settings that are not part of billing (billing_settings holds name, GSTIN and address).
create table hospital_config (
  id             int primary key default 1 check (id = 1),
  registration   text not null default '',
  working_hours  jsonb not null,
  appt_rules     jsonb not null,
  queue_rules    jsonb not null,
  notify_rules   jsonb not null,
  version        int not null default 1,
  updated_by     text,
  updated_at     timestamptz not null default now()
);

insert into hospital_config (working_hours, appt_rules, queue_rules, notify_rules) values (
  '[{"day":"Mon","open":"08:00","close":"20:00","closed":false},{"day":"Tue","open":"08:00","close":"20:00","closed":false},
    {"day":"Wed","open":"08:00","close":"20:00","closed":false},{"day":"Thu","open":"08:00","close":"20:00","closed":false},
    {"day":"Fri","open":"08:00","close":"20:00","closed":false},{"day":"Sat","open":"08:00","close":"14:00","closed":false},
    {"day":"Sun","open":"09:00","close":"13:00","closed":true}]',
  '{"slotMin":15,"maxAdvanceDays":60,"allowOverbook":false,"noShowAfterMin":30,"reminderHours":24}',
  '{"tokenPrefixByDept":true,"delayAlertMin":30,"emergencyJumpsQueue":true,"seniorPriority":true}',
  '[{"key":"appt","label":"Appointment confirmation and reminders","sms":true,"email":false,"whatsapp":true,"inapp":false},
    {"key":"lab","label":"Lab report ready","sms":true,"email":true,"whatsapp":true,"inapp":false},
    {"key":"pay","label":"Payment reminders","sms":true,"email":true,"whatsapp":false,"inapp":false},
    {"key":"followup","label":"Follow-up reminders","sms":true,"email":false,"whatsapp":true,"inapp":false},
    {"key":"critical","label":"Critical lab values (staff)","sms":true,"email":false,"whatsapp":false,"inapp":true},
    {"key":"stock","label":"Low stock (staff)","sms":false,"email":true,"whatsapp":false,"inapp":true}]');

create table workflow (
  id          text primary key,
  name        text not null,
  enabled     boolean not null default false,
  steps       jsonb not null default '[]',
  runs        int not null default 0,
  last_run    timestamptz,
  version     int not null default 1,
  created_by  text not null,
  updated_at  timestamptz not null default now()
);
create sequence workflow_seq start 10;

-- Test runs only: no workflow engine runs workflows yet, so nothing is sent.
create table workflow_run (
  id           bigserial primary key,
  workflow_id  text not null references workflow(id),
  at           timestamptz not null default now(),
  by_name      text not null,
  test         boolean not null default true,
  result       jsonb not null
);

-- Templates to start from. They are off until an administrator reviews and turns them on.
insert into workflow (id, name, enabled, steps, created_by) values
  ('WF1', 'Lab result verified', false, '[{"kind":"trigger","label":"Lab result is verified","detail":"Any test"},{"kind":"action","label":"Notify staff in-app","detail":"Ordering doctor"},{"kind":"action","label":"Create follow-up task","detail":"Due in 7 days"}]', 'System'),
  ('WF2', 'Critical value escalation', false, '[{"kind":"trigger","label":"Lab result is verified","detail":"Critical value"},{"kind":"action","label":"Raise alert","detail":"Alerts centre"},{"kind":"condition","label":"If not acknowledged in 15 min","detail":""},{"kind":"action","label":"Send SMS","detail":"Duty doctor"}]', 'System'),
  ('WF3', 'Appointment reminder', false, '[{"kind":"trigger","label":"Appointment is booked","detail":"Any department"},{"kind":"action","label":"Send WhatsApp message","detail":"Template: appt_reminder"},{"kind":"action","label":"Send SMS","detail":"Fallback"}]', 'System');

-- Connection settings for outside systems. Secret values are encrypted by the server and never sent back to the browser.
create table integration (
  id           text primary key,
  name         text not null,
  category     text not null,
  description  text not null,
  enabled      boolean not null default false,
  fields       jsonb not null,           -- [{key, label, secret}]
  config       jsonb not null default '{}', -- non-secret values by key
  secrets      text,                     -- AES-GCM encrypted JSON of secret values by key
  last_test    timestamptz,
  last_result  text,
  version      int not null default 1,
  updated_by   text,
  updated_at   timestamptz not null default now()
);

insert into integration (id, name, category, description, fields, config) values
  ('abdm', 'ABDM / ABHA', 'Government', 'Create and verify ABHA IDs, link health records and share consent-based data.',
   '[{"key":"clientId","label":"Client ID"},{"key":"secret","label":"Client secret","secret":true},{"key":"hipId","label":"HIP ID"},{"key":"env","label":"Environment"}]', '{"env":"Sandbox"}'),
  ('hl7', 'HL7 v2 interface', 'Interoperability', 'Send and receive ADT, ORM and ORU messages with external systems.',
   '[{"key":"host","label":"MLLP host"},{"key":"port","label":"Port"},{"key":"facility","label":"Sending facility"}]', '{"port":"2575","facility":"HOSPITOS"}'),
  ('fhir', 'FHIR R4 server', 'Interoperability', 'Expose Patient, Encounter, Observation and MedicationRequest resources.',
   '[{"key":"base","label":"Base URL"},{"key":"auth","label":"Auth type"},{"key":"scope","label":"Scopes"}]', '{"auth":"SMART on FHIR","scope":"patient/*.read"}'),
  ('lis', 'Laboratory analysers (LIS)', 'Diagnostics', 'Receive results directly from haematology and biochemistry analysers.',
   '[{"key":"driver","label":"Driver"},{"key":"ip","label":"Analyser IP"},{"key":"port","label":"Port"}]', '{"driver":"ASTM over TCP"}'),
  ('pacs', 'PACS / DICOM', 'Diagnostics', 'Send worklists to modalities and view images from the PACS.',
   '[{"key":"aet","label":"AE title"},{"key":"host","label":"PACS host"},{"key":"port","label":"Port"},{"key":"viewer","label":"Viewer URL"}]', '{"port":"104"}'),
  ('pay', 'Payment gateway', 'Payments', 'Collect UPI, card and net banking payments online and at the desk.',
   '[{"key":"merchant","label":"Merchant ID"},{"key":"key","label":"API key","secret":true},{"key":"mode","label":"Mode"}]', '{"mode":"Test"}'),
  ('sms', 'SMS gateway', 'Messaging', 'DLT-registered SMS for reminders and OTPs.',
   '[{"key":"sender","label":"Sender ID"},{"key":"dlt","label":"DLT entity ID"},{"key":"key","label":"API key","secret":true}]', '{}'),
  ('email', 'Email (SMTP)', 'Messaging', 'Send reports, invoices and reminders by email.',
   '[{"key":"host","label":"SMTP host"},{"key":"port","label":"Port"},{"key":"from","label":"From address"},{"key":"password","label":"SMTP password","secret":true}]', '{"port":"587"}'),
  ('wa', 'WhatsApp Business', 'Messaging', 'Approved templates for reminders, reports and discharge messages.',
   '[{"key":"waba","label":"WABA ID"},{"key":"phone","label":"Phone number ID"},{"key":"token","label":"Access token","secret":true}]', '{}'),
  ('ins', 'Insurance / TPA portal', 'Insurance', 'Submit pre-authorisations and track claims electronically.',
   '[{"key":"portal","label":"Portal"},{"key":"participant","label":"Participant code"}]', '{"portal":"NHCX sandbox"}'),
  ('acct', 'Accounting software', 'Finance', 'Push daily collections and invoices to the accounts system.',
   '[{"key":"system","label":"System"},{"key":"company","label":"Company name"}]', '{"system":"Tally Prime"}'),
  ('bio', 'Biometric attendance', 'Devices', 'Sync staff punches from fingerprint and face devices.',
   '[{"key":"device","label":"Device IP"},{"key":"sync","label":"Sync every"}]', '{"sync":"15 minutes"}'),
  ('barcode', 'Barcode scanners', 'Devices', 'Scan patient wristbands, sample tubes and medicine strips.',
   '[{"key":"mode","label":"Input mode"},{"key":"prefix","label":"Sample prefix"}]', '{"mode":"Keyboard wedge","prefix":"SMP"}'),
  ('printer', 'Printers', 'Devices', 'Label, wristband, receipt and A4 report printers.',
   '[{"key":"label","label":"Label printer"},{"key":"receipt","label":"Receipt printer"},{"key":"a4","label":"Report printer"}]', '{}');
