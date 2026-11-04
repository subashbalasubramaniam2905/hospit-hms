-- Insurance providers / TPAs and claims. Provider names are SAMPLE values.

-- ids match patient.insurance.providerId used by the Angular app (IP1..IP5).
create table billing_insurance_providers (
    id          text primary key,
    name        varchar(160) not null,
    tpa         varchar(160),
    type        varchar(12)  not null check (type in ('INSURER','GOVERNMENT','CORPORATE')),
    phone       varchar(40),
    cashless    boolean      not null default true,
    active      boolean      not null default true
);

insert into billing_insurance_providers (id, name, tpa, type, phone, cashless) values
 ('IP1',   'Star Health (sample)',                 'In-house',                   'INSURER',    '1800-000-0001', true),
 ('IP2',  'HDFC ERGO (sample)',                   'Medi Assist (sample)',       'INSURER',    '1800-000-0002', true),
 ('IP3',   'Niva Bupa (sample)',                   'In-house',                   'INSURER',    '1800-000-0003', true),
 ('IP4',  'PM-JAY / Ayushman Bharat (sample)',    'State Health Agency (sample)','GOVERNMENT', '14555',         true),
 ('IP5',  'Corporate: Infotech Ltd (sample)',     'Paramount TPA (sample)',     'CORPORATE',  '1800-000-0005', false);

create table billing_claims (
    id                  uuid primary key default gen_random_uuid(),
    number              varchar(16)   not null unique,
    branch_id           text          not null references branch(id),
    patient_id          text          not null references patient(id),
    invoice_id          uuid          references billing_invoices(id),
    provider_id         text          not null references billing_insurance_providers(id),
    policy_no           varchar(60)   not null,
    type                varchar(20)   not null check (type in ('PRE_AUTHORISATION','FINAL_CLAIM','REIMBURSEMENT')),
    status              varchar(14)   not null check (status in ('DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','SETTLED')),
    claimed             numeric(12,2) not null check (claimed >= 0),
    approved            numeric(12,2) not null default 0 check (approved >= 0),
    settled             numeric(12,2) not null default 0,
    copay_pct           numeric(5,2)  not null default 0,
    documents           text[]        not null default '{}',
    rejection_reason    varchar(300),
    settlement_ref      varchar(60),
    created_by          uuid          references app_user(id),
    created_by_name     varchar(120)  not null,
    created_at          timestamptz   not null default now(),
    updated_at          timestamptz   not null default now(),
    version             int           not null default 1
);
create index billing_claims_status_idx  on billing_claims (status);
create index billing_claims_patient_idx on billing_claims (patient_id);
create unique index billing_claims_open_invoice_idx on billing_claims (invoice_id)
    where invoice_id is not null and status <> 'REJECTED' and type <> 'PRE_AUTHORISATION';

create table billing_claim_events (
    id          uuid primary key default gen_random_uuid(),
    claim_id    uuid         not null references billing_claims(id) on delete cascade,
    status      varchar(14)  not null,
    note        varchar(300),
    at          timestamptz  not null default now(),
    by_user     uuid         references app_user(id),
    by_name     varchar(120) not null
);
create index billing_claim_events_claim_idx on billing_claim_events (claim_id, at);
