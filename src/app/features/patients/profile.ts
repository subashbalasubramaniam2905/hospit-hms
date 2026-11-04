import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED, fmtDate } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ExportService } from '../../core/services/export.service';
import { ToastService } from '../../core/services/toast.service';
import { SessionService } from '../../core/services/session.service';

type Tab = 'overview' | 'visits' | 'rx' | 'diag' | 'billing' | 'docs' | 'timeline';

@Component({
  standalone: true, imports: [SHARED],
  styles: [`
    .hero { display:grid; grid-template-columns:auto 1fr auto; gap:18px; align-items:center }
    .hero h2 { font-size:22px; font-weight:800 }
    .facts { display:flex; gap:8px 18px; flex-wrap:wrap; color:var(--mut); font-size:13px; margin-top:6px }
    .facts b { color:var(--fg); font-weight:600 }
    .acts { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end }
    .vit { display:grid; grid-template-columns:repeat(auto-fit,minmax(100px,1fr)); gap:10px }
    .vit .soft small { display:block; color:var(--mut); font-size:12px } .vit .soft b { font-size:18px }
    .doclist .li lucide-icon { color:var(--pri) }
    @media (max-width:900px){ .hero { grid-template-columns:auto 1fr } .acts { grid-column:1/-1; justify-content:flex-start } }
  `],
  template: `
  @if (p(); as p) {
  <div class="page">
    <cf-page-head [title]="p.name" [crumbs]="['Patients', 'Unified record']" [sub]="'UHID ' + p.id + ' · registered ' + (p.registered | d:true)">
      <a class="btn ghost" routerLink="/patients"><lucide-icon name="arrow-left" [size]="16"></lucide-icon>All patients</a>
    </cf-page-head>

    <div class="card">
      <div class="hero">
        <cf-avatar [name]="p.name" size="xl"></cf-avatar>
        <div>
          <div class="row"><h2>{{ p.name }}</h2><cf-status [s]="p.consent === 'Given' ? 'Consent on file' : 'Consent ' + p.consent" [tone]="p.consent === 'Given' ? 'g' : 'a'"></cf-status>
            @if (adm()) { <cf-status s="Admitted" tone="v" [label]="'Admitted · ' + store.bed(adm()!.bedId)?.label"></cf-status> }</div>
          <div class="facts">
            <span><b>{{ p.dob | age }} y</b> · {{ p.gender }}</span><span>Blood <b>{{ p.blood }}</b></span><span><lucide-icon name="phone" [size]="13"></lucide-icon> {{ p.mobile }}</span>
            <span>Primary doctor <b>{{ store.dname(p.primaryDoctorId) }}</b></span>
            @if (p.abha) { <span>ABHA <b>{{ p.abha }}</b></span> }
            <span>@if (p.insurance) { <b>{{ store.provider(p.insurance.providerId)?.name }}</b> · {{ p.insurance.policyNo }} } @else { Self pay }</span>
          </div>
          <div class="chips" style="margin-top:10px">
            @for (a of p.allergies; track a) { <span class="st r"><lucide-icon name="triangle-alert" [size]="12"></lucide-icon>{{ a }} allergy</span> }
            @if (!p.allergies.length) { <span class="st n">No known allergies</span> }
            @for (c of p.conditions; track c) { <span class="st b">{{ c }}</span> }
          </div>
        </div>
        <div class="acts">
          <a class="btn ghost sm" routerLink="/appointments/new" [queryParams]="{ patient: p.id }"><lucide-icon name="calendar-plus" [size]="15"></lucide-icon>Book</a>
          @if (session.is(['doctor', 'admin', 'super-admin'])) { <a class="btn sm" [routerLink]="['/consultation', p.id]"><lucide-icon name="stethoscope" [size]="15"></lucide-icon>Consult</a> }
          <button class="btn ghost sm" [matMenuTriggerFor]="more">More<lucide-icon name="chevron-down" [size]="14"></lucide-icon></button>
          <mat-menu #more="matMenu">
            <button mat-menu-item routerLink="/billing/new" [queryParams]="{ patient: p.id }">Create invoice</button>
            <button mat-menu-item routerLink="/lab/orders" [queryParams]="{ patient: p.id }">Order lab test</button>
            <button mat-menu-item [routerLink]="['/clinical-notes', p.id]">Clinical notes history</button>
            <button mat-menu-item routerLink="/ipd/admit" [queryParams]="{ patient: p.id }">Admit patient</button>
            <button mat-menu-item (click)="edit.set(true)">Edit demographics</button>
            <button mat-menu-item (click)="printCard()">Print patient card</button>
          </mat-menu>
        </div>
      </div>
    </div>

    <div class="tabs" role="tablist">
      @for (t of tabs; track t.id) { <button role="tab" [class.on]="tab() === t.id" [attr.aria-selected]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }} @if (t.n) { <span class="muted">· {{ t.n() }}</span> }</button> }
    </div>

    @switch (tab()) {
    @case ('overview') {
      <div class="grid">
        <div class="card c8">
          <div class="card-h"><h3>Latest vitals</h3><span class="r muted small">{{ last() ? (last()!.date | d:true) : 'No visits yet' }}</span></div>
          @if (last(); as c) {
          <div class="vit">
            <div class="soft"><small>Blood pressure</small><b>{{ c.vitals.bp }}</b></div>
            <div class="soft"><small>Pulse</small><b>{{ c.vitals.hr }}</b> <span class="muted small">bpm</span></div>
            <div class="soft"><small>SpO₂</small><b>{{ c.vitals.spo2 }}%</b></div>
            <div class="soft"><small>Temperature</small><b>{{ c.vitals.temp }}°F</b></div>
            <div class="soft"><small>Weight</small><b>{{ c.vitals.weight }}</b> <span class="muted small">kg</span></div>
            <div class="soft"><small>BMI</small><b>{{ bmi() }}</b></div>
          </div>
          <div class="section-title" style="margin-top:14px">Last diagnosis</div>
          <div class="chips">@for (d of c.dx; track d.code) { <span class="st b">{{ d.code }} · {{ d.label }}</span> }</div>
          <p class="muted" style="margin-top:8px">{{ c.plan || c.assessment }}</p>
          } @else { <cf-empty icon="stethoscope" title="No consultations yet" text="Vitals appear here after the first visit."></cf-empty> }
        </div>
        <div class="card c4">
          <div class="card-h"><h3>Upcoming</h3></div>
          <div class="list">
            @for (a of upcoming(); track a.id) {
              <div class="li"><cf-avatar [name]="store.dname(a.doctorId)"></cf-avatar><div class="grow"><b>{{ a.date | d }} · {{ a.time | time12 }}</b><span>{{ store.dname(a.doctorId) }} · {{ a.type }}</span></div><cf-status [s]="a.status"></cf-status></div>
            } @empty { <p class="muted small">No upcoming appointments.</p> }
            @for (f of followUps(); track f.id) {
              <div class="li"><span class="av" style="background:var(--amber-soft);color:var(--amber)"><lucide-icon name="calendar-clock" [size]="16"></lucide-icon></span><div class="grow"><b>Follow-up due {{ f.due | d }}</b><span>{{ f.reason }}</span></div><cf-status [s]="f.status"></cf-status></div>
            }
          </div>
        </div>
        <div class="card c6">
          <div class="card-h"><h3>Medical background</h3></div>
          <div class="kv">
            <div><small>History</small><b>{{ p.history || '—' }}</b></div>
            <div><small>Current medicines</small><b>{{ p.medications || '—' }}</b></div>
            <div><small>Surgical history</small><b>{{ p.surgicalHistory || '—' }}</b></div>
            <div><small>Family history</small><b>{{ p.familyHistory || '—' }}</b></div>
          </div>
        </div>
        <div class="card c6">
          <div class="card-h"><h3>Contact &amp; emergency</h3></div>
          <div class="kv">
            <div><small>Address</small><b>{{ p.address.line }}, {{ p.address.city }} {{ p.address.pin }}</b></div>
            <div><small>Email</small><b>{{ p.email || '—' }}</b></div>
            <div><small>Emergency contact</small><b>{{ p.emergency.name }} ({{ p.emergency.relation }})</b></div>
            <div><small>Emergency phone</small><b>{{ p.emergency.phone }}</b></div>
          </div>
        </div>
        @if (trend().length > 1) {
        <div class="card c6"><div class="card-h"><h3>HbA1c trend</h3><span class="r muted small">target under 7%</span></div>
          <cf-chart type="line" [labels]="trendLabels()" [datasets]="[{ data: trend(), borderColor: '--pri', backgroundColor: '--pri-soft', fill: true, tension: .35 }]" [height]="200" [options]="{ scales: { y: { suggestedMin: 5, suggestedMax: 10 } } }"></cf-chart></div>
        }
        <div class="card" [class.c6]="trend().length > 1" [class.c12]="trend().length <= 1">
          <div class="card-h"><h3>Financial summary</h3></div>
          <div class="kv">
            <div><small>Billed to date</small><b>{{ fin().total | inr }}</b></div>
            <div><small>Paid</small><b>{{ fin().paid | inr }}</b></div>
            <div><small>Outstanding</small><b [style.color]="fin().due ? 'var(--red)' : ''">{{ fin().due | inr }}</b></div>
            <div><small>Claims</small><b>{{ claims().length }}</b></div>
          </div>
        </div>
      </div>
    }
    @case ('visits') {
      <div class="card">
        <div class="list">
          @for (c of visits(); track c.id) {
            <div class="li"><span class="av"><lucide-icon name="stethoscope" [size]="16"></lucide-icon></span>
              <div class="grow"><b>{{ c.date | d:true }} · {{ store.dname(c.doctorId) }}</b><span>{{ c.cc || c.template }} · {{ dxText(c) }}</span></div>
              <cf-status [s]="c.status"></cf-status><a class="btn ghost sm" [routerLink]="['/clinical-notes', p.id]">Notes</a></div>
          } @empty { <cf-empty icon="stethoscope" title="No visits recorded"></cf-empty> }
        </div>
        <div class="section-title" style="margin-top:12px">Appointments</div>
        <cf-table [rows]="appts()" [cols]="apptCols" [pageSize]="6"></cf-table>
      </div>
    }
    @case ('rx') {
      <div class="card">
        <div class="card-h"><h3>Prescriptions</h3>@if (session.is(['doctor','admin','super-admin'])) {<a class="btn sm r" routerLink="/prescriptions/new" [queryParams]="{ patient: p.id }"><lucide-icon name="plus" [size]="15"></lucide-icon>New prescription</a>}</div>
        <div class="list">
          @for (r of rx(); track r.id) {
            <div class="li"><span class="av" style="background:var(--violet-soft);color:var(--violet)"><lucide-icon name="pill" [size]="16"></lucide-icon></span>
              <div class="grow"><b>{{ r.date | d:true }} · {{ r.diagnosis || 'Prescription' }}</b><span>{{ rxItems(r) }}</span></div>
              <cf-status [s]="r.status"></cf-status></div>
          } @empty { <cf-empty icon="pill" title="No prescriptions"></cf-empty> }
        </div>
      </div>
    }
    @case ('diag') {
      <div class="grid">
        <div class="card c6"><div class="card-h"><h3>Lab orders</h3></div>
          <div class="list">@for (o of labs(); track o.id) {
            <div class="li"><span class="av" style="background:var(--blue-soft);color:var(--blue)"><lucide-icon name="flask-conical" [size]="16"></lucide-icon></span>
              <div class="grow"><b>{{ store.names(o.testIds) }}</b><span>{{ o.id }} · {{ o.date | d }}</span></div><cf-status [s]="o.status"></cf-status>
              @if (o.status === 'Verified' || o.status === 'Delivered') { <a class="btn ghost sm" [routerLink]="['/lab/report', o.id]">Report</a> }</div>
          } @empty { <p class="muted small">No lab orders.</p> }</div></div>
        <div class="card c6"><div class="card-h"><h3>Imaging</h3></div>
          <div class="list">@for (o of imaging(); track o.id) {
            <div class="li"><span class="av" style="background:var(--pink-soft);color:var(--pink)"><lucide-icon name="scan-line" [size]="16"></lucide-icon></span>
              <div class="grow"><b>{{ o.modality }} · {{ o.study }}</b><span>{{ o.date | d }} · {{ o.impression || 'Report pending' }}</span></div><cf-status [s]="o.status"></cf-status></div>
          } @empty { <p class="muted small">No imaging studies.</p> }</div></div>
      </div>
    }
    @case ('billing') {
      <div class="card">
        <div class="card-h"><h3>Invoices</h3><a class="btn sm r" routerLink="/billing/new" [queryParams]="{ patient: p.id }"><lucide-icon name="plus" [size]="15"></lucide-icon>New invoice</a></div>
        <div class="list">@for (i of invoices(); track i.id) {
          <div class="li"><span class="av" style="background:var(--amber-soft);color:var(--amber)"><lucide-icon name="receipt" [size]="16"></lucide-icon></span>
            <div class="grow"><b>{{ i.id }} · {{ i.kind }}</b><span>{{ i.date | d:true }} · {{ i.items.length }} items</span></div>
            <b class="tnum">{{ store.invoiceTotals(i).total | inr }}</b><cf-status [s]="i.status"></cf-status><a class="btn ghost sm" [routerLink]="['/billing/invoice', i.id]">Open</a></div>
        } @empty { <cf-empty icon="receipt" title="No invoices"></cf-empty> }</div>
      </div>
    }
    @case ('docs') {
      <div class="card">
        <div class="card-h"><h3>Documents</h3><label class="btn sm r"><lucide-icon name="upload" [size]="15"></lucide-icon>Upload<input type="file" hidden (change)="upload($event)"></label></div>
        <div class="list doclist">@for (d of p.documents; track d.id) {
          <div class="li"><lucide-icon name="file-text" [size]="20"></lucide-icon><div class="grow"><b>{{ d.name }}</b><span>{{ d.type }} · {{ d.date | d:true }} · {{ d.size }}</span></div>
            <button class="btn ghost sm" (click)="toast.info('Document preview is simulated in this prototype')"><lucide-icon name="eye" [size]="14"></lucide-icon>View</button></div>
        } @empty { <cf-empty icon="file-text" title="No documents" text="Upload ID proofs, referral letters or old reports."></cf-empty> }</div>
        <p class="hint" style="margin-top:8px">Files stay in this browser only. No document leaves the prototype.</p>
      </div>
    }
    @case ('timeline') {
      <div class="card">
        <div class="tl">@for (e of timeline(); track $index) {
          <div class="tl-row"><time>{{ e.date | d }}</time><span class="dot" [style.background]="e.color"></span><div><b>{{ e.title }}</b><span class="sub">{{ e.sub }}</span></div></div>
        }</div>
      </div>
    }
    }
  </div>

  <cf-drawer [open]="edit()" title="Edit demographics" [sub]="p.id" (closed)="edit.set(false)">
    <div class="stack">
      <div class="field"><label>Mobile</label><input class="inp" [(ngModel)]="form.mobile"></div>
      <div class="field"><label>Email</label><input class="inp" [(ngModel)]="form.email"></div>
      <div class="field"><label>Address</label><input class="inp" [(ngModel)]="form.line"></div>
      <div class="field"><label>Emergency contact phone</label><input class="inp" [(ngModel)]="form.ephone"></div>
    </div>
    <div foot><button class="btn ghost" (click)="edit.set(false)">Cancel</button><button class="btn" (click)="saveEdit()">Save changes</button></div>
  </cf-drawer>
  } @else {
    <cf-empty icon="user-x" title="Patient not found" text="The UHID may be wrong or the record was removed in this demo."><a class="btn" routerLink="/patients" style="margin-top:12px">Back to directory</a></cf-empty>
  }`
})
export class ProfilePage {
  printer = inject(ExportService);
  store = inject(StoreService); toast = inject(ToastService); session = inject(SessionService); router = inject(Router);
  id = input<string>('');
  tab = signal<Tab>('overview'); edit = signal(false);
  form = { mobile: '', email: '', line: '', ephone: '' };

