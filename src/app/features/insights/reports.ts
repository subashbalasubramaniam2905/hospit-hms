import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { SHARED, fmtDate } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ExportService } from '../../core/services/export.service';
import { SessionService } from '../../core/services/session.service';
import { LIVE } from '../../core/api/api-config';
import { InsightsApi } from '../../core/api/insights-api';

type ReportId = 'opd' | 'revenue' | 'doctor' | 'lab' | 'pharmacy' | 'beds' | 'claims' | 'noshow';
interface Report { rows: Record<string, string | number>[]; labels: string[]; data: number[]; chart: 'bar' | 'line' | 'doughnut'; money?: string[]; note?: string; }

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.lay { display:grid; grid-template-columns:250px minmax(0,1fr); gap:16px; align-items:start } .rl button { display:flex; gap:10px; align-items:center; width:100%; padding:10px 12px; border:0; border-radius:10px; background:none; text-align:left; font-weight:600; color:var(--fg) } .rl button:hover { background:var(--ground) } .rl button.on { background:var(--pri-soft); color:var(--pri) } @media (max-width:960px){ .lay { grid-template-columns:minmax(0,1fr) } }`],
  template: `
  <div class="page">
    <cf-page-head title="Reports" [crumbs]="['Insights', 'Reports']" [sub]="isLive ? 'Operational and financial reports from the hospital’s records. Export to CSV or print.' : 'Operational and financial reports from the demo data. Export to CSV or print.'">
      @if (!isLive) {<button class="btn ghost" (click)="schedule()"><lucide-icon name="calendar-clock" [size]="16"></lucide-icon>Schedule email</button>}
      <button class="btn ghost" (click)="printer.print()"><lucide-icon name="printer" [size]="16"></lucide-icon>Print</button>
      <button class="btn" (click)="exportCsv()"><lucide-icon name="download" [size]="16"></lucide-icon>Export CSV</button>
    </cf-page-head>
    <div class="lay">
      <div class="card rl" style="padding:10px">@for (r of list; track r.id) {<button [class.on]="rid() === r.id" (click)="rid.set(r.id)"><lucide-icon [name]="r.icon" [size]="16"></lucide-icon>{{ r.label }}</button>}</div>
      <div class="stack">
        <div class="card" style="padding:12px 16px"><div class="toolbar">
          <div class="seg">@for (p of periods; track p.d) {<button [class.on]="days() === p.d" (click)="days.set(p.d)">{{ p.label }}</button>}</div>
          <select class="inp" style="width:auto" [ngModel]="dept()" (ngModelChange)="dept.set($event)" aria-label="Department"><option value="">All departments</option>@for (d of store.db.departments; track d.id) {<option [value]="d.id">{{ d.name }}</option>}</select>
          <select class="inp" style="width:auto" aria-label="Branch" [ngModel]="branch()" (ngModelChange)="branch.set($event)">@for (b of branches(); track b.id) {<option [value]="b.id">{{ b.name }}</option>}</select>
          <span class="spacer"></span><span class="muted small">{{ fromLabel() }} – today</span>
        </div></div>
        <div class="card">
          <div class="card-h"><h3>{{ title() }}</h3>@if (loading()) {<span class="muted small">Loading…</span>}@if (rep().note) {<span class="r muted small">{{ rep().note }}</span>}</div>
          @if (rep().data.length) { <cf-chart [type]="rep().chart" [labels]="rep().labels" [datasets]="[{ label: title(), data: rep().data, backgroundColor: rep().chart === 'doughnut' ? palette : '--pri', borderColor: '--pri', borderRadius: 6, tension: .3, fill: rep().chart === 'line' }]" [height]="250" [legend]="rep().chart === 'doughnut'"></cf-chart> }
        </div>
        <div class="card">
          <div class="tbl"><table class="t"><thead><tr>@for (c of columns(); track c) {<th [class.num]="isNum(c)">{{ c }}</th>}</tr></thead>
            <tbody>@for (r of rep().rows; track $index) {<tr>@for (c of columns(); track c) {<td [class.num]="isNum(c)">{{ fmt(c, r[c]) }}</td>}</tr>} @empty {<tr><td class="muted">No data for this filter.</td></tr>}</tbody></table></div>
        </div>
      </div>
    </div>
  </div>`
})
export class ReportsPage {
  store = inject(StoreService); toast = inject(ToastService); exp = inject(ExportService); printer = inject(ExportService);
  list: { id: ReportId; label: string; icon: string }[] = [
    { id: 'opd', label: 'OPD visits', icon: 'users' }, { id: 'revenue', label: 'Revenue by department', icon: 'indian-rupee' }, { id: 'doctor', label: 'Doctor performance', icon: 'stethoscope' },
    { id: 'lab', label: 'Lab turnaround', icon: 'flask-conical' }, { id: 'pharmacy', label: 'Pharmacy sales', icon: 'pill' }, { id: 'beds', label: 'Bed occupancy', icon: 'bed-double' },
    { id: 'claims', label: 'Insurance claims', icon: 'shield-check' }, { id: 'noshow', label: 'No-shows and cancellations', icon: 'user-x' },
  ];
  periods = [{ d: 7, label: '7 days' }, { d: 30, label: '30 days' }, { d: 90, label: '90 days' }];
  palette = ['--pri', '--blue', '--amber', '--violet', '--pink', '--green', '--red'];
  session = inject(SessionService); readonly isLive = LIVE; private api = inject(InsightsApi);
  rid = signal<ReportId>('opd'); days = signal(30); dept = signal(''); branch = signal(this.session.branchId());
  /** Branches this account may pick; in live mode the server refuses others. */
  branches = computed(() => { const a = this.session.allowedBranches(); return this.store.db.branches.filter(b => a === null || a.includes(b.id)); });
  /** Live mode: the report the server computed for the current filters. */
  private live = signal<Report | null>(null); loading = signal(false);
  constructor() {
    if (!LIVE) return;
    effect(() => { const id = this.rid(), d = this.days(), dept = this.dept(), br = this.branch(); untracked(() => this.load(id, d, dept, br)); });
  }
  private async load(id: ReportId, d: number, dept: string, br: string) {
    this.loading.set(true);
    try { const r = await this.api.report(id, d, dept || undefined, br || undefined); if (id === this.rid()) this.live.set({ rows: r.rows, labels: r.labels, data: r.data, chart: r.chart, note: r.note }); }
    catch { this.toast.err('Could not load the report'); this.live.set({ rows: [], labels: [], data: [], chart: 'bar' }); }
    finally { this.loading.set(false); }
  }
  since = computed(() => this.store.day(-this.days() + 1));
  fromLabel = computed(() => fmtDate(this.since(), true));
  title = computed(() => this.list.find(r => r.id === this.rid())!.label);
  columns = computed(() => Object.keys(this.rep().rows[0] || {}));
  isNum(c: string) { return /count|visits|amount|revenue|₹|%|hours|beds|claims|value|qty|rate|tat/i.test(c); }
  fmt(c: string, v: string | number) { return typeof v === 'number' && /₹|revenue|amount|value/i.test(c) ? '₹' + new Intl.NumberFormat('en-IN').format(Math.round(v)) : v; }
  rep = computed<Report>(() => {
    if (LIVE) return this.live() ?? { rows: [], labels: [], data: [], chart: 'bar' };
    this.store.rev(); const s = this.store, since = this.since(), dept = this.dept();
    const appts = s.db.appointments.filter(a => a.date >= since && a.date <= s.today() && (!dept || a.deptId === dept));
    switch (this.rid()) {
      case 'opd': {
        const by = new Map<string, number>(); appts.filter(a => !['Cancelled', 'No-show'].includes(a.status)).forEach(a => by.set(a.deptId, (by.get(a.deptId) || 0) + 1));
        const rows = s.db.departments.map(d => ({ Department: d.name, Visits: by.get(d.id) || 0, 'New %': Math.round(appts.filter(a => a.deptId === d.id && a.type === 'New consultation').length / Math.max(1, by.get(d.id) || 0) * 100) })).filter(r => r.Visits);
        return { rows, labels: rows.map(r => r.Department), data: rows.map(r => r.Visits), chart: 'bar' };
      }
      case 'revenue': {
        const inv = s.db.invoices.filter(i => i.date >= since); const by = new Map<string, number>();
        inv.forEach(i => i.items.forEach(it => by.set(it.category, (by.get(it.category) || 0) + it.qty * it.rate)));
        const rows = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ Category: k, 'Revenue ₹': v, 'Share %': Math.round(v / [...by.values()].reduce((a, b) => a + b, 0) * 100) }));
        return { rows, labels: rows.map(r => r.Category), data: rows.map(r => r['Revenue ₹']), chart: 'doughnut' };
      }
      case 'doctor': {
        const rows = s.db.doctors.filter(d => !dept || d.deptId === dept).map(d => { const mine = appts.filter(a => a.doctorId === d.id); const done = mine.filter(a => a.status === 'Completed').length; return { Doctor: d.name, Department: s.dept(d.deptId)?.name || '', Visits: mine.length, Completed: done, 'Revenue ₹': done * d.fee, 'Rating': (4 + (d.experience % 10) / 10).toFixed(1) }; });
        return { rows, labels: rows.map(r => r.Doctor.replace('Dr. ', '')), data: rows.map(r => r.Visits), chart: 'bar' };
      }
      case 'lab': {
        const rows = s.db.labTests.slice(0, 12).map(t => { const os = s.db.labOrders.filter(o => o.testIds.includes(t.id)); return { Test: t.name, Orders: os.length, 'Target TAT hours': t.tatHours, 'Actual TAT hours': +(t.tatHours * (0.7 + (t.price % 7) / 10)).toFixed(1), 'Within target %': Math.round(70 + (t.price % 30)) }; }).filter(r => r.Orders);
        return { rows, labels: rows.map(r => r.Test), data: rows.map(r => r['Actual TAT hours']), chart: 'bar', note: 'TAT figures are illustrative' };
      }
      case 'pharmacy': {
        const moves = s.db.stockMoves.filter(m => m.kind === 'Dispense'); const by = new Map<string, number>(); moves.forEach(m => by.set(m.name, (by.get(m.name) || 0) - m.qty));
        const base = s.db.medicines.slice(0, 10).map((m, k) => ({ Medicine: `${m.brand} ${m.strength}`, 'Qty sold': (by.get(`${m.brand} ${m.strength}`) || 0) + 40 + k * 7 % 60, 'Value ₹': 0 }));
        base.forEach(r => { const m = s.db.medicines.find(x => `${x.brand} ${x.strength}` === r.Medicine)!; r['Value ₹'] = r['Qty sold'] * m.price; }); base.sort((a, b) => b['Value ₹'] - a['Value ₹']);
        return { rows: base, labels: base.map(r => r.Medicine), data: base.map(r => r['Value ₹']), chart: 'bar' };
      }
      case 'beds': {
        const labels = Array.from({ length: Math.min(this.days(), 30) }, (_, i) => s.day(i - Math.min(this.days(), 30) + 1)); const occ = s.db.beds.filter(b => b.status === 'Occupied').length;
        const data = labels.map((_, i) => Math.round(Math.min(98, 55 + ((i * 37) % 30) + (i === labels.length - 1 ? occ / s.db.beds.length * 10 : 0))));
        const rows = s.db.wards.map(w => { const bs = s.db.beds.filter(b => b.wardId === w.id); return { Ward: w.name, Beds: bs.length, Occupied: bs.filter(b => b.status === 'Occupied').length, 'Occupancy %': Math.round(bs.filter(b => b.status === 'Occupied').length / bs.length * 100), 'Rate ₹': w.rate }; });
        return { rows, labels: labels.map(d => fmtDate(d)), data, chart: 'line', note: 'Trend before today is simulated' };
      }
      case 'claims': {
        const rows = s.db.providers.map(p => { const cs = s.db.claims.filter(c => c.providerId === p.id); return { Insurer: p.name, Claims: cs.length, 'Claimed ₹': cs.reduce((t, c) => t + c.claimed, 0), 'Approved ₹': cs.reduce((t, c) => t + c.approved, 0), 'Approval %': cs.length ? Math.round(cs.reduce((t, c) => t + c.approved, 0) / Math.max(1, cs.reduce((t, c) => t + c.claimed, 0)) * 100) : 0 }; }).filter(r => r.Claims);
        return { rows, labels: rows.map(r => r.Insurer), data: rows.map(r => r['Claimed ₹']), chart: 'bar' };
      }
      case 'noshow': {
        const rows = s.db.doctors.map(d => { const mine = appts.filter(a => a.doctorId === d.id); return { Doctor: d.name, Booked: mine.length, 'No-shows': mine.filter(a => a.status === 'No-show').length, Cancelled: mine.filter(a => a.status === 'Cancelled').length, 'Rate %': mine.length ? Math.round(mine.filter(a => ['No-show', 'Cancelled'].includes(a.status)).length / mine.length * 100) : 0 }; }).filter(r => r.Booked);
        return { rows, labels: rows.map(r => r.Doctor.replace('Dr. ', '')), data: rows.map(r => r['Rate %']), chart: 'bar' };
      }
    }
  });
  exportCsv() { this.exp.csv(this.rid() + '-report', this.rep().rows); }
  schedule() { this.store.log('Created', 'Report schedule', `${this.title()} weekly email`); this.toast.ok(`${this.title()} will be emailed every Monday at 8 am (simulated)`); }
}
