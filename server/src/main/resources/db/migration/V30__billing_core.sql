-- Billing: settings, GST rates, tariff, invoices, lines, payments/refunds and document numbering.
-- All values below are SAMPLE data. A branch's own GSTIN (branch.gstin) overrides the one here when set. Replace the GSTIN, legal name and tariff with the hospital's
-- real details through the admin API (PUT /api/billing/settings, /api/billing/tariff) before go-live.

create table billing_settings (
    id                      smallint primary key default 1 check (id = 1),
    legal_name              varchar(200) not null,
    trade_name              varchar(200) not null,
    gstin                   varchar(15)  not null,
    state_code              char(2)      not null,
    state_name              varchar(60)  not null,
    address                 varchar(400) not null,
    phone                   varchar(40),
    email                   varchar(120),
    invoice_prefix          varchar(6)   not null default 'INV',
    receipt_prefix          varchar(6)   not null default 'RCT',
    refund_prefix           varchar(6)   not null default 'RFD',
    claim_prefix            varchar(6)   not null default 'CLM',
    discount_approval_pct   numeric(5,2) not null default 10,
    default_copay_pct       numeric(5,2) not null default 10,
    invoice_footer          varchar(500),
    sample_data             boolean      not null default true,
    updated_at              timestamptz  not null default now(),
    updated_by              varchar(120),
    version                 int          not null default 1
);

insert into billing_settings (legal_name, trade_name, gstin, state_code, state_name, address, phone, email, invoice_footer)
values ('HospitOS Healthcare Pvt Ltd (sample)', 'HospitOS Multispeciality Hospital',
        '33AAACH0000A1ZY', '33', 'Tamil Nadu',
        'Palani Road, Udumalpet, Tiruppur district, Tamil Nadu 642126',
        '+91 4252 221000', 'billing@hospitos.example',
        'Healthcare services by a clinical establishment are exempt from GST (SAC 9993). Medicines, implants and non-clinical services are taxable.');

-- GST rate per billing category. tax_pct on a tariff item or line overrides this.
create table billing_tax_rates (
    category    varchar(20)  primary key,
    gst_pct     numeric(5,2) not null check (gst_pct >= 0 and gst_pct <= 28),
    hsn_sac     varchar(8),
    note        varchar(200)
);

insert into billing_tax_rates (category, gst_pct, hsn_sac, note) values
 ('CONSULTATION', 0,  '999312', 'Healthcare service, exempt'),
 ('PROCEDURE',    0,  '999312', 'Healthcare service, exempt'),
 ('LABORATORY',   0,  '999316', 'Diagnostic service, exempt'),
 ('IMAGING',      0,  '999316', 'Diagnostic service, exempt'),
 ('ROOM',         0,  '999311', 'Inpatient room, exempt (ICU/CCU); non-ICU above Rs 5000/day may attract 5%'),
 ('NURSING',      0,  '999311', 'Healthcare service, exempt'),
 ('OT',           0,  '999311', 'Healthcare service, exempt'),
 ('PHARMACY',     12, '3004',   'Medicines (sample rate; varies by drug)'),
 ('OTHER',        18, '9997',   'Non-clinical services (certificates, ambulance hire etc.)');

create table billing_tariff_items (
    id          uuid primary key default gen_random_uuid(),
    code        varchar(30)  not null unique,
    name        varchar(200) not null,
    category    varchar(20)  not null references billing_tax_rates(category),
    price       numeric(12,2) not null check (price >= 0),
    tax_pct     numeric(5,2) check (tax_pct >= 0 and tax_pct <= 28),
    hsn_sac     varchar(8),
    department  varchar(60),
    active      boolean      not null default true,
    version     int          not null default 1,
    created_at  timestamptz  not null default now(),
    updated_at  timestamptz  not null default now()
);

insert into billing_tariff_items (code, name, category, price, tax_pct) values
 ('CON-GEN',  'Consultation, General medicine',  'CONSULTATION', 500,  null),
 ('CON-CAR',  'Consultation, Cardiology',        'CONSULTATION', 800,  null),
 ('CON-PED',  'Consultation, Pediatrics',        'CONSULTATION', 600,  null),
 ('CON-ORT',  'Consultation, Orthopedics',       'CONSULTATION', 700,  null),
 ('CON-OBG',  'Consultation, Obstetrics and gynaecology', 'CONSULTATION', 700, null),
 ('LAB-CBC',  'Complete blood count (CBC)',      'LABORATORY',   350,  null),
 ('LAB-FBS',  'Fasting blood sugar',             'LABORATORY',   120,  null),
 ('LAB-HBA1C','HbA1c',                           'LABORATORY',   550,  null),
 ('LAB-LFT',  'Liver function test',             'LABORATORY',   750,  null),
 ('LAB-RFT',  'Renal function test',             'LABORATORY',   700,  null),
 ('LAB-LIP',  'Lipid profile',                   'LABORATORY',   650,  null),
 ('LAB-TSH',  'Thyroid stimulating hormone',     'LABORATORY',   400,  null),
 ('LAB-URI',  'Urine routine',                   'LABORATORY',   150,  null),
 ('IMG-XCH',  'X-ray chest PA',                  'IMAGING',      600,  null),
 ('IMG-USA',  'Ultrasound abdomen',              'IMAGING',      1500, null),
 ('IMG-CTB',  'CT brain plain',                  'IMAGING',      3500, null),
 ('IMG-MRL',  'MRI lumbar spine',                'IMAGING',      7500, null),
 ('PRC-ECG',  'ECG',                             'PROCEDURE',    400,  null),
 ('PRC-DRS',  'Dressing, small',                 'PROCEDURE',    250,  null),
 ('PRC-NEB',  'Nebulisation',                    'PROCEDURE',    200,  null),
 ('PRC-SUT',  'Suturing, minor',                 'PROCEDURE',    900,  null),
 ('PRC-PLS',  'Plaster application',             'PROCEDURE',    1800, null),
 ('ROOM-GEN', 'General ward bed (per day)',      'ROOM',         1800, null),
 ('ROOM-PVT', 'Private room (per day)',          'ROOM',         4500, null),
 ('ROOM-ICU', 'ICU bed (per day)',               'ROOM',         9000, null),
 ('NUR-DAY',  'Nursing charges (per day)',       'NURSING',      800,  null),
 ('OTH-AMB',  'Ambulance (within city)',         'OTHER',        1500, null),
 ('OTH-CERT', 'Medical certificate',             'OTHER',        300,  null),
 ('PRC-IMPL', 'Implant: knee prosthesis',        'PROCEDURE',    68000, 5);

