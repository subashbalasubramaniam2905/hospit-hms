-- Pharmacy: suppliers, the medicine formulary, branch-wise batch stock, stock movements and dispensing records.
-- Prescriptions belong to the clinical module; a dispense refers to one by id without a foreign key.

create table supplier (
  id          text primary key,
  name        text not null,
  contact     text not null default '',
  phone       text not null default '',
  gst         text not null default '',
  city        text not null default '',
  type        text not null default 'Pharmacy' check (type in ('Pharmacy','Surgical','Equipment','General')),
  rating      numeric(2,1) not null default 0,
  active      boolean not null default true
);

create sequence medicine_seq start 51;

create table medicine (
  id          text primary key,
  generic     text not null,
  brand       text not null,
  strength    text not null default '',
  form        text not null,
  category    text not null,
  route       text not null default 'Oral',
  price       numeric(12,2) not null check (price >= 0),
  gst_pct     numeric(5,2) not null default 12 check (gst_pct >= 0),
  reorder     int not null default 0 check (reorder >= 0),
  rack        text not null default '',
  schedule    text,
  active      boolean not null default true,
  version     int not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index medicine_generic_idx on medicine (lower(generic));

create table medicine_batch (
  id           uuid primary key default gen_random_uuid(),
  medicine_id  text not null references medicine(id),
  branch_id    text not null references branch(id),
  batch        text not null,
  expiry       date not null,
  qty          int not null check (qty >= 0),
  supplier_id  text references supplier(id),
  cost         numeric(12,2) not null default 0 check (cost >= 0),
  received     date not null default current_date,
  created_at   timestamptz not null default now(),
  unique (medicine_id, branch_id, batch)
);
create index medicine_batch_fefo_idx on medicine_batch (medicine_id, branch_id, expiry);

create table stock_move (
  id           uuid primary key default gen_random_uuid(),
  at           timestamptz not null default now(),
  branch_id    text not null references branch(id),
  medicine_id  text not null references medicine(id),
  batch_id     uuid references medicine_batch(id),
  batch        text not null default '',
  kind         text not null check (kind in ('Receipt','Dispense','Adjustment','Transfer','Return')),
  qty          int not null,
  ref          text not null default '',
  note         text,
  by_user      uuid references app_user(id),
  by_name      text not null
);
create index stock_move_branch_at_idx on stock_move (branch_id, at desc);
create index stock_move_medicine_idx on stock_move (medicine_id, at desc);

create table dispense (
  id               uuid primary key default gen_random_uuid(),
  branch_id        text not null references branch(id),
  prescription_id  uuid not null,
  patient_id       text not null references patient(id),
  partial          boolean not null,
  pay_mode         text not null,
  total            numeric(12,2) not null,
  invoice_id       uuid,
  invoice_number   text,
  counselled       boolean not null default false,
  by_user          uuid references app_user(id),
  by_name          text not null,
  at               timestamptz not null default now()
);
create index dispense_rx_idx on dispense (prescription_id);
create index dispense_branch_at_idx on dispense (branch_id, at desc);

create table dispense_line (
  dispense_id      uuid not null references dispense(id) on delete cascade,
  position         int not null,
  medicine_id      text not null references medicine(id),
  substituted_for  text references medicine(id),
  requested        int not null,
  qty              int not null,
  rate             numeric(12,2) not null,
  gst_pct          numeric(5,2) not null,
  amount           numeric(12,2) not null,
  batches          text not null default '',
  primary key (dispense_id, position)
);

insert into supplier (id, name, contact, phone, gst, city, type, rating) values
  ('SP1', 'Medisource Distributors (demo)', 'Ravi Shankar', '+91 422 4322 01', '33AAAAA0001A1Z1', 'Coimbatore', 'Pharmacy', 4.6),
  ('SP2', 'Southern Pharma Agencies (demo)', 'Meena Iyer', '+91 422 4322 02', '33AAAAA0002A1Z2', 'Coimbatore', 'Pharmacy', 4.2),
  ('SP3', 'SurgiCare Supplies (demo)', 'Ajay Rao', '+91 422 4322 03', '33AAAAA0003A1Z3', 'Coimbatore', 'Surgical', 4.4),
  ('SP4', 'MedEquip India (demo)', 'Sunil Mathew', '+91 44 4100 2204', '33AAAAA0004A1Z4', 'Chennai', 'Equipment', 4.1),
  ('SP5', 'CleanCo Facility Supplies (demo)', 'Fathima N', '+91 422 4322 05', '33AAAAA0005A1Z5', 'Coimbatore', 'General', 3.9);

insert into medicine (id, generic, brand, strength, form, category, route, price, reorder, rack, schedule) values
  ('M001', 'Paracetamol', 'Calpol', '650 mg', 'Tablet', 'Analgesic', 'Oral', 2.2, 100, 'A-01', null),
  ('M002', 'Metformin', 'Glycomet', '500 mg', 'Tablet', 'Antidiabetic', 'Oral', 1.9, 100, 'B-02', null),
  ('M003', 'Glimepiride', 'Amaryl', '1 mg', 'Tablet', 'Antidiabetic', 'Oral', 6.5, 100, 'C-03', null),
  ('M004', 'Amlodipine', 'Amlong', '5 mg', 'Tablet', 'Antihypertensive', 'Oral', 3.1, 100, 'D-04', null),
  ('M005', 'Telmisartan', 'Telma', '40 mg', 'Tablet', 'Antihypertensive', 'Oral', 7.8, 100, 'E-05', null),
  ('M006', 'Atorvastatin', 'Atorva', '10 mg', 'Tablet', 'Lipid lowering', 'Oral', 6.9, 100, 'F-06', null),
  ('M007', 'Amoxicillin', 'Mox', '500 mg', 'Capsule', 'Antibiotic', 'Oral', 7.4, 100, 'A-07', 'H'),
  ('M008', 'Amoxicillin + clavulanate', 'Augmentin', '625 mg', 'Tablet', 'Antibiotic', 'Oral', 19.6, 100, 'B-08', 'H'),
  ('M009', 'Azithromycin', 'Azee', '500 mg', 'Tablet', 'Antibiotic', 'Oral', 21.5, 100, 'C-01', 'H'),
  ('M010', 'Sulfamethoxazole + trimethoprim', 'Septran DS', '960 mg', 'Tablet', 'Antibiotic', 'Oral', 3.4, 100, 'D-02', 'H'),
  ('M011', 'Cefixime', 'Taxim-O', '200 mg', 'Tablet', 'Antibiotic', 'Oral', 11.2, 100, 'E-03', 'H'),
  ('M012', 'Ciprofloxacin', 'Ciplox', '500 mg', 'Tablet', 'Antibiotic', 'Oral', 4.8, 100, 'F-04', 'H'),
  ('M013', 'Pantoprazole', 'Pan', '40 mg', 'Tablet', 'Antacid', 'Oral', 8.9, 100, 'A-05', null),
  ('M014', 'Omeprazole', 'Omez', '20 mg', 'Capsule', 'Antacid', 'Oral', 5.6, 100, 'B-06', null),
  ('M015', 'Ondansetron', 'Emeset', '4 mg', 'Tablet', 'Antiemetic', 'Oral', 5.2, 100, 'C-07', null),
  ('M016', 'Cetirizine', 'Okacet', '10 mg', 'Tablet', 'Antihistamine', 'Oral', 1.8, 100, 'D-08', null),
  ('M017', 'Levocetirizine', 'Levocet', '5 mg', 'Tablet', 'Antihistamine', 'Oral', 3.6, 100, 'E-01', null),
  ('M018', 'Montelukast', 'Montair', '10 mg', 'Tablet', 'Antiasthmatic', 'Oral', 14.5, 100, 'F-02', null),
  ('M019', 'Salbutamol', 'Asthalin', '100 mcg', 'Inhaler', 'Bronchodilator', 'Inhalation', 152, 15, 'A-03', null),
  ('M020', 'Budesonide + formoterol', 'Foracort', '200 mcg', 'Inhaler', 'Bronchodilator', 'Inhalation', 410, 15, 'B-04', null),
  ('M021', 'Levothyroxine', 'Thyronorm', '50 mcg', 'Tablet', 'Thyroid', 'Oral', 1.6, 100, 'C-05', null),
  ('M022', 'Ibuprofen', 'Brufen', '400 mg', 'Tablet', 'Analgesic', 'Oral', 1.4, 100, 'D-06', null),
  ('M023', 'Diclofenac', 'Voveran', '50 mg', 'Tablet', 'Analgesic', 'Oral', 2.1, 100, 'E-07', null),
  ('M024', 'Aceclofenac + paracetamol', 'Zerodol-P', '100/325 mg', 'Tablet', 'Analgesic', 'Oral', 5.8, 100, 'F-08', null),
  ('M025', 'Aspirin', 'Ecosprin', '75 mg', 'Tablet', 'Antiplatelet', 'Oral', 0.6, 100, 'A-01', null),
  ('M026', 'Clopidogrel', 'Clopilet', '75 mg', 'Tablet', 'Antiplatelet', 'Oral', 7.2, 100, 'B-02', null),
  ('M027', 'Metoprolol', 'Metolar XR', '25 mg', 'Tablet', 'Beta blocker', 'Oral', 6.1, 100, 'C-03', null),
  ('M028', 'Furosemide', 'Lasix', '40 mg', 'Tablet', 'Diuretic', 'Oral', 1.1, 100, 'D-04', null),
  ('M029', 'Insulin glargine', 'Basalog', '100 IU/ml', 'Injection', 'Antidiabetic', 'IV/IM', 760, 15, 'E-05', null),
  ('M030', 'Insulin regular', 'Actrapid', '40 IU/ml', 'Injection', 'Antidiabetic', 'IV/IM', 165, 15, 'F-06', null),
  ('M031', 'Ceftriaxone', 'Monocef', '1 g', 'Injection', 'Antibiotic', 'IV/IM', 58, 100, 'A-07', 'H'),
  ('M032', 'Ondansetron', 'Emeset', '2 mg/ml', 'Injection', 'Antiemetic', 'IV/IM', 14, 100, 'B-08', null),
  ('M033', 'Normal saline', 'NS', '500 ml', 'IV fluid', 'IV fluid', 'IV/IM', 32, 100, 'C-01', null),
  ('M034', 'Ringer lactate', 'RL', '500 ml', 'IV fluid', 'IV fluid', 'IV/IM', 36, 100, 'D-02', null),
  ('M035', 'Dextrose 5%', 'D5', '500 ml', 'IV fluid', 'IV fluid', 'IV/IM', 34, 100, 'E-03', null),
  ('M036', 'Vitamin D3', 'Uprise D3', '60000 IU', 'Capsule', 'Supplement', 'Oral', 31, 100, 'F-04', null),
  ('M037', 'Calcium + vitamin D3', 'Shelcal', '500 mg', 'Tablet', 'Supplement', 'Oral', 5.9, 100, 'A-05', null),
  ('M038', 'Iron + folic acid', 'Autrin', '', 'Capsule', 'Supplement', 'Oral', 4.2, 100, 'B-06', null),
  ('M039', 'Multivitamin', 'Becosules', '', 'Capsule', 'Supplement', 'Oral', 2.3, 100, 'C-07', null),
  ('M040', 'ORS', 'Electral', '21.8 g', 'Sachet', 'Rehydration', 'Oral', 21, 100, 'D-08', null),
  ('M041', 'Domperidone', 'Domstal', '10 mg', 'Tablet', 'Antiemetic', 'Oral', 2.8, 100, 'E-01', null),
  ('M042', 'Prednisolone', 'Wysolone', '10 mg', 'Tablet', 'Steroid', 'Oral', 1.5, 100, 'F-02', 'H'),
  ('M043', 'Hydrocortisone', 'Efcorlin', '100 mg', 'Injection', 'Steroid', 'IV/IM', 46, 100, 'A-03', 'H'),
  ('M044', 'Clotrimazole', 'Candid', '1%', 'Cream', 'Antifungal', 'Topical', 92, 100, 'B-04', null),
  ('M045', 'Mupirocin', 'T-Bact', '2%', 'Ointment', 'Antibiotic', 'Topical', 148, 15, 'C-05', 'H'),
  ('M046', 'Tretinoin', 'Retino-A', '0.025%', 'Cream', 'Dermatology', 'Topical', 210, 15, 'D-06', null),
  ('M047', 'Paracetamol', 'Calpol', '250 mg/5 ml', 'Syrup', 'Analgesic', 'Oral', 48, 100, 'E-07', null),
  ('M048', 'Amoxicillin', 'Mox', '250 mg/5 ml', 'Syrup', 'Antibiotic', 'Oral', 64, 100, 'F-08', 'H'),
  ('M049', 'Folic acid', 'Folvite', '5 mg', 'Tablet', 'Supplement', 'Oral', 1.2, 100, 'A-01', null),
  ('M050', 'Enoxaparin', 'Clexane', '40 mg', 'Injection', 'Anticoagulant', 'IV/IM', 395, 15, 'B-02', null);

