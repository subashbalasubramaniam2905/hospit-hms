import { Component, computed, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ExportService } from '../../core/services/export.service';
import { Admission, ClinicalNote, MarEntry } from '../../core/models';
import { news2 } from '../../core/data/clinical';

type Tab = 'overview' | 'notes' | 'mar' | 'obs' | 'io' | 'bill' | 'discharge';

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.news { font-weight:800; border-radius:8px; padding:2px 8px } .io { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px } .io .soft b { font-size:22px; display:block }
    .chk { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:6px }`],
  template: `
  @if (a(); as a) { @let p = store.patient(a.patientId);
  <div class="page">
    <cf-page-head [title]="p?.name || ''" [crumbs]="['IPD', a.id]" [sub]="store.bed(a.bedId)?.label + ' · ' + store.ward(store.bed(a.bedId)?.wardId)?.name + ' · day ' + los() + ' · ' + store.dname(a.doctorId)">
      <a class="btn ghost" routerLink="/ipd">All inpatients</a>
      @if (a.status !== 'Discharged') { <button class="btn" (click)="tab.set('discharge')"><lucide-icon name="log-out" [size]="16"></lucide-icon>Discharge</button> }
    </cf-page-head>
    <div class="card row">
      <cf-avatar [name]="p?.name || ''" size="lg"></cf-avatar>
      <div style="flex:1"><div class="row"><b>{{ a.diagnosis }}</b><cf-status [s]="a.status"></cf-status><cf-status [s]="a.type" tone="b"></cf-status></div>
        <div class="small muted">{{ p?.dob | age }} y {{ p?.gender }} · {{ p?.id }} · admitted {{ a.admittedOn | d:true }} · expected discharge {{ a.expectedDischarge | d:true }}</div>
        <div class="chips" style="margin-top:6px">@for (al of p?.allergies; track al) {<span class="st r">{{ al }} allergy</span>}@for (c of p?.conditions; track c) {<span class="st b">{{ c }}</span>}</div></div>
      @if (latest(); as o) { <div style="text-align:right"><div class="small muted">NEWS2</div><span class="news" [style.background]="o.news >= 5 ? 'var(--red-soft)' : o.news >= 3 ? 'var(--amber-soft)' : 'var(--green-soft)'" [style.color]="o.news >= 5 ? 'var(--red)' : o.news >= 3 ? 'var(--amber)' : 'var(--green)'" style="font-size:20px">{{ o.news }}</span></div> }
    </div>
    <div class="tabs">@for (t of tabs; track t.id) {<button [class.on]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button>}</div>

    @switch (tab()) {
    @case ('overview') {
      <div class="grid">
        <div class="card c6"><div class="card-h"><h3>Care plan</h3></div>
          <div class="stack-s">@for (c of a.carePlan; track $index) {<div class="row"><lucide-icon name="circle-check" [size]="16" style="color:var(--pri)"></lucide-icon><span>{{ c }}</span></div>}</div>
          <div class="row" style="margin-top:10px"><input class="inp" style="flex:1" [(ngModel)]="cp" placeholder="Add care plan item" (keydown.enter)="addCp(a)"><button class="btn sm" (click)="addCp(a)">Add</button></div></div>
        <div class="card c6"><div class="card-h"><h3>Latest observations</h3><span class="r muted small">{{ latest()?.time }}</span></div>
          @if (latest(); as o) { <div class="kv"><div><small>BP</small><b>{{ o.bp }}</b></div><div><small>Pulse</small><b>{{ o.hr }}</b></div><div><small>SpO₂</small><b>{{ o.spo2 }}%</b></div><div><small>Temp</small><b>{{ o.temp }}°F</b></div><div><small>Resp. rate</small><b>{{ o.rr }}</b></div><div><small>Pain</small><b>{{ o.pain }}/10</b></div></div>
            @if (o.news >= 5) { <div class="alert-box crit" style="margin-top:10px"><lucide-icon name="siren" [size]="16"></lucide-icon>NEWS2 {{ o.news }}: urgent review by the doctor on duty. <span class="demo-tag">Demo score</span></div> } }
          @else { <p class="muted small">No observations yet.</p> }</div>
        <div class="card c12"><div class="card-h"><h3>Recent notes</h3><button class="r linkbtn" (click)="tab.set('notes')">All notes</button></div>
          <div class="tl">@for (n of a.notes.slice(0, 3); track n.id) {<div class="tl-row"><time>{{ n.date.slice(11) }}</time><span class="dot"></span><div><b>{{ n.type }} · {{ n.author }}</b><span class="sub">{{ n.text }}</span></div></div>}</div></div>
      </div>
    }
    @case ('notes') {
      <div class="card stack">
        @if (a.status !== 'Discharged') { <div class="soft stack-s">
          <div class="row"><b>Add note</b><span class="spacer"></span><div class="chips">@for (t of noteTypes; track t) {<button class="chip" [class.on]="nType === t" (click)="nType = t">{{ t }}</button>}</div></div>
          <div class="row"><textarea class="inp" style="flex:1" [(ngModel)]="nText" placeholder="Progress, round findings, plan…"></textarea><cf-voice text=" Patient comfortable. Afebrile overnight. Tolerating oral diet. Continue current antibiotics." (chunk)="nText = nText + $event"></cf-voice></div>
          <div class="row"><span class="spacer"></span><button class="btn sm" [disabled]="!nText.trim()" (click)="addNote(a)">Save note</button></div></div> }
        <div class="tl">@for (n of a.notes; track n.id) {<div class="tl-row"><time>{{ n.date | d }}<br>{{ n.date.slice(11) }}</time><span class="dot" [style.background]="n.type === 'Nursing' ? 'var(--pink)' : n.type === 'Handover' ? 'var(--amber)' : 'var(--pri)'"></span><div><b>{{ n.type }} · {{ n.author }}</b><span class="sub" style="white-space:pre-line">{{ n.text }}</span></div></div>}</div>
      </div>
    }
    @case ('mar') {
      <div class="card">
        <div class="card-h"><h3>Medication administration record · today</h3><span class="r muted small">{{ given() }} given · {{ due() }} due</span></div>
        <div class="tbl"><table class="t"><thead><tr><th>Time</th><th>Medicine</th><th>Dose</th><th>Route</th><th>Status</th><th>By</th><th></th></tr></thead><tbody>
          @for (m of a.mar; track m.id) { <tr><td><b>{{ m.time }}</b></td><td>{{ m.med }}</td><td>{{ m.dose }}</td><td>{{ m.route }}</td><td><cf-status [s]="m.status"></cf-status></td><td class="small">{{ m.by || '—' }}</td>
            <td>@if (m.status === 'Due') {<div class="row" style="gap:6px"><button class="btn sm" (click)="mar(m, 'Given')">Give</button><button class="btn ghost sm" (click)="mar(m, 'Held')">Hold</button></div>}</td></tr> }
        </tbody></table></div>
        <div class="soft row" style="margin-top:12px"><input class="inp" style="flex:2" [(ngModel)]="nm.med" placeholder="Medicine, e.g. Paracetamol 650 mg"><input class="inp" style="flex:1" [(ngModel)]="nm.dose" placeholder="Dose"><select class="inp" style="flex:1" [(ngModel)]="nm.route"><option>PO</option><option>IV</option><option>IM</option><option>SC</option></select><input class="inp" style="flex:1" type="time" [(ngModel)]="nm.time"><button class="btn sm" [disabled]="!nm.med" (click)="addMar(a)">Add order</button></div>
      </div>
    }
    @case ('obs') {
      <div class="grid">
        <div class="card c8"><div class="card-h"><h3>Vitals trend</h3></div>
          <cf-chart type="line" [labels]="obsLabels()" [datasets]="[{ label: 'Pulse', data: obsHr(), borderColor: '--pink', tension: .3 }, { label: 'SpO₂', data: obsSpo2(), borderColor: '--blue', tension: .3 }, { label: 'NEWS2 × 10', data: obsNews(), borderColor: '--amber', borderDash: [4, 4], tension: .3 }]" [legend]="true" [height]="240"></cf-chart></div>
        <div class="card c4 stack-s"><b>Record observations</b>
          <div class="form-grid"><div class="field"><label>BP</label><input class="inp" [(ngModel)]="ob.bp"></div><div class="field"><label>Pulse</label><input class="inp" type="number" [(ngModel)]="ob.hr"></div>
          <div class="field"><label>SpO₂</label><input class="inp" type="number" [(ngModel)]="ob.spo2"></div><div class="field"><label>Temp °F</label><input class="inp" type="number" step=".1" [(ngModel)]="ob.temp"></div>
          <div class="field"><label>Resp. rate</label><input class="inp" type="number" [(ngModel)]="ob.rr"></div><div class="field"><label>Pain 0–10</label><input class="inp" type="number" [(ngModel)]="ob.pain"></div></div>
          <div class="soft small">NEWS2 for these values: <b>{{ previewNews() }}</b> <span class="sim">Demo</span></div>
          <button class="btn sm" (click)="addObs(a)">Save observations</button></div>
      </div>
    }
    @case ('io') {
      <div class="card stack">
        <div class="io"><div class="soft"><small class="muted">Intake</small><b>{{ ioSum('Intake') }} ml</b></div><div class="soft"><small class="muted">Output</small><b>{{ ioSum('Output') }} ml</b></div><div class="soft"><small class="muted">Balance</small><b [style.color]="ioSum('Intake') - ioSum('Output') < 0 ? 'var(--red)' : 'var(--green)'">{{ ioSum('Intake') - ioSum('Output') }} ml</b></div></div>
        <div class="tbl"><table class="t"><thead><tr><th>Time</th><th>Type</th><th>Detail</th><th class="num">Volume</th></tr></thead><tbody>@for (e of a.io; track e.id) {<tr><td>{{ e.time }}</td><td><cf-status [s]="e.kind" [tone]="e.kind === 'Intake' ? 'b' : 'a'"></cf-status></td><td>{{ e.type }}</td><td class="num">{{ e.ml }} ml</td></tr>}</tbody></table></div>
        <div class="soft row"><select class="inp" style="flex:1" [(ngModel)]="ioN.kind"><option>Intake</option><option>Output</option></select><input class="inp" style="flex:2" [(ngModel)]="ioN.type" placeholder="Oral, IV fluids, urine, drain"><input class="inp" style="flex:1" type="number" [(ngModel)]="ioN.ml" placeholder="ml"><button class="btn sm" [disabled]="!ioN.ml" (click)="addIo(a)">Add</button></div>
      </div>
    }
    @case ('bill') {
      <div class="card stack">
        <div class="kv"><div><small>Room ({{ los() }} days × {{ store.ward(store.bed(a.bedId)?.wardId)?.rate | inr }})</small><b>{{ los() * (store.ward(store.bed(a.bedId)?.wardId)?.rate || 0) | inr }}</b></div><div><small>Nursing and visits</small><b>{{ los() * 1400 | inr }}</b></div><div><small>Advance paid</small><b>{{ a.advance | inr }}</b></div><div><small>Running estimate</small><b>{{ running() | inr }}</b></div></div>
        <div class="list">@for (i of invoices(); track i.id) {<div class="li"><div class="grow"><b>{{ i.id }}</b><span>{{ i.date | d }} · {{ i.items.length }} items</span></div><b>{{ store.invoiceTotals(i).total | inr }}</b><cf-status [s]="i.status"></cf-status><a class="btn ghost sm" [routerLink]="['/billing/invoice', i.id]">Open</a></div>}</div>
      </div>
    }
    @case ('discharge') {
      <div class="grid">
        <div class="card c8 stack">
          <div class="row"><h3 style="font-size:15.5px">Discharge summary</h3><span class="spacer"></span>@if (a.status !== 'Discharged') {<button class="btn soft-btn sm" (click)="draft(a)"><lucide-icon name="sparkles" [size]="14"></lucide-icon>Draft with AI (demo)</button>}</div>
          @if (drafted()) { <div class="alert-box ai"><lucide-icon name="sparkles" [size]="16"></lucide-icon>AI-drafted from notes and observations. The consultant must review and edit before signing.</div> }
          <textarea class="inp" rows="12" [(ngModel)]="summary" [disabled]="a.status === 'Discharged'" placeholder="Course in hospital, procedures, condition at discharge, medicines, follow-up"></textarea>
        </div>
        <div class="card c4 stack-s">
          <b>Discharge checklist</b>
          @for (c of checks; track c) { <mat-checkbox [checked]="done().includes(c)" (change)="toggle(c)" [disabled]="a.status === 'Discharged'">{{ c }}</mat-checkbox> }
          @if (a.status === 'Discharged') { <div class="alert-box ok"><lucide-icon name="circle-check" [size]="16"></lucide-icon>Discharged on {{ a.dischargeDate | d:true }}. Final bill created.</div> }
          @else { <button class="btn" [disabled]="done().length < checks.length || summary.trim().length < 20" (click)="discharge(a)">Sign and discharge</button><p class="hint">Creates the final IPD bill, frees the bed for cleaning and sends the summary to the patient (simulated).</p> }
          @if (a.status !== 'Discharged' && a.status !== 'Discharge planned') { <button class="btn ghost sm" (click)="plan(a)">Mark discharge planned</button> }
        </div>
      </div>
    }
    }
  </div>
  } @else { <cf-empty icon="bed" title="Admission not found"></cf-empty> }`
})
export class AdmissionPage {
  store = inject(StoreService); toast = inject(ToastService); router = inject(Router); printer = inject(ExportService);
  id = input<string>('');
  tabs: { id: Tab; label: string }[] = [{ id: 'overview', label: 'Overview' }, { id: 'notes', label: 'Notes' }, { id: 'mar', label: 'Medications (MAR)' }, { id: 'obs', label: 'Observations' }, { id: 'io', label: 'Intake / output' }, { id: 'bill', label: 'Billing' }, { id: 'discharge', label: 'Discharge' }];
  noteTypes: ClinicalNote['type'][] = ['Progress', 'Doctor round', 'Nursing'];
  checks = ['Final medicines reconciled', 'Pending reports reviewed', 'Follow-up appointment booked', 'Patient and family counselled', 'Bills cleared or approved'];
  tab = signal<Tab>((inject(ActivatedRoute).snapshot.queryParamMap.get('tab') as Tab) || 'overview'); done = signal<string[]>([]); drafted = signal(false);
  cp = ''; nType: ClinicalNote['type'] = 'Progress'; nText = ''; summary = '';
  nm = { med: '', dose: '', route: 'PO', time: '14:00' }; ob = { bp: '120/80', hr: 84, spo2: 97, temp: 98.6, rr: 16, pain: 2 }; ioN = { kind: 'Intake' as 'Intake' | 'Output', type: '', ml: 0 };

  a = computed(() => { this.store.rev(); const a = this.store.db.admissions.find(x => x.id === this.id()); if (a?.dischargeSummary && !this.summary) this.summary = a.dischargeSummary; return a; });
  los = computed(() => { const a = this.a(); return a ? Math.max(1, Math.round((Date.now() - new Date(a.admittedOn.slice(0, 10)).getTime()) / 864e5)) : 0; });
  latest = computed(() => { const o = this.a()?.obs || []; return o[o.length - 1]; });
  given = computed(() => (this.a()?.mar || []).filter(m => m.status === 'Given').length);
  due = computed(() => (this.a()?.mar || []).filter(m => m.status === 'Due').length);
  obsLabels = computed(() => (this.a()?.obs || []).map(o => o.time)); obsHr = computed(() => (this.a()?.obs || []).map(o => o.hr));
  obsSpo2 = computed(() => (this.a()?.obs || []).map(o => o.spo2)); obsNews = computed(() => (this.a()?.obs || []).map(o => o.news * 10));
  invoices = computed(() => { this.store.rev(); return this.store.db.invoices.filter(i => i.admissionId === this.id()); });
  running = computed(() => { const a = this.a(); if (!a) return 0; const w = this.store.ward(this.store.bed(a.bedId)?.wardId); return this.los() * ((w?.rate || 0) + 1400) + this.invoices().reduce((t, i) => t + this.store.invoiceTotals(i).total, 0); });
  previewNews() { return news2(this.ob); }
  ioSum(k: string) { return (this.a()?.io || []).filter(e => e.kind === k).reduce((t, e) => t + e.ml, 0); }

  addCp(a: Admission) { if (!this.cp.trim()) return; a.carePlan.push(this.cp.trim()); this.cp = ''; this.store.changed(); }
  addNote(a: Admission) { a.notes.unshift({ id: this.store.uid('N'), date: this.store.nowStamp(), author: this.nType === 'Nursing' ? 'Nurse Rekha Pillai' : this.store.dname(a.doctorId), type: this.nType, text: this.nText.trim() }); this.nText = ''; this.store.log('Created', 'Clinical note', `${a.id} ${this.nType}`); this.store.changed(); this.toast.ok('Note saved'); }
  mar(m: MarEntry, s: MarEntry['status']) { m.status = s; m.by = 'Nurse Rekha Pillai'; this.store.log('Updated', 'MAR', `${m.med} ${s}`); this.store.changed(); this.toast.ok(`${m.med} marked ${s.toLowerCase()}`); }
  addMar(a: Admission) { a.mar.push({ id: this.store.uid('MA'), med: this.nm.med, dose: this.nm.dose || '—', route: this.nm.route, time: this.nm.time, date: this.store.today(), status: 'Due' }); a.mar.sort((x, y) => x.time.localeCompare(y.time)); this.nm = { med: '', dose: '', route: 'PO', time: '14:00' }; this.store.changed(); this.toast.ok('Medication order added to the MAR'); }
  addObs(a: Admission) {
    const n = news2(this.ob); a.obs.push({ time: this.store.nowTime(), ...this.ob, news: n }); this.store.changed();
    if (n >= 5) { this.store.raiseAlert({ priority: 'High', category: 'Clinical', dept: this.store.ward(this.store.bed(a.bedId)?.wardId)?.name || 'Ward', title: `NEWS2 ${n} for ${this.store.pname(a.patientId)}`, detail: 'Escalate to the doctor on duty (demo early-warning rule).', assignee: this.store.dname(a.doctorId), link: '/ipd/admission/' + a.id }); this.toast.warn(`NEWS2 ${n}. Escalation alert raised (demo).`); }
    else this.toast.ok(`Observations saved. NEWS2 ${n}.`);
  }
  addIo(a: Admission) { a.io.push({ id: this.store.uid('IO'), time: this.store.nowTime(), kind: this.ioN.kind, type: this.ioN.type || (this.ioN.kind === 'Intake' ? 'Oral' : 'Urine'), ml: +this.ioN.ml }); this.ioN.ml = 0; this.ioN.type = ''; this.store.changed(); }
  toggle(c: string) { this.done.update(d => d.includes(c) ? d.filter(x => x !== c) : [...d, c]); }
  draft(a: Admission) {
    const p = this.store.patient(a.patientId)!; const last = this.latest();
    this.summary = `${p.name}, ${this.store.age(p.dob)} y ${p.gender.toLowerCase()}, was admitted on ${a.admittedOn.slice(0, 10)} under ${this.store.dname(a.doctorId)} with ${a.reason.toLowerCase()}.\n\nDiagnosis: ${a.diagnosis}.\n\nCourse in hospital: ${a.notes.slice(0, 3).reverse().map(n => n.text).join(' ')}\n\nCondition at discharge: stable.${last ? ` Last vitals BP ${last.bp}, pulse ${last.hr}, SpO2 ${last.spo2}%.` : ''}\n\nMedicines on discharge: [doctor to confirm]\n\nFollow-up: review in OPD after 7 days, earlier if fever, breathlessness or worsening symptoms.`;
    this.drafted.set(true); this.store.log('Generated', 'AI draft', `Discharge summary draft for ${a.id}`, 'Sensitive'); this.toast.info('Draft created. Review every line before signing.');
  }
  plan(a: Admission) { a.status = 'Discharge planned'; this.store.changed(); this.toast.ok('Marked as discharge planned. Billing and pharmacy notified (simulated).'); }
  discharge(a: Admission) { this.store.discharge(a, this.summary); this.toast.ok(`${this.store.pname(a.patientId)} discharged. Final bill created and bed sent for cleaning.`); }
}
