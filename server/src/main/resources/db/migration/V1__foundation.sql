-- HospitOS foundation schema: branches, staff accounts, patients (master index), append-only audit log.

create extension if not exists pgcrypto;

create table branch (
  id           text primary key,
  name         text not null,
  city         text not null,
  address      text,
  phone        text,
  gstin        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

insert into branch (id, name, city) values
  ('BR1', 'HospitOS Udumalpet', 'Udumalpet'),
  ('BR2', 'HospitOS Pollachi', 'Pollachi'),
  ('BR3', 'HospitOS Palani', 'Palani');

create table app_user (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  name            text not null,
  role            text not null check (role in ('super-admin','admin','doctor','nurse','receptionist','pharmacist',
                                                'lab-tech','radiologist','billing','hr','inventory')),
  branches        text[] not null default '{}',
  password_hash   text not null,
  status          text not null default 'Active' check (status in ('Active','Suspended')),
  must_change_pw  boolean not null default true,
  -- Every token carries this number; bumping it (password change, reset, suspension) signs out all sessions.
  token_version   int not null default 0,
  failed_logins   int not null default 0,
  locked_until    timestamptz,
  last_login      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index app_user_email_uq on app_user (lower(email));

-- UHID sequence per registration year: HS-YY-NNNNN
create table uhid_counter (
  yy    int primary key,
  next  int not null
);

create table patient (
  id                 text primary key,
  branch_id          text not null references branch(id),
  name               text not null,
  dob                date not null,
  gender             text not null check (gender in ('Female','Male','Other')),
  mobile             text not null,
  email              text,
  address            jsonb not null default '{}',
  blood              text not null default 'Unknown',
  allergies          text[] not null default '{}',
  conditions         text[] not null default '{}',
  history            text not null default '',
  surgical_history   text,
  family_history     text,
  medications        text,
  emergency          jsonb not null default '{}',
  insurance          jsonb,
  abha               text,
  consent            text not null default 'Pending' check (consent in ('Given','Pending','Withdrawn')),
  primary_doctor_id  text not null default '',
  registered         date not null default current_date,
  version            int not null default 1,
  created_by         uuid references app_user(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index patient_branch_idx on patient (branch_id);
create index patient_mobile_idx on patient (right(regexp_replace(mobile, '\D', '', 'g'), 10));
create index patient_name_idx on patient (lower(name));

-- Append-only, hash-chained audit trail. Every row's hash covers the previous row's hash,
-- so any edit or deletion made directly in the database breaks the chain and is detectable.
create table audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  user_id     uuid,
  user_name   text not null,
  role        text not null,
  branch_id   text,
  action      text not null,
  entity      text not null,
  entity_id   text,
  detail      text not null default '',
  ip          text,
  prev_hash   text not null,
  hash        text not null
);
create index audit_entity_idx on audit_log (entity, entity_id);
create index audit_at_idx on audit_log (at desc);

-- The canonical text that each row's hash covers. Timestamps are rendered in UTC so the result
-- does not depend on the session's TimeZone or DateStyle.
create function audit_payload(a audit_log) returns text language sql stable as $$
  select a.prev_hash || '|' || a.id::text || '|' || to_char(a.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
         coalesce(a.user_id::text, '') || '|' || a.user_name || '|' || a.role || '|' || coalesce(a.branch_id, '') || '|' ||
         a.action || '|' || a.entity || '|' || coalesce(a.entity_id, '') || '|' || a.detail
$$;

create function audit_chain() returns trigger language plpgsql as $$
declare last text;
begin
  -- Serialise writers, then take the id inside the lock so id order is chain order.
  perform pg_advisory_xact_lock(7302461);
  new.id := nextval(pg_get_serial_sequence('audit_log', 'id'));
  new.at := clock_timestamp();
  select hash into last from audit_log order by id desc limit 1;
  new.prev_hash := coalesce(last, 'GENESIS');
  new.hash := encode(digest(audit_payload(new), 'sha256'), 'hex');
  return new;
end $$;
create trigger audit_chain_bi before insert on audit_log for each row execute function audit_chain();

create function audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_no_update before update or delete on audit_log for each row execute function audit_immutable();
create trigger audit_no_truncate before truncate on audit_log for each statement execute function audit_immutable();
