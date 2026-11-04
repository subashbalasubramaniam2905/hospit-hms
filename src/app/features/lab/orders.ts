import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ExportService } from '../../core/services/export.service';
import { LabOrder, LabStatus } from '../../core/models';
import { SessionService } from '../../core/services/session.service';
import { LabApi, LiveLabOrder, DirectoryDoctor } from '../../core/api/lab-api';
import { LiveSync } from '../../core/api/live-sync';


const FLOW: LabStatus[] = ['Awaiting sample', 'Sample collected', 'Processing', 'Result ready', 'Verified', 'Delivered'];

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.pipe { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:10px } .pipe button { border:1px solid var(--line); background:var(--card); border-radius:12px; padding:12px; text-align:left; color:var(--fg) } .pipe button.on { border-color:var(--pri); box-shadow:inset 0 0 0 1px var(--pri) } .pipe b { font-size:22px; display:block } .pipe span { font-size:12px; color:var(--mut); font-weight:600 }
    .pick { border:1px solid var(--line); border-radius:12px; overflow:hidden; margin-top:6px } .pick button { display:flex; gap:10px; width:100%; padding:8px 12px; border:0; border-bottom:1px solid var(--line); background:none; text-align:left; color:var(--fg) }
    @media (max-width:900px){ .pipe { grid-template-columns:repeat(3,minmax(0,1fr)) } }`],
  template: `
  <div class="page">
    <cf-page-head title="Laboratory orders" [crumbs]="['Diagnostics', 'Lab orders']" sub="Track every test from order to delivered report.">
      <a class="btn ghost" routerLink="/lab/samples"><lucide-icon name="test-tubes" [size]="16"></lucide-icon>Sample collection</a>
      <a class="btn ghost" routerLink="/lab/results"><lucide-icon name="clipboard-check" [size]="16"></lucide-icon>Result entry</a>
      <button class="btn" (click)="newOpen.set(true)"><lucide-icon name="plus" [size]="16"></lucide-icon>New lab order</button>
    </cf-page-head>
    <div class="pipe">@for (s of flow; track s) { <button [class.on]="status() === s" (click)="status.set(status() === s ? '' : s)"><b>{{ count(s) }}</b><span>{{ s }}</span></button> }</div>
    <div class="card">
      <div class="toolbar" style="margin-bottom:12px">
        <label class="search boxed" style="flex:1;max-width:320px"><lucide-icon name="search" [size]="16"></lucide-icon><input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Patient, order or sample ID" aria-label="Search lab orders"></label>
        <div class="chips">@for (p of ['All', 'Routine', 'Urgent', 'STAT']; track p) {<button class="chip" [class.on]="prio() === p" (click)="prio.set(p)">{{ p }}</button>}</div>
        <span class="spacer"></span><button class="btn ghost sm" (click)="exportCsv()"><lucide-icon name="download" [size]="14"></lucide-icon>CSV</button>
      </div>
      <cf-table [rows]="rows()" [cols]="cols" [clickable]="true" (rowClick)="go($event)" [pageSize]="12">
        <ng-template cfCell="patient" let-o><div class="pname"><cf-avatar [name]="store.pname(o.patientId)"></cf-avatar><div>{{ store.pname(o.patientId) }}<small>{{ o.id }}</small></div></div></ng-template>
        <ng-template cfCell="tests" let-o><span class="small">{{ store.codes(o.testIds) }}</span></ng-template>
        <ng-template cfCell="when" let-o>{{ o.date | d }} · {{ o.time | time12 }}</ng-template>
        <ng-template cfCell="priority" let-o><cf-status [s]="o.priority"></cf-status></ng-template>
        <ng-template cfCell="status" let-o><cf-status [s]="o.status"></cf-status>@if (crit(o)) {<span class="st r" style="margin-left:4px">Critical</span>}</ng-template>
        <ng-template cfCell="tat" let-o><span [style.color]="late(o) ? 'var(--red)' : ''">{{ tat(o) }}</span></ng-template>
      </cf-table>
    </div>
  </div>
  <cf-drawer [open]="newOpen()" title="New lab order" (closed)="newOpen.set(false)">
    <div class="stack">
      <div class="field"><label>Patient</label>
        @if (store.patient(np()); as p) { <div class="soft row"><b style="flex:1">{{ p.name }} · {{ p.id }}</b><button class="btn ghost sm" (click)="np.set('')">Change</button></div> }
        @else { <input class="inp" [ngModel]="pq()" (ngModelChange)="pq.set($event)" placeholder="Search patient">
          @if (pq().length > 1) {<div class="pick">@for (p of matches(); track p.id) {<button (click)="np.set(p.id); pq.set('')">{{ p.name }} · {{ p.id }}</button>}</div>} }</div>
      <div class="field"><label>Ordering doctor</label><select class="inp" [(ngModel)]="nd">@for (d of doctors(); track d.id) {<option [value]="d.id">{{ d.name }}</option>}</select></div>
      <div class="field"><label>Tests</label><div class="chips">@for (t of store.db.labTests; track t.id) {<button class="chip" [class.on]="nt().includes(t.id)" (click)="toggle(t.id)" [matTooltip]="t.name + ' · ' + (t.price | inr) + ' · TAT ' + t.tatHours + 'h'">{{ t.code }}</button>}</div></div>
      <div class="field"><label>Priority</label><div class="chips">@for (p of ['Routine', 'Urgent', 'STAT']; track p) {<button class="chip" [class.on]="npr === p" (click)="npr = p">{{ p }}</button>}</div></div>
      @if (nt().length) { <div class="soft small">{{ store.names(nt()) }}<br><b>{{ ntTotal() | inr }}</b> will be added to a lab invoice.</div> }
    </div>
    <div foot><button class="btn ghost" (click)="newOpen.set(false)">Cancel</button><button class="btn" [disabled]="!np() || !nt().length" (click)="create()">Place order</button></div>
  </cf-drawer>`
})
export class LabOrdersPage {
  store = inject(StoreService); toast = inject(ToastService); router = inject(Router); exp = inject(ExportService);
  session = inject(SessionService); private api = inject(LabApi); private sync = inject(LiveSync); live = this.session.live;
  liveDoctors = signal<DirectoryDoctor[]>([]);
  doctors = computed(() => this.live ? this.liveDoctors() : this.store.db.doctors);
  flow = FLOW; q = signal(''); status = signal(''); prio = signal('All');
  newOpen = signal(false); np = signal(''); pq = signal(''); nt = signal<string[]>([]); nd = 'D01'; npr = 'Routine';
  cols = [
    { key: 'patient', label: 'Patient', value: (o: LabOrder) => this.store.pname(o.patientId) }, { key: 'tests', label: 'Tests', sortable: false },
    { key: 'doctor', label: 'Doctor', value: (o: LabOrder) => this.store.dname(o.doctorId) }, { key: 'when', label: 'Ordered', value: (o: LabOrder) => o.date + o.time },
    { key: 'priority', label: 'Priority' }, { key: 'sampleId', label: 'Sample' }, { key: 'status', label: 'Status', value: (o: LabOrder) => FLOW.indexOf(o.status) }, { key: 'tat', label: 'TAT', value: (o: LabOrder) => this.due(o) },
  ];
  constructor() {
    if (this.live) this.sync.loadLab().catch(() => this.toast.err('Could not load lab orders from the server'));
    if (this.live) this.api.doctors().then(d => { this.liveDoctors.set(d); if (!d.some(x => x.id === this.nd)) this.nd = d[0]?.id ?? ''; }).catch(() => undefined);
    const p = inject(ActivatedRoute).snapshot.queryParamMap.get('patient'); if (p) { this.np.set(p); this.newOpen.set(true); this.nd = this.store.patient(p)?.primaryDoctorId || 'D01'; } }
  all = computed(() => { this.store.rev(); return this.store.db.labOrders; });
  rows = computed(() => { const q = this.q().toLowerCase(); return this.all().filter(o => (!this.status() || o.status === this.status()) && (this.prio() === 'All' || o.priority === this.prio()) && (!q || o.id.toLowerCase().includes(q) || (o.sampleId || '').toLowerCase().includes(q) || this.store.pname(o.patientId).toLowerCase().includes(q))); });
  matches = computed(() => { const q = this.pq().toLowerCase(); return this.store.db.patients.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)).slice(0, 6); });
  ntTotal = computed(() => this.nt().reduce((t, id) => t + (this.store.test(id)?.price || 0), 0));
  count(s: LabStatus) { return this.all().filter(o => o.status === s).length; }
  crit(o: LabOrder) { return this.store.criticals(o).length > 0; }
  private due(o: LabOrder) { const h = Math.max(...o.testIds.map(t => this.store.test(t)?.tatHours || 6)) / (o.priority === 'STAT' ? 4 : o.priority === 'Urgent' ? 2 : 1); return new Date(o.date + 'T' + o.time).getTime() + h * 36e5; }
  late(o: LabOrder) { return !['Verified', 'Delivered'].includes(o.status) && Date.now() > this.due(o); }
  tat(o: LabOrder) { if (['Verified', 'Delivered'].includes(o.status)) return 'Done'; const m = Math.round((this.due(o) - Date.now()) / 6e4); return m < 0 ? `${Math.round(-m / 60)}h overdue` : m < 60 ? `${m} min left` : `${Math.round(m / 60)}h left`; }
  go(o: LabOrder) { if (o.status === 'Awaiting sample' || o.status === 'Ordered') this.router.navigate(['/lab/samples'], { queryParams: { order: o.id } }); else if (o.status === 'Verified' || o.status === 'Delivered') this.router.navigate(['/lab/report', o.id]); else this.router.navigate(['/lab/results', o.id]); }
  toggle(id: string) { this.nt.update(t => t.includes(id) ? t.filter(x => x !== id) : [...t, id]); }
  async create() {
    if (this.live) {
      const o = await this.sync.labAction(() => this.api.create(this.np(), this.nd, this.nt(), this.npr as LabOrder['priority']), x => `${x.id} placed for ${x.patientName}. Lab invoice ${x.invoiceNumber ?? ''} created.`);
      if (o) { this.newOpen.set(false); this.nt.set([]); this.np.set(''); }
      return;
    }
    const o = this.store.orderLab(this.np(), this.nd, this.nt(), this.npr as LabOrder['priority']); this.toast.ok(`${o.id} placed for ${this.store.pname(o.patientId)}. Lab invoice created.`); this.newOpen.set(false); this.nt.set([]); this.np.set(''); }
  exportCsv() { this.exp.csv('lab-orders', this.rows().map(o => ({ Order: o.id, Patient: this.store.pname(o.patientId), Tests: this.store.codes(o.testIds), Priority: o.priority, Status: o.status, Sample: o.sampleId || '', Date: o.date, Time: o.time }))); }
}
