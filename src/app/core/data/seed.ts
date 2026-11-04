/* Fictional seed data for the HospitOS prototype. Deterministic so screens stay consistent.
   No real patients, staff, phone numbers or identifiers are used. */
import {
  Admission, Alert, Appointment, ApptStatus, Asset, AuditLog, Bed, Branch, Claim, Consultation, Department, Doctor, ERCase,
  Feedback, FollowUp, HospitalConfig, ImagingOrder, InAppNote, Integration, InventoryItem, Invoice, InsuranceProvider, LabOrder, LabTest,
  LeaveRequest, LoginEvent, Medicine, NotificationMsg, Patient, Prescription, PurchaseOrder, QueueEntry, Requisition, ServiceItem,
  StaffMember, StockMove, Supplier, Surgery, UserAccount, Ward, Workflow
} from '../models';

let s = 20261103;
const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const int = (a: number, b: number) => Math.floor(a + rnd() * (b - a + 1));
export const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function isoDay(offset = 0, base = new Date()): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const TODAY = () => isoDay(0);

export interface SeedData {
  version: number; seededOn: string;
  branches: Branch[]; departments: Department[]; doctors: Doctor[]; patients: Patient[]; appointments: Appointment[]; queue: QueueEntry[];
  consultations: Consultation[]; prescriptions: Prescription[]; medicines: Medicine[]; suppliers: Supplier[]; purchaseOrders: PurchaseOrder[]; stockMoves: StockMove[];
  labTests: LabTest[]; labOrders: LabOrder[]; imaging: ImagingOrder[]; invoices: Invoice[]; providers: InsuranceProvider[]; claims: Claim[];
  wards: Ward[]; beds: Bed[]; admissions: Admission[]; surgeries: Surgery[]; erCases: ERCase[]; staff: StaffMember[]; leaves: LeaveRequest[];
  inventory: InventoryItem[]; assets: Asset[]; requisitions: Requisition[]; notifications: NotificationMsg[]; inbox: InAppNote[]; alerts: Alert[];
  audit: AuditLog[]; logins: LoginEvent[]; users: UserAccount[]; integrations: Integration[]; workflows: Workflow[]; followUps: FollowUp[];
  feedback: Feedback[]; services: ServiceItem[]; config: HospitalConfig;
}

