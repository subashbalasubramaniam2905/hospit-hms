-- Starting ward and bed layout for Udumalpet (20 beds) and Pollachi (45 beds), matching the prototype.
-- SAMPLE layout and room rates: change them to the hospital's real wards before go-live (PUT /api/ipd/wards/{id}).

insert into ward (id, branch_id, name, type, floor, rate, position) values
  ('BR1-W1', 'BR1', 'General ward A', 'General',   '2nd floor', 1800, 1),
  ('BR1-W2', 'BR1', 'Private rooms',  'Private',   '3rd floor', 4500, 2),
  ('BR1-W3', 'BR1', 'ICU',            'ICU',       '1st floor', 9000, 3),
  ('BR1-W4', 'BR1', 'Maternity',      'Maternity', '3rd floor', 3500, 4),
  ('BR1-W5', 'BR1', 'Pediatric ward', 'Pediatric', '2nd floor', 2200, 5),
  ('BR2-W1', 'BR2', 'General ward',   'General',   '1st floor', 1600, 1),
  ('BR2-W2', 'BR2', 'Semi-private',   'Semi-private', '2nd floor', 2800, 2),
  ('BR2-W3', 'BR2', 'Private rooms',  'Private',   '2nd floor', 4200, 3),
  ('BR2-W4', 'BR2', 'ICU',            'ICU',       'Ground floor', 8500, 4),
  ('BR2-W5', 'BR2', 'Maternity',      'Maternity', '3rd floor', 3200, 5);

insert into bed (id, ward_id, label, position)
select w.id || '-B' || n, w.id, p.prefix || '-' || lpad(n::text, 2, '0'), n
from ward w
join (values ('BR1-W1','GA',7), ('BR1-W2','P',4), ('BR1-W3','ICU',4), ('BR1-W4','M',3), ('BR1-W5','PD',2),
             ('BR2-W1','GW',15), ('BR2-W2','SP',8), ('BR2-W3','P',8), ('BR2-W4','ICU',6), ('BR2-W5','M',8)) as p(ward, prefix, beds)
  on p.ward = w.id
cross join lateral generate_series(1, p.beds) as n;
