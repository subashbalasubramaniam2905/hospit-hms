import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { JOURNEY, QueueEntry } from '../../core/models';
import { FrontDeskService } from '../../core/services/front-desk.service';
import { apiMessage } from '../../core/api/appointments-api';

const LANE_TONE = ['--blue', '--amber', '--pink', '--violet', '--blue', '--pri', '--green'];

@Component({
  standalone: true, imports: [SHARED],
  styles: [`
    .lanes { display:grid; grid-template-columns:repeat(7,minmax(158px,1fr)); gap:12px; overflow-x:auto; padding-bottom:6px }
    .lane { background:var(--card); border:1px solid var(--line); border-radius:var(--r); display:flex; flex-direction:column; min-height:420px; transition:box-shadow .15s }
    .lane.over { box-shadow:0 0 0 2px var(--pri) }
    .lane-h { padding:12px 14px 10px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:8px; border-top:4px solid var(--c); border-radius:var(--r) var(--r) 0 0 }
    .lane-h b { font-size:13.5px } .lane-h .n { margin-left:auto; font-weight:800; font-size:13px; background:var(--ground); border-radius:99px; padding:1px 9px }
    .lane-b { padding:10px; display:flex; flex-direction:column; gap:8px; flex:1 }
    .qc { background:var(--ground); border:1px solid transparent; border-radius:12px; padding:10px 11px; text-align:left; display:flex; flex-direction:column; gap:6px; cursor:grab; color:var(--fg) }
    .qc:hover { border-color:var(--line); background:color-mix(in srgb,var(--ground) 60%,var(--card)) }
    .qc.late { border-color:color-mix(in srgb,var(--amber) 60%,transparent); background:var(--amber-soft) }
    .qc.em { border-color:var(--red); background:var(--red-soft) }
    .qc .top { display:flex; align-items:center; gap:6px }
    .qc .tok { font-weight:800; font-size:13px; letter-spacing:.02em }
    .qc .nm { font-weight:600; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
    .qc .meta { display:flex; justify-content:space-between; font-size:11.5px; color:var(--mut) }
    .wait { font-weight:700 } .wait.hot { color:var(--red) }
    .kpis { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px }
    @media (max-width:900px){ .kpis { grid-template-columns:repeat(2,minmax(0,1fr)) } }
    .hist .tl-row { grid-template-columns:52px 14px 1fr }
  `],
  template: `
  <div class="page">
    <cf-page-head title="Queue & patient journey" [crumbs]="['Front desk', 'Live queue']" sub="Every checked-in patient, from registration to discharge. Drag a card to move it, or open it for actions.">
      <button class="btn ghost" (click)="callNext()"><lucide-icon name="bell-ring" [size]="16"></lucide-icon>Call next token</button>
      <a class="btn" routerLink="/appointments/new" [queryParams]="{ walkin: 1 }"><lucide-icon name="user-plus" [size]="16"></lucide-icon>Add walk-in</a>
    </cf-page-head>

    <div class="kpis">
      <cf-stat label="In the hospital now" [value]="active().length" icon="users" tone="pri" [sub]="done() + ' completed today'"></cf-stat>
      <cf-stat label="Average wait at current step" [value]="avgWait() + ' min'" icon="hourglass" tone="amber" sub="Target under 20 min"></cf-stat>
      <cf-stat label="Waiting over {{ delay }} min" [value]="late().length" icon="triangle-alert" tone="red" [sub]="late().length ? 'Longest ' + longest() + ' min' : 'No delays'"></cf-stat>
      <cf-stat label="Priority and emergency" [value]="prio()" icon="siren" tone="pink" sub="Seniors, pregnancy, emergencies"></cf-stat>
    </div>

    <div class="card" style="padding:12px 16px">
      <div class="toolbar">
        <label class="search boxed" style="max-width:280px;flex:1"><lucide-icon name="search" [size]="16"></lucide-icon><input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Token or patient" aria-label="Search queue"></label>
        <select class="inp" style="width:auto" [ngModel]="dept()" (ngModelChange)="dept.set($event)" aria-label="Department"><option value="">All departments</option>@for (d of store.db.departments; track d.id) {<option [value]="d.id">{{ d.name }}</option>}</select>
        <select class="inp" style="width:auto" [ngModel]="doc()" (ngModelChange)="doc.set($event)" aria-label="Doctor"><option value="">All doctors</option>@for (d of store.db.doctors; track d.id) {<option [value]="d.id">{{ d.name }}</option>}</select>
        <button class="chip" [class.on]="onlyLate()" (click)="onlyLate.set(!onlyLate())">Delayed only</button>
        <span class="spacer"></span>
        <span class="legend"><span><i style="background:var(--amber)"></i>Waiting over {{ delay }} min</span><span><i style="background:var(--red)"></i>Emergency</span><span><lucide-icon name="star" [size]="12"></lucide-icon> Priority</span></span>
      </div>
    </div>

    <div class="lanes" role="list">
      @for (step of journey; track step; let i = $index) {
        <section class="lane" [style.--c]="'var(' + tones[i] + ')'" [class.over]="over() === i" (dragover)="$event.preventDefault(); over.set(i)" (dragleave)="over.set(-1)" (drop)="drop(i)" [attr.aria-label]="step">
          <div class="lane-h"><b>{{ step }}</b><span class="n">{{ lane(i).length }}</span></div>
          <div class="lane-b">
            @for (e of lane(i); track e.id ?? e.token) {
              <button class="qc" [class.late]="e.since > delay && i < 6" [class.em]="e.emergency" draggable="true" (dragstart)="drag = key(e)" (click)="sel.set(key(e))">
                <div class="top"><span class="tok">{{ e.token }}</span>@if (e.priority) {<lucide-icon name="star" [size]="13" style="color:var(--amber)"></lucide-icon>}@if (e.emergency) {<span class="st r" style="padding:1px 6px">ER</span>}
                  <span class="spacer"></span><span class="wait" [class.hot]="e.since > delay && i < 6">@if (i < 6) {{{ e.since }}m} @else {<lucide-icon name="check" [size]="13"></lucide-icon>}</span></div>
                <div class="nm">{{ store.pname(e.patientId) }}</div>
                <div class="meta"><span>{{ store.dname(e.doctorId) }}</span></div>
              </button>
            } @empty { <p class="muted small" style="text-align:center;padding:20px 0">No one here</p> }
          </div>
        </section>
      }
    </div>
  </div>

  <cf-drawer [open]="!!entry()" [title]="entry() ? 'Token ' + entry()!.token : ''" [sub]="entry() ? store.pname(entry()!.patientId) : ''" (closed)="sel.set('')">
    @if (entry(); as e) {
      <div class="stack">
        <div class="stepper">@for (s of journey; track s; let i = $index) { <span class="s" [class.done]="i < e.step" [class.cur]="i === e.step">{{ s }}</span> }</div>
        <div class="kv">
          <div><small>Current step</small><b>{{ journey[e.step] }}</b></div><div><small>Time at this step</small><b>{{ e.since }} min</b></div>
          <div><small>Doctor</small><b>{{ store.dname(e.doctorId) }}</b></div><div><small>Arrived</small><b>{{ e.arrivedAt | time12 }}</b></div>
        </div>
        @if (store.patient(e.patientId)?.allergies?.length) { <div class="alert-box crit"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon>Allergy: {{ store.patient(e.patientId)!.allergies.join(', ') }}</div> }
        <div class="row">
          @if (e.step < 6) { <button class="btn" (click)="next(e)"><lucide-icon name="arrow-right" [size]="16"></lucide-icon>Move to {{ journey[e.step + 1] }}</button> }
          @if (e.step === 3) { <a class="btn soft-btn" [routerLink]="['/consultation', e.patientId]"><lucide-icon name="stethoscope" [size]="16"></lucide-icon>Open consultation</a> }
          @if (e.step === 1) { <a class="btn soft-btn" routerLink="/billing/new" [queryParams]="{ patient: e.patientId }"><lucide-icon name="receipt" [size]="16"></lucide-icon>Collect fee</a> }
          @if (e.step === 5) { <a class="btn soft-btn" routerLink="/pharmacy/dispense" [queryParams]="{ patient: e.patientId }"><lucide-icon name="pill" [size]="16"></lucide-icon>Dispense</a> }
        </div>
        <div class="form-grid">
          <div class="field"><label>Jump to step</label><select class="inp" [ngModel]="e.step" (ngModelChange)="jump(e, +$event)">@for (s of journey; track s; let i = $index) {<option [value]="i">{{ s }}</option>}</select></div>
          <div class="field"><label>Reassign doctor</label><select class="inp" [ngModel]="e.doctorId" (ngModelChange)="reassign(e, $event)">@for (d of store.db.doctors; track d.id) {<option [value]="d.id" [disabled]="d.status === 'On leave'">{{ d.name }}{{ d.status === 'On leave' ? ' (on leave)' : '' }}</option>}</select></div>
        </div>
        <div class="row">
          <mat-slide-toggle [checked]="e.priority" (change)="togglePrio(e)" [disabled]="busy()">Priority (senior, pregnancy, disability)</mat-slide-toggle>
        </div>
        <div class="row">
          <button class="btn ghost sm" (click)="announce(e)"><lucide-icon name="bell-ring" [size]="15"></lucide-icon>Call to counter</button>
          <a class="btn ghost sm" [routerLink]="['/patients', e.patientId]"><lucide-icon name="user-round" [size]="15"></lucide-icon>Patient record</a>
          <button class="btn ghost sm" style="color:var(--red)" (click)="remove(e)"><lucide-icon name="user-x" [size]="15"></lucide-icon>Left without being seen</button>
        </div>
        <div class="section-title">Journey so far</div>
        <div class="tl hist">
          @for (h of e.history; track $index) { <div class="tl-row"><time>{{ h.at | time12 }}</time><span class="dot"></span><div><b>{{ h.step === 0 && $index === 0 ? 'Checked in' : 'Left ' + journey[h.step] }}</b></div></div> }
          <div class="tl-row"><time>now</time><span class="dot" style="background:var(--amber)"></span><div><b>At {{ journey[e.step] }}</b><span class="sub">{{ e.since }} min so far</span></div></div>
        </div>
      </div>
    }
  </cf-drawer>`
})
export class QueuePage {
  store = inject(StoreService); fd = inject(FrontDeskService); toast = inject(ToastService); router = inject(Router);
  journey = JOURNEY; tones = LANE_TONE; delay = this.store.db.config.queueRules.delayAlertMin;
  q = signal(''); dept = signal(''); doc = signal(''); onlyLate = signal(false); sel = signal(''); over = signal(-1); drag = ''; busy = signal(false);