  p = computed(() => { this.store.rev(); const p = this.store.patient(this.id()); if (p) this.form = { mobile: p.mobile, email: p.email || '', line: p.address.line, ephone: p.emergency.phone }; return p; });
  adm = computed(() => { this.store.rev(); return this.store.admissionFor(this.id()); });
  visits = computed(() => { this.store.rev(); return this.store.db.consultations.filter(c => c.patientId === this.id()).sort((a, b) => b.date.localeCompare(a.date)); });
  last = computed(() => this.visits().find(c => c.status === 'Completed') ?? this.visits()[0]);
  bmi = computed(() => { const v = this.last()?.vitals; if (!v?.height || !v.weight) return '—'; return (v.weight / ((v.height / 100) ** 2)).toFixed(1); });
  appts = computed(() => { this.store.rev(); return this.store.db.appointments.filter(a => a.patientId === this.id()).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)); });
  upcoming = computed(() => this.appts().filter(a => a.date >= this.store.today() && !['Completed', 'Cancelled', 'No-show'].includes(a.status)).reverse().slice(0, 3));
  followUps = computed(() => { this.store.rev(); return this.store.db.followUps.filter(f => f.patientId === this.id() && f.status !== 'Completed').slice(0, 2); });
  rx = computed(() => { this.store.rev(); return this.store.db.prescriptions.filter(r => r.patientId === this.id()); });
  labs = computed(() => { this.store.rev(); return this.store.db.labOrders.filter(o => o.patientId === this.id()); });
  imaging = computed(() => { this.store.rev(); return this.store.db.imaging.filter(o => o.patientId === this.id()); });
  invoices = computed(() => { this.store.rev(); return this.store.db.invoices.filter(i => i.patientId === this.id()); });
  claims = computed(() => { this.store.rev(); return this.store.db.claims.filter(c => c.patientId === this.id()); });
  fin = computed(() => this.invoices().reduce((t, i) => { const x = this.store.invoiceTotals(i); return { total: t.total + x.total, paid: t.paid + x.paid, due: t.due + x.due }; }, { total: 0, paid: 0, due: 0 }));
  private hba1c = computed(() => this.labs().filter(o => o.results['L04']?.['HbA1c'] != null).sort((a, b) => a.date.localeCompare(b.date)));
  trend = computed(() => this.hba1c().map(o => o.results['L04']['HbA1c'] as number));
  trendLabels = computed(() => this.hba1c().map(o => fmtDate(o.date)));

  tabs: { id: Tab; label: string; n?: () => number }[] = [
    { id: 'overview', label: 'Overview' }, { id: 'visits', label: 'Visits', n: () => this.visits().length }, { id: 'rx', label: 'Prescriptions', n: () => this.rx().length },
    { id: 'diag', label: 'Lab & imaging', n: () => this.labs().length + this.imaging().length }, { id: 'billing', label: 'Billing', n: () => this.invoices().length },
    { id: 'docs', label: 'Documents', n: () => this.p()?.documents.length ?? 0 }, { id: 'timeline', label: 'Timeline' },
  ];
  apptCols = [
    { key: 'date', label: 'Date' }, { key: 'time', label: 'Time' }, { key: 'doctor', label: 'Doctor', value: (a: { doctorId: string }) => this.store.dname(a.doctorId) },
    { key: 'type', label: 'Type' }, { key: 'status', label: 'Status' },
  ];

  timeline = computed(() => {
    const ev: { date: string; title: string; sub: string; color: string }[] = [];
    this.visits().forEach(c => ev.push({ date: c.date, title: `Consultation with ${this.store.dname(c.doctorId)}`, sub: this.dxText(c) || c.template, color: 'var(--pri)' }));
    this.labs().forEach(o => ev.push({ date: o.date, title: `Lab: ${this.store.names(o.testIds)}`, sub: o.status, color: 'var(--blue)' }));
    this.imaging().forEach(o => ev.push({ date: o.date, title: `${o.modality}: ${o.study}`, sub: o.status, color: 'var(--pink)' }));
    this.rx().forEach(r => ev.push({ date: r.date, title: `Prescription (${r.items.length} medicines)`, sub: r.status, color: 'var(--violet)' }));
    this.invoices().forEach(i => ev.push({ date: i.date, title: `Invoice ${i.id}`, sub: `${i.status}`, color: 'var(--amber)' }));
    const p = this.p(); if (p) ev.push({ date: p.registered, title: 'Registered at HospitOS', sub: `UHID ${p.id}`, color: 'var(--green)' });
    return ev.sort((a, b) => b.date.localeCompare(a.date));
  });

  dxText(c: { dx: { label: string }[] }) { return c.dx.map(d => d.label).join(', '); }
  rxItems(r: { items: { name: string; strength: string }[] }) { return r.items.map(i => `${i.name} ${i.strength}`).join(' · '); }
  upload(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0]; const p = this.p(); if (!f || !p) return;
    p.documents.unshift({ id: this.store.uid('DOC'), name: f.name, type: 'Uploaded', date: this.store.today(), size: `${Math.max(1, Math.round(f.size / 1024))} KB` });
    this.store.log('Uploaded', 'Document', `${f.name} for ${p.name}`); this.store.changed(); this.toast.ok(`${f.name} added to the record`);
  }
  saveEdit() {
    const p = this.p(); if (!p) return;
    if (!/^(\+91\s?)?[6-9]\d{4}\s?\d{5}$/.test(this.form.mobile.trim())) { this.toast.err('Enter a valid 10-digit Indian mobile number'); return; }
    this.store.updatePatient(p.id, { mobile: this.form.mobile, email: this.form.email, address: { ...p.address, line: this.form.line }, emergency: { ...p.emergency, phone: this.form.ephone } });
    this.edit.set(false); this.toast.ok('Patient details updated');
  }
  printCard() { this.printer.print(); }
}
