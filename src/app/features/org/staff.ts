import { Component, computed, inject, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ExportService } from '../../core/services/export.service';
import { LeaveRequest, StaffMember } from '../../core/models';
import { LIVE } from '../../core/api/api-config';
import { OrgApi, SMark, SPayroll, fromServerLeave, fromServerStaff } from '../../core/api/org-api';
import { apiMessage } from '../../core/api/auth.service';
import { SessionService } from '../../core/services/session.service';
import { FrontDeskService } from '../../core/services/front-desk.service';

type Tab = 'directory' | 'roster' | 'leave' | 'attendance' | 'payroll';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHIFTS = ['Morning', 'Evening', 'Night', 'Off'];

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.ros td { padding:6px !important } .sh { border:0; border-radius:8px; padding:5px 8px; font-size:12px; font-weight:700; width:100%; min-width:74px; cursor:pointer }
    .sh.Morning { background:var(--amber-soft); color:color-mix(in srgb,var(--amber) 60%,var(--fg)) } .sh.Evening { background:var(--blue-soft); color:var(--blue) } .sh.Night { background:var(--violet-soft); color:var(--violet) } .sh.Off { background:var(--ground); color:var(--mut) }`],
  template: `
  <div class="page">
    <cf-page-head title="Staff & HR" [crumbs]="['Organisation', 'People']" [sub]="live ? 'Directory, duty roster, leave, attendance register and payroll for this branch.' : 'Directory, duty roster, leave, attendance and a payroll preview. Payroll is simulated.'">
      <button class="btn ghost" (click)="exportCsv()"><lucide-icon name="download" [size]="16"></lucide-icon>Export</button>
      <button class="btn" (click)="addOpen.set(true)"><lucide-icon name="user-plus" [size]="16"></lucide-icon>Add staff</button>
    </cf-page-head>
    <div class="grid">
      <cf-stat class="c3" label="Total staff" [value]="all().length" icon="users" tone="pri" [sub]="onDuty() + ' on duty now'"></cf-stat>
      <cf-stat class="c3" label="On leave" [value]="onLeave()" icon="calendar-days" tone="pink"></cf-stat>
      <cf-stat class="c3" label="Leave requests" [value]="pending().length" icon="clipboard-list" tone="amber" [clickable]="true" (click)="tab.set('leave')" sub="awaiting approval"></cf-stat>
      <cf-stat class="c3" label="Average attendance" [value]="avgAtt() + '%'" icon="user-check" tone="green" sub="this month"></cf-stat>
    </div>
    <div class="tabs">@for (t of tabs; track t.id) {<button [class.on]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button>}</div>
    @switch (tab()) {
    @case ('directory') {
      <div class="card">
        <div class="toolbar" style="margin-bottom:12px"><label class="search boxed" style="flex:1;max-width:300px"><lucide-icon name="search" [size]="16"></lucide-icon><input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Name or role" aria-label="Search staff"></label>
          <div class="chips">@for (c of cats; track c) {<button class="chip" [class.on]="cat() === c" (click)="cat.set(c)">{{ c }}</button>}</div></div>
        <cf-table [rows]="rows()" [cols]="cols" [pageSize]="12">
          <ng-template cfCell="name" let-s><div class="pname"><cf-avatar [name]="s.name"></cf-avatar><div>{{ s.name }}<small>{{ s.id }}</small></div></div></ng-template>
          <ng-template cfCell="dept" let-s>{{ store.dept(s.deptId)?.name || s.deptId }}</ng-template>
          <ng-template cfCell="status" let-s><cf-status [s]="s.status"></cf-status></ng-template>
        </cf-table>
      </div>
    }
    @case ('roster') {
      <div class="card">
        <div class="card-h"><h3>This week's roster@if (live && week()) { <span class="muted small">from {{ week() | d }}</span>}</h3><span class="r muted small">Click a cell to cycle the shift</span><button class="btn ghost sm" [disabled]="busy()" (click)="publish()"><lucide-icon name="send" [size]="14"></lucide-icon>Publish to staff</button></div>
        <div class="tbl"><table class="t ros"><thead><tr><th>Staff</th>@for (d of days; track d) {<th>{{ d }}</th>}<th>Hours</th></tr></thead><tbody>
          @for (s of rosterStaff(); track s.id) { <tr><td><b>{{ s.name }}</b><div class="small muted">{{ s.role }}</div></td>
            @for (d of days; track d; let i = $index) { <td><button class="sh {{ roster()[s.id][i] }}" (click)="cycle(s.id, i)">{{ roster()[s.id][i] }}</button></td> }
            <td class="tnum" [style.color]="hours(s.id) > 48 ? 'var(--red)' : ''">{{ hours(s.id) }}</td></tr> }
        </tbody></table></div>
        @if (over().length) { <div class="alert-box warn" style="margin-top:10px"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon>{{ over().join(', ') }} scheduled over 48 hours this week.</div> }
      </div>
    }
    @case ('leave') {
      <div class="card">
        @if (live) {<div class="row" style="margin-bottom:12px;flex-wrap:wrap;gap:8px"><b>Record a leave request</b>
          <select class="inp" style="width:auto" [(ngModel)]="nl.staffId" aria-label="Staff member"><option value="">Staff member</option>@for (s of all(); track s.id) {<option [value]="s.id">{{ s.name }}</option>}</select>
          <select class="inp" style="width:auto" [(ngModel)]="nl.type" aria-label="Leave type"><option>Casual</option><option>Sick</option><option>Earned</option><option>Maternity</option></select>
          <input class="inp" style="width:auto" type="date" [(ngModel)]="nl.from" aria-label="From"><input class="inp" style="width:auto" type="date" [(ngModel)]="nl.to" aria-label="To">
          <input class="inp" style="flex:1;min-width:140px" [(ngModel)]="nl.reason" placeholder="Reason" aria-label="Reason">
          <button class="btn sm" [disabled]="busy() || !nl.staffId || !nl.from || !nl.to" (click)="addLeave()">Add</button></div>}
        <cf-table [rows]="leaves()" [cols]="leaveCols">
          <ng-template cfCell="staff" let-l>{{ name(l.staffId) }}</ng-template>
          <ng-template cfCell="dates" let-l>{{ l.from | d }} – {{ l.to | d:true }}</ng-template>
          <ng-template cfCell="status" let-l><cf-status [s]="l.status"></cf-status></ng-template>
          <ng-template cfCell="act" let-l>@if (l.status === 'Pending') {<div class="row" style="gap:6px"><button class="btn sm" (click)="decide(l, 'Approved')">Approve</button><button class="btn ghost sm" (click)="decide(l, 'Rejected')">Reject</button></div>}</ng-template>
        </cf-table>
      </div>
    }
    @case ('attendance') {
      <div class="card">
        @if (live) {
          <div class="card-h"><h3>Today's register</h3><span class="r muted small">{{ store.today() | d:true }}</span><button class="btn sm" [disabled]="busy()" (click)="saveRegister()">Save register</button></div>
          <div class="list" style="margin-bottom:16px">@for (s of all(); track s.id) {<div class="li"><div class="grow"><b>{{ s.name }}</b><span>{{ s.role }}</span></div>
            <div class="chips">@for (m of marks; track m) {<button class="chip" [class.on]="register()[s.id] === m" (click)="setMark(s.id, m)">{{ m }}</button>}</div></div>}</div>
          <div class="card-h"><h3>Attendance, last 30 days</h3><span class="r muted small">Only staff with marked days</span></div>
        } @else {
        <div class="card-h"><h3>Attendance this month</h3><button class="r btn ghost sm" (click)="toast.info('Biometric device sync is simulated. 3 punches imported.')"><lucide-icon name="refresh-cw" [size]="14"></lucide-icon>Sync biometric</button></div>
        }
        <cf-chart type="bar" [labels]="attLabels()" [datasets]="[{ data: attData(), backgroundColor: '--pri', borderRadius: 6 }]" [height]="260" [options]="{ indexAxis: 'y', scales: { x: { min: 60, max: 100 } } }"></cf-chart>
      </div>
    }
    @case ('payroll') {
      <div class="card">
        <div class="alert-box info" style="margin-bottom:12px"><lucide-icon name="info" [size]="16"></lucide-icon>@if (live) {Payroll for {{ pay()?.month }} with illustrative deductions (PF 12%, professional tax ₹200, loss of pay for absent days in the register). Not a statutory calculation, and nothing is sent to a bank.@if (pay()?.run; as r) { Run by {{ r.runBy }}.}} @else {Payroll preview with illustrative deductions (PF 12%, professional tax ₹200). Not a statutory calculation.}</div>
        <cf-table [rows]="payroll()" [cols]="payCols" [pageSize]="12">
          <ng-template cfCell="gross" let-r>{{ r.gross | inr }}</ng-template><ng-template cfCell="pf" let-r>{{ r.pf | inr }}</ng-template><ng-template cfCell="lop" let-r>{{ r.lop | inr }}</ng-template><ng-template cfCell="net" let-r><b>{{ r.net | inr }}</b></ng-template>
        </cf-table>
        <div class="row" style="margin-top:12px"><b>Total net pay {{ payTotal() | inr }}</b><span class="spacer"></span><button class="btn" [disabled]="busy() || (live && (!!pay()?.run || !session.is(['super-admin', 'admin'])))" (click)="runPayroll()"><lucide-icon name="banknote" [size]="16"></lucide-icon>{{ live ? (pay()?.run ? 'Payroll recorded' : 'Record payroll for the month') : 'Run payroll (simulated)' }}</button></div>
      </div>
    }
    }
  </div>
  <cf-drawer [open]="addOpen()" title="Add staff member" (closed)="addOpen.set(false)">
    <div class="stack">
      <div class="field"><label>Full name <span class="req">*</span></label><input class="inp" [(ngModel)]="n.name"></div>
      <div class="form-grid"><div class="field"><label>Role</label><input class="inp" [(ngModel)]="n.role" placeholder="Staff nurse"></div><div class="field"><label>Category</label><select class="inp" [(ngModel)]="n.category"><option>Nurse</option><option>Technician</option><option>Admin</option><option>Support</option><option>Pharmacist</option></select></div>
        <div class="field"><label>Department</label><select class="inp" [(ngModel)]="n.deptId">@for (d of store.db.departments; track d.id) {<option [value]="d.id">{{ d.name }}</option>}</select></div><div class="field"><label>Shift</label><select class="inp" [(ngModel)]="n.shift"><option>Morning</option><option>Evening</option><option>Night</option><option>General</option></select></div>
        <div class="field"><label>Mobile</label><input class="inp" [(ngModel)]="n.phone"></div><div class="field"><label>Monthly salary</label><input class="inp" type="number" [(ngModel)]="n.salary"></div></div>
    </div>
    <div foot><button class="btn ghost" (click)="addOpen.set(false)">Cancel</button><button class="btn" [disabled]="!n.name || busy()" (click)="add()">Add</button></div>
  </cf-drawer>`
})
export class StaffPage {
  store = inject(StoreService); toast = inject(ToastService); exp = inject(ExportService); api = inject(OrgApi); session = inject(SessionService); frontDesk = inject(FrontDeskService);
  live = LIVE; busy = signal(false); week = signal(''); pay = signal<SPayroll | null>(null); register = signal<Record<string, SMark['status']>>({});
  marks: SMark['status'][] = ['Present', 'Absent', 'Half day', 'Leave'];
  nl = { staffId: '', type: 'Casual' as LeaveRequest['type'], from: '', to: '', reason: '' };
  tabs: { id: Tab; label: string }[] = [{ id: 'directory', label: 'Directory' }, { id: 'roster', label: 'Roster' }, { id: 'leave', label: 'Leave' }, { id: 'attendance', label: 'Attendance' }, { id: 'payroll', label: 'Payroll' }];
  cats = ['All', 'Doctor', 'Nurse', 'Technician', 'Pharmacist', 'Admin', 'Support']; days = DAYS;
  tab = signal<Tab>('directory'); q = signal(''); cat = signal('All'); addOpen = signal(false);
  n = { name: '', role: 'Staff nurse', category: 'Nurse' as StaffMember['category'], deptId: 'GM', shift: 'Morning' as StaffMember['shift'], phone: '', salary: 32000 };
  cols = [{ key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'category', label: 'Category' }, { key: 'dept', label: 'Department', value: (s: StaffMember) => s.deptId }, { key: 'shift', label: 'Shift' }, { key: 'phone', label: 'Phone', sortable: false }, { key: 'status', label: 'Status' }];
  leaveCols = [{ key: 'staff', label: 'Staff', value: (l: LeaveRequest) => this.name(l.staffId) }, { key: 'type', label: 'Type' }, { key: 'dates', label: 'Dates', value: (l: LeaveRequest) => l.from }, { key: 'reason', label: 'Reason' }, { key: 'status', label: 'Status' }, { key: 'act', label: '', sortable: false }];
  payCols = [{ key: 'name', label: 'Staff' }, { key: 'role', label: 'Role' }, { key: 'gross', label: 'Gross', align: 'right' as const }, { key: 'pf', label: 'PF', align: 'right' as const }, { key: 'lop', label: 'Loss of pay', align: 'right' as const }, { key: 'net', label: 'Net', align: 'right' as const }];
  all = computed(() => { this.store.rev(); return this.store.db.staff; });
  rows = computed(() => { const q = this.q().toLowerCase(); return this.all().filter(s => (this.cat() === 'All' || s.category === this.cat()) && (!q || (s.name + s.role).toLowerCase().includes(q))); });
  onDuty = computed(() => this.all().filter(s => s.status === 'On duty').length);
  onLeave = computed(() => this.all().filter(s => s.status === 'On leave').length);
  private measured = computed(() => this.live ? this.all().filter(s => (s as StaffMember & { recorded?: boolean }).recorded) : this.all());
  avgAtt = computed(() => Math.round(this.measured().reduce((t, s) => t + s.attendance, 0) / (this.measured().length || 1)));
  leaves = computed(() => { this.store.rev(); return this.store.db.leaves; });
  pending = computed(() => this.leaves().filter(l => l.status === 'Pending'));
  rosterStaff = computed(() => this.live ? this.all().filter(s => this.roster()[s.id]) : this.all().filter(s => s.category !== 'Doctor').slice(0, 12));
  roster = signal<Record<string, string[]>>({});
  constructor() {
    if (LIVE) { this.store.db.staff = []; this.store.db.leaves = []; this.reload(); return; }
    const r: Record<string, string[]> = {}; this.store.db.staff.forEach((s, k) => { const base = s.shift === 'General' ? 'Morning' : s.shift; r[s.id] = DAYS.map((_, i) => (i + k) % 7 === 6 ? 'Off' : base); }); this.roster.set(r);
  }
  private branch() { return this.session.branchId(); }
  async reload() {
    try {
      const b = this.branch();
      const [staff, leave, roster, marks, pay] = await Promise.all([this.api.staff(b), this.api.leave(), this.api.roster(b), this.api.attendance(), this.api.payroll(b), this.frontDesk.loadDirectory().catch(() => undefined)]);
      this.store.db.staff = staff.map(fromServerStaff); this.store.db.leaves = leave.filter(l => staff.some(s => s.id === l.staffId)).map(fromServerLeave);
      const r: Record<string, string[]> = {}; roster.rows.forEach(x => r[x.staffId] = x.shifts); this.roster.set(r); this.week.set(roster.week);
      const reg: Record<string, SMark['status']> = {}; marks.forEach(m => reg[m.staffId] = m.status); this.register.set(reg);
      this.pay.set(pay); this.store.changed();
    } catch (e) { this.toast.err(apiMessage(e, 'Could not load staff')); }
  }
  /** Live mode: runs a server change, reloads and reports errors. */
  private async run(f: () => Promise<unknown>, ok: string, fail: string) {
    this.busy.set(true);
    try { await f(); this.toast.ok(ok); await this.reload(); return true; } catch (e) { this.toast.err(apiMessage(e, fail)); return false; } finally { this.busy.set(false); }
  }
  hours(id: string) { return (this.roster()[id] || []).filter(x => x !== 'Off').reduce((t, x) => t + (x === 'Night' ? 12 : 8), 0); }
  over = computed(() => this.rosterStaff().filter(s => this.hours(s.id) > 48).map(s => s.name));
  cycle(id: string, i: number) { this.roster.update(r => { const row = [...r[id]]; row[i] = SHIFTS[(SHIFTS.indexOf(row[i]) + 1) % SHIFTS.length]; return { ...r, [id]: row }; }); }
  publish() {
    if (this.live) { const rows = Object.entries(this.roster()).map(([staffId, shifts]) => ({ staffId, shifts })); this.run(() => this.api.publishRoster({ week: this.week(), branchId: this.branch(), rows }), 'Roster published. Staff with accounts see it in their inbox.', 'Could not publish the roster'); return; }
    this.store.log('Published', 'Roster', 'Weekly roster published'); this.toast.ok('Roster published. Staff notified on the app (simulated).');
  }
  name(id: string) { return this.all().find(s => s.id === id)?.name || id; }
  decide(l: LeaveRequest, s: 'Approved' | 'Rejected') {
    if (this.live) { this.run(() => this.api.decideLeave(l.id, s), `Leave ${s.toLowerCase()} for ${this.name(l.staffId)}`, 'Could not record the decision'); return; }
    l.status = s; if (s === 'Approved' && l.from <= this.store.today()) { const m = this.all().find(x => x.id === l.staffId); if (m) m.status = 'On leave'; } this.store.log(s, 'Leave', `${this.name(l.staffId)} ${l.type} leave`); this.store.changed(); this.toast.ok(`Leave ${s.toLowerCase()} for ${this.name(l.staffId)}`);
  }
  async addLeave() {
    const nl = this.nl;
    if (await this.run(() => this.api.requestLeave({ staffId: nl.staffId, from: nl.from, to: nl.to, type: nl.type, reason: nl.reason }), 'Leave request recorded', 'Could not record the leave')) this.nl = { staffId: '', type: 'Casual', from: '', to: '', reason: '' };
  }
  setMark(id: string, m: SMark['status']) { this.register.update(r => ({ ...r, [id]: m })); }
  saveRegister() {
    const entries = Object.entries(this.register()).map(([staffId, status]) => ({ staffId, status }));
    if (!entries.length) { this.toast.err('Mark at least one person'); return; }
    this.run(() => this.api.markAttendance(this.store.today(), entries), `Register saved for ${entries.length} staff`, 'Could not save the register');
  }
  attLabels = computed(() => this.measured().slice(0, 14).map(s => s.name.replace(/^Dr\.\s/, '')));
  attData = computed(() => this.measured().slice(0, 14).map(s => s.attendance));
  payroll = computed(() => {
    if (this.live) return (this.pay()?.lines ?? []).map(l => ({ name: l.name, role: l.role, gross: +l.gross, pf: +l.pf, lop: +l.lop, net: +l.net }));
    return this.all().map(s => { const gross = s.salary; const pf = Math.round(gross * 0.12); const lop = Math.round(gross * Math.max(0, 96 - s.attendance) / 100); return { name: s.name, role: s.role, gross, pf, lop, net: gross - pf - lop - 200 }; });
  });
  payTotal = computed(() => this.payroll().reduce((t, r) => t + r.net, 0));
  runPayroll() {
    if (this.live) { const p = this.pay(); if (p) this.run(() => this.api.runPayroll(this.branch(), p.month), `Payroll for ${p.month} recorded. Nothing was sent to the bank.`, 'Could not record the payroll'); return; }
    this.store.log('Approved', 'Payroll', 'Monthly payroll run (simulated)', 'Sensitive'); this.toast.ok(`Payroll of ₹${new Intl.NumberFormat('en-IN').format(this.payTotal())} queued for bank upload (simulated)`);
  }
  exportCsv() { this.exp.csv('staff', this.rows().map(s => ({ ID: s.id, Name: s.name, Role: s.role, Category: s.category, Department: s.deptId, Shift: s.shift, Status: s.status, Phone: s.phone }))); }
  async add() {
    if (this.live) {
      const n = this.n;
      if (await this.run(() => this.api.addStaff({ name: n.name.trim(), role: n.role.trim() || 'Staff', category: n.category, deptId: n.deptId, phone: n.phone, shift: n.shift, salary: +n.salary, branchId: this.branch() }), `${n.name} added`, 'Could not add the staff member')) { this.addOpen.set(false); this.n.name = ''; }
      return;
    }
    this.store.db.staff.unshift({ id: 'ST' + (200 + this.all().length), name: this.n.name, role: this.n.role, category: this.n.category, deptId: this.n.deptId, phone: this.n.phone || '+91 90000 00000', email: '', shift: this.n.shift, status: 'Off duty', joined: this.store.today(), salary: +this.n.salary, attendance: 100 }); this.roster.update(r => ({ ...r, [this.store.db.staff[0].id]: DAYS.map((_, i) => i === 6 ? 'Off' : this.n.shift === 'General' ? 'Morning' : this.n.shift) })); this.store.log('Created', 'Staff', this.n.name); this.store.changed(); this.toast.ok(`${this.n.name} added`); this.addOpen.set(false); this.n.name = '';
  }
}