  constructor() {
    if (this.fd.live) {
      const load = () => this.fd.loadQueue().catch(e => this.toast.err(apiMessage(e, 'Could not load the queue')));
      load();
      // Other desks move patients too, so refresh every 30 seconds while this screen is open.
      const t = setInterval(load, 30000);
      inject(DestroyRef).onDestroy(() => clearInterval(t));
    }
  }

  /** Tokens repeat across days in the demo data, so live entries are keyed by their id. */
  key(e: QueueEntry) { return e.id != null ? String(e.id) : e.token; }
  private byKey(k: string) { return this.store.db.queue.find(x => this.key(x) === k); }

  private all = computed(() => { this.store.rev(); return [...this.store.db.queue]; });
  private shown = computed(() => {
    const q = this.q().toLowerCase();
    return this.all().filter(e => (!this.dept() || e.deptId === this.dept()) && (!this.doc() || e.doctorId === this.doc()) && (!this.onlyLate() || (e.since > this.delay && e.step < 6))
      && (!q || e.token.toLowerCase().includes(q) || this.store.pname(e.patientId).toLowerCase().includes(q)));
  });
  private lanes = computed(() => JOURNEY.map((_, i) => this.shown().filter(e => e.step === i).sort((a, b) => (+b.emergency - +a.emergency) || (+b.priority - +a.priority) || (b.since - a.since))));
  lane(i: number) { return this.lanes()[i]; }
  active = computed(() => this.all().filter(e => e.step < 6));
  done = computed(() => this.all().filter(e => e.step === 6).length);
  late = computed(() => this.active().filter(e => e.since > this.delay));
  longest = computed(() => this.late().reduce((m, e) => Math.max(m, e.since), 0));
  avgWait = computed(() => { const a = this.active(); return a.length ? Math.round(a.reduce((t, e) => t + e.since, 0) / a.length) : 0; });
  prio = computed(() => this.active().filter(e => e.priority || e.emergency).length);
  entry = computed(() => { this.store.rev(); return this.byKey(this.sel()); });

