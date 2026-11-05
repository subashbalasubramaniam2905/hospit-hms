import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { Admission, MarEntry, QueueEntry } from '../../core/models';
import { news2 } from '../../core/data/clinical';
import { SessionService } from '../../core/services/session.service';
import { LiveSync } from '../../core/api/live-sync';
import { IpdApi } from '../../core/api/ipd-api';

type Tab = 'ward' | 'triage' | 'handover';

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.pc { display:flex; flex-direction:column; gap:8px } .pc .top { display:flex; gap:10px; align-items:center } .news { font-weight:800; border-radius:8px; padding:2px 8px; font-size:12px } .due { display:flex; gap:6px; flex-wrap:wrap }
    .sbar { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px } @media (max-width:760px){ .sbar { grid-template-columns:minmax(0,1fr) } }`],
  template: `
  <div class="page">
    <cf-page-head title="Nursing station" [crumbs]="['Clinical', 'Nursing']" sub="Ward tasks, OPD triage and shift handover in one place.">
      <select class="inp" style="width:auto" [ngModel]="ward()" (ngModelChange)="ward.set($event)" aria-label="Ward"><option value="">All wards</option>@for (w of store.db.wards; track w.id) {<option [value]="w.id">{{ w.name }}</option>}</select>
    </cf-page-head>
    <div class="grid">
      <cf-stat class="c3" label="Patients on ward" [value]="patients().length" icon="bed" tone="pri"></cf-stat>
      <cf-stat class="c3" label="Medicines due now" [value]="dueMeds().length" icon="syringe" tone="amber" [clickable]="true" (click)="tab.set('ward')"></cf-stat>
      <cf-stat class="c3" label="Waiting for triage" [value]="triage().length" icon="clipboard-plus" tone="blue" [clickable]="true" (click)="tab.set('triage')"></cf-stat>
      <cf-stat class="c3" label="NEWS2 ≥ 5" [value]="sick()" icon="heart-pulse" tone="red"></cf-stat>
    </div>
    <div class="tabs"><button [class.on]="tab() === 'ward'" (click)="tab.set('ward')">Ward tasks</button><button [class.on]="tab() === 'triage'" (click)="tab.set('triage')">OPD triage · {{ triage().length }}</button><button [class.on]="tab() === 'handover'" (click)="tab.set('handover')">Shift handover</button></div>

    @switch (tab()) {
    @case ('ward') {
      <div class="cards-auto" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">
        @for (a of patients(); track a.id) { @let o = a.obs[a.obs.length - 1];
          <div class="card pc">
            <div class="top"><cf-avatar [name]="store.pname(a.patientId)"></cf-avatar><div style="flex:1;min-width:0"><b>{{ store.pname(a.patientId) }}</b><div class="small muted">{{ store.bed(a.bedId)?.label }} · {{ a.diagnosis }}</div></div>
              @if (o) {<span class="news" [style.background]="o.news >= 5 ? 'var(--red-soft)' : o.news >= 3 ? 'var(--amber-soft)' : 'var(--green-soft)'" [style.color]="o.news >= 5 ? 'var(--red)' : o.news >= 3 ? 'var(--amber)' : 'var(--green)'">NEWS {{ o.news }}</span>}</div>
            @if (o) { <div class="small muted">Last obs {{ o.time }} · BP {{ o.bp }} · HR {{ o.hr }} · SpO₂ {{ o.spo2 }}%</div> }
            <div class="due">@for (m of dueFor(a); track m.id) { <button class="chip" (click)="give(m)" [matTooltip]="'Mark given: ' + m.dose + ' ' + m.route"><lucide-icon name="syringe" [size]="12"></lucide-icon> {{ m.time }} {{ m.med }}</button> } @empty { <span class="small muted">No medicines due</span> }</div>
            <div class="row"><a class="btn ghost sm" [routerLink]="['/ipd/admission', a.id]" [queryParams]="{ tab: 'obs' }">Record vitals</a><a class="btn ghost sm" [routerLink]="['/ipd/admission', a.id]" [queryParams]="{ tab: 'mar' }">Open MAR</a></div>
          </div>
        } @empty { <div class="card"><cf-empty icon="bed" title="No patients on this ward"></cf-empty></div> }
      </div>
    }
    @case ('triage') {
      <div class="grid">
        <div class="card c5"><div class="card-h"><h3>Waiting for triage</h3></div>
          <div class="list">@for (q of triage(); track q.token) {
            <div class="li" style="cursor:pointer" (click)="pick(q)" (keydown.enter)="pick(q)" tabindex="0" role="button" [style.background]="sel()?.token === q.token ? 'var(--pri-soft)' : ''"><span class="st b">{{ q.token }}</span><div class="grow"><b>{{ store.pname(q.patientId) }}</b><span>{{ store.dname(q.doctorId) }} · waiting {{ q.since }} min</span></div>@if (q.priority) {<lucide-icon name="star" [size]="14" style="color:var(--amber)"></lucide-icon>}</div>
          } @empty { <p class="muted small">No one is waiting for triage.</p> }</div></div>
        <div class="card c7 stack">
          @if (sel(); as q) {
            <div class="row"><h3 style="font-size:16px">Triage · {{ store.pname(q.patientId) }}</h3><span class="spacer"></span><span class="st b">{{ q.token }}</span></div>
            @for (al of store.patient(q.patientId)?.allergies; track al) {<div class="alert-box crit"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon>{{ al }} allergy</div>}
            <div class="form-grid three">
              <div class="field"><label>BP</label><input class="inp" [(ngModel)]="v.bp"></div><div class="field"><label>Pulse</label><input class="inp" type="number" [(ngModel)]="v.hr"></div><div class="field"><label>Temp °F</label><input class="inp" type="number" step=".1" [(ngModel)]="v.temp"></div>
              <div class="field"><label>SpO₂</label><input class="inp" type="number" [(ngModel)]="v.spo2"></div><div class="field"><label>Resp. rate</label><input class="inp" type="number" [(ngModel)]="v.rr"></div><div class="field"><label>Weight kg</label><input class="inp" type="number" [(ngModel)]="v.weight"></div>
            </div>
            <div class="field"><label>Chief complaint</label><input class="inp" [(ngModel)]="v.cc" placeholder="In the patient's words"></div>
            <div class="soft small">Early-warning score <b>{{ score() }}</b> <span class="sim">Demo NEWS2</span> @if (score() >= 5) {<b style="color:var(--red)"> · flag as priority</b>}</div>
            <div class="row"><mat-checkbox [(ngModel)]="v.prio">Mark as priority</mat-checkbox><span class="spacer"></span><button class="btn" (click)="sendIn(q)"><lucide-icon name="arrow-right" [size]="16"></lucide-icon>Save and send to doctor</button></div>
          } @else { <cf-empty icon="clipboard-plus" title="Choose a patient" text="Pick a token from the triage list."></cf-empty> }
        </div>
      </div>
    }
    @case ('handover') {
      <div class="card stack">
        <div class="row"><b>SBAR handover</b><span class="spacer"></span><select class="inp" style="width:auto" [(ngModel)]="hAdm"><option value="">Choose patient</option>@for (a of patients(); track a.id) {<option [value]="a.id">{{ store.pname(a.patientId) }} · {{ store.bed(a.bedId)?.label }}</option>}</select></div>
        <div class="sbar">
          <div class="field"><label>Situation</label><textarea class="inp" [(ngModel)]="h.s" placeholder="Current status and concern"></textarea></div>
          <div class="field"><label>Background</label><textarea class="inp" [(ngModel)]="h.b" placeholder="Diagnosis, relevant history"></textarea></div>
          <div class="field"><label>Assessment</label><textarea class="inp" [(ngModel)]="h.a" placeholder="Vitals trend, pain, lines, drains"></textarea></div>
          <div class="field"><label>Recommendation</label><textarea class="inp" [(ngModel)]="h.r" placeholder="What the next shift should do"></textarea></div>
        </div>
        <div class="row"><button class="btn ghost" [disabled]="!hAdm" (click)="prefill()"><lucide-icon name="sparkles" [size]="16"></lucide-icon>Prefill from record (demo)</button><span class="spacer"></span><button class="btn" [disabled]="!hAdm || !h.s" (click)="saveHandover()">Save handover note</button></div>
        <div class="section-title">Recent handovers</div>
        <div class="tl">@for (n of handovers(); track n.id) {<div class="tl-row"><time>{{ n.date.slice(11) }}</time><span class="dot" style="background:var(--amber)"></span><div><b>{{ n.who }}</b><span class="sub" style="white-space:pre-line">{{ n.text }}</span></div></div>} @empty {<p class="muted small">No handover notes yet this shift.</p>}</div>
      </div>
    }
    }
  </div>`
})
export class NursingPage {
  store = inject(StoreService); toast = inject(ToastService);
  private session = inject(SessionService); private sync = inject(LiveSync); private api = inject(IpdApi); live = this.session.live;
  constructor() {
    if (this.live) effect(() => { const b = this.session.branchId(); untracked(() => this.sync.loadIpd(b).catch(() => this.toast.err('Could not load ward patients from the server'))); });
  }
  tab = signal<Tab>('ward'); ward = signal(''); sel = signal<QueueEntry | null>(null);
  v = { bp: '124/80', hr: 82, temp: 98.4, spo2: 98, rr: 16, weight: 68, cc: '', prio: false };
  hAdm = ''; h = { s: '', b: '', a: '', r: '' };
  patients = computed(() => { this.store.rev(); return this.store.db.admissions.filter(a => a.status !== 'Discharged' && (!this.ward() || this.store.bed(a.bedId)?.wardId === this.ward())); });
  dueMeds = computed(() => this.patients().flatMap(a => this.dueFor(a)));
  sick = computed(() => this.patients().filter(a => (a.obs[a.obs.length - 1]?.news ?? 0) >= 5).length);
  triage = computed(() => { this.store.rev(); return this.store.db.queue.filter(q => q.step === 2).sort((a, b) => (+b.priority - +a.priority) || b.since - a.since); });
  handovers = computed(() => { this.store.rev(); return this.patients().flatMap(a => a.notes.filter(n => n.type === 'Handover').map(n => ({ ...n, who: this.store.pname(a.patientId) }))).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 6); });
  score() { return news2(this.v); }
  dueFor(a: Admission) { return a.mar.filter(m => m.status === 'Due'); }
  give(m: MarEntry) {
    if (this.live) { const a = this.store.db.admissions.find(x => x.mar.includes(m)); if (a) void this.sync.ipdAction(() => this.api.dose(a.id, m.id, 'Given'), () => `${m.med} marked as given`); return; }
    m.status = 'Given'; m.by = 'Nurse Rekha Pillai'; this.store.log('Updated', 'MAR', `${m.med} given`); this.store.changed(); this.toast.ok(`${m.med} marked as given`); }
  pick(q: QueueEntry) { this.sel.set(q); this.v = { bp: '124/80', hr: 82, temp: 98.4, spo2: 98, rr: 16, weight: 68, cc: '', prio: q.priority }; }
  sendIn(q: QueueEntry) {
    const p = this.store.patient(q.patientId)!; const c = this.store.draftFor(p.id, q.doctorId, q.appointmentId);
    Object.assign(c.vitals, { bp: this.v.bp, hr: +this.v.hr, temp: +this.v.temp, spo2: +this.v.spo2, rr: +this.v.rr, weight: +this.v.weight }); if (this.v.cc) c.cc = this.v.cc;
    q.priority = this.v.prio || this.score() >= 5; this.store.moveQueue(q.token, 3); this.toast.ok(`Vitals saved. ${q.token} sent to ${this.store.dname(q.doctorId)}.`); this.sel.set(null);
  }
  prefill() {
    const a = this.store.db.admissions.find(x => x.id === this.hAdm)!; const o = a.obs[a.obs.length - 1];
    this.h = { s: `${this.store.pname(a.patientId)} in ${this.store.bed(a.bedId)?.label}, day ${Math.max(1, Math.round((Date.now() - new Date(a.admittedOn.slice(0, 10)).getTime()) / 864e5))}.`, b: `${a.diagnosis}. Admitted for ${a.reason.toLowerCase()}.`, a: o ? `Last obs ${o.time}: BP ${o.bp}, HR ${o.hr}, SpO2 ${o.spo2}%, NEWS2 ${o.news}. Pain ${o.pain}/10.` : 'No observations recorded.', r: `${a.mar.filter(m => m.status === 'Due').length} medicines due. Continue care plan: ${a.carePlan.join('; ')}.` };
    this.toast.info('Prefilled from the record. Check and edit before saving.');
  }
  saveHandover() {
    if (this.live) { const text = `S: ${this.h.s}\nB: ${this.h.b}\nA: ${this.h.a}\nR: ${this.h.r}`; void this.sync.ipdAction(() => this.api.note(this.hAdm, 'Handover', text), () => 'Handover note saved to the patient record').then(r => { if (r) this.h = { s: '', b: '', a: '', r: '' }; }); return; }
    const a = this.store.db.admissions.find(x => x.id === this.hAdm)!; a.notes.unshift({ id: this.store.uid('N'), date: this.store.nowStamp(), author: 'Nurse Rekha Pillai', type: 'Handover', text: `S: ${this.h.s}\nB: ${this.h.b}\nA: ${this.h.a}\nR: ${this.h.r}` }); this.store.changed(); this.toast.ok('Handover note saved to the patient record'); this.h = { s: '', b: '', a: '', r: '' }; }
}
