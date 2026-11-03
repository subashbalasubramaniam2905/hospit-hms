import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ERCase, TriageLevel } from '../../core/models';

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
      <cf-stat class="c3" label="Free bays" [value]="freeBays().length + ' of ' + bays.length" icon="bed" tone="pri"></cf-stat>
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
              <small>{{ c.bay }} · {{ c.status }}{{ c.doctorId ? ' · ' + store.dname(c.doctorId) : '' }}</small>
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
      <div class="field"><label>Triage</label><div class="chips">@for (l of levels; track l.id) {<button class="chip" [class.on]="f.triage === l.id" (click)="f.triage = l.id">{{ l.id }}</button>}</div><span class="hint">Suggested from vitals: <b>{{ suggest() }}</b> (demo rule)</span></div>
      <div class="field"><label>Bay</label><select class="inp" [(ngModel)]="f.bay">@for (b of freeBays(); track b) {<option>{{ b }}</option>}</select></div>
    </div>
    <div foot><button class="btn ghost" (click)="newOpen.set(false)">Cancel</button><button class="btn" [disabled]="!f.complaint" (click)="register()">Register</button></div>
  </cf-drawer>

  <cf-drawer [open]="!!sel()" [title]="sel()?.label || ''" [sub]="sel() ? sel()!.id + ' · arrived ' + sel()!.arrival + ' by ' + sel()!.mode.toLowerCase() : ''" width="min(520px,100%)" (closed)="sel.set(null)">
    @if (sel(); as c) {
      <div class="row"><cf-status [s]="c.triage"></cf-status><cf-status [s]="c.status"></cf-status><span class="st n">{{ c.bay }}</span></div>
      <div class="kv"><div><small>BP</small><b>{{ c.vitals.bp }}</b></div><div><small>Pulse</small><b>{{ c.vitals.hr }}</b></div><div><small>SpO₂</small><b>{{ c.vitals.spo2 }}%</b></div><div><small>GCS</small><b>{{ c.vitals.gcs }}</b></div></div>
      <div class="field"><label>Doctor</label><select class="inp" [(ngModel)]="c.doctorId" (ngModelChange)="store.changed()">@for (d of store.db.doctors; track d.id) {<option [value]="d.id">{{ d.name }}</option>}</select></div>
      <div class="field"><label>Re-triage</label><div class="chips">@for (l of levels; track l.id) {<button class="chip" [class.on]="c.triage === l.id" (click)="c.triage = l.id; store.changed()">{{ l.id }}</button>}</div></div>
      <div class="section-title">Orders</div>
      <div class="chips">@for (o of c.orders; track o) {<span class="st b">{{ o }}</span>}</div>
      <div class="chips">@for (o of quickOrders; track o) { @if (!c.orders.includes(o)) {<button class="chip" (click)="order(c, o)">+ {{ o }}</button>} }</div>
      @if (!c.patientId) { <div class="soft stack-s"><b>Link to a registered patient</b><select class="inp" [(ngModel)]="link"><option value="">Choose</option>@for (p of store.db.patients.slice(0, 50); track p.id) {<option [value]="p.id">{{ p.name }} · {{ p.id }}</option>}</select><button class="btn sm" [disabled]="!link" (click)="doLink(c)">Link record</button></div> }
    }
    <div foot>@if (sel(); as c) {
      <button class="btn ghost" (click)="setStatus(c, 'Observation')">Observation</button>
      <button class="btn ghost" (click)="setStatus(c, 'Discharged')">Discharge</button>
      <button class="btn ghost" (click)="setStatus(c, 'Referred')">Refer out</button>
      <button class="btn" (click)="admit(c)"><lucide-icon name="bed" [size]="16"></lucide-icon>Admit</button>
    }</div>
  </cf-drawer>`
})
export class EmergencyPage {
  store = inject(StoreService); toast = inject(ToastService); router = inject(Router);
  levels = LEVELS; modes: ERCase['mode'][] = ['Walk-in', 'Ambulance', 'Referred', 'Police'];
  bays = ['Resus 1', 'Resus 2', 'Bay 1', 'Bay 2', 'Bay 3', 'Bay 4', 'Bay 5', 'Bay 6', 'Minor 1', 'Minor 2'];
  quickOrders = ['ECG', 'CBC', 'Troponin I', 'RBS', 'ABG', 'CT brain plain', 'X-ray chest', 'IV fluids', 'Oxygen', 'Analgesia'];
  newOpen = signal(false); sel = signal<ERCase | null>(null); unknown = false; link = '';
  f = { patientId: '', age: 40, gender: 'Male', mode: 'Walk-in' as ERCase['mode'], complaint: '', bp: '120/80', hr: 90, spo2: 97, gcs: 15, triage: 'Yellow' as TriageLevel, bay: '' };
  active = computed(() => { this.store.rev(); return this.store.db.erCases.filter(c => !['Admitted', 'Discharged', 'Referred'].includes(c.status)); });
  lane(t: TriageLevel) { return this.active().filter(c => c.triage === t); }
  crit = computed(() => this.active().filter(c => c.triage === 'Red' || c.triage === 'Orange').length);
  byMode(m: string) { return this.active().filter(c => c.mode === m).length; }
  admitted = computed(() => { this.store.rev(); return this.store.db.erCases.filter(c => c.status === 'Admitted').length; });
  freeBays = computed(() => { const used = new Set(this.active().map(c => c.bay)); return this.bays.filter(b => !used.has(b)); });
  sys(c: ERCase) { return +c.vitals.bp.split('/')[0]; }
  suggest(): TriageLevel { const s = +this.f.bp.split('/')[0]; if (this.f.gcs < 9 || this.f.spo2 < 88 || s < 80) return 'Red'; if (this.f.gcs < 13 || this.f.spo2 < 92 || this.f.hr > 130 || s < 90) return 'Orange'; if (this.f.hr > 110 || s > 180) return 'Yellow'; return 'Green'; }
  openNew(unknown: boolean) { this.unknown = unknown; this.f = { patientId: '', age: 40, gender: unknown ? 'Unknown' : 'Male', mode: unknown ? 'Ambulance' : 'Walk-in', complaint: '', bp: '120/80', hr: 90, spo2: 97, gcs: 15, triage: unknown ? 'Red' : 'Yellow', bay: this.freeBays()[0] || 'Corridor' }; this.newOpen.set(true); }
  register() {
    const p = this.store.patient(this.f.patientId);
    const label = p ? p.name : `Unknown ${this.f.gender === 'Unknown' ? 'patient' : this.f.gender.toLowerCase()}, about ${this.f.age} years`;
    const c = this.store.registerER({ patientId: p?.id, label, age: +this.f.age, gender: this.f.gender, mode: this.f.mode, triage: this.f.triage, complaint: this.f.complaint, bay: this.f.bay, doctorId: 'D08', vitals: { bp: this.f.bp, hr: +this.f.hr, spo2: +this.f.spo2, gcs: +this.f.gcs, temp: 98.4 } });
    this.newOpen.set(false); this.toast.ok(`${c.id} registered in ${c.bay}${c.triage === 'Red' ? '. Resus team alerted (simulated).' : ''}`); this.sel.set(c);
  }
  order(c: ERCase, o: string) { c.orders.push(o); if (c.status === 'Waiting') c.status = 'Under treatment'; this.store.log('Created', 'ER order', `${c.id}: ${o}`); this.store.changed(); this.toast.ok(`${o} ordered`); }
  doLink(c: ERCase) { const p = this.store.patient(this.link)!; c.patientId = p.id; c.label = p.name; this.store.log('Merged', 'ER case', `${c.id} linked to ${p.id}`, 'Sensitive'); this.store.changed(); this.toast.ok(`Linked to ${p.name}'s record`); this.link = ''; }
  setStatus(c: ERCase, s: ERCase['status']) { c.status = s; this.store.changed(); this.toast.ok(`${c.label} marked ${s.toLowerCase()}`); if (s !== 'Observation') this.sel.set(null); }
  admit(c: ERCase) { if (!c.patientId) { this.toast.warn('Link or register the patient before admission'); return; } c.status = 'Admitted'; this.store.changed(); this.router.navigate(['/ipd/admit'], { queryParams: { patient: c.patientId, type: 'Emergency' } }); }
}