export function buildSeed(): SeedData {
  s = 20261103;
  const T = (o: number) => isoDay(o);

  const branches: Branch[] = [
    { id: 'BR1', name: 'HospitOS Udumalpet', city: 'Udumalpet', beds: 20, revenueMonth: 9640000, visitsMonth: 3920, occupancy: 0, doctors: 10, doctorsAvailable: 8, utilisation: { OPD: 82, OT: 71, Lab: 77, Radiology: 64 } },
    { id: 'BR2', name: 'HospitOS Pollachi', city: 'Pollachi', beds: 45, revenueMonth: 12850000, visitsMonth: 4610, occupancy: 78, doctors: 16, doctorsAvailable: 13, utilisation: { OPD: 88, OT: 79, Lab: 81, Radiology: 70 } },
    { id: 'BR3', name: 'HospitOS Palani Clinic', city: 'Palani', beds: 0, revenueMonth: 2310000, visitsMonth: 1480, occupancy: 0, doctors: 4, doctorsAvailable: 3, utilisation: { OPD: 69, OT: 0, Lab: 58, Radiology: 0 } },
  ];

  const departments: Department[] = [
    { id: 'GM', name: 'General medicine', icon: 'stethoscope', floor: 'Ground floor' },
    { id: 'CA', name: 'Cardiology', icon: 'heart-pulse', floor: 'First floor' },
    { id: 'PE', name: 'Pediatrics', icon: 'baby', floor: 'Ground floor' },
    { id: 'OR', name: 'Orthopedics', icon: 'bone', floor: 'First floor' },
    { id: 'DE', name: 'Dermatology', icon: 'scan-face', floor: 'Second floor' },
    { id: 'GY', name: 'Gynecology', icon: 'flower-2', floor: 'Second floor' },
    { id: 'EN', name: 'Endocrinology', icon: 'droplet', floor: 'First floor' },
    { id: 'EM', name: 'Emergency', icon: 'siren', floor: 'Ground floor' },
  ];

  const docDefs: [string, string, string, number, number, string][] = [
    ['Dr. Sana Iqbal', 'GM', 'MBBS, MD (Internal Medicine)', 12, 700, 'OPD-3'],
    ['Dr. Vikram Rao', 'CA', 'MBBS, MD, DM (Cardiology)', 18, 1200, 'OPD-1'],
    ['Dr. Anjali Desai', 'PE', 'MBBS, MD (Pediatrics)', 9, 800, 'OPD-5'],
    ['Dr. Arjun Pillai', 'OR', 'MBBS, MS (Ortho)', 14, 1000, 'OPD-6'],
    ['Dr. Priya Nair', 'DE', 'MBBS, MD (Dermatology)', 7, 900, 'OPD-8'],
    ['Dr. Kavitha Menon', 'GY', 'MBBS, MS (OBG)', 15, 1000, 'OPD-9'],
    ['Dr. Rahul Verghese', 'EN', 'MBBS, MD, DM (Endocrinology)', 11, 1100, 'OPD-4'],
    ['Dr. Imran Qureshi', 'EM', 'MBBS, MEM', 8, 600, 'ER'],
    ['Dr. Deepa Krishnan', 'GM', 'MBBS, DNB (Family Medicine)', 6, 600, 'OPD-2'],
    ['Dr. Nikhil Sharma', 'CA', 'MBBS, MD (Medicine)', 5, 900, 'OPD-7'],
  ];
  const statuses: Doctor['status'][] = ['In OPD', 'Running late', 'In OPD', 'In OT', 'Available', 'In OPD', 'In OPD', 'Available', 'On leave', 'In OPD'];
  const doctors: Doctor[] = docDefs.map((d, i) => ({
    id: 'D' + pad(i + 1), name: d[0], deptId: d[1], qualification: d[2], experience: d[3], fee: d[4], room: d[5],
    phone: '+91 4252 22' + pad(1100 + i * 7, 4), email: d[0].replace('Dr. ', '').toLowerCase().replace(/ /g, '.') + '@hospit.demo',
    days: i % 3 === 0 ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start: i === 7 ? '08:00' : '09:00', end: i === 7 ? '20:00' : '17:00', slotMin: i === 1 || i === 6 ? 20 : 15, status: statuses[i], regNo: 'TNMC-DEMO-' + (40100 + i * 13)
  }));

  const female = ['Lakshmi', 'Ishita', 'Kavya', 'Neha', 'Meenakshi', 'Pooja', 'Sneha', 'Divya', 'Zoya', 'Tanvi', 'Asha', 'Fatima', 'Rekha', 'Ananya', 'Shruti', 'Nandini', 'Priyanka', 'Swati', 'Bhavana', 'Geeta', 'Ritu', 'Sunita', 'Anjali', 'Mehak', 'Roshni'];
  const male = ['Aarav', 'Rohit', 'Farhan', 'Suresh', 'Joseph', 'Anil', 'Ravi', 'Manoj', 'Harish', 'Gurpreet', 'Nikhil', 'Vivek', 'Siddharth', 'Karthik', 'Arun', 'Sanjay', 'Mohan', 'Abdul', 'Deepak', 'Rajesh', 'Varun', 'Kiran', 'Prakash', 'Yusuf', 'Ganesh'];
  const last = ['Kulkarni', 'Narayan', 'Menon', 'Ghosh', 'Sheikh', 'Reddy', 'Bhat', 'Joshi', 'Iyer', "D'Souza", 'Verma', 'Kapoor', 'Patil', 'Teja', 'Rao', 'Das', 'Khan', 'Gowda', 'Shah', 'Singh', 'Thomas', 'Jain', 'Begum', 'Chauhan', 'Pillai', 'Bose', 'Mishra', 'Subramanian', 'Hegde', 'Naidu'];
  const cities: [string, string, string][] = [['Gandhi Nagar, Udumalpet', 'Tamil Nadu', '642126'], ['Palani Road, Udumalpet', 'Tamil Nadu', '642126'], ['Thali Road, Udumalpet', 'Tamil Nadu', '642126'], ['Madathukulam', 'Tamil Nadu', '642113'], ['Pollachi', 'Tamil Nadu', '642001'], ['Dharapuram', 'Tamil Nadu', '638656'], ['Tiruppur', 'Tamil Nadu', '641601']];
  const condPool = ['Type 2 diabetes', 'Hypertension', 'Asthma', 'Hypothyroidism', 'Osteoarthritis', 'Migraine', 'Coronary artery disease', 'GERD', 'Atopic dermatitis', 'PCOS', 'Chronic kidney disease stage 2', 'Hyperlipidaemia'];
  const allergyPool = ['Sulfonamides', 'Penicillin', 'NSAIDs', 'Peanuts', 'Latex', 'Iodinated contrast'];
  const bloods = ['O+', 'B+', 'A+', 'AB+', 'O-', 'B-', 'A-', 'AB-'];
  const relations = ['Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister'];
  const docForDept = (dept: string) => doctors.filter(d => d.deptId === dept);

  const patients: Patient[] = [];
  for (let i = 0; i < 50; i++) {
    const g: Patient['gender'] = i % 2 === 0 ? 'Male' : 'Female';
    const first = g === 'Female' ? female[(i / 2 | 0) % female.length] : male[(i / 2 | 0) % male.length];
    const name = `${first} ${last[(i * 7 + 3) % last.length]}`;
    let age = i % 9 === 4 ? int(2, 14) : int(19, 82);
    const dobY = new Date().getFullYear() - age;
    const conds = age < 15 ? (i % 3 === 0 ? ['Asthma'] : []) : rnd() < .62 ? [pick(condPool)].concat(rnd() < .3 ? [pick(condPool)] : []).filter((v, k, a) => a.indexOf(v) === k) : [];
    const allergies = rnd() < .28 ? [pick(allergyPool)] : [];
    let dept = age < 15 ? 'PE' : conds.includes('Coronary artery disease') || conds.includes('Hyperlipidaemia') ? 'CA' : conds.includes('Type 2 diabetes') || conds.includes('Hypothyroidism') ? (i % 2 ? 'EN' : 'GM') : conds.includes('Osteoarthritis') ? 'OR' : conds.includes('Atopic dermatitis') ? 'DE' : conds.includes('PCOS') && g === 'Female' ? 'GY' : pick(['GM', 'GM', 'OR', 'DE', g === 'Female' ? 'GY' : 'GM', 'CA']);
    const doc = pick(docForDept(dept));
    const c = cities[i % cities.length];
    const insured = rnd() < .45;
    patients.push({
      id: `HS-${pad(22 + (i % 5))}-${pad(1000 + i * 41, 5)}`, name, dob: `${dobY}-${pad(int(1, 12))}-${pad(int(1, 28))}`, gender: g,
      mobile: `+91 9${int(1, 9)}${pad(int(0, 99))}${pad(int(0, 99))} ${pad(int(0, 999), 3)}${pad(int(0, 99))}`,
      email: rnd() < .6 ? `${first.toLowerCase()}.${(i * 37 % 900) + 100}@example.com` : undefined,
      address: { line: `${int(1, 240)}, ${pick(['3rd Cross', '5th Main', '12th Cross', '2nd Stage', 'MG Road', 'Lake View Road', 'Temple Street'])}`, city: c[0], state: c[1], pin: c[2] },
      blood: bloods[i % bloods.length], allergies, conditions: conds,
      history: conds.length ? `Known case of ${conds.join(' and ').toLowerCase()} for ${int(1, 12)} years.` : 'No significant past medical history.',
      surgicalHistory: rnd() < .25 ? pick(['Appendectomy (2015)', 'Caesarean section (2018)', 'Knee arthroscopy (2021)', 'Cholecystectomy (2019)']) : 'None',
      familyHistory: pick(['Father: type 2 diabetes', 'Mother: hypertension', 'No significant family history', 'Father: coronary artery disease', 'Mother: hypothyroidism']),
      medications: conds.includes('Type 2 diabetes') ? 'Metformin 500 mg twice daily' : conds.includes('Hypertension') ? 'Amlodipine 5 mg once daily' : conds.includes('Hypothyroidism') ? 'Levothyroxine 50 mcg once daily' : 'None',
      emergency: { name: `${pick([...female, ...male])} ${last[(i * 7 + 3) % last.length]}`, relation: pick(relations), phone: `+91 98${pad(int(10, 99))}${pad(int(0, 99))} ${pad(int(0, 999), 3)}${pad(int(0, 99))}` },
      insurance: insured ? { providerId: pick(['IP1', 'IP2', 'IP3', 'IP4', 'IP5']), policyNo: `POL-DEMO-${int(100000, 999999)}`, validTill: T(int(60, 400)), sumInsured: pick([300000, 500000, 1000000]) } : undefined,
      abha: rnd() < .7 ? `91-${int(1000, 9999)}-${int(1000, 9999)}-${int(1000, 9999)}` : undefined,
      consent: rnd() < .9 ? 'Given' : 'Pending', registered: T(-int(1, 900)), primaryDoctorId: doc.id,
      documents: [{ id: 'DOC' + i + 'a', name: 'Consent form.pdf', type: 'Consent', date: T(-int(1, 300)), size: '184 KB' }].concat(rnd() < .5 ? [{ id: 'DOC' + i + 'b', name: 'Previous discharge summary.pdf', type: 'Report', date: T(-int(30, 400)), size: '412 KB' }] : []),
      branchId: i % 7 === 5 ? 'BR3' : i % 5 === 4 ? 'BR2' : 'BR1',
    });
    void age; age = 0;
  }
  // Anchor patients used across demo flows
  Object.assign(patients[1], { name: 'Lakshmi Narayan', gender: 'Female', dob: `${new Date().getFullYear() - 58}-04-12`, conditions: ['Type 2 diabetes', 'Hypertension'], allergies: ['Sulfonamides'], primaryDoctorId: 'D01', medications: 'Metformin 500 mg twice daily; Amlodipine 5 mg once daily', history: 'Known case of type 2 diabetes for 8 years and hypertension for 5 years.' });
  Object.assign(patients[0], { name: 'Aarav Kulkarni', conditions: ['Asthma'], allergies: [], primaryDoctorId: 'D01' });
  Object.assign(patients[2], { name: 'Rohit Menon', gender: 'Male', dob: `${new Date().getFullYear() - 61}-08-02`, conditions: ['Coronary artery disease', 'Chronic kidney disease stage 2'], allergies: ['Iodinated contrast'], primaryDoctorId: 'D02' });
  patients[1].insurance = { providerId: 'IP1', policyNo: 'POL-DEMO-448120', validTill: T(210), sumInsured: 500000 };

  const age = (p: Patient) => new Date().getFullYear() - +p.dob.slice(0, 4);

  // Appointments: 100 across past 30 days, today and next 14 days
  const appointments: Appointment[] = [];
  const types: Appointment['type'][] = ['New consultation', 'Follow-up', 'Follow-up', 'Review', 'Procedure', 'Walk-in', 'Teleconsult'];
  const times = (doc: Doctor) => { const out: string[] = []; const [h0] = doc.start.split(':').map(Number); const [h1] = doc.end.split(':').map(Number); for (let h = h0; h < h1; h++) for (let m = 0; m < 60; m += doc.slotMin) if (h !== 13) out.push(`${pad(h)}:${pad(m)}`); return out; };
  const used = new Set<string>();
  const addAppt = (pIdx: number, dayOff: number, status: ApptStatus, docId?: string, time?: string) => {
    const p = patients[pIdx]; const doc = doctors.find(d => d.id === (docId || p.primaryDoctorId))!;
    let t = time || pick(times(doc)); let k = `${doc.id}|${T(dayOff)}|${t}`; let guard = 0;
    while (used.has(k) && guard++ < 40) { t = pick(times(doc)); k = `${doc.id}|${T(dayOff)}|${t}`; }
    used.add(k);
    const a: Appointment = { id: 'AP' + pad(appointments.length + 1, 4), patientId: p.id, doctorId: doc.id, deptId: doc.deptId, date: T(dayOff), time: t, duration: doc.slotMin, type: pIdx % 7 === 3 ? 'Walk-in' : pick(types), status, room: doc.room, reminderSent: dayOff >= 0 && rnd() < .7 };
    appointments.push(a); return a;
  };
  // Today: 30 appointments with a realistic mix of statuses
  const todayStatus: ApptStatus[] = ['Completed', 'Completed', 'Completed', 'Completed', 'Completed', 'Completed', 'Completed', 'Completed', 'In consultation', 'In consultation', 'In consultation', 'Waiting', 'Waiting', 'Waiting', 'Waiting', 'Waiting', 'Arrived', 'Arrived', 'Arrived', 'Confirmed', 'Confirmed', 'Confirmed', 'Confirmed', 'Scheduled', 'Scheduled', 'Scheduled', 'Scheduled', 'No-show', 'Cancelled', 'Scheduled'];
  const todayTimes = ['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '09:20', '09:40', '10:30', '10:40', '10:20', '10:45', '10:50', '11:00', '10:55', '11:10', '11:15', '11:20', '11:30', '11:45', '12:00', '12:15', '14:00', '14:15', '14:30', '15:00', '15:20', '09:10', '16:00', '16:30'];
  const todayPatients = [5, 0, 8, 11, 14, 17, 20, 23, 2, 26, 29, 1, 32, 35, 38, 3, 41, 44, 47, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];
  todayPatients.forEach((pi, k) => addAppt(pi, 0, todayStatus[k], k === 11 ? 'D01' : k === 8 ? 'D02' : undefined, todayTimes[k]));
  // Past 40
  for (let k = 0; k < 40; k++) addAppt(int(0, 49), -int(1, 30), pick<ApptStatus>(['Completed', 'Completed', 'Completed', 'Completed', 'No-show', 'Cancelled']));
  // Future 30
  for (let k = 0; k < 30; k++) addAppt(int(0, 49), int(1, 14), pick<ApptStatus>(['Scheduled', 'Confirmed', 'Confirmed', 'Scheduled']));
  appointments.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  // Tokens for today
  const prefix: Record<string, string> = { GM: 'G', CA: 'C', PE: 'P', OR: 'O', DE: 'D', GY: 'Y', EN: 'E', EM: 'X' };
  const tokCount: Record<string, number> = {};
  appointments.filter(a => a.date === T(0)).forEach(a => { tokCount[a.deptId] = (tokCount[a.deptId] || 0) + 1; a.token = `${prefix[a.deptId]}-${pad(tokCount[a.deptId], 3)}`; });

  // Queue for today's active patients
  const stepFor: Partial<Record<ApptStatus, number>> = { 'Arrived': 1, 'Waiting': 2, 'In consultation': 3 };
  const queue: QueueEntry[] = [];
  appointments.filter(a => a.date === T(0) && stepFor[a.status] !== undefined).forEach((a, k) => {
    const step = stepFor[a.status]!;
    queue.push({ token: a.token!, patientId: a.patientId, doctorId: a.doctorId, deptId: a.deptId, step: a.patientId === patients[1].id ? 3 : step, since: [4, 27, 9, 12, 31, 6, 14, 3, 19, 8, 22][k % 11], arrivedAt: a.time, priority: a.patientId === patients[2].id, emergency: false, appointmentId: a.id, history: [] });
  });
  // Patients further along the journey today (completed consults)
  appointments.filter(a => a.date === T(0) && a.status === 'Completed').slice(0, 5).forEach((a, k) => queue.push({ token: a.token!, patientId: a.patientId, doctorId: a.doctorId, deptId: a.deptId, step: [4, 4, 5, 5, 6][k], since: [38, 12, 5, 16, 1][k], arrivedAt: a.time, priority: false, emergency: false, appointmentId: a.id, history: [] }));
  queue.push({ token: 'G-090', patientId: patients[45].id, doctorId: 'D01', deptId: 'GM', step: 0, since: 2, arrivedAt: '11:05', priority: false, emergency: false, history: [] });

  // Medicines (50)
  const medDefs: [string, string, string, string, string, number][] = [
    ['Paracetamol', 'Calpol', '650 mg', 'Tablet', 'Analgesic', 2.2], ['Metformin', 'Glycomet', '500 mg', 'Tablet', 'Antidiabetic', 1.9], ['Glimepiride', 'Amaryl', '1 mg', 'Tablet', 'Antidiabetic', 6.5],
    ['Amlodipine', 'Amlong', '5 mg', 'Tablet', 'Antihypertensive', 3.1], ['Telmisartan', 'Telma', '40 mg', 'Tablet', 'Antihypertensive', 7.8], ['Atorvastatin', 'Atorva', '10 mg', 'Tablet', 'Lipid lowering', 6.9],
    ['Amoxicillin', 'Mox', '500 mg', 'Capsule', 'Antibiotic', 7.4], ['Amoxicillin + clavulanate', 'Augmentin', '625 mg', 'Tablet', 'Antibiotic', 19.6], ['Azithromycin', 'Azee', '500 mg', 'Tablet', 'Antibiotic', 21.5],
    ['Sulfamethoxazole + trimethoprim', 'Septran DS', '960 mg', 'Tablet', 'Antibiotic', 3.4], ['Cefixime', 'Taxim-O', '200 mg', 'Tablet', 'Antibiotic', 11.2], ['Ciprofloxacin', 'Ciplox', '500 mg', 'Tablet', 'Antibiotic', 4.8],
    ['Pantoprazole', 'Pan', '40 mg', 'Tablet', 'Antacid', 8.9], ['Omeprazole', 'Omez', '20 mg', 'Capsule', 'Antacid', 5.6], ['Ondansetron', 'Emeset', '4 mg', 'Tablet', 'Antiemetic', 5.2],
    ['Cetirizine', 'Okacet', '10 mg', 'Tablet', 'Antihistamine', 1.8], ['Levocetirizine', 'Levocet', '5 mg', 'Tablet', 'Antihistamine', 3.6], ['Montelukast', 'Montair', '10 mg', 'Tablet', 'Antiasthmatic', 14.5],
    ['Salbutamol', 'Asthalin', '100 mcg', 'Inhaler', 'Bronchodilator', 152], ['Budesonide + formoterol', 'Foracort', '200 mcg', 'Inhaler', 'Bronchodilator', 410], ['Levothyroxine', 'Thyronorm', '50 mcg', 'Tablet', 'Thyroid', 1.6],
    ['Ibuprofen', 'Brufen', '400 mg', 'Tablet', 'Analgesic', 1.4], ['Diclofenac', 'Voveran', '50 mg', 'Tablet', 'Analgesic', 2.1], ['Aceclofenac + paracetamol', 'Zerodol-P', '100/325 mg', 'Tablet', 'Analgesic', 5.8],
    ['Aspirin', 'Ecosprin', '75 mg', 'Tablet', 'Antiplatelet', 0.6], ['Clopidogrel', 'Clopilet', '75 mg', 'Tablet', 'Antiplatelet', 7.2], ['Metoprolol', 'Metolar XR', '25 mg', 'Tablet', 'Beta blocker', 6.1],
    ['Furosemide', 'Lasix', '40 mg', 'Tablet', 'Diuretic', 1.1], ['Insulin glargine', 'Basalog', '100 IU/ml', 'Injection', 'Antidiabetic', 760], ['Insulin regular', 'Actrapid', '40 IU/ml', 'Injection', 'Antidiabetic', 165],
    ['Ceftriaxone', 'Monocef', '1 g', 'Injection', 'Antibiotic', 58], ['Ondansetron', 'Emeset', '2 mg/ml', 'Injection', 'Antiemetic', 14], ['Normal saline', 'NS', '500 ml', 'IV fluid', 'IV fluid', 32],
    ['Ringer lactate', 'RL', '500 ml', 'IV fluid', 'IV fluid', 36], ['Dextrose 5%', 'D5', '500 ml', 'IV fluid', 'IV fluid', 34], ['Vitamin D3', 'Uprise D3', '60000 IU', 'Capsule', 'Supplement', 31],
    ['Calcium + vitamin D3', 'Shelcal', '500 mg', 'Tablet', 'Supplement', 5.9], ['Iron + folic acid', 'Autrin', '', 'Capsule', 'Supplement', 4.2], ['Multivitamin', 'Becosules', '', 'Capsule', 'Supplement', 2.3],
    ['ORS', 'Electral', '21.8 g', 'Sachet', 'Rehydration', 21], ['Domperidone', 'Domstal', '10 mg', 'Tablet', 'Antiemetic', 2.8], ['Prednisolone', 'Wysolone', '10 mg', 'Tablet', 'Steroid', 1.5],
    ['Hydrocortisone', 'Efcorlin', '100 mg', 'Injection', 'Steroid', 46], ['Clotrimazole', 'Candid', '1%', 'Cream', 'Antifungal', 92], ['Mupirocin', 'T-Bact', '2%', 'Ointment', 'Antibiotic', 148],
    ['Tretinoin', 'Retino-A', '0.025%', 'Cream', 'Dermatology', 210], ['Paracetamol', 'Calpol', '250 mg/5 ml', 'Syrup', 'Analgesic', 48], ['Amoxicillin', 'Mox', '250 mg/5 ml', 'Syrup', 'Antibiotic', 64],
    ['Folic acid', 'Folvite', '5 mg', 'Tablet', 'Supplement', 1.2], ['Enoxaparin', 'Clexane', '40 mg', 'Injection', 'Anticoagulant', 395],
  ];
  const suppliers: Supplier[] = [
    { id: 'SP1', name: 'Medisource Distributors (demo)', contact: 'Ravi Shankar', phone: '+91 422 4322 01', gst: '33AAAAA0001A1Z1', city: 'Coimbatore', type: 'Pharmacy', rating: 4.6 },
    { id: 'SP2', name: 'Southern Pharma Agencies (demo)', contact: 'Meena Iyer', phone: '+91 422 4322 02', gst: '33AAAAA0002A1Z2', city: 'Coimbatore', type: 'Pharmacy', rating: 4.2 },
    { id: 'SP3', name: 'SurgiCare Supplies (demo)', contact: 'Ajay Rao', phone: '+91 422 4322 03', gst: '33AAAAA0003A1Z3', city: 'Coimbatore', type: 'Surgical', rating: 4.4 },
    { id: 'SP4', name: 'MedEquip India (demo)', contact: 'Sunil Mathew', phone: '+91 44 4100 2204', gst: '33AAAAA0004A1Z4', city: 'Chennai', type: 'Equipment', rating: 4.1 },
    { id: 'SP5', name: 'CleanCo Facility Supplies (demo)', contact: 'Fathima N', phone: '+91 422 4322 05', gst: '33AAAAA0005A1Z5', city: 'Coimbatore', type: 'General', rating: 3.9 },
  ];
  const medicines: Medicine[] = medDefs.map((m, i) => {
    const nb = i % 4 === 0 ? 2 : 1;
    const batches = Array.from({ length: nb }, (_, b) => ({ batch: `${m[1].slice(0, 3).toUpperCase()}${pad(24 + b)}${pad(int(10, 99))}`, expiry: T(i % 9 === 2 && b === 0 ? int(10, 55) : int(120, 700)), qty: i % 11 === 6 ? int(8, 30) : int(60, 900), supplierId: i % 2 ? 'SP1' : 'SP2', cost: +(m[5] * .72).toFixed(2), received: T(-int(10, 200)) }));
    batches.sort((a, b) => a.expiry.localeCompare(b.expiry));
    return { id: 'M' + pad(i + 1, 3), generic: m[0], brand: m[1], strength: m[2], form: m[3], category: m[4], route: m[3] === 'Injection' || m[3] === 'IV fluid' ? 'IV/IM' : m[3] === 'Inhaler' ? 'Inhalation' : ['Cream', 'Ointment'].includes(m[3]) ? 'Topical' : 'Oral', price: m[5], reorder: m[5] > 100 ? 15 : 100, rack: `${String.fromCharCode(65 + (i % 6))}-${pad((i % 8) + 1)}`, batches, schedule: ['Antibiotic', 'Steroid'].includes(m[4]) ? 'H' : undefined };
  });
  medicines[6].batches = [{ batch: 'MOX2411', expiry: T(38), qty: 36, supplierId: 'SP1', cost: 5.3, received: T(-150) }, { batch: 'MOX2507', expiry: T(320), qty: 2, supplierId: 'SP1', cost: 5.3, received: T(-20) }];

  // Lab tests (30)
  const lt = (id: string, code: string, name: string, category: string, sample: string, price: number, tat: number, params: LabTest['params']): LabTest => ({ id, code, name, category, sample, price, tatHours: tat, params });
  const labTests: LabTest[] = [
    lt('L01', 'CBC', 'Complete blood count', 'Haematology', 'EDTA blood', 350, 4, [{ name: 'Haemoglobin', unit: 'g/dL', low: 12, high: 16, critLow: 7 }, { name: 'Total WBC count', unit: '×10³/µL', low: 4, high: 11, critHigh: 30 }, { name: 'Platelet count', unit: '×10³/µL', low: 150, high: 410, critLow: 50 }, { name: 'RBC count', unit: '×10⁶/µL', low: 4.2, high: 5.4 }, { name: 'Haematocrit', unit: '%', low: 36, high: 46 }]),
    lt('L02', 'FBS', 'Fasting blood glucose', 'Biochemistry', 'Fluoride plasma', 120, 2, [{ name: 'Glucose, fasting', unit: 'mg/dL', low: 70, high: 100, critLow: 50, critHigh: 400 }]),
    lt('L03', 'PPBS', 'Post-prandial blood glucose', 'Biochemistry', 'Fluoride plasma', 120, 2, [{ name: 'Glucose, 2 h post meal', unit: 'mg/dL', low: 70, high: 140, critHigh: 450 }]),
    lt('L04', 'HBA1C', 'HbA1c', 'Biochemistry', 'EDTA blood', 550, 6, [{ name: 'HbA1c', unit: '%', low: 4, high: 5.6 }, { name: 'Estimated average glucose', unit: 'mg/dL', low: 68, high: 114 }]),
    lt('L05', 'LIPID', 'Lipid profile', 'Biochemistry', 'Serum', 650, 6, [{ name: 'Total cholesterol', unit: 'mg/dL', low: 0, high: 200 }, { name: 'Triglycerides', unit: 'mg/dL', low: 0, high: 150 }, { name: 'HDL cholesterol', unit: 'mg/dL', low: 40, high: 90 }, { name: 'LDL cholesterol', unit: 'mg/dL', low: 0, high: 100 }, { name: 'VLDL cholesterol', unit: 'mg/dL', low: 5, high: 40 }]),
    lt('L06', 'TFT', 'Thyroid profile', 'Immunoassay', 'Serum', 600, 8, [{ name: 'T3', unit: 'ng/dL', low: 80, high: 200 }, { name: 'T4', unit: 'µg/dL', low: 5.1, high: 14.1 }, { name: 'TSH', unit: 'µIU/mL', low: 0.27, high: 4.2 }]),
    lt('L07', 'LFT', 'Liver function test', 'Biochemistry', 'Serum', 700, 6, [{ name: 'Total bilirubin', unit: 'mg/dL', low: 0.3, high: 1.2 }, { name: 'Direct bilirubin', unit: 'mg/dL', low: 0, high: 0.3 }, { name: 'SGOT (AST)', unit: 'U/L', low: 5, high: 40 }, { name: 'SGPT (ALT)', unit: 'U/L', low: 7, high: 56 }, { name: 'Alkaline phosphatase', unit: 'U/L', low: 44, high: 147 }, { name: 'Albumin', unit: 'g/dL', low: 3.5, high: 5 }]),
    lt('L08', 'KFT', 'Kidney function test', 'Biochemistry', 'Serum', 650, 6, [{ name: 'Urea', unit: 'mg/dL', low: 15, high: 40 }, { name: 'Creatinine', unit: 'mg/dL', low: 0.6, high: 1.2, critHigh: 6 }, { name: 'Uric acid', unit: 'mg/dL', low: 3.4, high: 7 }, { name: 'Sodium', unit: 'mmol/L', low: 135, high: 145, critLow: 120, critHigh: 160 }, { name: 'Potassium', unit: 'mmol/L', low: 3.5, high: 5.1, critLow: 2.8, critHigh: 6 }]),
    lt('L09', 'URINE', 'Urine routine analysis', 'Clinical pathology', 'Urine', 200, 3, [{ name: 'pH', unit: '', low: 4.5, high: 8 }, { name: 'Specific gravity', unit: '', low: 1.005, high: 1.03 }, { name: 'Pus cells', unit: '/hpf', low: 0, high: 5 }, { name: 'RBCs', unit: '/hpf', low: 0, high: 2 }, { name: 'Protein', unit: 'mg/dL', low: 0, high: 14 }]),
    lt('L10', 'ESR', 'Erythrocyte sedimentation rate', 'Haematology', 'EDTA blood', 150, 2, [{ name: 'ESR', unit: 'mm/hr', low: 0, high: 20 }]),
    lt('L11', 'CRP', 'C-reactive protein', 'Immunoassay', 'Serum', 450, 4, [{ name: 'CRP', unit: 'mg/L', low: 0, high: 6 }]),
    lt('L12', 'VITD', 'Vitamin D (25-OH)', 'Immunoassay', 'Serum', 1400, 24, [{ name: '25-OH vitamin D', unit: 'ng/mL', low: 30, high: 100 }]),
    lt('L13', 'B12', 'Vitamin B12', 'Immunoassay', 'Serum', 900, 24, [{ name: 'Vitamin B12', unit: 'pg/mL', low: 211, high: 911 }]),
    lt('L14', 'TROP', 'Troponin I', 'Immunoassay', 'Serum', 1200, 1, [{ name: 'Troponin I', unit: 'ng/mL', low: 0, high: 0.04, critHigh: 0.4 }]),
    lt('L15', 'PTINR', 'Prothrombin time / INR', 'Haematology', 'Citrate plasma', 400, 3, [{ name: 'PT', unit: 'sec', low: 11, high: 13.5 }, { name: 'INR', unit: '', low: 0.8, high: 1.2, critHigh: 4.5 }]),
    lt('L16', 'DENG', 'Dengue NS1 antigen', 'Serology', 'Serum', 600, 4, [{ name: 'NS1 index', unit: '', low: 0, high: 0.9 }]),
    lt('L17', 'WIDAL', 'Widal test', 'Serology', 'Serum', 250, 4, [{ name: 'S. typhi O titre', unit: '1:', low: 0, high: 80 }]),
    lt('L18', 'MAL', 'Malaria parasite (smear)', 'Haematology', 'EDTA blood', 200, 2, [{ name: 'Parasite index', unit: '%', low: 0, high: 0 }]),
    lt('L19', 'ELEC', 'Serum electrolytes', 'Biochemistry', 'Serum', 450, 3, [{ name: 'Sodium', unit: 'mmol/L', low: 135, high: 145, critLow: 120, critHigh: 160 }, { name: 'Potassium', unit: 'mmol/L', low: 3.5, high: 5.1, critLow: 2.8, critHigh: 6 }, { name: 'Chloride', unit: 'mmol/L', low: 98, high: 107 }]),
    lt('L20', 'CALC', 'Serum calcium', 'Biochemistry', 'Serum', 250, 4, [{ name: 'Calcium', unit: 'mg/dL', low: 8.6, high: 10.3, critLow: 6.5, critHigh: 13 }]),
    lt('L21', 'IRON', 'Iron studies', 'Biochemistry', 'Serum', 900, 8, [{ name: 'Serum iron', unit: 'µg/dL', low: 60, high: 170 }, { name: 'Ferritin', unit: 'ng/mL', low: 20, high: 250 }]),
    lt('L22', 'UACR', 'Urine albumin-creatinine ratio', 'Biochemistry', 'Urine', 550, 6, [{ name: 'ACR', unit: 'mg/g', low: 0, high: 30 }]),
    lt('L23', 'BHCG', 'Beta hCG', 'Immunoassay', 'Serum', 750, 6, [{ name: 'Beta hCG', unit: 'mIU/mL', low: 0, high: 5 }]),
    lt('L24', 'PSA', 'Prostate specific antigen', 'Immunoassay', 'Serum', 800, 8, [{ name: 'Total PSA', unit: 'ng/mL', low: 0, high: 4 }]),
    lt('L25', 'HBSAG', 'HBsAg', 'Serology', 'Serum', 350, 4, [{ name: 'HBsAg index', unit: '', low: 0, high: 0.9 }]),
    lt('L26', 'HIV', 'HIV 1 & 2 antibodies', 'Serology', 'Serum', 450, 4, [{ name: 'Index', unit: '', low: 0, high: 0.9 }]),
    lt('L27', 'STOOL', 'Stool routine', 'Clinical pathology', 'Stool', 200, 4, [{ name: 'Ova / cysts', unit: '', low: 0, high: 0 }]),
    lt('L28', 'CULT', 'Urine culture', 'Microbiology', 'Urine', 700, 48, [{ name: 'Colony count', unit: 'CFU/mL ×10³', low: 0, high: 10 }]),
    lt('L29', 'ABG', 'Arterial blood gas', 'Biochemistry', 'Arterial blood', 900, 1, [{ name: 'pH', unit: '', low: 7.35, high: 7.45, critLow: 7.2, critHigh: 7.6 }, { name: 'pO₂', unit: 'mmHg', low: 80, high: 100, critLow: 55 }, { name: 'pCO₂', unit: 'mmHg', low: 35, high: 45 }]),
    lt('L30', 'MHC', 'Master health check (profile)', 'Profile', 'Blood + urine', 2999, 24, []),
  ];
  labTests[29].profile = ['L01', 'L02', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09'];

  const statusPool: LabOrder['status'][] = ['Ordered', 'Awaiting sample', 'Sample collected', 'Processing', 'Result ready', 'Verified', 'Delivered'];
  const fill = (t: LabTest, abnormal = false) => Object.fromEntries(t.params.map(p => [p.name, +(p.low + (p.high - p.low) * (abnormal && rnd() < .5 ? 1.25 : .2 + rnd() * .6)).toFixed(p.high < 2 ? 2 : 1)]));
  const labOrders: LabOrder[] = [];
  for (let k = 0; k < 26; k++) {
    const p = patients[(k * 3 + 1) % 50]; const st = k < 4 ? 'Ordered' : k < 8 ? 'Awaiting sample' : k < 11 ? 'Sample collected' : k < 14 ? 'Processing' : k < 17 ? 'Result ready' : k < 21 ? 'Verified' : 'Delivered';
    const tests = k % 5 === 0 ? ['L04', 'L02'] : k % 5 === 1 ? ['L01'] : k % 5 === 2 ? ['L05'] : k % 5 === 3 ? ['L08', 'L19'] : ['L06'];
    const day = k < 17 ? 0 : -int(1, 12);
    const results: LabOrder['results'] = {};
    if (statusPool.indexOf(st) >= 4) tests.forEach(t => results[t] = fill(labTests.find(x => x.id === t)!, k % 3 === 0));
    labOrders.push({ id: 'LO' + pad(5100 + k, 5), patientId: p.id, doctorId: p.primaryDoctorId, testIds: tests, date: T(day), time: `${pad(8 + (k % 8))}:${pad((k * 13) % 60)}`, status: st, priority: k % 7 === 0 ? 'Urgent' : k === 15 ? 'STAT' : 'Routine', sampleId: statusPool.indexOf(st) >= 2 ? 'SMP' + pad(88000 + k * 7, 6) : undefined, collectedAt: statusPool.indexOf(st) >= 2 ? `${pad(9 + (k % 6))}:${pad((k * 7) % 60)}` : undefined, collectedBy: statusPool.indexOf(st) >= 2 ? 'Nisha (phlebotomy)' : undefined, results, verifiedBy: statusPool.indexOf(st) >= 5 ? 'Dr. Meghana Rao (Pathologist)' : undefined, billed: k % 6 !== 2 });
  }
  // Lakshmi's HbA1c history + Rohit's critical potassium
  labOrders.push({ id: 'LO05090', patientId: patients[1].id, doctorId: 'D01', testIds: ['L04', 'L02'], date: T(-6), time: '08:40', status: 'Delivered', priority: 'Routine', sampleId: 'SMP087910', collectedAt: '08:45', collectedBy: 'Nisha (phlebotomy)', results: { L04: { 'HbA1c': 8.1, 'Estimated average glucose': 186 }, L02: { 'Glucose, fasting': 156 } }, verifiedBy: 'Dr. Meghana Rao (Pathologist)', billed: true });
  labOrders.push({ id: 'LO05091', patientId: patients[1].id, doctorId: 'D01', testIds: ['L04'], date: T(-98), time: '09:10', status: 'Delivered', priority: 'Routine', sampleId: 'SMP081200', results: { L04: { 'HbA1c': 7.4, 'Estimated average glucose': 166 } }, verifiedBy: 'Dr. Meghana Rao (Pathologist)', billed: true });
  labOrders.push({ id: 'LO05092', patientId: patients[2].id, doctorId: 'D02', testIds: ['L08'], date: T(0), time: '08:20', status: 'Result ready', priority: 'Urgent', sampleId: 'SMP088990', collectedAt: '08:25', collectedBy: 'Nisha (phlebotomy)', results: { L08: { 'Urea': 48, 'Creatinine': 1.6, 'Uric acid': 6.8, 'Sodium': 136, 'Potassium': 6.2 } }, billed: true });

  const imaging: ImagingOrder[] = [
    ['X-ray', 'Chest PA view', 'Scheduled', 600], ['CT', 'CT brain plain', 'Awaiting report', 3500], ['MRI', 'MRI lumbar spine', 'Scheduled', 7500], ['Ultrasound', 'USG abdomen and pelvis', 'In progress', 1500],
    ['X-ray', 'X-ray right knee AP/lateral', 'Reported', 700], ['Ultrasound', 'Obstetric scan (anomaly)', 'Verified', 2200], ['CT', 'CT coronary angiography', 'Ordered', 9500], ['X-ray', 'X-ray chest PA', 'Verified', 600],
    ['MRI', 'MRI brain with contrast', 'Ordered', 9000], ['Ultrasound', 'Thyroid ultrasound', 'Awaiting report', 1400], ['X-ray', 'X-ray lumbosacral spine', 'Scheduled', 700], ['CT', 'HRCT chest', 'Reported', 5200],
  ].map((r, k) => ({
    id: 'IM' + pad(3300 + k, 5), patientId: patients[(k * 4 + 2) % 50].id, doctorId: patients[(k * 4 + 2) % 50].primaryDoctorId, modality: r[0] as ImagingOrder['modality'], study: r[1] as string, date: T(k < 9 ? 0 : -int(1, 9)), slot: `${pad(9 + (k % 8))}:${k % 2 ? '30' : '00'}`, room: r[0] === 'X-ray' ? 'XR-1' : r[0] === 'CT' ? 'CT-1' : r[0] === 'MRI' ? 'MR-1' : 'US-2', status: r[2] as ImagingOrder['status'],
    technician: ['Scheduled', 'Ordered'].includes(r[2] as string) ? undefined : pick(['Vinod (radiographer)', 'Sharmila (sonographer)', 'Akash (CT technologist)']), radiologist: ['Reported', 'Verified'].includes(r[2] as string) ? 'Dr. Farah Siddiqui (Radiologist)' : undefined,
    findings: ['Reported', 'Verified'].includes(r[2] as string) ? 'Lung fields are clear. Cardiac silhouette is within normal limits. No pleural effusion. Bony thorax is unremarkable.' : undefined,
    impression: ['Reported', 'Verified'].includes(r[2] as string) ? 'No acute cardiopulmonary abnormality.' : undefined, billed: k !== 6, price: r[3] as number, priority: k === 1 ? 'Urgent' : 'Routine'
  }));

  // Consultations + prescriptions (30)
  const consultations: Consultation[] = []; const prescriptions: Prescription[] = [];
  const dxFor = (p: Patient) => p.conditions.includes('Type 2 diabetes') ? { code: 'E11.65', label: 'Type 2 diabetes mellitus with hyperglycaemia' } : p.conditions.includes('Hypertension') ? { code: 'I10', label: 'Essential (primary) hypertension' } : p.conditions.includes('Asthma') ? { code: 'J45.909', label: 'Asthma, unspecified, uncomplicated' } : p.conditions.includes('Osteoarthritis') ? { code: 'M17.11', label: 'Primary osteoarthritis, right knee' } : pick([{ code: 'J06.9', label: 'Acute upper respiratory infection, unspecified' }, { code: 'R50.9', label: 'Fever, unspecified' }, { code: 'M54.5', label: 'Low back pain' }, { code: 'K21.9', label: 'Gastro-oesophageal reflux disease' }]);
  const rxFor = (dx: string) => dx.startsWith('E11') ? ['M002', 'M005'] : dx === 'I10' ? ['M004', 'M005'] : dx.startsWith('J45') ? ['M019', 'M018'] : dx.startsWith('M17') ? ['M024', 'M037'] : dx.startsWith('J06') ? ['M001', 'M016'] : dx.startsWith('R50') ? ['M001'] : dx.startsWith('M54') ? ['M024', 'M013'] : ['M013', 'M041'];
  const doneAppts = appointments.filter(a => a.status === 'Completed').slice(0, 30);
  doneAppts.forEach((a, k) => {
    const p = patients.find(x => x.id === a.patientId)!; const dx = dxFor(p);
    const c: Consultation = { id: 'CN' + pad(7000 + k, 5), appointmentId: a.id, patientId: p.id, doctorId: a.doctorId, date: a.date, template: dx.code.startsWith('E11') ? 'Diabetes care' : 'General medicine', vitals: { bp: `${int(112, 150)}/${int(72, 94)}`, hr: int(66, 96), temp: 98.4, rr: 16, spo2: int(95, 99), height: int(150, 178), weight: int(48, 92) }, cc: pick(['Routine review', 'Fever and body ache for 3 days', 'Cough and cold', 'Knee pain while climbing stairs', 'Follow-up of sugar levels', 'Headache on and off']), hpi: '', pmh: p.history, fh: p.familyHistory || '', sh: 'Non-smoker. Occasional alcohol.', meds: p.medications || '', allergyNote: p.allergies.join(', ') || 'No known allergies', exam: 'General condition fair. Systemic examination within normal limits.', dx: [dx], assessment: '', plan: 'Continue medicines as advised. Review with reports.', notes: '', followUp: 'Review after 4 weeks with reports.', followUpDate: isoDay(28, new Date(a.date)), status: 'Completed', billed: k % 7 !== 3 };
    const items = rxFor(dx.code).map(id => { const m = medicines.find(x => x.id === id)!; return { medId: m.id, name: m.brand, generic: m.generic, strength: m.strength, dose: m.form === 'Inhaler' ? '2 puffs' : '1 ' + m.form.toLowerCase(), route: m.route, frequency: m.form === 'Inhaler' ? 'As needed (SOS)' : pick(['Once daily (1-0-0)', 'Twice daily (1-0-1)', 'Three times daily (1-1-1)']), duration: pick(['5 days', '7 days', '1 month']), qty: 10, food: pick(['After food', 'Before food']), instructions: '', refills: 0 }; });
    const rx: Prescription = { id: 'RX' + pad(9000 + k, 5), consultationId: c.id, patientId: p.id, doctorId: a.doctorId, date: a.date, diagnosis: `${dx.code} ${dx.label}`, items, status: a.date === T(0) ? (k % 2 ? 'Sent to pharmacy' : 'Signed') : 'Dispensed' };
    c.prescriptionId = rx.id; consultations.push(c); prescriptions.push(rx);
  });
  // Prescriptions awaiting pharmacy that trip the demo safety rules (for the clinical safety screen)
  const mkItem = (id: string, freq = 'Once daily (1-0-0)') => { const m = medicines.find(x => x.id === id)!; return { medId: m.id, name: m.brand, generic: m.generic, strength: m.strength, dose: '1 ' + m.form.toLowerCase(), route: m.route, frequency: freq, duration: '7 days', qty: 7, food: 'After food', instructions: '', refills: 0 }; };
  const asthmatic = patients.find(x => x.conditions.includes('Asthma') && x.id !== patients[1].id && x.id !== patients[2].id);
  prescriptions.push(
    { id: 'RX09101', patientId: patients[1].id, doctorId: 'D01', date: T(0), diagnosis: 'N39.0 Urinary tract infection', items: [mkItem('M010', 'Twice daily (1-0-1)'), mkItem('M003')], status: 'Sent to pharmacy' },
    { id: 'RX09102', patientId: patients[2].id, doctorId: 'D02', date: T(0), diagnosis: 'I25.10 Coronary artery disease', items: [mkItem('M005'), mkItem('M025'), mkItem('M026'), mkItem('M014'), mkItem('M022', 'Twice daily (1-0-1)')], status: 'Signed' },
  );
  if (asthmatic) prescriptions.push({ id: 'RX09103', patientId: asthmatic.id, doctorId: 'D01', date: T(-1), diagnosis: 'I10 Essential (primary) hypertension', items: [mkItem('M027'), mkItem('M019', 'As needed (SOS)')], status: 'Sent to pharmacy' });
  // Lakshmi prior consult
  consultations.push({ id: 'CN06990', patientId: patients[1].id, doctorId: 'D01', date: T(-93), template: 'Diabetes care', vitals: { bp: '138/88', hr: 80, temp: 98.2, rr: 16, spo2: 98, height: 161, weight: 72 }, cc: 'Diabetes review', hpi: 'Sugars mostly controlled. Occasional missed doses.', pmh: patients[1].history, fh: 'Mother: type 2 diabetes', sh: 'Vegetarian. Walks 20 minutes most days.', meds: patients[1].medications!, allergyNote: 'Sulfonamides', exam: 'Foot exam normal.', dx: [{ code: 'E11.9', label: 'Type 2 diabetes mellitus without complications' }, { code: 'I10', label: 'Essential (primary) hypertension' }], assessment: 'Fair control.', plan: 'Continue metformin 500 mg twice daily and amlodipine 5 mg once daily.', notes: '', followUp: 'Review in 3 months with HbA1c.', followUpDate: T(-3), status: 'Completed', billed: true });

  // Invoices (20+)
  const invoices: Invoice[] = [];
  const mkInv = (p: Patient, date: string, items: Invoice['items'], paidRatio: number, mode: Invoice['payments'][0]['mode'], kind: Invoice['kind'] = 'OPD', discount = 0): Invoice => {
    const total = items.reduce((t, i) => t + i.qty * i.rate * (1 + i.taxPct / 100), 0) * (1 - discount / 100);
    const paid = Math.round(total * paidRatio);
    const inv: Invoice = { id: 'INV-' + date.slice(2, 4) + date.slice(5, 7) + '-' + pad(invoices.length + 1, 4), patientId: p.id, date, items, discountPct: discount, payments: paid ? [{ id: 'PY' + (invoices.length + 1), date, mode, amount: paid, ref: mode === 'UPI' ? 'UPI-DEMO-' + int(100000, 999999) : undefined }] : [], refunds: [], status: paid >= Math.round(total) ? 'Paid' : paid ? 'Partially paid' : 'Unpaid', createdBy: 'Arun Prakash', kind };
    invoices.push(inv); return inv;
  };
  consultations.slice(0, 18).filter(c => c.billed).forEach((c, k) => {
    const p = patients.find(x => x.id === c.patientId)!; const d = doctors.find(x => x.id === c.doctorId)!;
    const items: Invoice['items'] = [{ desc: `Consultation, ${departments.find(x => x.id === d.deptId)!.name} (${d.name})`, category: 'Consultation', qty: 1, rate: d.fee, taxPct: 0, refId: c.id }];
    if (k % 3 === 0) items.push({ desc: 'HbA1c', category: 'Laboratory', qty: 1, rate: 550, taxPct: 0 });
    if (k % 4 === 1) items.push({ desc: 'Pharmacy: dispensed medicines', category: 'Pharmacy', qty: 1, rate: int(180, 900), taxPct: 12 });
    mkInv(p, c.date, items, k % 5 === 2 ? 0 : k % 6 === 4 ? .5 : 1, pick(['UPI', 'UPI', 'Cash', 'Card']), 'OPD', k % 8 === 0 ? 10 : 0);
  });
  mkInv(patients[1], T(-93), [{ desc: 'Consultation, General medicine (Dr. Sana Iqbal)', category: 'Consultation', qty: 1, rate: 700, taxPct: 0 }, { desc: 'HbA1c', category: 'Laboratory', qty: 1, rate: 550, taxPct: 0 }, { desc: 'Fasting blood glucose', category: 'Laboratory', qty: 1, rate: 120, taxPct: 0 }], 1, 'UPI');

  // Daily billing activity for the last 7 days so finance views have a realistic shape.
  for (let dd = -6; dd <= 0; dd++) {
    const n = dd === 0 ? 9 : int(10, 16);
    for (let k = 0; k < n; k++) {
      const p = patients[int(3, patients.length - 1)]; const d = doctors[int(0, doctors.length - 1)]; const r = rnd();
      const kind: Invoice['kind'] = r < .5 ? 'OPD' : r < .75 ? 'Pharmacy' : 'Lab';
      const items: Invoice['items'] = kind === 'OPD' ? [{ desc: `Consultation (${d.name})`, category: 'Consultation', qty: 1, rate: d.fee, taxPct: 0 }]
        : kind === 'Pharmacy' ? [{ desc: 'Pharmacy: dispensed medicines', category: 'Pharmacy', qty: 1, rate: int(160, 2400), taxPct: 12 }]
        : [{ desc: pick(['Complete blood count', 'Lipid profile', 'Thyroid profile', 'Kidney function test', 'HbA1c']), category: 'Laboratory', qty: 1, rate: pick([350, 650, 700, 550, 900]), taxPct: 0 }];
      mkInv(p, T(dd), items, dd === 0 && k > 6 ? 0 : 1, pick(['UPI', 'UPI', 'UPI', 'Cash', 'Card']), kind);
    }
  }

  const providers: InsuranceProvider[] = [
    { id: 'IP1', name: 'Star Health (demo)', tpa: 'In-house', type: 'Insurer', phone: '1800-000-0001', cashless: true },
    { id: 'IP2', name: 'HDFC ERGO (demo)', tpa: 'Medi Assist (demo)', type: 'Insurer', phone: '1800-000-0002', cashless: true },
    { id: 'IP3', name: 'Niva Bupa (demo)', tpa: 'In-house', type: 'Insurer', phone: '1800-000-0003', cashless: true },
    { id: 'IP4', name: 'PM-JAY / Ayushman Bharat (demo)', tpa: 'State Health Agency (demo)', type: 'Government', phone: '14555', cashless: true },
    { id: 'IP5', name: 'Corporate: Infotech Ltd (demo)', tpa: 'Paramount TPA (demo)', type: 'Corporate', phone: '1800-000-0005', cashless: false },
  ];

  // Wards & beds (20)
  const wards: Ward[] = [
    { id: 'W1', name: 'General ward A', type: 'General', floor: '2nd floor', rate: 1800 },
    { id: 'W2', name: 'Private rooms', type: 'Private', floor: '3rd floor', rate: 4500 },
    { id: 'W3', name: 'ICU', type: 'ICU', floor: '1st floor', rate: 9500 },
    { id: 'W4', name: 'Maternity', type: 'Maternity', floor: '3rd floor', rate: 3500 },
    { id: 'W5', name: 'Pediatric ward', type: 'Pediatric', floor: '2nd floor', rate: 2200 },
  ];
  const bedPlan: [string, number][] = [['W1', 7], ['W2', 4], ['W3', 4], ['W4', 3], ['W5', 2]];
  const beds: Bed[] = [];
  bedPlan.forEach(([w, n]) => { for (let b = 1; b <= n; b++) beds.push({ id: `${w}-B${b}`, wardId: w, label: `${w === 'W3' ? 'ICU' : w === 'W2' ? 'P' : w === 'W4' ? 'M' : w === 'W5' ? 'PD' : 'GA'}-${pad(b)}`, status: 'Available' }); });
  const admissions: Admission[] = [];
  const admitIdx = [2, 10, 16, 22, 28, 34, 40, 13, 19, 46];
  const occBeds = ['W3-B1', 'W1-B1', 'W1-B2', 'W1-B4', 'W2-B1', 'W2-B3', 'W3-B2', 'W4-B1', 'W5-B1', 'W1-B6'];
  const reasons: [string, string, string][] = [['Chest pain, NSTEMI ruled in', 'I21.4 Non-ST elevation myocardial infarction', 'CA'], ['Community-acquired pneumonia', 'J18.9 Pneumonia, unspecified', 'GM'], ['Dengue fever with thrombocytopenia', 'A97.1 Dengue with warning signs', 'GM'], ['Uncontrolled diabetes, DKA resolved', 'E11.10 Type 2 diabetes with ketoacidosis', 'EN'], ['Total knee replacement, right', 'M17.11 Primary osteoarthritis, right knee', 'OR'], ['Acute gastroenteritis with dehydration', 'A09 Infectious gastroenteritis', 'GM'], ['COPD exacerbation on NIV', 'J44.1 COPD with acute exacerbation', 'GM'], ['Term pregnancy, LSCS', 'O82 Caesarean delivery', 'GY'], ['Bronchiolitis', 'J21.9 Acute bronchiolitis', 'PE'], ['Cellulitis left leg', 'L03.116 Cellulitis of left lower limb', 'GM']];
  admitIdx.forEach((pi, k) => {
    const p = patients[pi]; const r = reasons[k]; const doc = docForDept(r[2])[0];
    const a: Admission = { id: 'IPD-' + pad(2400 + k, 5), patientId: p.id, doctorId: doc.id, deptId: r[2], bedId: occBeds[k], admittedOn: T(-[3, 2, 4, 1, 5, 1, 2, 1, 3, 6][k]), reason: r[0], diagnosis: r[1], type: k === 7 ? 'Maternity' : k === 0 || k === 3 ? 'Emergency' : 'Planned', status: k === 5 || k === 9 ? 'Discharge planned' : 'Admitted', expectedDischarge: T([2, 2, 1, 2, 2, 0, 3, 2, 1, 0][k]), advance: [50000, 20000, 15000, 25000, 80000, 10000, 30000, 40000, 10000, 15000][k], nurseId: 'S0' + (1 + (k % 3)),
      notes: [{ id: 'N' + k + 'a', date: T(-1) + ' 09:30', author: doc.name, type: 'Doctor round', text: 'Patient comfortable. Vitals stable. Continue current management.' }, { id: 'N' + k + 'b', date: T(0) + ' 07:00', author: 'Nurse Rekha Pillai', type: 'Nursing', text: 'Slept well overnight. Oral intake adequate. No fresh complaints.' }],
      mar: [{ id: 'MA' + k + '1', med: k === 0 ? 'Enoxaparin 40 mg' : 'Ceftriaxone 1 g', dose: k === 0 ? '40 mg' : '1 g', route: k === 0 ? 'SC' : 'IV', time: '08:00', date: T(0), status: 'Given', by: 'Nurse Rekha Pillai' }, { id: 'MA' + k + '2', med: 'Pantoprazole 40 mg', dose: '40 mg', route: 'IV', time: '08:00', date: T(0), status: 'Given', by: 'Nurse Rekha Pillai' }, { id: 'MA' + k + '3', med: 'Paracetamol 650 mg', dose: '650 mg', route: 'Oral', time: '14:00', date: T(0), status: 'Due' }, { id: 'MA' + k + '4', med: k === 0 ? 'Aspirin 75 mg' : 'Ceftriaxone 1 g', dose: k === 0 ? '75 mg' : '1 g', route: k === 0 ? 'Oral' : 'IV', time: '20:00', date: T(0), status: 'Due' }],
      io: [{ id: 'IO' + k + '1', time: '06:00', kind: 'Intake', type: 'IV fluids', ml: 500 }, { id: 'IO' + k + '2', time: '08:00', kind: 'Intake', type: 'Oral', ml: 250 }, { id: 'IO' + k + '3', time: '09:00', kind: 'Output', type: 'Urine', ml: 400 }],
      obs: ['02:00', '06:00', '10:00'].map((t, j) => ({ time: t, bp: `${int(110, 140)}/${int(70, 90)}`, hr: int(72, 104) + (k === 6 ? 8 : 0), temp: +(98 + rnd() * (k === 2 ? 3 : 1.2)).toFixed(1), spo2: k === 6 ? 91 + j : int(95, 99), rr: k === 6 ? 24 - j : int(14, 20), pain: int(0, 4), news: k === 6 ? 6 - j : int(0, 3) })),
      carePlan: ['Monitor vitals every 4 hours', 'Strict intake and output charting', 'Fall-risk precautions', k === 2 ? 'Platelet count every 12 hours' : 'Encourage mobilisation as tolerated'] };
    admissions.push(a);
    const bed = beds.find(b => b.id === a.bedId)!; bed.status = 'Occupied'; bed.admissionId = a.id;
  });
  beds.find(b => b.id === 'W1-B3')!.status = 'Cleaning';
  beds.find(b => b.id === 'W2-B2')!.status = 'Reserved';
  beds.find(b => b.id === 'W3-B4')!.status = 'Maintenance';
  beds.find(b => b.id === 'W1-B7')!.status = 'Cleaning';
  invoices.push({ id: 'INV-IPD-2404', patientId: patients[28].id, date: T(-5), items: [{ desc: 'Private room × 5 days', category: 'Room', qty: 5, rate: 4500, taxPct: 0 }, { desc: 'Total knee replacement package', category: 'OT', qty: 1, rate: 185000, taxPct: 0 }, { desc: 'Implant: knee prosthesis', category: 'Procedure', qty: 1, rate: 68000, taxPct: 5 }, { desc: 'Pharmacy and consumables', category: 'Pharmacy', qty: 1, rate: 14200, taxPct: 12 }], discountPct: 0, payments: [{ id: 'PYADV', date: T(-5), mode: 'Advance', amount: 80000 }], refunds: [], status: 'Partially paid', admissionId: 'IPD-02404', createdBy: 'Billing desk', kind: 'IPD' });

  const claims: Claim[] = [
    { id: 'CLM-3101', patientId: patients[28].id, invoiceId: 'INV-IPD-2404', admissionId: 'IPD-02404', providerId: 'IP2', policyNo: 'POL-DEMO-781102', claimed: 285000, approved: 240000, copay: 10, status: 'Approved', type: 'Pre-authorisation', created: T(-5), docs: ['Pre-auth form', 'Doctor notes', 'X-ray knee', 'ID proof'], history: [{ date: T(-5), status: 'Submitted', note: 'Pre-auth submitted with estimate' }, { date: T(-4), status: 'Under review', note: 'Query: implant invoice requested' }, { date: T(-3), status: 'Approved', note: 'Approved ₹2,40,000; 10% co-pay' }] },
    { id: 'CLM-3102', patientId: patients[10].id, admissionId: 'IPD-02401', providerId: 'IP1', policyNo: 'POL-DEMO-200114', claimed: 64000, approved: 0, copay: 0, status: 'Under review', type: 'Pre-authorisation', created: T(-2), docs: ['Pre-auth form', 'Chest X-ray', 'CBC report'], history: [{ date: T(-2), status: 'Submitted', note: 'Submitted' }, { date: T(-1), status: 'Under review', note: 'With insurer medical team' }] },
    { id: 'CLM-3103', patientId: patients[16].id, admissionId: 'IPD-02402', providerId: 'IP4', policyNo: 'PMJAY-DEMO-55120', claimed: 22000, approved: 22000, copay: 0, status: 'Settled', type: 'Final claim', created: T(-20), docs: ['Discharge summary', 'Bills'], history: [{ date: T(-20), status: 'Submitted', note: '' }, { date: T(-12), status: 'Approved', note: '' }, { date: T(-4), status: 'Settled', note: 'UTR DEMO88112' }] },
    { id: 'CLM-3104', patientId: patients[22].id, providerId: 'IP3', policyNo: 'POL-DEMO-339870', claimed: 41500, approved: 0, copay: 0, status: 'Rejected', type: 'Final claim', created: T(-14), docs: ['Discharge summary', 'Bills'], rejectionReason: 'Pre-existing condition within waiting period (demo)', history: [{ date: T(-14), status: 'Submitted', note: '' }, { date: T(-9), status: 'Rejected', note: 'Waiting period clause' }] },
    { id: 'CLM-3105', patientId: patients[1].id, providerId: 'IP1', policyNo: 'POL-DEMO-448120', claimed: 1370, approved: 0, copay: 0, status: 'Draft', type: 'Reimbursement', created: T(0), docs: ['OPD bill'], history: [] },
    { id: 'CLM-3106', patientId: patients[34].id, providerId: 'IP5', policyNo: 'CORP-DEMO-1102', claimed: 18400, approved: 0, copay: 0, status: 'Submitted', type: 'Final claim', created: T(-1), docs: ['Discharge summary', 'Bills', 'Lab reports'], history: [{ date: T(-1), status: 'Submitted', note: '' }] },
  ];

  const surgeries: Surgery[] = [
    { proc: 'Total knee replacement, right', p: 28, doc: 'D04', room: 'OT-1', off: 0, start: '08:00', dur: 150, st: 'Recovery' },
    { proc: 'Laparoscopic cholecystectomy', p: 31, doc: 'D01', room: 'OT-2', off: 0, start: '11:00', dur: 90, st: 'In progress' },
    { proc: 'Knee arthroscopy, ACL reconstruction', p: 37, doc: 'D04', room: 'OT-1', off: 0, start: '12:30', dur: 120, st: 'Pre-op' },
    { proc: 'Lower segment caesarean section', p: 13, doc: 'D06', room: 'OT-3', off: 0, start: '15:00', dur: 60, st: 'Scheduled' },
    { proc: 'Coronary angiography', p: 2, doc: 'D02', room: 'Cath lab', off: 1, start: '10:00', dur: 45, st: 'Scheduled' },
    { proc: 'Hernia repair (mesh)', p: 43, doc: 'D01', room: 'OT-2', off: 1, start: '09:00', dur: 75, st: 'Scheduled' },
    { proc: 'Excision of lipoma', p: 48, doc: 'D05', room: 'OT-3', off: 2, start: '11:00', dur: 40, st: 'Scheduled' },
    { proc: 'Hysteroscopy', p: 25, doc: 'D06', room: 'OT-3', off: -1, start: '10:00', dur: 50, st: 'Completed' },
  ].map((x, k) => ({ id: 'OT' + pad(610 + k, 4), patientId: patients[x.p].id, surgeonId: x.doc, anaesthetist: pick(['Dr. Rakesh Hegde', 'Dr. Swathi Bhat']), room: x.room, date: T(x.off), start: x.start, durationMin: x.dur, procedure: x.proc, status: x.st as Surgery['status'], anaesthesia: x.proc.includes('caesarean') ? 'Spinal' : x.proc.includes('angiography') || x.proc.includes('lipoma') ? 'Local' : 'General',
    checklist: { 'Consent signed': true, 'Site marked': x.st !== 'Scheduled', 'Fasting confirmed': x.st !== 'Scheduled', 'Allergies checked': true, 'Blood arranged': x.dur > 60, 'Anaesthesia review': x.st !== 'Scheduled', 'Implants available': !x.proc.includes('knee') || x.st !== 'Scheduled' },
    timeline: x.st === 'Recovery' || x.st === 'Completed' ? [{ at: x.start, event: 'Patient in OT' }, { at: '08:20', event: 'Anaesthesia induced' }, { at: '08:35', event: 'Incision' }, { at: '10:15', event: 'Closure' }, { at: '10:30', event: 'Moved to recovery' }] : x.st === 'In progress' ? [{ at: x.start, event: 'Patient in OT' }, { at: '11:15', event: 'Anaesthesia induced' }, { at: '11:30', event: 'Incision' }] : [] }));

  const erCases: ERCase[] = [
    { id: 'ER-901', label: 'Unknown male, about 50 years', age: 50, gender: 'Male', arrival: '10:31', mode: 'Ambulance', triage: 'Red', complaint: 'Found unresponsive, road traffic accident', bay: 'Resus 1', doctorId: 'D08', vitals: { bp: '90/60', hr: 128, spo2: 88, gcs: 9, temp: 97.8 }, status: 'Under treatment', orders: ['CT brain plain', 'CBC', 'Blood group & crossmatch', 'IV fluids'] },
    { id: 'ER-902', patientId: patients[2].id, label: 'Rohit Menon', arrival: '09:55', mode: 'Walk-in', triage: 'Orange', complaint: 'Chest discomfort, sweating', bay: 'Bay 2', doctorId: 'D08', vitals: { bp: '150/96', hr: 104, spo2: 95, gcs: 15, temp: 98.4 }, status: 'Observation', orders: ['ECG', 'Troponin I', 'KFT'] },
    { id: 'ER-903', patientId: patients[38].id, label: patients[38].name, arrival: '10:48', mode: 'Walk-in', triage: 'Yellow', complaint: 'High fever with vomiting', bay: 'Bay 4', doctorId: 'D08', vitals: { bp: '108/70', hr: 112, spo2: 97, gcs: 15, temp: 102.6 }, status: 'Under treatment', orders: ['CBC', 'Dengue NS1'] },
    { id: 'ER-904', patientId: patients[41].id, label: patients[41].name, arrival: '11:02', mode: 'Walk-in', triage: 'Green', complaint: 'Cut on left hand', bay: 'Minor OT', vitals: { bp: '122/80', hr: 84, spo2: 99, gcs: 15, temp: 98.4 }, status: 'Waiting', orders: [] },
    { id: 'ER-905', patientId: patients[19].id, label: patients[19].name, arrival: '08:40', mode: 'Referred', triage: 'Orange', complaint: 'Breathlessness, known COPD', bay: 'Bay 1', doctorId: 'D08', vitals: { bp: '138/86', hr: 98, spo2: 90, gcs: 15, temp: 99.1 }, status: 'Admitted', orders: ['ABG', 'Chest X-ray', 'Nebulisation'] },
    { id: 'ER-906', patientId: patients[47].id, label: patients[47].name, arrival: '07:15', mode: 'Walk-in', triage: 'Green', complaint: 'Ankle sprain', bay: 'Bay 5', doctorId: 'D08', vitals: { bp: '118/76', hr: 78, spo2: 99, gcs: 15, temp: 98.2 }, status: 'Discharged', orders: ['X-ray ankle'] },
  ];

  const staff: StaffMember[] = [
    ['Rekha Pillai', 'Staff nurse (ward in-charge)', 'Nurse', 'GM', 'Morning'], ['Joseph Mathew', 'Staff nurse', 'Nurse', 'EM', 'Morning'], ['Anitha Rao', 'ICU nurse', 'Nurse', 'GM', 'Night'],
    ['Arun Prakash', 'Front office executive', 'Admin', 'GM', 'General'], ['Nisha Fernandes', 'Phlebotomist', 'Technician', 'GM', 'Morning'], ['Vinod Kumar', 'Radiographer', 'Technician', 'GM', 'Morning'],
    ['Farzana Ali', 'Pharmacist', 'Pharmacist', 'GM', 'Morning'], ['Santosh Gowda', 'Lab technologist', 'Technician', 'GM', 'Evening'], ['Meera Rao', 'Hospital administrator', 'Admin', 'GM', 'General'], ['Kiran Shetty', 'Billing executive', 'Admin', 'GM', 'General'],
  ].map((x, k) => ({ id: 'S' + pad(k + 1), name: x[0], role: x[1], category: x[2] as StaffMember['category'], deptId: x[3], phone: '+91 4252 23' + pad(3100 + k * 11, 4), email: x[0].toLowerCase().replace(/ /g, '.') + '@hospit.demo', shift: x[4] as StaffMember['shift'], status: k === 7 ? 'Off duty' : k === 5 ? 'On leave' : 'On duty', joined: T(-int(200, 2400)), salary: [42000, 38000, 46000, 28000, 26000, 34000, 40000, 32000, 120000, 30000][k], attendance: int(88, 100) }));
  doctors.forEach(d => staff.push({ id: 'SD' + d.id, name: d.name, role: 'Consultant, ' + departments.find(x => x.id === d.deptId)!.name, category: 'Doctor', deptId: d.deptId, phone: d.phone, email: d.email, shift: d.deptId === 'EM' ? 'Morning' : 'General', status: d.status === 'On leave' ? 'On leave' : 'On duty', joined: T(-int(300, 3000)), salary: 180000 + d.experience * 9000, attendance: int(90, 100), doctorId: d.id }));
  const leaves: LeaveRequest[] = [
    { id: 'LV1', staffId: 'S06', from: T(0), to: T(2), type: 'Sick', reason: 'Fever', status: 'Approved' },
    { id: 'LV2', staffId: 'SDD09', from: T(-1), to: T(1), type: 'Casual', reason: 'Family function', status: 'Approved' },
    { id: 'LV3', staffId: 'S02', from: T(6), to: T(8), type: 'Earned', reason: 'Travel', status: 'Pending' },
    { id: 'LV4', staffId: 'S05', from: T(10), to: T(10), type: 'Casual', reason: 'Personal work', status: 'Pending' },
  ];

  const inventory: InventoryItem[] = [
    ['Disposable syringe 5 ml', 'Consumables', 'pcs', 1800, 1000, 'Central store'], ['IV cannula 20G', 'Consumables', 'pcs', 340, 400, 'Central store'], ['Examination gloves (M)', 'Consumables', 'box', 64, 40, 'Central store'],
    ['Surgical gloves 7.0', 'Surgical supplies', 'pair', 220, 300, 'OT store'], ['Suture: vicryl 2-0', 'Surgical supplies', 'pcs', 90, 60, 'OT store'], ['Surgical gown (sterile)', 'Surgical supplies', 'pcs', 150, 100, 'OT store'],
    ['Face mask, 3-ply', 'Consumables', 'box', 38, 50, 'Central store'], ['N95 respirator', 'Consumables', 'pcs', 410, 200, 'Central store'], ['Gauze roll', 'Consumables', 'roll', 260, 150, 'Ward store'],
    ['Urine bag', 'Consumables', 'pcs', 120, 80, 'Ward store'], ['Foley catheter 16Fr', 'Consumables', 'pcs', 45, 60, 'Ward store'], ['ECG electrodes', 'Consumables', 'pack', 30, 25, 'Cardiology'],
    ['Pulse oximeter probe', 'Medical equipment', 'pcs', 12, 6, 'ICU'], ['BP cuff, adult', 'Medical equipment', 'pcs', 18, 10, 'Central store'], ['Infusion pump set', 'Consumables', 'pcs', 70, 60, 'ICU'],
    ['Bedsheet', 'Linen', 'pcs', 420, 300, 'Laundry'], ['Patient gown', 'Linen', 'pcs', 260, 200, 'Laundry'], ['Hand sanitiser 500 ml', 'Housekeeping', 'bottle', 95, 60, 'Central store'],
    ['Surface disinfectant 5 L', 'Housekeeping', 'can', 14, 20, 'Housekeeping'], ['A4 paper ream', 'General supplies', 'ream', 40, 30, 'Admin store'], ['Printer toner', 'General supplies', 'pcs', 3, 4, 'Admin store'],
    ['Blood collection tubes (EDTA)', 'Consumables', 'pcs', 900, 600, 'Laboratory'], ['Glucometer strips', 'Consumables', 'pack', 22, 30, 'Ward store'], ['Sterile dressing pad', 'Surgical supplies', 'pcs', 310, 200, 'OT store'], ['Oxygen mask, adult', 'Consumables', 'pcs', 55, 40, 'ICU'],
  ].map((x, k) => ({ id: 'INV' + pad(k + 1, 3), name: x[0] as string, category: x[1] as InventoryItem['category'], unit: x[2] as string, stock: x[3] as number, reorder: x[4] as number, location: x[5] as string, cost: [6, 28, 290, 32, 210, 180, 160, 45, 38, 42, 95, 260, 1400, 900, 120, 220, 260, 180, 1100, 260, 2400, 9, 650, 18, 70][k], expiry: k < 12 || k > 20 ? T(int(30, 700)) : undefined, supplierId: k < 12 ? 'SP3' : k < 15 ? 'SP4' : 'SP5' }));
  const assets: Asset[] = [
    ['Ventilator', 'Critical care', 'ICU'], ['Defibrillator', 'Critical care', 'ER'], ['Patient monitor', 'Critical care', 'ICU'], ['Ultrasound machine', 'Imaging', 'Radiology'], ['ECG machine (12 lead)', 'Diagnostics', 'Cardiology'],
    ['Infusion pump', 'Critical care', 'Ward A'], ['Autoclave', 'Sterilisation', 'CSSD'], ['X-ray unit (DR)', 'Imaging', 'Radiology'], ['Hematology analyser', 'Laboratory', 'Lab'], ['Wheelchair', 'Mobility', 'Front office'],
  ].map((x, k) => ({ id: 'AS' + pad(k + 1, 3), name: x[0], category: x[1], tag: 'HS-AST-' + pad(1200 + k * 3, 5), location: x[2], status: k === 3 ? 'Under maintenance' : k === 9 ? 'Available' : 'In use', purchased: T(-int(200, 2000)), value: [1450000, 320000, 280000, 1800000, 190000, 85000, 240000, 2600000, 1250000, 9000][k], nextService: T(k === 0 ? 6 : int(20, 180)) }));
  const purchaseOrders: PurchaseOrder[] = [
    { id: 'PO-1201', supplierId: 'SP1', date: T(-6), kind: 'Pharmacy', items: [{ itemId: 'M007', name: 'Mox 500 mg', qty: 500, cost: 5.3 }, { itemId: 'M002', name: 'Glycomet 500 mg', qty: 1000, cost: 1.4 }], status: 'Ordered', requestedBy: 'Farzana Ali', expected: T(1) },
    { id: 'PO-1202', supplierId: 'SP3', date: T(-3), kind: 'Inventory', items: [{ itemId: 'INV002', name: 'IV cannula 20G', qty: 500, cost: 28 }, { itemId: 'INV004', name: 'Surgical gloves 7.0', qty: 400, cost: 32 }], status: 'Approved', requestedBy: 'Store manager', expected: T(2) },
    { id: 'PO-1203', supplierId: 'SP2', date: T(-12), kind: 'Pharmacy', items: [{ itemId: 'M029', name: 'Basalog 100 IU/ml', qty: 40, cost: 547 }], status: 'Received', requestedBy: 'Farzana Ali' },
    { id: 'PO-1204', supplierId: 'SP5', date: T(-1), kind: 'Inventory', items: [{ itemId: 'INV019', name: 'Surface disinfectant 5 L', qty: 20, cost: 1100 }, { itemId: 'INV021', name: 'Printer toner', qty: 4, cost: 2400 }], status: 'Requested', requestedBy: 'Housekeeping' },
    { id: 'PO-1205', supplierId: 'SP4', date: T(-20), kind: 'Inventory', items: [{ itemId: 'INV013', name: 'Pulse oximeter probe', qty: 10, cost: 1400 }], status: 'Received', requestedBy: 'ICU in-charge' },
  ];
  const requisitions: Requisition[] = [
    { id: 'RQ-501', date: T(0), dept: 'ICU', items: [{ itemId: 'INV025', name: 'Oxygen mask, adult', qty: 10 }, { itemId: 'INV015', name: 'Infusion pump set', qty: 15 }], status: 'Pending', requestedBy: 'Anitha Rao' },
    { id: 'RQ-502', date: T(0), dept: 'OT', items: [{ itemId: 'INV005', name: 'Suture: vicryl 2-0', qty: 20 }], status: 'Approved', requestedBy: 'OT in-charge' },
    { id: 'RQ-503', date: T(-1), dept: 'General ward A', items: [{ itemId: 'INV009', name: 'Gauze roll', qty: 30 }, { itemId: 'INV011', name: 'Foley catheter 16Fr', qty: 10 }], status: 'Issued', requestedBy: 'Rekha Pillai' },
  ];
  const stockMoves: StockMove[] = [
    { id: 'SM1', date: T(-1) + ' 17:20', itemId: 'M001', name: 'Calpol 650 mg', kind: 'Dispense', qty: -30, ref: 'RX09003', by: 'Farzana Ali' },
    { id: 'SM2', date: T(-2) + ' 11:05', itemId: 'M029', name: 'Basalog 100 IU/ml', kind: 'Receipt', qty: 40, ref: 'PO-1203', by: 'Farzana Ali' },
    { id: 'SM3', date: T(-3) + ' 16:40', itemId: 'M019', name: 'Asthalin 100 mcg', kind: 'Adjustment', qty: -1, ref: 'ADJ-77', by: 'Farzana Ali', note: 'Damaged canister' },
    { id: 'SM4', date: T(-1) + ' 09:15', itemId: 'INV009', name: 'Gauze roll', kind: 'Issue', qty: -30, ref: 'RQ-503', by: 'Store manager' },
  ];

  const now = new Date(); const tm = (minAgo: number) => { const d = new Date(now.getTime() - minAgo * 60000); return `${isoDay(0, d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const notifications: NotificationMsg[] = [
    ['WhatsApp', 'Appointment reminder', 1, 'Reminder: your appointment with Dr. Sana Iqbal is today at 10:45. Token G-012.', 'Delivered', 90], ['SMS', 'Appointment confirmation', 5, 'Your appointment with Dr. Arjun Pillai is confirmed for tomorrow 11:00.', 'Delivered', 75],
    ['Email', 'Lab report ready', 10, 'Your lab report (HbA1c) is ready. View it in the patient portal.', 'Read', 60], ['WhatsApp', 'Payment reminder', 22, 'An amount of ₹1,250 is due on invoice INV-1103. Pay by UPI at the front desk or portal.', 'Sent', 45],
    ['SMS', 'Follow-up reminder', 14, 'Your follow-up with Dr. Rahul Verghese is due this week. Reply 1 to book.', 'Delivered', 40], ['In-app', 'Prescription', 1, 'Your prescription from Dr. Sana Iqbal is ready in the portal.', 'Read', 30],
    ['WhatsApp', 'Discharge', 16, 'Discharge summary and medicines list have been shared. Follow-up in 7 days.', 'Failed', 20], ['Email', 'Appointment confirmation', 30, 'Teleconsult link for your appointment is attached.', 'Queued', 5],
  ].map((x, k) => ({ id: 'NT' + pad(k + 1, 3), time: tm(x[5] as number), channel: x[0] as NotificationMsg['channel'], type: x[1] as NotificationMsg['type'], to: patients[x[2] as number].name + ' · ' + patients[x[2] as number].mobile, patientId: patients[x[2] as number].id, message: x[3] as string, status: x[4] as NotificationMsg['status'] }));
  const inbox: InAppNote[] = [
    { id: 'IN1', time: tm(3), title: 'Critical lab value', body: 'Potassium 6.2 mmol/L for Rohit Menon. Dr. Vikram Rao notified.', read: false, link: '/lab/results', icon: 'flask-conical', tone: 'r' },
    { id: 'IN2', time: tm(12), title: 'Cardiology running late', body: 'Average wait 41 minutes in Cardiology. 3 patients waiting.', read: false, link: '/queue', icon: 'clock', tone: 'a' },
    { id: 'IN3', time: tm(25), title: 'Pre-auth approved', body: 'HDFC ERGO approved ₹2,40,000 for knee replacement (CLM-3101).', read: false, link: '/insurance', icon: 'shield-check', tone: 'g' },
    { id: 'IN4', time: tm(48), title: 'Low stock', body: 'Mox 500 mg capsules below reorder level (38 left).', read: true, link: '/pharmacy/inventory', icon: 'pill', tone: 'a' },
    { id: 'IN5', time: tm(70), title: 'Bed ready', body: 'Bed GA-03 has been cleaned and can be allotted.', read: true, link: '/ipd/beds', icon: 'bed', tone: 'b' },
  ];
  const alerts: Alert[] = [
    ['Critical', 'Lab', 'Laboratory', 'Critical potassium 6.2 mmol/L', 'Rohit Menon, KFT. Inform treating doctor within 30 minutes.', 'Dr. Vikram Rao', 'Open', '/lab/results', 3],
    ['Critical', 'Clinical', 'Emergency', 'SpO₂ 88% in Resus 1', 'Unknown male, RTA. Airway team alerted.', 'Dr. Imran Qureshi', 'Acknowledged', '/emergency', 8],
    ['High', 'Operations', 'Cardiology', 'Wait time over 40 minutes', '3 patients waiting for Dr. Vikram Rao.', 'Arun Prakash', 'Open', '/queue', 12],
    ['High', 'Safety', 'Pharmacy', 'Allergy conflict blocked', 'Septran DS prescribed for a patient with sulfonamide allergy. Prescription held.', 'Farzana Ali', 'Resolved', '/clinical-safety', 35],
    ['Medium', 'Pharmacy', 'Pharmacy', 'Mox 500 mg below reorder level', '38 capsules left, reorder level 100.', 'Farzana Ali', 'Open', '/pharmacy/inventory', 48],
    ['Medium', 'Billing', 'Billing', 'Consultations without invoice', 'Completed consultations have no invoice yet.', 'Kiran Shetty', 'Open', '/revenue-leakage', 55],
    ['Medium', 'Bed', 'IPD', 'Discharge pending since morning', '2 patients marked for discharge, bills not settled.', 'Billing desk', 'Open', '/ipd', 80],
    ['Low', 'Pharmacy', 'Pharmacy', 'Batch nearing expiry', 'Batch MOX2411 expires in 38 days.', 'Farzana Ali', 'Acknowledged', '/pharmacy/inventory', 120],
    ['High', 'Clinical', 'IPD', 'NEWS score 6 for COPD patient', 'Bed ICU-02. Escalated to duty doctor.', 'Anitha Rao', 'Acknowledged', '/nursing', 18],
    ['Low', 'System', 'IT', 'WhatsApp message failed', 'Discharge message could not be delivered. Retry queued.', 'Front office', 'Open', '/notifications', 20],
    ['Medium', 'Operations', 'Radiology', 'CT report pending over 2 hours', 'CT brain for a patient in ER.', 'Dr. Farah Siddiqui', 'Open', '/radiology', 25],
    ['Low', 'Operations', 'Biomedical', 'Ventilator service due in 6 days', 'Asset HS-AST-01200.', 'Biomedical engineer', 'Open', '/inventory', 200],
  ].map((x, k) => ({ id: 'AL' + pad(k + 1, 3), time: tm(x[8] as number), priority: x[0] as Alert['priority'], category: x[1] as Alert['category'], dept: x[2] as string, title: x[3] as string, detail: x[4] as string, assignee: x[5] as string, status: x[6] as Alert['status'], link: x[7] as string }));

  const users: UserAccount[] = [
    ['Super Admin (demo)', 'super-admin'], ['Meera Rao', 'admin'], ['Dr. Sana Iqbal', 'doctor'], ['Dr. Vikram Rao', 'doctor'], ['Rekha Pillai', 'nurse'], ['Arun Prakash', 'receptionist'], ['Farzana Ali', 'pharmacist'],
    ['Santosh Gowda', 'lab-tech'], ['Dr. Farah Siddiqui', 'radiologist'], ['Kiran Shetty', 'billing'], ['Lavanya HR', 'hr'], ['Store manager', 'inventory'], ['Lakshmi Narayan', 'patient'], ['Dr. Rahul Verghese', 'doctor'],
  ].map((x, k) => ({ id: 'U' + pad(k + 1, 3), name: x[0], email: x[0].replace(/[^A-Za-z ]/g, '').trim().toLowerCase().replace(/ +/g, '.') + '@hospit.demo', roleId: x[1] as UserAccount['roleId'], branches: k === 0 || k === 1 ? ['BR1', 'BR2', 'BR3'] : ['BR1'], depts: [], status: k === 13 ? 'Invited' : k === 11 ? 'Suspended' : 'Active', lastLogin: k === 13 ? '' : tm(int(5, 3000)), mfa: k < 4 || k === 9 }));
  const audit: AuditLog[] = [];
  const acts: [string, string, string, AuditLog['risk']][] = [['Viewed', 'Patient record', 'Opened unified record', 'Normal'], ['Updated', 'Consultation', 'Saved consultation draft', 'Normal'], ['Created', 'Invoice', 'Created OPD invoice', 'Normal'], ['Exported', 'Patient list', 'Exported 48 rows to CSV', 'Sensitive'], ['Viewed', 'Lab report', 'Viewed HbA1c report', 'Normal'], ['Changed', 'Role permissions', 'Granted Billing: refunds', 'Sensitive'], ['Printed', 'Prescription', 'Printed prescription', 'Normal'], ['Viewed', 'Patient record', 'Viewed record outside assigned department', 'Flagged'], ['Deleted', 'Draft invoice', 'Deleted draft invoice', 'Sensitive'], ['Signed', 'Prescription', 'Signed and sent to pharmacy', 'Normal']];
  for (let k = 0; k < 30; k++) { const u = users[(k * 3) % 13]; const a = acts[k % acts.length]; audit.push({ id: 'AU' + pad(k + 1, 4), time: tm(k * 17 + 2), user: u.name, role: u.roleId, action: a[0], entity: a[1], detail: `${a[2]} · ${patients[(k * 7) % 50].id}`, ip: `10.20.${int(1, 9)}.${int(10, 240)}`, branch: k % 6 === 0 ? 'Pollachi' : 'Udumalpet', risk: a[3] }); }
  const logins: LoginEvent[] = users.slice(0, 13).map((u, k) => ({ id: 'LG' + k, time: tm(k * 31 + 4), user: u.name, role: u.roleId, ip: `10.20.${int(1, 9)}.${int(10, 240)}`, device: pick(['Chrome on Windows', 'Edge on Windows', 'Safari on iPad', 'Chrome on Android', 'Chrome on macOS']), result: k === 6 ? 'Failed' : k === 11 ? 'Locked' : 'Success' }));

  const integrations: Integration[] = [
    ['abdm', 'ABDM / ABHA', 'Government', 'Create and verify ABHA IDs, link health records and share consent-based data.', true, 'Connected', [['clientId', 'Client ID', 'SBX-DEMO-CAREFLOW'], ['secret', 'Client secret', '••••••••', true], ['hipId', 'HIP ID', 'HOSPIT-HIP-DEMO'], ['env', 'Environment', 'Sandbox']]],
    ['hl7', 'HL7 v2 interface', 'Interoperability', 'Send and receive ADT, ORM and ORU messages with external systems.', false, 'Not configured', [['host', 'MLLP host', ''], ['port', 'Port', '2575'], ['facility', 'Sending facility', 'HOSPIT']]],
    ['fhir', 'FHIR R4 server', 'Interoperability', 'Expose Patient, Encounter, Observation and MedicationRequest resources.', true, 'Connected', [['base', 'Base URL', 'https://fhir.sandbox.hospit.demo/r4'], ['auth', 'Auth type', 'SMART on FHIR'], ['scope', 'Scopes', 'patient/*.read']]],
    ['lis', 'Laboratory analysers (LIS)', 'Diagnostics', 'Receive results directly from haematology and biochemistry analysers.', true, 'Error', [['driver', 'Driver', 'ASTM over TCP'], ['ip', 'Analyser IP', '192.168.10.45'], ['port', 'Port', '5001']]],
    ['pacs', 'PACS / DICOM', 'Diagnostics', 'Send worklists to modalities and view images from the PACS.', true, 'Connected', [['aet', 'AE title', 'HOSPIT_RIS'], ['host', 'PACS host', 'pacs.local.demo'], ['port', 'Port', '104'], ['viewer', 'Viewer URL', 'https://viewer.local.demo']]],
    ['pay', 'Payment gateway', 'Payments', 'Collect UPI, card and net banking payments online and at the desk.', true, 'Connected', [['merchant', 'Merchant ID', 'MID-DEMO-55021'], ['key', 'API key', '••••••••', true], ['mode', 'Mode', 'Test']]],
    ['sms', 'SMS gateway', 'Messaging', 'DLT-registered SMS for reminders and OTPs.', true, 'Connected', [['sender', 'Sender ID', 'HOSPIT'], ['dlt', 'DLT entity ID', 'DEMO1100220033'], ['key', 'API key', '••••••••', true]]],
    ['email', 'Email (SMTP)', 'Messaging', 'Send reports, invoices and reminders by email.', true, 'Connected', [['host', 'SMTP host', 'smtp.demo.local'], ['port', 'Port', '587'], ['from', 'From address', 'no-reply@hospit.demo']]],
    ['wa', 'WhatsApp Business', 'Messaging', 'Approved templates for reminders, reports and discharge messages.', true, 'Error', [['waba', 'WABA ID', 'WABA-DEMO-8812'], ['phone', 'Phone number ID', 'PN-DEMO-1102'], ['token', 'Access token', '••••••••', true]]],
    ['ins', 'Insurance / TPA portal', 'Insurance', 'Submit pre-authorisations and track claims electronically.', false, 'Not configured', [['portal', 'Portal', 'NHCX sandbox'], ['participant', 'Participant code', '']]],
    ['acct', 'Accounting software', 'Finance', 'Push daily collections and invoices to the accounts system.', false, 'Disabled', [['system', 'System', 'Tally Prime'], ['company', 'Company name', 'HospitOS Healthcare Pvt Ltd (demo)']]],
    ['bio', 'Biometric attendance', 'Devices', 'Sync staff punches from fingerprint and face devices.', true, 'Connected', [['device', 'Device IP', '192.168.10.80'], ['sync', 'Sync every', '15 minutes']]],
    ['barcode', 'Barcode scanners', 'Devices', 'Scan patient wristbands, sample tubes and medicine strips.', true, 'Connected', [['mode', 'Input mode', 'Keyboard wedge'], ['prefix', 'Sample prefix', 'SMP']]],
    ['printer', 'Printers', 'Devices', 'Label, wristband, receipt and A4 report printers.', true, 'Connected', [['label', 'Label printer', 'Zebra ZD220 (Lab)'], ['receipt', 'Receipt printer', 'Thermal 80 mm (Front desk)'], ['a4', 'Report printer', 'HP LaserJet (Records)']]],
  ].map(x => ({ id: x[0] as string, name: x[1] as string, category: x[2] as string, description: x[3] as string, enabled: x[4] as boolean, status: x[5] as Integration['status'], lastSync: x[5] === 'Connected' ? tm(int(2, 90)) : undefined, fields: (x[6] as (string | boolean)[][]).map(f => ({ key: f[0] as string, label: f[1] as string, value: f[2] as string, secret: !!f[3] })) }));

  const workflows: Workflow[] = [
    { id: 'WF1', name: 'Lab result verified', enabled: true, runs: 214, lastRun: tm(14), steps: [{ kind: 'trigger', label: 'Lab result is verified', detail: 'Any test' }, { kind: 'action', label: 'Notify ordering doctor', detail: 'In-app' }, { kind: 'action', label: 'Publish to patient portal', detail: 'Report PDF' }, { kind: 'action', label: 'Create follow-up task', detail: 'Due in 7 days' }] },
    { id: 'WF2', name: 'Critical value escalation', enabled: true, runs: 9, lastRun: tm(3), steps: [{ kind: 'trigger', label: 'Result outside critical range', detail: 'Any parameter' }, { kind: 'action', label: 'Raise critical alert', detail: 'Alerts centre' }, { kind: 'condition', label: 'If not acknowledged in 15 min', detail: '' }, { kind: 'action', label: 'Call duty doctor', detail: 'SMS + call' }] },
    { id: 'WF3', name: 'Appointment reminder', enabled: true, runs: 1840, lastRun: tm(30), steps: [{ kind: 'trigger', label: 'Appointment is 24 hours away', detail: 'Scheduled or confirmed' }, { kind: 'action', label: 'Send WhatsApp reminder', detail: 'Template: appt_reminder_v2' }, { kind: 'condition', label: 'If not delivered', detail: '' }, { kind: 'action', label: 'Send SMS', detail: 'Fallback' }] },
    { id: 'WF4', name: 'Unbilled consultation', enabled: false, runs: 0, steps: [{ kind: 'trigger', label: 'Consultation completed', detail: '' }, { kind: 'condition', label: 'If no invoice in 30 min', detail: '' }, { kind: 'action', label: 'Flag in revenue leakage', detail: '' }, { kind: 'action', label: 'Notify billing desk', detail: 'In-app' }] },
  ];

  const followUps: FollowUp[] = [];
  consultations.forEach((c, k) => { if (!c.followUpDate) return; const due = c.followUpDate; const st: FollowUp['status'] = due < T(0) ? (k % 3 === 0 ? 'Completed' : 'Overdue') : k % 4 === 0 ? 'Booked' : 'Due'; followUps.push({ id: 'FU' + pad(k + 1, 3), patientId: c.patientId, doctorId: c.doctorId, due, reason: c.dx[0]?.label || 'Review', status: st, reminder: st === 'Booked' || st === 'Completed' ? 'Delivered' : k % 3 === 1 ? 'Sent' : k % 5 === 2 ? 'Failed' : 'Not sent' }); });
  const feedback: Feedback[] = [5, 4, 5, 3, 4, 5, 2, 4].map((r, k) => ({ id: 'FB' + k, patientId: patients[k * 5].id, date: T(-k * 2), rating: r, comment: ['Doctor explained everything clearly.', 'Waiting time could be shorter.', 'Very clean and well organised.', 'Billing took a long time.', 'Nurses were caring and quick.', 'Easy to book on WhatsApp.', 'Pharmacy queue was long.', 'Good experience overall.'][k], dept: ['General medicine', 'Cardiology', 'Pediatrics', 'Billing', 'IPD', 'Front desk', 'Pharmacy', 'Orthopedics'][k] }));

  const services: ServiceItem[] = [
    ...doctors.map(d => ({ id: 'SV-C' + d.id, name: `Consultation, ${departments.find(x => x.id === d.deptId)!.name} (${d.name})`, category: 'Consultation', price: d.fee, taxPct: 0, dept: d.deptId })),
    ...labTests.map(t => ({ id: 'SV-' + t.id, name: t.name, category: 'Laboratory', price: t.price, taxPct: 0 })),
    ...['X-ray chest PA|600|Imaging', 'Ultrasound abdomen|1500|Imaging', 'CT brain plain|3500|Imaging', 'MRI lumbar spine|7500|Imaging', 'ECG|400|Procedure', 'Dressing, small|250|Procedure', 'Nebulisation|200|Procedure', 'Suturing, minor|900|Procedure', 'Plaster application|1800|Procedure', 'Nursing charges (per day)|800|Nursing', 'Ambulance (within city)|1500|Other', 'Medical certificate|300|Other']
      .map((x, k) => { const [n, p, c] = x.split('|'); return { id: 'SV-P' + k, name: n, category: c, price: +p, taxPct: c === 'Other' ? 18 : 0 }; }),
  ];

  const config: HospitalConfig = {
    name: 'HospitOS Multispeciality Hospital', legalName: 'HospitOS Healthcare Pvt Ltd (demo)', gstin: '33AAACH0000A1Z5 (demo)', phone: '+91 4252 221000', email: 'hello@hospit.demo', address: 'Palani Road, Udumalpet, Tiruppur district, Tamil Nadu 642126', registration: 'TN-CE-DEMO-2024-0091',
    workingHours: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => ({ day: d, open: '08:00', close: d === 'Sun' ? '13:00' : '20:00', closed: false })),
    apptRules: { slotMin: 15, maxAdvanceDays: 60, allowOverbook: false, noShowAfterMin: 30, reminderHours: 24 },
    queueRules: { tokenPrefixByDept: true, delayAlertMin: 25, emergencyJumpsQueue: true, seniorPriority: true },
    notifyRules: [['appt_confirm', 'Appointment confirmation', 1, 0, 1, 1], ['appt_reminder', 'Appointment reminder', 1, 0, 1, 1], ['followup', 'Follow-up reminder', 1, 1, 1, 1], ['lab_ready', 'Lab report ready', 0, 1, 1, 1], ['payment', 'Payment reminder', 1, 0, 1, 0], ['rx', 'Prescription ready', 0, 0, 1, 1], ['discharge', 'Discharge summary', 0, 1, 1, 1]].map(x => ({ key: x[0] as string, label: x[1] as string, sms: !!x[2], email: !!x[3], whatsapp: !!x[4], inapp: !!x[5] })),
    taxes: [{ name: 'GST on pharmacy', rate: 12, appliesTo: 'Pharmacy (most medicines)' }, { name: 'GST on implants', rate: 5, appliesTo: 'Implants and devices' }, { name: 'GST on non-clinical services', rate: 18, appliesTo: 'Certificates, ambulance, cosmetic' }, { name: 'Healthcare services', rate: 0, appliesTo: 'Consultation, lab, imaging, room (exempt)' }],
  };
  void age;

  return { version: 3, seededOn: T(0), branches, departments, doctors, patients, appointments, queue, consultations, prescriptions, medicines, suppliers, purchaseOrders, stockMoves, labTests, labOrders, imaging, invoices, providers, claims, wards, beds, admissions, surgeries, erCases, staff, leaves, inventory, assets, requisitions, notifications, inbox, alerts, audit, logins, users, integrations, workflows, followUps, feedback, services, config };
}
