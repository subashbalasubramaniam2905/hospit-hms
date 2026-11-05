import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ERCase, TriageLevel } from '../../core/models';
import { SessionService } from '../../core/services/session.service';
import { ErOtApi, ErUpdate, LiveERCase } from '../../core/api/er-ot-api';
import { DirectoryDoctor } from '../../core/api/lab-api';
import { apiMessage } from '../../core/api/auth.service';

const LEVELS: { id: TriageLevel; label: string; target: string; c: string }[] = [
  { id: 'Red', label: 'Red · immediate', target: 'Seen now', c: '--red' }, { id: 'Orange', label: 'Orange · very urgent', target: '10 min', c: '--pink' },
  { id: 'Yellow', label: 'Yellow · urgent', target: '60 min', c: '--amber' }, { id: 'Green', label: 'Green · standard', target: '120 min', c: '--green' },
];

@Component({
  standalone: true, imports: [SHARED],
  styles: [`
    .board { display:grid; grid-template-columns:repeat(4,minmax(220px,1fr)); gap:12px; overflow-x:auto }
    .lane { background:var(--card); border:1px solid var(--line); border-top:5px solid var(--c); border-radius:var(--r); padding:10px; display:flex; flex-direction:column; gap:8px; min-height:320px }
    .lane h4 { font-size:13px; display:flex; justify-content:space-between; padding:2px 4px 6px } .lane h4 small { color:var(--mut); font-weight:500 }
    .ec { background:var(--ground); border-radius:12px; padding:10px 12px; text-align:left; border:1px solid transparent; display:flex; flex-direction:column; gap:4px; color:var(--fg) }
    .ec:hover { border-color:var(--line) } .ec .t { display:flex; gap:6px; align-items:center } .ec small { color:var(--mut); font-size:12px }
    .vit { display:flex; gap:10px; flex-wrap:wrap; font-size:12px } .vit b { font-weight:700 } .bad { color:var(--red) }
  `],
  template: `
  <div class="page">
    <cf-page-head title="Emergency" [crumbs]="['Clinical', 'ER board']" sub="Live triage board. Unknown patients can be registered with a temporary ID and linked later.">
      <button class="btn danger" (click)="openNew(true)"><lucide-icon name="siren" [size]="16"></lucide-icon>Unknown patient</button>
      <button class="btn" (click)="openNew(false)"><lucide-icon name="plus" [size]="16"></lucide-icon>Register arrival</button>
    </cf-page-head>
    <div class="grid">
      <cf-stat class="c3" label="In the ER" [value]="active().length" icon="ambulance" tone="red" [sub]="byMode('Ambulance') + ' by ambulance'"></cf-stat>
      <cf-stat class="c3" label="Red and orange" [value]="crit()" icon="siren" tone="pink"></cf-stat>
      <cf-stat class="c3" label="Free bays" [value]="freeBays().length + ' of ' + bays().length" icon="bed" tone="pri"></cf-stat>
      <cf-stat class="c3" label="Admitted from ER today" [value]="admitted()" icon="log-out" tone="blue"></cf-stat>
    </div>
    <div class="board">
      @for (l of levels; track l.id) {
        <div class="lane" [style.--c]="'var(' + l.c + ')'"><h4>{{ l.label }}<small>{{ l.target }} · {{ lane(l.id).length }}</small></h4>
          @for (c of lane(l.id); track c.id) {
            <button class="ec" (click)="sel.set(c)">
              <div class="t"><b>{{ c.label }}</b>@if (!c.patientId) {<span class="st a" style="padding:1px 6px">Temp ID</span>}<span class="spacer"></span><small>{{ c.arrival }}</small></div>
              <small>{{ c.complaint }}</small>
              <div class="vit"><span [class.bad]="sys(c) < 100 || sys(c) > 180">BP <b>{{ c.vitals.bp }}</b></span><span [class.bad]="c.vitals.hr > 120">HR <b>{{ c.vitals.hr }}</b></span><span [class.bad]="c.vitals.spo2 < 92">SpO₂ <b>{{ c.vitals.spo2 }}</b></span><span [class.bad]="c.vitals.gcs < 13">GCS <b>{{ c.vitals.gcs }}</b></span></div>
              <small>{{ c.bay || 'Corridor' }} · {{ c.status }}{{ c.doctorId ? ' · ' + docName(c) : '' }}</small>
            </button>
          } @empty { <p class="muted small" style="text-align:center;padding:18px 0">None</p> }
        </div>
      }
    </div>
  </div>

  <cf-drawer [open]="newOpen()" [title]="unknown ? 'Unknown patient' : 'Register ER arrival'" sub="A temporary ER number is created now. Full registration can follow." (closed)="newOpen.set(false)">
    <div class="stack">
      @if (!unknown) { <div class="field"><label>Existing patient (optional)</label><select class="inp" [(ngModel)]="f.patientId"><option value="">Not registered yet</option>@for (p of store.db.patients.slice(0, 50); track p.id) {<option [value]="p.id">{{ p.name }} · {{ p.id }}</option>}</select></div> }
      <div class="form-grid"><div class="field"><label>Approx. age</label><input class="inp" type="number" [(ngModel)]="f.age"></div><div class="field"><label>Sex</label><select class="inp" [(ngModel)]="f.gender"><option>Male</option><option>Female</option><option>Unknown</option></select></div></div>
      <div class="field"><label>Arrival</label><div class="chips">@for (m of modes; track m) {<button class="chip" [class.on]="f.mode === m" (click)="f.mode = m">{{ m }}</button>}</div></div>
      <div class="field"><label>Presenting complaint <span class="req">*</span></label><input class="inp" [(ngModel)]="f.complaint"></div>
      <div class="form-grid four"><div class="field"><label>BP</label><input class="inp" [(ngModel)]="f.bp"></div><div class="field"><label>HR</label><input class="inp" type="number" [(ngModel)]="f.hr"></div><div class="field"><label>SpO₂</label><input class="inp" type="number" [(ngModel)]="f.spo2"></div><div class="field"><label>GCS</label><input class="inp" type="number" min="3" max="15" [(ngModel)]="f.gcs"></div></div>
      <div class="field"><label>Triage</label><div class="chips">@for (l of levels; track l.id) {<button class="chip" [class.on]="f.triage === l.id" (click)="f.triage = l.id">{{ l.id }}</button>}</div><span class="hint">Suggested from vitals: <b>{{ suggest() }}</b>{{ live ? '' : ' (demo rule)' }}</span></div>
      <div class="field"><label>Bay</label><select class="inp" [(ngModel)]="f.bay">@for (b of freeBays(); track b) {<option>{{ b }}</option>}<option value="">Corridor (no bay free)</option></select></div>
    </div>
    <div foot><button class="btn ghost" (click)="newOpen.set(false)">Cancel</button><button class="btn" [disabled]="!f.complaint || busy()" (click)="register()">Register</button></div>
  </cf-drawer>

  <cf-drawer [open]="!!sel()" [title]="sel()?.label || ''" [sub]="sel() ? sel()!.id + ' · arrived ' + sel()!.arrival + ' by ' + sel()!.mode.toLowerCase() : ''" width="min(520px,100%)" (closed)="sel.set(null)">
    @if (sel(); as c) {
      <div class="row"><cf-status [s]="c.triage"></cf-status><cf-status [s]="c.status"></cf-status><span class="st n">{{ c.bay || 'Corridor' }}</span></div>
      <div class="kv"><div><small>BP</small><b>{{ c.vitals.bp }}</b></div><div><small>Pulse</small><b>{{ c.vitals.hr }}</b></div><div><small>SpO₂</small><b>{{ c.vitals.spo2 }}%</b></div><div><small>GCS</small><b>{{ c.vitals.gcs }}</b></div></div>
      <div class="field"><label>Doctor</label><select class="inp" [ngModel]="c.doctorId" (ngModelChange)="setDoctor(c, $event)">@for (d of doctors(); track d.id) {<option [value]="d.id">{{ d.name }}</option>}</select></div>
      <div class="field"><label>Re-triage</label><div class="chips">@for (l of levels; track l.id) {<button class="chip" [class.on]="c.triage === l.id" (click)="retriage(c, l.id)">{{ l.id }}</button>}</div></div>
      <div class="section-title">Orders</div>
      <div class="chips">@for (o of c.orders; track o) {<span class="st b">{{ o }}</span>}</div>
      <div class="chips">@for (o of quickOrders; track o) { @if (!c.orders.includes(o)) {<button class="chip" (click)="order(c, o)">+ {{ o }}</button>} }</div>
      @if (timeline(c); as tl) { @if (tl.length) { <div class="section-title">Timeline</div><div class="tl">@for (t of tl; track $index) {<div class="tl-row"><time>{{ t.at }}</time><span class="dot"></span><div><b>{{ t.event }}</b><small class="muted"> · {{ t.by }}</small></div></div>}</div> } }
      @if (!c.patientId) { <div class="soft stack-s"><b>Link to a registered patient</b><select class="inp" [(ngModel)]="link"><option value="">Choose</option>@for (p of store.db.patients.slice(0, 50); track p.id) {<option [value]="p.id">{{ p.name }} · {{ p.id }}</option>}</select><button class="btn sm" [disabled]="!link" (click)="doLink(c)">Link record</button></div> }
    }
    <div foot>@if (sel(); as c) { @if (open(c)) {
      <button class="btn ghost" (click)="setStatus(c, 'Observation')">Observation</button>
      <button class="btn ghost" (click)="setStatus(c, 'Discharged')">Discharge</button>
      <button class="btn ghost" (click)="setStatus(c, 'Referred')">Refer out</button>
      <button class="btn" (click)="admit(c)"><lucide-icon name="bed" [size]="16"></lucide-icon>Admit</button>
    } }</div>
  </cf-drawer>`
})
export class EmergencyPage {
  store = inject(StoreService); toast = inject(ToastService); router = inject(Router);
  session = inject(SessionService); private api = inject(ErOtApi); live = this.session.live;
  levels = LEVELS; modes: ERCase['mode'][] = ['Walk-in', 'Ambulance', 'Referred', 'Police'];
  /** Demo bays; in live mode the branch's bays come from the server. */
  bays = signal(['Resus 1', 'Resus 2', 'Bay 1', 'Bay 2', 'Bay 3', 'Bay 4', 'Bay 5', 'Bay 6', 'Minor 1', 'Minor 2']);
  quickOrders = ['ECG', 'CBC', 'Troponin I', 'RBS', 'ABG', 'CT brain plain', 'X-ray chest', 'IV fluids', 'Oxygen', 'Analgesia'];
  newOpen = signal(false); sel = signal<ERCase | null>(null); unknown = false; link = ''; busy = signal(false);
  liveDoctors = signal<DirectoryDoctor[]>([]);
  doctors = computed(() => this.live ? this.liveDoctors() : this.store.db.doctors);
  f = { patientId: '', age: 40, gender: 'Male', mode: 'Walk-in' as ERCase['mode'], complaint: '', bp: '120/80', hr: 90, spo2: 97, gcs: 15, triage: 'Yellow' as TriageLevel, bay: '' };
  active = computed(() => { this.store.rev(); return this.store.db.erCases.filter(c => this.open(c)); });
  lane(t: TriageLevel) { return this.active().filter(c => c.triage === t); }
  crit = computed(() => this.active().filter(c => c.triage === 'Red' || c.triage === 'Orange').length);
  byMode(m: string) { return this.active().filter(c => c.mode === m).length; }
  admitted = computed(() => { this.store.rev(); return this.store.db.erCases.filter(c => c.status === 'Admitted').length; });
  freeBays = computed(() => { const used = new Set(this.active().map(c => c.bay)); return this.bays().filter(b => !used.has(b)); });

