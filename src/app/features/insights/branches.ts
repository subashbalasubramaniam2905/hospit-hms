import { Component, computed, inject, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { SessionService } from '../../core/services/session.service';
import { Branch } from '../../core/models';
import { LIVE } from '../../core/api/api-config';
import { InsightsApi } from '../../core/api/insights-api';

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.br { display:flex; flex-direction:column; gap:12px } .br.cur { border-color:var(--pri); box-shadow:0 0 0 3px var(--pri-soft) }
  .ut { display:grid; grid-template-columns:80px 1fr 40px; gap:8px; align-items:center; font-size:13px } .ut .bar { height:8px; background:var(--ground); border-radius:4px; overflow:hidden } .ut .bar i { display:block; height:100%; background:var(--pri); border-radius:4px }`],
  template: `
  <div class="page">
    <cf-page-head title="Branches" [crumbs]="['Insights', 'Multi-branch']" [sub]="isLive ? 'Compare branches this month, from billing, appointments, doctor schedules and the bed board.' : 'Compare branches this month. Udumalpet figures update from live demo data; other branches use sample figures.'"></cf-page-head>
    <div class="grid">
      <cf-stat class="c3" label="Revenue this month" [value]="(totalRev() | inr:true)" icon="indian-rupee" tone="pri" sub="All branches"></cf-stat>
      <cf-stat class="c3" label="OPD visits" [value]="fmtN(totalVisits())" icon="users" tone="blue"></cf-stat>
      <cf-stat class="c3" label="Inpatient beds" [value]="totalBeds()" icon="bed-double" tone="violet"></cf-stat>
      <cf-stat class="c3" label="Doctors on duty" [value]="onDuty()" [of]="totalDocs()" icon="stethoscope" tone="green"></cf-stat>
    </div>
    <div class="grid">
      @for (b of list(); track b.id) {
        <div class="card br c4" [class.cur]="session.branchId() === b.id">
          <div class="row"><span class="av lg"><lucide-icon name="building-2" [size]="20"></lucide-icon></span><div class="grow"><b>{{ b.name }}</b><span>{{ b.city }} · {{ b.beds ? b.beds + ' beds' : 'OPD clinic' }}</span></div>@if (session.branchId() === b.id) {<cf-status s="Current" tone="g"></cf-status>}</div>
          <div class="kv"><div><small>Revenue</small><b>{{ b.revenueMonth | inr:true }}</b></div><div><small>Visits</small><b>{{ b.visitsMonth | number }}</b></div><div><small>Occupancy</small><b>{{ b.beds ? b.occupancy + '%' : '—' }}</b></div><div><small>Revenue per visit</small><b>{{ perVisit(b) | inr }}</b></div></div>
          <div class="stack-s">@for (u of util(b); track u.k) {<div class="ut"><span class="muted">{{ u.k }}</span><span class="bar"><i [style.width.%]="u.v" [style.background]="u.v >= 85 ? 'var(--amber)' : u.v ? 'var(--pri)' : 'transparent'"></i></span><b>{{ u.v ? u.v + '%' : '—' }}</b></div>}</div>
          @if (session.branchId() !== b.id) {<button class="btn ghost sm" (click)="switchTo(b)">Switch to this branch</button>}
        </div>
      }
    </div>
    <div class="grid">
      <div class="card c6"><div class="card-h"><h3>Revenue by branch</h3><span class="r muted small">This month</span></div><cf-chart type="bar" [labels]="labels()" [datasets]="[{ label: 'Revenue', data: revs(), backgroundColor: '--pri', borderRadius: 6 }]" [height]="230"></cf-chart></div>
      <div class="card c6"><div class="card-h"><h3>OPD visits by branch</h3><span class="r muted small">This month</span></div><cf-chart type="bar" [labels]="labels()" [datasets]="[{ label: 'Visits', data: visits(), backgroundColor: '--blue', borderRadius: 6 }]" [height]="230"></cf-chart></div>
    </div>
    <div class="card">
      <div class="card-h"><h3>Side by side</h3></div>
      <div class="tbl"><table class="t"><thead><tr><th>Measure</th>@for (b of list(); track b.id) {<th class="num">{{ b.name.replace('HospitOS ', '') }}</th>}</tr></thead><tbody>
        @for (m of measures; track m.k) {<tr><td>{{ m.k }}</td>@for (b of list(); track b.id) {<td class="num">{{ m.f(b) }}</td>}</tr>}
      </tbody></table></div>
    </div>
  </div>`
})
export class BranchesPage {
  store = inject(StoreService); toast = inject(ToastService); session = inject(SessionService);
  readonly isLive = LIVE; private api = inject(InsightsApi);
  private live = signal<Branch[] | null>(null);
  constructor() {
    if (LIVE) this.api.branches().then(l => this.live.set(l.map(b => ({ ...(this.store.db.branches.find(x => x.id === b.id) ?? {}), ...b }) as Branch))).catch(() => this.toast.err('Could not load branch figures'));
  }
  list = computed<Branch[]>(() => { const L = this.live(); if (L) return L; this.store.rev(); const s = this.store.db; return s.branches.map(b => b.id === 'BR1' ? { ...b, occupancy: Math.round(s.beds.filter(x => x.status === 'Occupied').length / Math.max(1, s.beds.length) * 100), beds: s.beds.length, doctorsAvailable: s.doctors.filter(d => d.status !== 'On leave').length, doctors: s.doctors.length } : b); });
  labels = computed(() => this.list().map(b => b.name.replace('HospitOS ', '')));
  revs = computed(() => this.list().map(b => b.revenueMonth)); visits = computed(() => this.list().map(b => b.visitsMonth));
  totalRev = computed(() => this.revs().reduce((a, b) => a + b, 0)); totalVisits = computed(() => this.visits().reduce((a, b) => a + b, 0));
  totalBeds = computed(() => this.list().reduce((a, b) => a + b.beds, 0)); totalDocs = computed(() => this.list().reduce((a, b) => a + b.doctors, 0)); onDuty = computed(() => this.list().reduce((a, b) => a + b.doctorsAvailable, 0));
  measures: { k: string; f: (b: Branch) => string }[] = [
    { k: 'Revenue this month', f: b => '₹' + new Intl.NumberFormat('en-IN').format(b.revenueMonth) }, { k: 'OPD visits', f: b => new Intl.NumberFormat('en-IN').format(b.visitsMonth) },
    { k: 'Revenue per visit', f: b => '₹' + new Intl.NumberFormat('en-IN').format(this.perVisit(b)) }, { k: 'Beds', f: b => String(b.beds || '—') }, { k: 'Bed occupancy', f: b => b.beds ? b.occupancy + '%' : '—' },
    { k: 'Doctors available', f: b => `${b.doctorsAvailable} of ${b.doctors}` }, { k: 'OPD utilisation', f: b => (b.utilisation['OPD'] || 0) + '%' }, { k: 'OT utilisation', f: b => b.utilisation['OT'] ? b.utilisation['OT'] + '%' : '—' },
  ];
  fmtN(n: number) { return new Intl.NumberFormat('en-IN').format(n); }
  perVisit(b: Branch) { return Math.round(b.revenueMonth / Math.max(1, b.visitsMonth)); }
  util(b: Branch) { return Object.entries(b.utilisation).map(([k, v]) => ({ k, v })); }
  switchTo(b: Branch) { this.session.setBranch(b.id); this.toast.info(LIVE ? `Switched to ${b.name}` : `Switched to ${b.name}. Screens other than this one show Udumalpet demo data.`); }
}