  /** Runs one queue change at a time and reports the server's reason when it is refused. */
  private async act(what: string, fn: () => Promise<unknown>) {
    if (this.busy()) return;
    this.busy.set(true);
    try { await fn(); } catch (e) { this.toast.err(apiMessage(e, `Could not ${what}`)); if (this.fd.live) this.fd.loadQueue().catch(() => {}); }
    finally { this.busy.set(false); }
  }

  next(e: QueueEntry) { const to = Math.min(6, e.step + 1); this.act('move the patient', async () => { await this.fd.move(e); this.toast.ok(`${e.token} moved to ${JOURNEY[to]}`); }); }
  jump(e: QueueEntry, s: number) { if (s === e.step) return; this.act('move the patient', async () => { await this.fd.move(e, s); this.toast.ok(`${e.token} moved to ${JOURNEY[s]}`); }); }
  drop(i: number) { this.over.set(-1); const e = this.byKey(this.drag); this.drag = ''; if (e && e.step !== i) this.jump(e, i); }
  reassign(e: QueueEntry, id: string) { if (id === e.doctorId) return; this.act('reassign the doctor', async () => { await this.fd.reassign(e, id); this.toast.ok(`${e.token} reassigned to ${this.store.dname(id)}`); }); }
  togglePrio(e: QueueEntry) { const v = !e.priority; this.act('change priority', async () => { await this.fd.setPriority(e, v); this.toast.info(v ? `${e.token} marked as priority` : `${e.token} priority removed`); }); }
  announce(e: QueueEntry) { this.toast.info(`Announcing "Token ${e.token}, please come to ${JOURNEY[e.step]}" on the display (simulated)`); }
  callNext() {
    this.act('call the next token', async () => {
      const w = await this.fd.callNext({ deptId: this.dept() || undefined, doctorId: this.doc() || undefined });
      if (!w) { this.toast.info('No one is waiting at triage right now'); return; }
      this.toast.ok(`Token ${w.token} (${this.store.pname(w.patientId)}) called to ${this.store.dname(w.doctorId)}'s room`);
    });
  }
  remove(e: QueueEntry) { this.act('remove the patient', async () => { await this.fd.left(e); this.sel.set(''); this.toast.warn(`${e.token} removed from the queue`); }); }
}
