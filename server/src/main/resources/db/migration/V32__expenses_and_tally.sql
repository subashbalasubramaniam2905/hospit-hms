-- Hospital expenses (rent, salaries, utilities...) and Tally export settings.
-- Pharmacy and store purchases stay in procurement; this is for everything else the hospital pays for.

create table expense_category (
    id            varchar(30)  primary key,
    name          varchar(80)  not null unique,
    tally_ledger  varchar(120) not null,
    tally_group   varchar(60)  not null default 'Indirect Expenses'
                  check (tally_group in ('Direct Expenses', 'Indirect Expenses', 'Fixed Assets', 'Current Assets', 'Loans (Liability)')),
    active        boolean      not null default true,
    sort_order    int          not null default 100,
    version       int          not null default 1
);

insert into expense_category (id, name, tally_ledger, tally_group, sort_order) values
 ('RENT',        'Rent and lease',                    'Rent',                         'Indirect Expenses', 10),
 ('SALARY',      'Salaries and wages',                'Salaries and Wages',           'Indirect Expenses', 20),
 ('DOCTOR_FEE',  'Visiting doctor fees',              'Professional Fees - Doctors',  'Direct Expenses',   30),
 ('ELECTRICITY', 'Electricity',                       'Electricity Charges',          'Indirect Expenses', 40),
 ('WATER',       'Water',                             'Water Charges',                'Indirect Expenses', 50),
 ('DIESEL',      'Diesel and generator',              'Generator Fuel',               'Indirect Expenses', 60),
 ('PHONE',       'Telephone and internet',            'Telephone and Internet',       'Indirect Expenses', 70),
 ('REPAIRS',     'Repairs and maintenance',           'Repairs and Maintenance',      'Indirect Expenses', 80),
 ('EQUIP_AMC',   'Equipment AMC and service',         'Equipment AMC',                'Indirect Expenses', 90),
 ('HOUSEKEEP',   'Housekeeping and laundry',          'Housekeeping and Laundry',     'Indirect Expenses', 100),
 ('SECURITY',    'Security services',                 'Security Charges',             'Indirect Expenses', 110),
 ('BMW',         'Biomedical waste disposal',         'Biomedical Waste Disposal',    'Direct Expenses',   120),
 ('OXYGEN',      'Medical gases (oxygen)',            'Medical Gases',                'Direct Expenses',   130),
 ('AMBULANCE',   'Ambulance and vehicle running',     'Vehicle Running Expenses',     'Indirect Expenses', 140),
 ('CANTEEN',     'Canteen and patient food',          'Canteen Expenses',             'Indirect Expenses', 150),
 ('STATIONERY',  'Printing and stationery',           'Printing and Stationery',      'Indirect Expenses', 160),
 ('ADVERT',      'Advertising and camps',             'Advertisement and Publicity',  'Indirect Expenses', 170),
 ('INSURANCE',   'Insurance premium',                 'Insurance Premium',            'Indirect Expenses', 180),
 ('LICENCE',     'Licences, fees and taxes',          'Rates and Taxes',              'Indirect Expenses', 190),
 ('PROF_FEE',    'Audit, legal and consultancy',      'Professional Fees',            'Indirect Expenses', 200),
 ('BANK',        'Bank charges',                      'Bank Charges',                 'Indirect Expenses', 210),
 ('SOFTWARE',    'Software and IT',                   'Software and IT Expenses',     'Indirect Expenses', 220),
 ('TRAVEL',      'Travel and conveyance',             'Travel and Conveyance',        'Indirect Expenses', 230),
 ('EQUIPMENT',   'Equipment purchase (capital)',      'Medical Equipment',            'Fixed Assets',      240),
 ('MISC',        'Miscellaneous',                     'Miscellaneous Expenses',       'Indirect Expenses', 900);

create sequence expense_seq start 1001;

create table expense (
    id               uuid primary key default gen_random_uuid(),
    number           varchar(16)   not null unique,          -- EXP-1001
    branch_id        text          not null references branch(id),
    expense_date     date          not null,
    category_id      varchar(30)   not null references expense_category(id),
    payee            varchar(120)  not null,
    description      varchar(300),
    bill_no          varchar(40),
    amount           numeric(12,2) not null check (amount > 0),  -- before GST
    gst_amount       numeric(12,2) not null default 0 check (gst_amount >= 0),
    interstate       boolean       not null default false,       -- GST is IGST rather than CGST + SGST
    tds_amount       numeric(12,2) not null default 0 check (tds_amount >= 0),
    pay_mode         varchar(16)   not null check (pay_mode in ('CASH','UPI','CARD','BANK_TRANSFER','CHEQUE','UNPAID')),
    reference        varchar(100),
    status           varchar(10)   not null default 'RECORDED' check (status in ('RECORDED','CANCELLED')),
    cancel_reason    varchar(300),
    cancelled_at     timestamptz,
    cancelled_by     varchar(120),
    created_by       uuid          references app_user(id),
    created_by_name  varchar(120)  not null,
    created_at       timestamptz   not null default now(),
    updated_at       timestamptz   not null default now(),
    version          int           not null default 1,
    check (tds_amount <= amount + gst_amount)
);
create index expense_branch_date_idx on expense (branch_id, expense_date desc);
create index expense_category_idx    on expense (category_id, expense_date desc);

