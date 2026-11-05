-- Fictional departments and doctors for local testing (same ids as the Angular prototype).
-- Loaded only when FLYWAY_LOCATIONS includes classpath:db/sample (docker-compose does this).
-- Replace with the hospital's real departments and doctors before any real use.

insert into department (id, branch_id, name, icon, floor) values
  ('GM', 'BR1', 'General medicine', 'stethoscope', 'Ground floor'),
  ('CA', 'BR1', 'Cardiology', 'heart-pulse', 'First floor'),
  ('PE', 'BR1', 'Pediatrics', 'baby', 'Ground floor'),
  ('OR', 'BR1', 'Orthopedics', 'bone', 'First floor'),
  ('DE', 'BR1', 'Dermatology', 'scan-face', 'Second floor'),
  ('GY', 'BR1', 'Gynecology', 'flower-2', 'Second floor'),
  ('EN', 'BR1', 'Endocrinology', 'droplet', 'First floor'),
  ('EM', 'BR1', 'Emergency', 'siren', 'Ground floor')
on conflict (id) do nothing;

insert into doctor (id, branch_id, dept_id, name, qualification, experience, fee, room, phone, email, days, start_time, end_time, slot_min, status, reg_no) values
  ('D01', 'BR1', 'GM', 'Dr. Sana Iqbal', 'MBBS, MD (Internal Medicine)', 12, 700, 'OPD-3', '+91 4252 221100', 'sana.iqbal@hospit.demo', '{Mon,Tue,Wed,Thu,Fri,Sat}', '09:00', '17:00', 15, 'Available', 'TNMC-DEMO-40100'),
  ('D02', 'BR1', 'CA', 'Dr. Vikram Rao', 'MBBS, MD, DM (Cardiology)', 18, 1200, 'OPD-1', '+91 4252 221107', 'vikram.rao@hospit.demo', '{Mon,Tue,Wed,Thu,Fri}', '09:00', '17:00', 20, 'Available', 'TNMC-DEMO-40113'),
  ('D03', 'BR1', 'PE', 'Dr. Anjali Desai', 'MBBS, MD (Pediatrics)', 9, 800, 'OPD-5', '+91 4252 221114', 'anjali.desai@hospit.demo', '{Mon,Tue,Wed,Thu,Fri}', '09:00', '17:00', 15, 'Available', 'TNMC-DEMO-40126'),
  ('D04', 'BR1', 'OR', 'Dr. Arjun Pillai', 'MBBS, MS (Ortho)', 14, 1000, 'OPD-6', '+91 4252 221121', 'arjun.pillai@hospit.demo', '{Mon,Tue,Wed,Thu,Fri,Sat}', '09:00', '17:00', 15, 'Available', 'TNMC-DEMO-40139'),
  ('D05', 'BR1', 'DE', 'Dr. Priya Nair', 'MBBS, MD (Dermatology)', 7, 900, 'OPD-8', '+91 4252 221128', 'priya.nair@hospit.demo', '{Mon,Tue,Wed,Thu,Fri}', '09:00', '17:00', 15, 'Available', 'TNMC-DEMO-40152'),
  ('D06', 'BR1', 'GY', 'Dr. Kavitha Menon', 'MBBS, MS (OBG)', 15, 1000, 'OPD-9', '+91 4252 221135', 'kavitha.menon@hospit.demo', '{Mon,Tue,Wed,Thu,Fri}', '09:00', '17:00', 15, 'Available', 'TNMC-DEMO-40165'),
  ('D07', 'BR1', 'EN', 'Dr. Rahul Verghese', 'MBBS, MD, DM (Endocrinology)', 11, 1100, 'OPD-4', '+91 4252 221142', 'rahul.verghese@hospit.demo', '{Mon,Tue,Wed,Thu,Fri,Sat}', '09:00', '17:00', 20, 'Available', 'TNMC-DEMO-40178'),
  ('D08', 'BR1', 'EM', 'Dr. Imran Qureshi', 'MBBS, MEM', 8, 600, 'ER', '+91 4252 221149', 'imran.qureshi@hospit.demo', '{Mon,Tue,Wed,Thu,Fri}', '08:00', '20:00', 15, 'Available', 'TNMC-DEMO-40191'),
  ('D09', 'BR1', 'GM', 'Dr. Deepa Krishnan', 'MBBS, DNB (Family Medicine)', 6, 600, 'OPD-2', '+91 4252 221156', 'deepa.krishnan@hospit.demo', '{Mon,Tue,Wed,Thu,Fri}', '09:00', '17:00', 15, 'Available', 'TNMC-DEMO-40204'),
  ('D10', 'BR1', 'CA', 'Dr. Nikhil Sharma', 'MBBS, MD (Medicine)', 5, 900, 'OPD-7', '+91 4252 221163', 'nikhil.sharma@hospit.demo', '{Mon,Tue,Wed,Thu,Fri,Sat}', '09:00', '17:00', 15, 'Available', 'TNMC-DEMO-40217')
on conflict (id) do nothing;