-- Gap-free document numbers per financial year (GST rule 46 requires consecutive serials).
create table billing_number_sequences (
    doc_type    varchar(10) not null,
    fin_year    char(4)     not null,   -- e.g. 2627 for FY 2026-27
    next_value  bigint      not null,
    primary key (doc_type, fin_year)
);

create table billing_invoices (
    id                  uuid primary key default gen_random_uuid(),
    number              varchar(16)   not null unique,
    branch_id           text          not null references branch(id),
    gstin               varchar(15)   not null,
    patient_id          text          not null references patient(id),
    kind                varchar(10)   not null check (kind in ('OPD','IPD','PHARMACY','LAB')),
    status              varchar(16)   not null check (status in ('UNPAID','PARTIALLY_PAID','PAID','REFUNDED','CANCELLED')),
    invoice_date        date          not null,
    place_of_supply     char(2)       not null,
    discount_pct        numeric(5,2)  not null default 0 check (discount_pct >= 0 and discount_pct <= 100),
    subtotal            numeric(12,2) not null,
    discount_amount     numeric(12,2) not null,
    taxable_amount      numeric(12,2) not null,
    cgst                numeric(12,2) not null,
    sgst                numeric(12,2) not null,
    igst                numeric(12,2) not null,
    round_off           numeric(6,2)  not null,
    total               numeric(12,2) not null,
    paid                numeric(12,2) not null default 0,
    refunded            numeric(12,2) not null default 0,
    admission_ref       varchar(40),
    source_type         varchar(20),
    source_id           varchar(64),
    notes               varchar(500),
    cancel_reason       varchar(300),
    cancelled_at        timestamptz,
    cancelled_by        varchar(120),
    created_by          uuid          references app_user(id),
    created_by_name     varchar(120)  not null,
    created_at          timestamptz   not null default now(),
    updated_at          timestamptz   not null default now(),
    version             int           not null default 1
);
create index billing_invoices_patient_idx on billing_invoices (patient_id, invoice_date desc);
create index billing_invoices_date_idx    on billing_invoices (invoice_date desc);
create index billing_invoices_status_idx  on billing_invoices (status);
create index billing_invoices_branch_idx  on billing_invoices (branch_id, invoice_date desc);

create table billing_invoice_lines (
    id              uuid primary key default gen_random_uuid(),
    invoice_id      uuid          not null references billing_invoices(id) on delete cascade,
    line_no         int           not null,
    tariff_code     varchar(30),
    description     varchar(300)  not null,
    category        varchar(20)   not null references billing_tax_rates(category),
    hsn_sac         varchar(8),
    qty             numeric(10,2) not null check (qty > 0),
    rate            numeric(12,2) not null check (rate >= 0),
    gross           numeric(12,2) not null,
    discount        numeric(12,2) not null,
    taxable         numeric(12,2) not null,
    tax_pct         numeric(5,2)  not null,
    cgst            numeric(12,2) not null,
    sgst            numeric(12,2) not null,
    igst            numeric(12,2) not null,
    amount          numeric(12,2) not null,
    ref_type        varchar(20),
    ref_id          varchar(64),
    unique (invoice_id, line_no)
);
create index billing_invoice_lines_ref_idx on billing_invoice_lines (ref_type, ref_id);

-- Money in (PAYMENT) and money out (REFUND) against an invoice. Rows are never updated or deleted.
create table billing_payments (
    id              uuid primary key default gen_random_uuid(),
    invoice_id      uuid          not null references billing_invoices(id),
    receipt_number  varchar(16)   not null unique,
    type            varchar(8)    not null check (type in ('PAYMENT','REFUND')),
    mode            varchar(16)   not null check (mode in ('CASH','UPI','CARD','BANK_TRANSFER','ONLINE','INSURANCE','ADVANCE')),
    amount          numeric(12,2) not null check (amount > 0),
    reference       varchar(100),
    reason          varchar(300),
    received_at     timestamptz   not null default now(),
    received_by     uuid          references app_user(id),
    received_by_name varchar(120) not null
);
create index billing_payments_invoice_idx on billing_payments (invoice_id);
create index billing_payments_time_idx    on billing_payments (received_at);