  constructor() {
    if (!this.live) return;
    this.api.doctors().then(d => this.liveDoctors.set(d)).catch(() => undefined);
    effect(() => { const b = this.session.branchId(); untracked(() => this.load(b, true)); });
    // The board is shared by the whole ER team, so refresh it every 30 seconds.
    const t = setInterval(() => { if (!this.busy()) this.load(this.session.branchId(), false); }, 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  /** Live mode: the branch's bays and today's board. */
  async load(branch: string, first: boolean) {
    try {
      const [bays, cases] = await Promise.all([this.api.bays(branch), this.api.board(branch)]);
      if (branch !== this.session.branchId()) return;
      this.bays.set(bays.map(b => b.name));
      this.store.db.erCases = cases;
      const s = this.sel(); if (s) this.sel.set(cases.find(c => c.id === s.id) ?? null);
      this.store.changed();
    } catch (e) { if (first) this.toast.err(apiMessage(e, 'Could not load the ER board from the server')); }
  }

  /** Live mode: runs a change on the server and puts the case it returns on the board. */
  private async call(run: () => Promise<LiveERCase>, ok: (c: LiveERCase) => string): Promise<LiveERCase | null> {
    this.busy.set(true);
    try {
      const c = await run();
      const i = this.store.db.erCases.findIndex(x => x.id === c.id);
      if (i >= 0) this.store.db.erCases[i] = c; else this.store.db.erCases.unshift(c);
      if (this.sel()?.id === c.id) this.sel.set(c);
      this.store.changed(); this.toast.ok(ok(c));
      return c;
    } catch (e) { this.toast.err(apiMessage(e, 'Could not update the ER case')); this.load(this.session.branchId(), false); return null; }
    finally { this.busy.set(false); }
  }

  open(c: ERCase) { return !['Admitted', 'Discharged', 'Referred'].includes(c.status); }
  docName(c: ERCase) { return (c as LiveERCase).doctorName ?? this.store.dname(c.doctorId); }
  timeline(c: ERCase) { return (c as LiveERCase).timeline ?? []; }
  sys(c: ERCase) { return +c.vitals.bp.split('/')[0]; }
  suggest(): TriageLevel { const s = +this.f.bp.split('/')[0]; if (this.f.gcs < 9 || this.f.spo2 < 88 || s < 80) return 'Red'; if (this.f.gcs < 13 || this.f.spo2 < 92 || this.f.hr > 130 || s < 90) return 'Orange'; if (this.f.hr > 110 || s > 180) return 'Yellow'; return 'Green'; }
  openNew(unknown: boolean) { this.unknown = unknown; this.f = { patientId: '', age: 40, gender: unknown ? 'Unknown' : 'Male', mode: unknown ? 'Ambulance' : 'Walk-in', complaint: '', bp: '120/80', hr: 90, spo2: 97, gcs: 15, triage: unknown ? 'Red' : 'Yellow', bay: this.freeBays()[0] || '' }; this.newOpen.set(true); }
  async register() {
    if (this.live) {
      const f = this.f, er = this.doctors().find(d => d.deptId === 'EM')?.id;
      const c = await this.call(() => this.api.register({ branchId: this.session.branchId(), patientId: f.patientId || undefined, age: f.age == null || `${f.age}` === '' ? undefined : +f.age, gender: f.gender, mode: f.mode, triage: f.triage, complaint: f.complaint, bay: f.bay || undefined, doctorId: er, vitals: { bp: f.bp.trim(), hr: +f.hr, spo2: +f.spo2, gcs: +f.gcs } }),
        x => `${x.id} registered in ${x.bay || 'the corridor'}${x.triage === 'Red' ? '. Red triage logged for the resus team.' : ''}`);
      if (c) { this.newOpen.set(false); this.sel.set(c); }
      return;
    }
    const p = this.store.patient(this.f.patientId);
    const label = p ? p.name : `Unknown ${this.f.gender === 'Unknown' ? 'patient' : this.f.gender.toLowerCase()}, about ${this.f.age} years`;
    const c = this.store.registerER({ patientId: p?.id, label, age: +this.f.age, gender: this.f.gender, mode: this.f.mode, triage: this.f.triage, complaint: this.f.complaint, bay: this.f.bay || 'Corridor', doctorId: 'D08', vitals: { bp: this.f.bp, hr: +this.f.hr, spo2: +this.f.spo2, gcs: +this.f.gcs, temp: 98.4 } });
    this.newOpen.set(false); this.toast.ok(`${c.id} registered in ${c.bay}${c.triage === 'Red' ? '. Resus team alerted (simulated).' : ''}`); this.sel.set(c);
  }
  private change(c: ERCase, u: ErUpdate, ok: string) { return this.call(() => this.api.update(c.id, u), () => ok); }
  setDoctor(c: ERCase, id: string) {
    if (this.live) { this.change(c, { doctorId: id }, `Assigned to ${this.liveDoctors().find(d => d.id === id)?.name ?? id}`); return; }
    c.doctorId = id; this.store.changed();
  }
  retriage(c: ERCase, t: TriageLevel) {
    if (c.triage === t) return;
    if (this.live) { this.change(c, { triage: t }, `${c.label} re-triaged ${t}`); return; }
    c.triage = t; this.store.changed();
  }
  order(c: ERCase, o: string) {
    if (this.live) { this.call(() => this.api.order(c.id, o), () => `${o} ordered`); return; }
    c.orders.push(o); if (c.status === 'Waiting') c.status = 'Under treatment'; this.store.log('Created', 'ER order', `${c.id}: ${o}`); this.store.changed(); this.toast.ok(`${o} ordered`);
  }
  doLink(c: ERCase) {
    if (this.live) { const id = this.link; this.call(() => this.api.link(c.id, id), x => `Linked to ${x.label}'s record`).then(x => { if (x) this.link = ''; }); return; }
    const p = this.store.patient(this.link)!; c.patientId = p.id; c.label = p.name; this.store.log('Merged', 'ER case', `${c.id} linked to ${p.id}`, 'Sensitive'); this.store.changed(); this.toast.ok(`Linked to ${p.name}'s record`); this.link = '';
  }
  async setStatus(c: ERCase, s: ERCase['status']) {
    if (this.live) {
      const x = await this.call(() => this.api.status(c.id, s), y => `${y.label} marked ${s === 'Referred' ? 'referred out' : s.toLowerCase()}`);
      if (x && s !== 'Observation') this.sel.set(null);
      return;
    }
    c.status = s; this.store.changed(); this.toast.ok(`${c.label} marked ${s.toLowerCase()}`); if (s !== 'Observation') this.sel.set(null);
  }
  admit(c: ERCase) {
    if (!c.patientId) { this.toast.warn('Link or register the patient before admission'); return; }
    // Live mode: the admission screen tells the server once the admission exists, which closes this case and frees the bay.
    if (!this.live) { c.status = 'Admitted'; this.store.changed(); }
    this.router.navigate(['/ipd/admit'], { queryParams: { patient: c.patientId, type: 'Emergency', erCase: c.id } });
  }
}
