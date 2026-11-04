import { Injectable, signal } from '@angular/core';
import { buildSeed, isoDay, pad, SeedData, TODAY } from '../data/seed';
import {
  Admission, Alert, Appointment, ApptStatus, Bed, Channel, Claim, ClaimStatus, Consultation, ERCase, ImagingOrder, ImgStatus, Invoice, InvoiceItem,
  JOURNEY, LabOrder, LabStatus, Medicine, NotificationMsg, Patient, PayMode, Prescription, PurchaseOrder, QueueEntry, Surgery
} from '../models';

const KEY = 'hospit-hms:v6';

export interface DuplicateMatch { patient: Patient; score: number; reasons: string[]; }
export interface ConflictResult { ok: boolean; reason?: string; }

/** Central mock data store. All mutations persist to LocalStorage so demo changes survive a reload. */
@Injectable({ providedIn: 'root' })
export class StoreService {
  db: SeedData;
  /** Bumped on every change so signal-based views can react. */
  readonly rev = signal(0);
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.db = this.load();
  }

  private load(): SeedData {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw) as SeedData;
        if (d.version === 3 && d.seededOn === TODAY()) return d;
      }
    } catch { /* storage unavailable: fall back to fresh seed */ }
    return buildSeed();
  }

  changed() {
    this.rev.update(v => v + 1);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(this.db)); } catch { /* ignore */ } }, 250);
  }

  reset() { this.db = buildSeed(); try { localStorage.removeItem(KEY); } catch { /* ignore */ } this.changed(); }

  // ---------- helpers ----------
  today() { return TODAY(); }
  day(offset: number) { return isoDay(offset); }
  nowTime() { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  nowStamp() { return `${this.today()} ${this.nowTime()}`; }
  uid(prefix: string) { return prefix + Date.now().toString(36).toUpperCase().slice(-5) + Math.floor(Math.random() * 90 + 10); }

  patient(id?: string) { return this.db.patients.find(p => p.id === id); }
  doctor(id?: string) { return this.db.doctors.find(d => d.id === id); }
  dept(id?: string) { return this.db.departments.find(d => d.id === id); }
  med(id?: string) { return this.db.medicines.find(m => m.id === id); }
  test(id?: string) { return this.db.labTests.find(t => t.id === id); }
  bed(id?: string) { return this.db.beds.find(b => b.id === id); }
  ward(id?: string) { return this.db.wards.find(w => w.id === id); }
  provider(id?: string) { return this.db.providers.find(p => p.id === id); }
  supplier(id?: string) { return this.db.suppliers.find(s => s.id === id); }
  admissionFor(patientId: string) { return this.db.admissions.find(a => a.patientId === patientId && a.status !== 'Discharged'); }
  codes(ids: string[]) { return ids.map(t => this.test(t)?.code ?? t).join(', '); }
  names(ids: string[]) { return ids.map(t => this.test(t)?.name ?? t).join(', '); }
  pname(id?: string) { return this.patient(id)?.name ?? 'Unknown patient'; }
  dname(id?: string) { return this.doctor(id)?.name ?? '—'; }

  age(dob: string) {
    const d = new Date(dob), n = new Date();
    let a = n.getFullYear() - d.getFullYear();
    if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
    return Math.max(0, a);
  }
  stock(m: Medicine) { return m.batches.reduce((t, b) => t + b.qty, 0); }
  invoiceTotals(inv: Invoice) {
    const sub = inv.items.reduce((t, i) => t + i.qty * i.rate, 0);
    const discount = sub * inv.discountPct / 100;
    const tax = inv.items.reduce((t, i) => t + i.qty * i.rate * (1 - inv.discountPct / 100) * i.taxPct / 100, 0);
    const total = Math.round(sub - discount + tax);
    const paid = inv.payments.reduce((t, p) => t + p.amount, 0) - inv.refunds.reduce((t, p) => t + p.amount, 0);
    return { sub, discount, tax, total, paid, due: Math.max(0, total - paid) };
  }
  invoiceStatus(inv: Invoice): Invoice['status'] {
    if (inv.status === 'Cancelled' || inv.status === 'Draft') return inv.status;
    const t = this.invoiceTotals(inv);
    if (inv.refunds.length && t.paid <= 0) return 'Refunded';
    return t.paid >= t.total ? 'Paid' : t.paid > 0 ? 'Partially paid' : 'Unpaid';
  }

  log(action: string, entity: string, detail: string, risk: 'Normal' | 'Sensitive' | 'Flagged' = 'Normal') {
    const u = (() => { try { return JSON.parse(localStorage.getItem('hospit-hms:session') || '{}'); } catch { return {}; } })();
    this.db.audit.unshift({ id: this.uid('AU'), time: this.nowStamp(), user: u.userName || 'Demo user', role: u.roleId || 'admin', action, entity, detail, ip: '10.20.1.15', branch: 'Udumalpet', risk });
  }
  notify(channel: Channel, type: NotificationMsg['type'], patientId: string, message: string) {
    const p = this.patient(patientId);
    this.db.notifications.unshift({ id: this.uid('NT'), time: this.nowStamp(), channel, type, to: p ? `${p.name} · ${p.mobile}` : 'Unknown', patientId, message, status: 'Sent' });
    setTimeout(() => { const n = this.db.notifications[0]; if (n && n.status === 'Sent') { n.status = 'Delivered'; this.changed(); } }, 2500);
  }
  inboxPush(title: string, body: string, icon: string, tone: 'g' | 'a' | 'r' | 'b' | 'v', link?: string) {
    this.db.inbox.unshift({ id: this.uid('IN'), time: this.nowStamp(), title, body, read: false, link, icon, tone });
  }
  raiseAlert(a: Omit<Alert, 'id' | 'time' | 'status'>) {
    this.db.alerts.unshift({ ...a, id: this.uid('AL'), time: this.nowStamp(), status: 'Open' });
  }

  // ---------- patients ----------
  nextUhid() {
    const yy = String(new Date().getFullYear()).slice(2);
    const n = this.db.patients.length + 1001 + Math.floor(Math.random() * 50);
    return `HS-${yy}-${pad(n * 7 % 99999, 5)}`;
  }
  findDuplicates(name: string, mobile: string, dob?: string): DuplicateMatch[] {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
    const digits = (s: string) => s.replace(/\D/g, '').slice(-10);
    const n = norm(name), m = digits(mobile);
    const out: DuplicateMatch[] = [];
    for (const p of this.db.patients) {
      const reasons: string[] = []; let score = 0;
      const pn = norm(p.name);
      if (n.length > 3 && pn === n) { score += 60; reasons.push('Same name'); }
      else if (n.length > 3 && (pn.includes(n) || n.includes(pn) || this.similar(pn, n) > .8)) { score += 35; reasons.push('Similar name'); }
      if (m.length === 10 && digits(p.mobile) === m) { score += 40; reasons.push('Same mobile'); }
      if (dob && p.dob === dob) { score += 25; reasons.push('Same date of birth'); }
      if (score >= 40) out.push({ patient: p, score: Math.min(99, score), reasons });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 3);
  }
  private similar(a: string, b: string) {
    const bi = (s: string) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
    const A = bi(a), B = bi(b); let inter = 0; A.forEach(x => { if (B.has(x)) inter++; });
    return (2 * inter) / (A.size + B.size || 1);
  }
  addPatient(p: Omit<Patient, 'id' | 'registered' | 'documents' | 'branchId'>) {
    const patient: Patient = { ...p, id: this.nextUhid(), registered: this.today(), documents: [], branchId: 'BR1' };
    this.db.patients.unshift(patient);
    this.log('Created', 'Patient', `Registered ${patient.name} · ${patient.id}`);
    this.changed();
    return patient;
  }
  updatePatient(id: string, patch: Partial<Patient>) { const p = this.patient(id); if (!p) return; Object.assign(p, patch); this.log('Updated', 'Patient', `Updated ${p.name} · ${p.id}`); this.changed(); }

  // ---------- appointments ----------
  checkSlot(doctorId: string, date: string, time: string, duration: number, ignoreId?: string): ConflictResult {
    const d = this.doctor(doctorId); if (!d) return { ok: false, reason: 'Choose a doctor.' };
    const dayName = new Date(date + 'T00:00').toLocaleDateString('en-US', { weekday: 'short' });
    if (d.status === 'On leave' && date === this.today()) return { ok: false, reason: `${d.name} is on leave today.` };
    if (!d.days.includes(dayName)) return { ok: false, reason: `${d.name} does not consult on ${dayName}. Available ${d.days.join(', ')}.` };
    const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const s = toMin(time), e = s + duration;
    if (s < toMin(d.start) || e > toMin(d.end)) return { ok: false, reason: `${d.name} consults between ${d.start} and ${d.end}.` };
    if (s >= 13 * 60 && s < 14 * 60) return { ok: false, reason: 'This slot falls in the 1–2 pm lunch break.' };
    if (date === this.today() && s < toMin(this.nowTime()) - 5) return { ok: false, reason: 'This time has already passed today.' };
    const clash = this.db.appointments.find(a => a.id !== ignoreId && a.doctorId === doctorId && a.date === date && !['Cancelled', 'No-show'].includes(a.status) && toMin(a.time) < e && toMin(a.time) + a.duration > s);
    if (clash) return { ok: false, reason: `${d.name} already sees ${this.pname(clash.patientId)} at ${clash.time}.` };
    return { ok: true };
  }
  freeSlots(doctorId: string, date: string) {
    const d = this.doctor(doctorId); if (!d) return [];
    const out: string[] = []; const [h0] = d.start.split(':').map(Number); const [h1] = d.end.split(':').map(Number);
    for (let h = h0; h < h1; h++) for (let m = 0; m < 60; m += d.slotMin) { const t = `${pad(h)}:${pad(m)}`; if (this.checkSlot(doctorId, date, t, d.slotMin).ok) out.push(t); }
    return out;
  }
  private token(deptId: string) {
    const prefix: Record<string, string> = { GM: 'G', CA: 'C', PE: 'P', OR: 'O', DE: 'D', GY: 'Y', EN: 'E', EM: 'X' };
    const n = this.db.appointments.filter(a => a.date === this.today() && a.deptId === deptId && a.token).length + this.db.queue.filter(q => q.deptId === deptId && !q.appointmentId).length + 1;
    return `${prefix[deptId] || 'Q'}-${pad(n + 40, 3)}`;
  }
  book(a: Omit<Appointment, 'id' | 'deptId' | 'room' | 'status' | 'token'> & { status?: ApptStatus }) {
    const d = this.doctor(a.doctorId)!;
    const appt: Appointment = { ...a, id: this.uid('AP'), deptId: d.deptId, room: d.room, status: a.status || 'Scheduled', reminderSent: false };
    if (appt.date === this.today()) appt.token = this.token(d.deptId);
    this.db.appointments.push(appt);
    this.db.appointments.sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
    this.notify('WhatsApp', 'Appointment confirmation', a.patientId, `Your appointment with ${d.name} is booked for ${appt.date} at ${appt.time}${appt.token ? `. Token ${appt.token}` : ''}.`);
    this.log('Created', 'Appointment', `${this.pname(a.patientId)} with ${d.name} on ${appt.date} ${appt.time}`);
    if (a.recurring && a.recurring !== 'None') {
      const step = a.recurring === 'Weekly' ? 7 : a.recurring === 'Every 2 weeks' ? 14 : 28;
      for (let k = 1; k <= 3; k++) {
        const dt = isoDay(step * k, new Date(a.date + 'T00:00'));
        if (this.checkSlot(a.doctorId, dt, a.time, a.duration).ok) this.db.appointments.push({ ...appt, id: this.uid('AP'), date: dt, token: undefined, status: 'Scheduled' });
      }
    }
    this.changed();
    return appt;
  }
  setApptStatus(id: string, status: ApptStatus) {
    const a = this.db.appointments.find(x => x.id === id); if (!a) return;
    a.status = status;
    if (status === 'Arrived') this.checkIn(a);
    if (status === 'Cancelled') { this.db.queue = this.db.queue.filter(q => q.appointmentId !== a.id); this.notify('SMS', 'Appointment confirmation', a.patientId, `Your appointment on ${a.date} at ${a.time} has been cancelled.`); }
    if (status === 'Confirmed') this.notify('WhatsApp', 'Appointment confirmation', a.patientId, `Your appointment on ${a.date} at ${a.time} is confirmed.`);
    this.log('Updated', 'Appointment', `${this.pname(a.patientId)} marked ${status}`);
    this.changed();
  }
  reschedule(id: string, date: string, time: string) { const a = this.db.appointments.find(x => x.id === id); if (!a) return; a.date = date; a.time = time; a.status = 'Scheduled'; this.notify('SMS', 'Appointment confirmation', a.patientId, `Your appointment has moved to ${date} at ${time}.`); this.changed(); }
  sendReminder(id: string) { const a = this.db.appointments.find(x => x.id === id); if (!a) return; a.reminderSent = true; this.notify('WhatsApp', 'Appointment reminder', a.patientId, `Reminder: appointment with ${this.dname(a.doctorId)} on ${a.date} at ${a.time}.`); this.changed(); }
  checkIn(a: Appointment) {
    if (!a.token) a.token = this.token(a.deptId);
    if (!this.db.queue.some(q => q.appointmentId === a.id)) this.db.queue.push({ token: a.token, patientId: a.patientId, doctorId: a.doctorId, deptId: a.deptId, step: 1, since: 0, arrivedAt: this.nowTime(), priority: false, emergency: false, appointmentId: a.id, history: [{ step: 0, at: this.nowTime() }] });
    return a.token;
  }
  walkIn(patientId: string, doctorId: string) {
    const d = this.doctor(doctorId)!;
    const appt = this.book({ patientId, doctorId, date: this.today(), time: this.nowTime(), duration: d.slotMin, type: 'Walk-in', status: 'Arrived' });
    this.checkIn(appt); this.changed(); return appt;
  }

  // ---------- queue ----------
  moveQueue(token: string, step?: number) {
    const q = this.db.queue.find(x => x.token === token); if (!q) return;
    q.history.push({ step: q.step, at: this.nowTime() });
    q.step = step ?? Math.min(JOURNEY.length - 1, q.step + 1); q.since = 0;
    const a = this.db.appointments.find(x => x.id === q.appointmentId);
    if (a) { if (q.step === 2) a.status = 'Waiting'; if (q.step === 3) a.status = 'In consultation'; if (q.step >= 4 && a.status === 'In consultation') a.status = 'Completed'; }
    this.changed();
  }
  tickQueue() { this.db.queue.forEach(q => { if (q.step < 6) q.since++; }); this.changed(); }

  // ---------- consultation ----------
  draftFor(patientId: string, doctorId: string, apptId?: string): Consultation {
    let c = this.db.consultations.find(x => x.patientId === patientId && x.status === 'Draft');
    if (!c) {
      const p = this.patient(patientId)!;
      const prev = this.db.consultations.filter(x => x.patientId === patientId && x.status === 'Completed').sort((a, b) => b.date.localeCompare(a.date))[0];
      c = { id: this.uid('CN'), appointmentId: apptId, patientId, doctorId, date: this.today(), template: p.conditions.includes('Type 2 diabetes') ? 'Diabetes care' : 'General medicine', vitals: { bp: p.conditions.includes('Hypertension') ? '148/92' : '124/80', hr: 82, temp: 98.4, rr: 16, spo2: 98, height: prev?.vitals.height ?? 162, weight: prev?.vitals.weight ?? 68 }, cc: '', hpi: '', pmh: p.history, fh: p.familyHistory || '', sh: '', meds: p.medications || '', allergyNote: p.allergies.join(', ') || 'No known allergies', exam: '', dx: [], assessment: '', plan: '', notes: '', followUp: '', status: 'Draft', billed: false };
      this.db.consultations.push(c);
    }
    return c;
  }
  saveDraft(c: Consultation) { c.status = 'Draft'; this.log('Updated', 'Consultation', `Saved draft for ${this.pname(c.patientId)}`); this.changed(); }
  completeConsultation(c: Consultation, rx?: Prescription) {
    c.status = 'Completed';
    if (rx && rx.items.length) { rx.status = 'Sent to pharmacy'; rx.consultationId = c.id; if (!this.db.prescriptions.includes(rx)) this.db.prescriptions.unshift(rx); c.prescriptionId = rx.id; this.notify('In-app', 'Prescription', c.patientId, `Your prescription from ${this.dname(c.doctorId)} is available in the portal.`); }
    const q = this.db.queue.find(x => x.patientId === c.patientId && x.step <= 3);
    if (q) { q.history.push({ step: q.step, at: this.nowTime() }); q.step = rx?.items.length ? 5 : 6; q.since = 0; }
    const a = this.db.appointments.find(x => x.patientId === c.patientId && x.date === this.today() && !['Completed', 'Cancelled', 'No-show'].includes(x.status));
    if (a) { a.status = 'Completed'; c.appointmentId = a.id; }
    if (c.followUpDate) this.db.followUps.unshift({ id: this.uid('FU'), patientId: c.patientId, doctorId: c.doctorId, due: c.followUpDate, reason: c.dx[0]?.label || 'Review', status: 'Due', reminder: 'Not sent' });
    this.log('Signed', 'Consultation', `Completed consultation for ${this.pname(c.patientId)}`);
    this.changed();
  }

  // ---------- prescriptions & pharmacy ----------
  newRx(patientId: string, doctorId: string, diagnosis = ''): Prescription {
    return { id: this.uid('RX'), patientId, doctorId, date: this.today(), diagnosis, items: [], status: 'Draft' };
  }
  saveRx(rx: Prescription, status: Prescription['status']) {
    rx.status = status; if (!this.db.prescriptions.includes(rx)) this.db.prescriptions.unshift(rx);
    this.log('Signed', 'Prescription', `${status}: ${this.pname(rx.patientId)}`); this.changed();
  }
  /** First-expiry-first-out batch allocation for a quantity. */
  fefo(medId: string, qty: number) {
    const m = this.med(medId); if (!m) return [];
    const plan: { batch: string; expiry: string; take: number }[] = []; let left = qty;
    for (const b of [...m.batches].filter(b => b.qty > 0 && b.expiry >= this.today()).sort((a, b) => a.expiry.localeCompare(b.expiry))) {
      if (left <= 0) break; const take = Math.min(b.qty, left); plan.push({ batch: b.batch, expiry: b.expiry, take }); left -= take;
    }
    return plan;
  }
  dispense(rx: Prescription, lines: { medId: string; qty: number }[], mode: PayMode) {
    const items: InvoiceItem[] = [];
    let partial = false;
    for (const l of lines) {
      const m = this.med(l.medId); if (!m || l.qty <= 0) continue;
      const plan = this.fefo(l.medId, l.qty); const got = plan.reduce((t, p) => t + p.take, 0);
      if (got < l.qty) partial = true;
      plan.forEach(p => { const b = m.batches.find(x => x.batch === p.batch)!; b.qty -= p.take; });
      this.db.stockMoves.unshift({ id: this.uid('SM'), date: this.nowStamp(), itemId: m.id, name: `${m.brand} ${m.strength}`, kind: 'Dispense', qty: -got, ref: rx.id, by: 'Farzana Ali', note: plan.map(p => `${p.batch}×${p.take}`).join(', ') });
      items.push({ desc: `${m.brand} ${m.strength} (${m.generic})`, category: 'Pharmacy', qty: got, rate: m.price, taxPct: 12, refId: rx.id });
      if (this.stock(m) < m.reorder) this.raiseAlert({ priority: 'Medium', category: 'Pharmacy', dept: 'Pharmacy', title: `${m.brand} ${m.strength} below reorder level`, detail: `${this.stock(m)} left, reorder level ${m.reorder}.`, assignee: 'Farzana Ali', link: '/pharmacy/inventory' });
    }
    rx.status = partial ? 'Partially dispensed' : 'Dispensed';
    const inv = this.createInvoice(rx.patientId, items, 0, 'Pharmacy');
    const t = this.invoiceTotals(inv); this.pay(inv, mode, t.total);
    const q = this.db.queue.find(x => x.patientId === rx.patientId && x.step === 5); if (q) { q.step = 6; q.since = 0; }
    this.log('Dispensed', 'Prescription', `${rx.id} for ${this.pname(rx.patientId)}`);
    this.changed();
    return inv;
  }
  adjustStock(medId: string, batch: string, delta: number, note: string) {
    const m = this.med(medId)!; const b = m.batches.find(x => x.batch === batch); if (!b) return;
    b.qty = Math.max(0, b.qty + delta);
    this.db.stockMoves.unshift({ id: this.uid('SM'), date: this.nowStamp(), itemId: m.id, name: `${m.brand} ${m.strength}`, kind: 'Adjustment', qty: delta, ref: 'ADJ', by: 'Farzana Ali', note });
    this.log('Changed', 'Stock', `${m.brand} ${batch} ${delta > 0 ? '+' : ''}${delta}: ${note}`); this.changed();
  }
  receivePO(po: PurchaseOrder) {
    po.status = 'Received';
    po.items.forEach(i => {
      const m = this.med(i.itemId);
      if (m) { m.batches.push({ batch: `${m.brand.slice(0, 3).toUpperCase()}${new Date().getFullYear() % 100}${Math.floor(Math.random() * 90 + 10)}`, expiry: this.day(540), qty: i.qty, supplierId: po.supplierId, cost: i.cost, received: this.today() }); m.batches.sort((a, b) => a.expiry.localeCompare(b.expiry)); }
      const inv = this.db.inventory.find(x => x.id === i.itemId); if (inv) inv.stock += i.qty;
      this.db.stockMoves.unshift({ id: this.uid('SM'), date: this.nowStamp(), itemId: i.itemId, name: i.name, kind: 'Receipt', qty: i.qty, ref: po.id, by: 'Store' });
    });
    this.log('Received', 'Purchase order', po.id); this.changed();
  }

  // ---------- lab ----------
  orderLab(patientId: string, doctorId: string, testIds: string[], priority: LabOrder['priority'] = 'Routine', bill = true) {
    const o: LabOrder = { id: 'LO' + pad(5200 + this.db.labOrders.length, 5), patientId, doctorId, testIds, date: this.today(), time: this.nowTime(), status: 'Awaiting sample', priority, results: {}, billed: bill };
    this.db.labOrders.unshift(o);
    if (bill) this.createInvoice(patientId, testIds.map(t => { const x = this.test(t)!; return { desc: x.name, category: 'Laboratory' as const, qty: 1, rate: x.price, taxPct: 0, refId: o.id }; }), 0, 'Lab');
    const q = this.db.queue.find(x => x.patientId === patientId && x.step === 3); if (q) { /* patient goes to lab after consult */ }
    this.log('Created', 'Lab order', `${o.id} for ${this.pname(patientId)}: ${testIds.map(t => this.test(t)?.code).join(', ')}`);
    this.changed(); return o;
  }
  collectSample(o: LabOrder) { o.status = 'Sample collected'; o.sampleId = 'SMP' + pad(89000 + Math.floor(Math.random() * 999), 6); o.collectedAt = this.nowTime(); o.collectedBy = 'Nisha (phlebotomy)'; this.changed(); return o.sampleId; }
  setLabStatus(o: LabOrder, s: LabStatus) { o.status = s; this.changed(); }
  criticals(o: LabOrder) {
    const out: { test: string; param: string; value: number; unit: string; flag: string }[] = [];
    o.testIds.forEach(tid => { const t = this.test(tid); if (!t) return; t.params.forEach(p => { const v = o.results[tid]?.[p.name]; if (v == null) return; if ((p.critHigh != null && v >= p.critHigh) || (p.critLow != null && v <= p.critLow)) out.push({ test: t.name, param: p.name, value: v, unit: p.unit, flag: v >= (p.critHigh ?? Infinity) ? 'Critical high' : 'Critical low' }); }); });
    return out;
  }
  saveResults(o: LabOrder) { o.status = 'Result ready'; this.log('Updated', 'Lab result', `${o.id} results entered`); this.changed(); }
  verifyLab(o: LabOrder, by: string) {
    o.status = 'Verified'; o.verifiedBy = by;
    const crit = this.criticals(o);
    crit.forEach(c => {
      this.raiseAlert({ priority: 'Critical', category: 'Lab', dept: 'Laboratory', title: `Critical ${c.param} ${c.value} ${c.unit}`, detail: `${this.pname(o.patientId)}, ${c.test}. Inform ${this.dname(o.doctorId)}.`, assignee: this.dname(o.doctorId), link: '/lab/results' });
      this.inboxPush('Critical lab value', `${c.param} ${c.value} ${c.unit} for ${this.pname(o.patientId)}`, 'flask-conical', 'r', '/lab/results');
    });
    const wf = this.db.workflows.find(w => w.id === 'WF1');
    if (wf?.enabled) { wf.runs++; wf.lastRun = this.nowStamp(); this.inboxPush('Workflow: Lab result verified', `Doctor notified and report published for ${this.pname(o.patientId)}.`, 'workflow', 'v', '/admin/workflows'); }
    this.log('Verified', 'Lab result', `${o.id} verified by ${by}`);
    this.changed(); return crit;
  }
  deliverLab(o: LabOrder) { o.status = 'Delivered'; this.notify('WhatsApp', 'Lab report ready', o.patientId, `Your lab report (${o.testIds.map(t => this.test(t)?.name).join(', ')}) is ready.`); this.changed(); }

  // ---------- imaging ----------
  orderImaging(o: Omit<ImagingOrder, 'id' | 'status' | 'billed'>) {
    const x: ImagingOrder = { ...o, id: 'IM' + pad(3400 + this.db.imaging.length, 5), status: 'Scheduled', billed: true };
    this.db.imaging.unshift(x);
    this.createInvoice(o.patientId, [{ desc: o.study, category: 'Imaging', qty: 1, rate: o.price, taxPct: 0, refId: x.id }], 0, 'OPD');
    this.changed(); return x;
  }
  setImaging(o: ImagingOrder, s: ImgStatus, patch: Partial<ImagingOrder> = {}) { Object.assign(o, patch); o.status = s; if (s === 'Verified') this.notify('Email', 'Lab report ready', o.patientId, `Your ${o.study} report is ready.`); this.changed(); }

  // ---------- billing ----------
  createInvoice(patientId: string, items: InvoiceItem[], discountPct = 0, kind: Invoice['kind'] = 'OPD', admissionId?: string): Invoice {
    const d = new Date();
    const inv: Invoice = { id: `INV-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}-${pad(this.db.invoices.length + 101, 4)}`, patientId, date: this.today(), items, discountPct, payments: [], refunds: [], status: 'Unpaid', createdBy: 'Kiran Shetty', kind, admissionId };
    this.db.invoices.unshift(inv);
    items.forEach(i => {
      if (i.category === 'Consultation' && i.refId) { const c = this.db.consultations.find(x => x.id === i.refId); if (c) c.billed = true; }
      if (i.category === 'Laboratory' && i.refId) { const o = this.db.labOrders.find(x => x.id === i.refId); if (o) o.billed = true; }
    });
    this.log('Created', 'Invoice', `${inv.id} for ${this.pname(patientId)}`);
    this.changed(); return inv;
  }
  pay(inv: Invoice, mode: PayMode, amount: number, ref?: string) {
    inv.payments.push({ id: this.uid('PY'), date: this.today(), mode, amount: Math.round(amount), ref });
    inv.status = this.invoiceStatus(inv);
    const q = this.db.queue.find(x => x.patientId === inv.patientId && x.step === 1); if (q) { q.step = 2; q.since = 0; }
    this.log('Created', 'Payment', `${inv.id} ₹${Math.round(amount)} by ${mode}`);
    this.changed();
  }
  refund(inv: Invoice, amount: number, reason: string) { inv.refunds.push({ id: this.uid('RF'), date: this.today(), mode: 'Cash', amount: Math.round(amount), ref: reason }); inv.status = this.invoiceStatus(inv); this.log('Created', 'Refund', `${inv.id} ₹${amount}: ${reason}`, 'Sensitive'); this.changed(); }

  // ---------- insurance ----------
  setClaim(c: Claim, status: ClaimStatus, note = '', patch: Partial<Claim> = {}) { Object.assign(c, patch); c.status = status; c.history.push({ date: this.today(), status, note }); this.log('Updated', 'Claim', `${c.id} → ${status}`); this.changed(); }

  // ---------- IPD ----------
  admit(a: Omit<Admission, 'id' | 'notes' | 'mar' | 'io' | 'obs' | 'carePlan' | 'status'>) {
    const adm: Admission = { ...a, id: 'IPD-' + pad(2500 + this.db.admissions.length, 5), status: 'Admitted', notes: [{ id: this.uid('N'), date: this.nowStamp(), author: this.dname(a.doctorId), type: 'Progress', text: `Admitted for ${a.reason}.` }], mar: [], io: [], obs: [], carePlan: ['Monitor vitals every 4 hours', 'Fall-risk precautions'] };
    this.db.admissions.unshift(adm);
    const b = this.bed(a.bedId)!; b.status = 'Occupied'; b.admissionId = adm.id;
    if (a.advance) { const inv = this.createInvoice(a.patientId, [{ desc: 'Admission advance', category: 'Other', qty: 1, rate: 0, taxPct: 0 }], 0, 'IPD', adm.id); inv.payments.push({ id: this.uid('PY'), date: this.today(), mode: 'Advance', amount: a.advance }); }
    this.log('Created', 'Admission', `${adm.id} ${this.pname(a.patientId)} to ${b.label}`);
    this.changed(); return adm;
  }
  transferBed(adm: Admission, bedId: string) { const old = this.bed(adm.bedId); if (old) { old.status = 'Cleaning'; old.admissionId = undefined; } const nb = this.bed(bedId)!; nb.status = 'Occupied'; nb.admissionId = adm.id; adm.bedId = bedId; adm.notes.unshift({ id: this.uid('N'), date: this.nowStamp(), author: 'Ward clerk', type: 'Progress', text: `Transferred from ${old?.label} to ${nb.label}.` }); this.changed(); }
  discharge(adm: Admission, summary: string) {
    adm.status = 'Discharged'; adm.dischargeDate = this.today(); adm.dischargeSummary = summary;
    const b = this.bed(adm.bedId); if (b) { b.status = 'Cleaning'; b.admissionId = undefined; }
    const days = Math.max(1, Math.round((Date.now() - new Date(adm.admittedOn).getTime()) / 864e5));
    const w = this.ward(b?.wardId);
    this.createInvoice(adm.patientId, [{ desc: `${w?.name ?? 'Room'} × ${days} days`, category: 'Room', qty: days, rate: w?.rate ?? 1800, taxPct: 0 }, { desc: 'Nursing charges', category: 'Nursing', qty: days, rate: 800, taxPct: 0 }, { desc: 'Doctor visits', category: 'Consultation', qty: days, rate: 600, taxPct: 0 }], 0, 'IPD', adm.id);
    this.notify('WhatsApp', 'Discharge', adm.patientId, 'Your discharge summary and medicines list are ready. Follow-up in 7 days.');
    this.log('Updated', 'Admission', `${adm.id} discharged`); this.changed();
  }
  setBed(b: Bed, status: Bed['status']) { b.status = status; this.changed(); }

  // ---------- OT / ER ----------
  bookSurgery(s: Omit<Surgery, 'id' | 'status' | 'timeline' | 'checklist'>) {
    const x: Surgery = { ...s, id: 'OT' + pad(700 + this.db.surgeries.length, 4), status: 'Scheduled', timeline: [], checklist: { 'Consent signed': false, 'Site marked': false, 'Fasting confirmed': false, 'Allergies checked': false, 'Blood arranged': false, 'Anaesthesia review': false, 'Implants available': false } };
    this.db.surgeries.push(x); this.changed(); return x;
  }
  otClash(room: string, date: string, start: string, dur: number, ignore?: string) {
    const m = (t: string) => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm; };
    return this.db.surgeries.find(s => s.id !== ignore && s.room === room && s.date === date && s.status !== 'Cancelled' && m(s.start) < m(start) + dur && m(s.start) + s.durationMin > m(start));
  }
  advanceSurgery(s: Surgery) {
    const order: Surgery['status'][] = ['Scheduled', 'Pre-op', 'In progress', 'Recovery', 'Completed'];
    const i = order.indexOf(s.status); if (i < 0 || i >= order.length - 1) return;
    s.status = order[i + 1]; s.timeline.push({ at: this.nowTime(), event: { 'Pre-op': 'Pre-op checks started', 'In progress': 'Patient in OT, surgery started', 'Recovery': 'Moved to recovery', 'Completed': 'Shifted to ward' }[s.status as string] || s.status });
    this.changed();
  }
  registerER(c: Omit<ERCase, 'id' | 'arrival' | 'orders' | 'status'>) {
    const x: ERCase = { ...c, id: 'ER-' + (910 + this.db.erCases.length), arrival: this.nowTime(), status: 'Waiting', orders: [] };
    this.db.erCases.unshift(x);
    if (x.triage === 'Red') this.raiseAlert({ priority: 'Critical', category: 'Clinical', dept: 'Emergency', title: `Red triage: ${x.label}`, detail: x.complaint, assignee: 'Dr. Imran Qureshi', link: '/emergency' });
    this.log('Created', 'Emergency case', `${x.id} ${x.label}`); this.changed(); return x;
  }

  // ---------- generic ----------
  csv(rows: Record<string, unknown>[]) {
    if (!rows.length) return '';
    const cols = Object.keys(rows[0]);
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
  }
}
