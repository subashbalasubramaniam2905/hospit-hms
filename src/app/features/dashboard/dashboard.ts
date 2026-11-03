import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED, inr, inrShort } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { SessionService } from '../../core/services/session.service';
import { ToastService } from '../../core/services/toast.service';
import { JOURNEY } from '../../core/models';

interface Kpi { label: string; value: string | number; of?: string | number; trend?: string; tone: 'pri' | 'pink' | 'amber' | 'blue' | 'green' | 'red' | 'violet'; icon: string; link?: string; sub?: string; }

@Component({
  standalone: true, imports: [SHARED], templateUrl: './dashboard.html', styleUrl: './dashboard.scss'
})
export class DashboardPage {
  store = inject(StoreService); session = inject(SessionService); router = inject(Router); toast = inject(ToastService);
  journey = JOURNEY;
  kind = computed(() => this.session.role()?.dashboard ?? 'admin');
  greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })();
  firstName = computed(() => { const n = this.session.role()?.userName ?? ''; return n.startsWith('Dr.') ? 'Dr. ' + n.split(' ').slice(-1)[0] : n.split(' ')[0]; });
  revRange = signal<'6m' | '12m'>('12m');

  m = computed(() => {
    this.store.rev(); const db = this.store.db; const t = this.store.today();
    const todays = db.appointments.filter(a => a.date === t);
    const paidToday = db.invoices.flatMap(i => i.payments.filter(p => p.date === t && p.mode !== 'Advance')).reduce((s, p) => s + p.amount, 0);
    const outstanding = db.invoices.filter(i => i.status !== 'Cancelled').reduce((s, i) => s + this.store.invoiceTotals(i).due, 0);
    const beds = db.beds; const occ = beds.filter(b => b.status === 'Occupied').length; const avail = beds.filter(b => b.status === 'Available').length;
    const lowStock = db.medicines.filter(m => this.store.stock(m) < m.reorder);
    const nearExpiry = db.medicines.flatMap(m => m.batches.filter(b => b.qty > 0 && b.expiry <= this.store.day(60)).map(b => ({ m, b })));
    const labPending = db.labOrders.filter(o => !['Verified', 'Delivered'].includes(o.status));
    const er = db.erCases.filter(c => !['Discharged'].includes(c.status));
    const docsAvail = db.doctors.filter(d => ['Available', 'In OPD', 'Running late'].includes(d.status)).length;
    return {
      appts: todays.filter(a => a.status !== 'Cancelled').length, visits: todays.filter(a => ['Arrived', 'Waiting', 'In consultation', 'Completed'].includes(a.status)).length + db.erCases.length,
      newRegs: db.patients.filter(p => p.registered === t).length + 6, waiting: db.queue.filter(q => q.step <= 2).length, consulting: db.queue.filter(q => q.step === 3).length,
      completed: todays.filter(a => a.status === 'Completed').length, labPending: labPending.length, paidToday, outstanding, occ, avail, bedsTotal: beds.length,
      lowStock, nearExpiry, er: er.length, erRed: er.filter(c => c.triage === 'Red').length, docsAvail, docsTotal: db.doctors.length, todays,
      icu: beds.filter(b => b.wardId === 'W3'), admissionsToday: db.admissions.filter(a => a.admittedOn === t).length,
      emergencyAdmits: db.admissions.filter(a => a.type === 'Emergency' && a.status !== 'Discharged').length,
    };
  });

  kpis = computed<Kpi[]>(() => {
    const m = this.m(); const db = this.store.db; const k = this.kind();
    const me = this.session.role()?.userName; const doc = db.doctors.find(d => d.name === me) ?? db.doctors[0];
    switch (k) {
      case 'doctor': {
        const mine = m.todays.filter(a => a.doctorId === doc.id && a.status !== 'Cancelled');
        return [
          { label: 'My patients today', value: mine.filter(a => a.status === 'Completed').length, of: mine.length, tone: 'pri', icon: 'users', link: '/consultation', trend: `${mine.filter(a => a.status !== 'Completed').length} left` },
          { label: 'Waiting for me', value: db.queue.filter(q => q.doctorId === doc.id && q.step <= 3).length, tone: 'pink', icon: 'clock', link: '/queue' },
          { label: 'Results to review', value: db.labOrders.filter(o => o.doctorId === doc.id && ['Result ready', 'Verified'].includes(o.status)).length, tone: 'amber', icon: 'flask-conical', link: '/lab/orders' },
          { label: 'Follow-ups due', value: db.followUps.filter(f => f.doctorId === doc.id && ['Due', 'Overdue'].includes(f.status)).length, tone: 'blue', icon: 'calendar-clock', link: '/follow-ups' },
        ];
      }
      case 'reception': return [
        { label: 'Checked in', value: m.visits, of: m.appts, tone: 'pri', icon: 'clipboard-check', link: '/appointments', trend: `${m.todays.filter(a => ['Scheduled', 'Confirmed'].includes(a.status)).length} to come` },
        { label: 'Waiting', value: m.waiting, tone: 'pink', icon: 'clock', link: '/queue', trend: 'live' },
        { label: 'Collected today', value: inrShort(m.paidToday), tone: 'amber', icon: 'wallet', link: '/billing' },
        { label: 'Outstanding', value: inrShort(m.outstanding), tone: 'blue', icon: 'receipt', link: '/billing' },
      ];
      case 'nurse': {
        const mar = db.admissions.flatMap(a => a.mar).filter(x => x.status === 'Due');
        return [
          { label: 'My ward patients', value: db.admissions.filter(a => a.status !== 'Discharged').length, tone: 'pri', icon: 'bed-double', link: '/nursing' },
          { label: 'Medicines due', value: mar.length, tone: 'pink', icon: 'syringe', link: '/nursing' },
          { label: 'Triage waiting', value: db.queue.filter(q => q.step === 2).length, tone: 'amber', icon: 'thermometer', link: '/queue' },
          { label: 'Escalations', value: db.admissions.filter(a => (a.obs.at(-1)?.news ?? 0) >= 5).length, tone: 'red', icon: 'triangle-alert', link: '/nursing' },
        ];
      }
      case 'pharmacy': return [
        { label: 'To dispense', value: db.prescriptions.filter(r => ['Sent to pharmacy', 'Signed'].includes(r.status)).length, tone: 'pri', icon: 'pill', link: '/pharmacy/dispense' },
        { label: 'Low stock', value: m.lowStock.length, tone: 'pink', icon: 'package', link: '/pharmacy/inventory' },
        { label: 'Expiring in 60 days', value: m.nearExpiry.length, tone: 'amber', icon: 'hourglass', link: '/pharmacy/inventory' },
        { label: 'Pharmacy sales today', value: inrShort(db.invoices.filter(i => i.kind === 'Pharmacy' && i.date === this.store.today()).reduce((s, i) => s + this.store.invoiceTotals(i).paid, 0) + 18450), tone: 'blue', icon: 'indian-rupee' },
      ];
      case 'lab': return [
        { label: 'Awaiting sample', value: db.labOrders.filter(o => ['Ordered', 'Awaiting sample'].includes(o.status)).length, tone: 'pri', icon: 'test-tube', link: '/lab/samples' },
        { label: 'In processing', value: db.labOrders.filter(o => ['Sample collected', 'Processing'].includes(o.status)).length, tone: 'amber', icon: 'flask-conical', link: '/lab/results' },
        { label: 'To verify', value: db.labOrders.filter(o => o.status === 'Result ready').length, tone: 'blue', icon: 'badge-check', link: '/lab/results' },
        { label: 'Critical values', value: db.labOrders.filter(o => this.store.criticals(o).length && !['Delivered'].includes(o.status)).length, tone: 'red', icon: 'triangle-alert', link: '/lab/results' },
      ];
      case 'radiology': return [
        { label: 'Scheduled today', value: db.imaging.filter(i => i.date === this.store.today()).length, tone: 'pri', icon: 'scan-line', link: '/radiology' },
        { label: 'Awaiting report', value: db.imaging.filter(i => i.status === 'Awaiting report').length, tone: 'pink', icon: 'file-text', link: '/radiology' },
        { label: 'In progress', value: db.imaging.filter(i => i.status === 'In progress').length, tone: 'amber', icon: 'timer', link: '/radiology' },
        { label: 'Reported', value: db.imaging.filter(i => ['Reported', 'Verified'].includes(i.status)).length, tone: 'blue', icon: 'file-check', link: '/radiology' },
      ];
      case 'billing': return [
        { label: 'Collected today', value: inrShort(m.paidToday), tone: 'pri', icon: 'wallet', link: '/billing' },
        { label: 'Outstanding', value: inrShort(m.outstanding), tone: 'pink', icon: 'receipt', link: '/billing' },
        { label: 'Claims in review', value: db.claims.filter(c => ['Submitted', 'Under review'].includes(c.status)).length, tone: 'amber', icon: 'shield-check', link: '/insurance' },
        { label: 'Unbilled items', value: db.consultations.filter(c => c.status === 'Completed' && !c.billed).length + db.labOrders.filter(o => !o.billed).length, tone: 'red', icon: 'trending-down', link: '/revenue-leakage' },
      ];
      case 'hr': return [
        { label: 'Staff on duty', value: db.staff.filter(s => s.status === 'On duty').length, of: db.staff.length, tone: 'pri', icon: 'users', link: '/staff' },
        { label: 'On leave', value: db.staff.filter(s => s.status === 'On leave').length, tone: 'pink', icon: 'calendar-days', link: '/staff' },
        { label: 'Leave requests', value: db.leaves.filter(l => l.status === 'Pending').length, tone: 'amber', icon: 'clipboard-list', link: '/staff' },
        { label: 'Avg attendance', value: Math.round(db.staff.reduce((s, x) => s + x.attendance, 0) / db.staff.length) + '%', tone: 'blue', icon: 'user-check', link: '/staff' },
      ];
      case 'inventory': return [
        { label: 'Items below reorder', value: db.inventory.filter(i => i.stock < i.reorder).length, tone: 'pink', icon: 'package', link: '/inventory' },
        { label: 'Open requisitions', value: db.requisitions.filter(r => r.status === 'Pending' || r.status === 'Approved').length, tone: 'pri', icon: 'clipboard-list', link: '/inventory' },
        { label: 'POs in transit', value: db.purchaseOrders.filter(p => ['Approved', 'Ordered'].includes(p.status)).length, tone: 'amber', icon: 'truck', link: '/procurement' },
        { label: 'Assets due service', value: db.assets.filter(a => a.nextService <= this.store.day(30)).length, tone: 'blue', icon: 'settings', link: '/inventory' },
      ];
      default: return [
        { label: 'Appointments today', value: m.completed, of: m.appts, tone: 'pri', icon: 'calendar-days', link: '/appointments', trend: '+12%' },
        { label: 'Patients waiting', value: m.waiting, tone: 'pink', icon: 'clock', link: '/queue', trend: `${m.consulting} in consult` },
        { label: 'Collected today', value: inrShort(m.paidToday + 312000), tone: 'amber', icon: 'wallet', link: '/billing', trend: '+6%' },
        { label: 'Beds available', value: m.avail, of: m.bedsTotal, tone: 'blue', icon: 'bed-double', link: '/ipd/beds', trend: `ICU ${m.icu.filter(b => b.status === 'Available').length} free` },
      ];
    }
  });

  hero = computed(() => {
    const m = this.m(); const k = this.kind(); const db = this.store.db;
    const late = db.doctors.filter(d => d.status === 'Running late');
    const map: Record<string, [string, string, string]> = {
      admin: [`${m.appts} appointments are booked today and ${m.waiting} patients are waiting. ${late.length ? late.map(d => this.store.dept(d.deptId)?.name).join(', ') + ' is running late.' : 'All clinics are on time.'}`, 'Book appointment', '/appointments/new'],
      doctor: [`You have ${m.todays.filter(a => a.doctorId === 'D01' && a.status !== 'Cancelled').length} patients today. Next up is ${this.store.pname(db.queue.find(q => q.doctorId === 'D01' && q.step === 3)?.patientId)} for a diabetes review.`, 'Start next consultation', '/consultation/' + (db.queue.find(q => q.doctorId === 'D01' && q.step === 3)?.patientId ?? db.patients[1].id)],
      reception: [`${m.waiting} patients are waiting and ${m.todays.filter(a => ['Scheduled', 'Confirmed'].includes(a.status)).length} more are booked for today. Walk-ins get a token when you check them in.`, 'Register patient', '/patients/new'],
      nurse: [`${db.admissions.filter(a => a.status !== 'Discharged').length} inpatients are on your shift. ${db.admissions.flatMap(a => a.mar).filter(x => x.status === 'Due').length} medicine doses are due.`, 'Open nursing board', '/nursing'],
      pharmacy: [`${db.prescriptions.filter(r => ['Sent to pharmacy', 'Signed'].includes(r.status)).length} prescriptions are waiting to be dispensed. ${m.lowStock.length} medicines are below reorder level.`, 'Dispense next', '/pharmacy/dispense'],
      lab: [`${db.labOrders.filter(o => ['Ordered', 'Awaiting sample'].includes(o.status)).length} samples are waiting to be collected and ${db.labOrders.filter(o => o.status === 'Result ready').length} results need verification.`, 'Collect samples', '/lab/samples'],
      radiology: [`${db.imaging.filter(i => i.status === 'Awaiting report').length} studies are waiting for your report.`, 'Open worklist', '/radiology'],
      billing: [`${inr(m.outstanding)} is outstanding across open invoices. Review unbilled services before the day closes.`, 'Create invoice', '/billing/new'],
      hr: [`${db.leaves.filter(l => l.status === 'Pending').length} leave requests need a decision. Tomorrow's roster has ${db.staff.filter(s => s.shift === 'Night').length} night-shift staff.`, 'Open staff roster', '/staff'],
      inventory: [`${db.inventory.filter(i => i.stock < i.reorder).length} store items are below reorder level and ${db.requisitions.filter(r => r.status === 'Pending').length} requisitions are pending.`, 'Review stock', '/inventory'],
    };
    return map[k] ?? map['admin'];
  });

  // ---------- charts ----------
  hourly = computed(() => {
    this.store.rev(); const hrs = Array.from({ length: 10 }, (_, i) => i + 8);
    const todays = this.m().todays;
    return { labels: hrs.map(h => (h > 12 ? h - 12 : h) + (h >= 12 ? 'p' : 'a')), data: hrs.map(h => todays.filter(a => +a.time.slice(0, 2) === h).length * 3 + [2, 4, 6, 5, 2, 3, 4, 3, 2, 1][h - 8]) };
  });
  revenue = computed(() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const cur = new Date().getMonth(); const all = [7.2, 8.1, 7.6, 9.4, 8.8, 9.9, 10.6, 9.2, 12.4, 13.2, 11.9, 12.8];
    const n = this.revRange() === '6m' ? 6 : 12; const idx = Array.from({ length: n }, (_, i) => (cur - n + 1 + i + 12) % 12);
    return { labels: idx.map(i => months[i]), data: idx.map(i => all[i]), total: idx.reduce((s, i) => s + all[i], 0) };
  });
  deptPerf = computed(() => {
    this.store.rev(); const db = this.store.db;
    const rows = db.departments.filter(d => d.id !== 'EM').map(d => {
      const ap = db.appointments.filter(a => a.deptId === d.id); const done = ap.filter(a => a.status === 'Completed').length;
      const rev = db.invoices.filter(i => i.items.some(it => it.desc.includes(d.name))).reduce((s, i) => s + this.store.invoiceTotals(i).total, 0);
      return { name: d.name, visits: ap.length, done, rev: rev + done * 650, wait: [18, 41, 12, 22, 9, 16, 20][db.departments.indexOf(d)] ?? 15 };
    });
    return rows.sort((a, b) => b.rev - a.rev);
  });
  bedChart = computed(() => { this.store.rev(); const b = this.store.db.beds; const c = (s: string) => b.filter(x => x.status === s).length; return [c('Occupied'), c('Available'), c('Reserved'), c('Cleaning') + c('Maintenance')]; });
  queueByStep = computed(() => { this.store.rev(); return JOURNEY.map((s, i) => ({ s, n: this.store.db.queue.filter(q => q.step === i).length })); });
  queueMax = computed(() => Math.max(1, ...this.queueByStep().map(x => x.n)));
  doctorsToday = computed(() => { this.store.rev(); return this.store.db.doctors.map(d => ({ d, left: this.m().todays.filter(a => a.doctorId === d.id && !['Completed', 'Cancelled', 'No-show'].includes(a.status)).length })); });
  upcoming = computed(() => { this.store.rev(); return this.m().todays.filter(a => !['Completed', 'Cancelled', 'No-show'].includes(a.status)).sort((a, b) => a.time.localeCompare(b.time)).slice(0, 6); });
  tasks = computed(() => {
    this.store.rev(); const db = this.store.db; const m = this.m();
    return [
      { icon: 'flask-conical', tone: 'r', text: `${db.labOrders.filter(o => o.status === 'Result ready').length} lab results waiting for verification`, link: '/lab/results' },
      { icon: 'receipt', tone: 'a', text: `${db.consultations.filter(c => c.status === 'Completed' && !c.billed).length} completed consultations without an invoice`, link: '/revenue-leakage' },
      { icon: 'bed-double', tone: 'b', text: `${db.admissions.filter(a => a.status === 'Discharge planned').length} discharges planned today`, link: '/ipd' },
      { icon: 'shield-check', tone: 'v', text: `${db.claims.filter(c => c.status === 'Draft').length} insurance claim drafts to submit`, link: '/insurance' },
      { icon: 'pill', tone: 'p', text: `${m.lowStock.length} medicines below reorder level`, link: '/pharmacy/inventory' },
      { icon: 'calendar-clock', tone: 'g', text: `${db.followUps.filter(f => f.status === 'Overdue').length} overdue follow-ups to call`, link: '/follow-ups' },
    ];
  });
  nurseRows = computed(() => { this.store.rev(); return this.store.db.admissions.filter(a => a.status !== 'Discharged').map(a => ({ a, p: this.store.patient(a.patientId)!, bed: this.store.bed(a.bedId)!, last: a.obs.at(-1), due: a.mar.filter(x => x.status === 'Due') })); });
  rxQueue = computed(() => { this.store.rev(); return this.store.db.prescriptions.filter(r => ['Sent to pharmacy', 'Signed'].includes(r.status)).slice(0, 6); });
  labQueue = computed(() => { this.store.rev(); return this.store.db.labOrders.filter(o => !['Delivered'].includes(o.status) && o.date === this.store.today()).slice(0, 8); });
  myQueue = computed(() => { this.store.rev(); return this.store.db.queue.filter(q => q.doctorId === 'D01' && q.step <= 3).sort((a, b) => b.step - a.step || (b.priority ? 1 : 0) - (a.priority ? 1 : 0)); });

  docResults = computed(() => { this.store.rev(); return this.store.db.labOrders.filter(x => x.doctorId === 'D01' && ['Result ready', 'Verified', 'Delivered'].includes(x.status)).slice(0, 5); });
  hourlyMine = computed(() => this.hourly().data.map(x => Math.round(x / 3)));
  go(l?: string) { if (l) this.router.navigateByUrl(l); }
  checkIn(id: string) { const a = this.store.db.appointments.find(x => x.id === id)!; this.store.setApptStatus(id, 'Arrived'); this.toast.ok(`${this.store.pname(a.patientId)} checked in with token ${a.token}`, { label: 'Open queue', run: () => this.go('/queue') }); }
  pct(n: number, d: number) { return d ? Math.round(n / d * 100) : 0; }
  inr = inr;
}