-- Ledger names used in the Tally export. Accountants change them to match the ledgers already in their Tally company.
create table tally_ledger (
    key          varchar(30)  primary key,
    label        varchar(80)  not null,
    ledger_name  varchar(120) not null,
    tally_group  varchar(60)  not null,
    sort_order   int          not null
);

insert into tally_ledger (key, label, ledger_name, tally_group, sort_order) values
 ('PATIENTS',             'Patients (receivable)',         'Patient Receivables',        'Sundry Debtors',     10),
 ('SALES_CONSULTATION',   'Income: consultation',          'OPD Consultation Income',    'Sales Accounts',     20),
 ('SALES_PROCEDURE',      'Income: procedures',            'Procedure Income',           'Sales Accounts',     21),
 ('SALES_LABORATORY',     'Income: laboratory',            'Laboratory Income',          'Sales Accounts',     22),
 ('SALES_IMAGING',        'Income: imaging',               'Radiology Income',           'Sales Accounts',     23),
 ('SALES_PHARMACY',       'Income: pharmacy',              'Pharmacy Sales',             'Sales Accounts',     24),
 ('SALES_ROOM',           'Income: room and bed',          'Room Rent Income',           'Sales Accounts',     25),
 ('SALES_NURSING',        'Income: nursing',               'Nursing Income',             'Sales Accounts',     26),
 ('SALES_OT',             'Income: operation theatre',     'OT Income',                  'Sales Accounts',     27),
 ('SALES_OTHER',          'Income: other services',        'Other Operating Income',     'Sales Accounts',     28),
 ('OUTPUT_CGST',          'Output CGST',                   'Output CGST',                'Duties & Taxes',     40),
 ('OUTPUT_SGST',          'Output SGST',                   'Output SGST',                'Duties & Taxes',     41),
 ('OUTPUT_IGST',          'Output IGST',                   'Output IGST',                'Duties & Taxes',     42),
 ('INPUT_CGST',           'Input CGST',                    'Input CGST',                 'Duties & Taxes',     43),
 ('INPUT_SGST',           'Input SGST',                    'Input SGST',                 'Duties & Taxes',     44),
 ('INPUT_IGST',           'Input IGST',                    'Input IGST',                 'Duties & Taxes',     45),
 ('TDS_PAYABLE',          'TDS deducted on expenses',      'TDS Payable',                'Duties & Taxes',     46),
 ('ROUND_OFF',            'Round off',                     'Round Off',                  'Indirect Expenses',  50),
 ('MODE_CASH',            'Money in/out: cash',            'Cash',                       'Cash-in-Hand',       60),
 ('MODE_UPI',             'Money in/out: UPI',             'Bank Account',               'Bank Accounts',      61),
 ('MODE_CARD',            'Money in/out: card',            'Bank Account',               'Bank Accounts',      62),
 ('MODE_BANK_TRANSFER',   'Money in/out: bank transfer',   'Bank Account',               'Bank Accounts',      63),
 ('MODE_ONLINE',          'Money in: online payment',      'Bank Account',               'Bank Accounts',      64),
 ('MODE_CHEQUE',          'Money out: cheque',             'Bank Account',               'Bank Accounts',      65),
 ('MODE_INSURANCE',       'Money in: insurer settlement',  'Bank Account',               'Bank Accounts',      66),
 ('MODE_ADVANCE',         'Patient advances adjusted',     'Patient Advances',           'Current Liabilities',67),
 ('EXPENSES_PAYABLE',     'Expenses not yet paid',         'Expenses Payable',           'Current Liabilities',70);

create table tally_settings (
    id            smallint primary key default 1 check (id = 1),
    company_name  varchar(120) not null default '',
    updated_at    timestamptz  not null default now(),
    updated_by    varchar(120)
);
insert into tally_settings (company_name) values ('');

-- One row per download, so accounts can see what was already sent to Tally.
create table tally_export_log (
    id            uuid primary key default gen_random_uuid(),
    branch_id     text,
    from_date     date        not null,
    to_date       date        not null,
    format        varchar(10) not null,
    vouchers      int         not null,
    exported_by   varchar(120) not null,
    exported_at   timestamptz not null default now()
);
create index tally_export_log_time_idx on tally_export_log (exported_at desc);
