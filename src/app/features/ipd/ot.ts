import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { Surgery } from '../../core/models';
import { SessionService } from '../../core/services/session.service';
import { ErOtApi, LiveSurgery } from '../../core/api/er-ot-api';
import { DirectoryDoctor } from '../../core/api/lab-api';
import { apiMessage } from '../../core/api/auth.service';

const H0 = 7, H1 = 20, PX = 72;
const m = (t: string) => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm; };

@Component({
  standalone: true, imports: [SHARED],
  styles: [`
    .tlh { display:grid; grid-template-columns:90px 1fr; overflow-x:auto }
    .hours { display:flex; margin-left:90px; position:relative; height:22px; min-width:calc(13 * 72px) } .hours span { width:72px; font-size:11.5px; color:var(--mut); flex:none }
    .room { display:contents } .rl { font-weight:700; font-size:13px; padding:14px 0; border-top:1px solid var(--line) }
    .track { position:relative; height:58px; border-top:1px solid var(--line); min-width:calc(13 * 72px); background:repeating-linear-gradient(90deg,transparent 0 71px,var(--line) 71px 72px) }
    .blk { position:absolute; top:6px; height:46px; border-radius:10px; padding:5px 9px; font-size:12px; overflow:hidden; border:0; text-align:left; color:var(--fg); border-left:4px solid var(--c); background:color-mix(in srgb,var(--c) 14%,var(--card)) }
    .blk b { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
    .now { position:absolute; top:0; bottom:0; width:2px; background:var(--red) }
  `],
  template: `
  <div class="page">
    <cf-page-head title="Operation theatre" [crumbs]="['Clinical', 'OT schedule']" sub="Room schedule, WHO safety checklist and live status.">
      <input class="inp" type="date" style="width:auto" [ngModel]="date()" (ngModelChange)="date.set($event)" aria-label="Date">
      <button class="btn" (click)="openBook()"><lucide-icon name="calendar-plus" [size]="16"></lucide-icon>Book surgery</button>
    </cf-page-head>
    <div class="grid">
      @for (s of statuses; track s) { <cf-stat class="c2" [label]="s" [value]="count(s)" [tone]="tone(s)" [icon]="s === 'In progress' ? 'scissors' : s === 'Recovery' ? 'heart-pulse' : s === 'Completed' ? 'circle-check' : 'clock'"></cf-stat> }
    </div>
    <div class="card">
      <div class="tlh">
        <div class="hours" style="grid-column:1/-1">@for (h of hours; track h) {<span>{{ h > 12 ? h - 12 : h }}{{ h >= 12 ? 'pm' : 'am' }}</span>}</div>
        @for (r of rooms(); track r) {
          <div class="rl">{{ r }}</div>
          <div class="track">
            @if (date() === store.today()) { <div class="now" [style.left.px]="nowX()"></div> }
            @for (s of inRoom(r); track s.id) {
              <button class="blk" [style.left.px]="x(s.start)" [style.width.px]="s.durationMin / 60 * px" [style.--c]="'var(' + col(s) + ')'" (click)="select(s)" [matTooltip]="s.procedure + ' · ' + pname(s)">
                <b>{{ s.procedure }}</b>{{ s.start | time12 }} · {{ pname(s) }}
              </button>
            }
          </div>
        }
      </div>
    </div>
    <div class="card">
      <cf-table [rows]="list()" [cols]="cols" [clickable]="true" (rowClick)="select($event)">
        <ng-template cfCell="patient" let-s>{{ pname(s) }}</ng-template>
        <ng-template cfCell="time" let-s>{{ s.start | time12 }} · {{ s.durationMin }} min</ng-template>
        <ng-template cfCell="check" let-s><span [style.color]="checked(s) === 7 ? 'var(--green)' : 'var(--amber)'">{{ checked(s) }}/7</span></ng-template>
        <ng-template cfCell="status" let-s><cf-status [s]="s.status"></cf-status></ng-template>
      </cf-table>
    </div>
  </div>

  <cf-drawer [open]="!!sel()" [title]="sel()?.procedure || ''" [sub]="sel() ? pname(sel()!) + ' · ' + sel()!.room + ' · ' + sel()!.start : ''" width="min(540px,100%)" (closed)="sel.set(null)">
    @if (sel(); as s) {
      <div class="stepper">@for (st of flow; track st; let i = $index) {<span class="s" [class.done]="i < flow.indexOf(s.status)" [class.cur]="st === s.status">{{ st }}</span>}</div>
      <div class="kv"><div><small>Surgeon</small><b>{{ surgeon(s) }}</b></div><div><small>Anaesthetist</small><b>{{ s.anaesthetist }}</b></div><div><small>Anaesthesia</small><b>{{ s.anaesthesia }}</b></div><div><small>Duration</small><b>{{ s.durationMin }} min</b></div></div>
      @for (al of allergies(s); track al) {<div class="alert-box crit"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon>{{ al }} allergy</div>}
      <div class="section-title">WHO surgical safety checklist</div>
      <div class="stack-s">@for (k of keys(s); track k) { <mat-checkbox [checked]="s.checklist[k]" (change)="tick(s, k)" [disabled]="s.status === 'Completed' || s.status === 'Cancelled' || busy()">{{ k }}</mat-checkbox> }</div>
      @if (s.status === 'Pre-op' && checked(s) < 7) { <div class="alert-box warn"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon>Complete every checklist item before starting surgery.</div> }
      @if (s.status === 'Recovery' || s.status === 'Completed') { <div class="field"><label>Post-op notes</label>@if (live) { <textarea class="inp" [(ngModel)]="notes"></textarea><button class="btn ghost sm" style="align-self:flex-start" [disabled]="busy() || notes === (s.postOpNotes || '')" (click)="saveNotes(s)">Save notes</button> } @else { <textarea class="inp" [(ngModel)]="s.postOpNotes" (ngModelChange)="store.changed()"></textarea> }</div> }
      @if (s.status === 'Cancelled' && cancelReason(s)) { <div class="alert-box warn"><lucide-icon name="circle-alert" [size]="16"></lucide-icon>Cancelled: {{ cancelReason(s) }}</div> }
      <div class="section-title">Timeline</div>
      <div class="tl">@for (t of s.timeline; track $index) {<div class="tl-row"><time>{{ t.at }}</time><span class="dot"></span><div><b>{{ t.event }}</b>@if (by(t)) {<small class="muted"> · {{ by(t) }}</small>}</div></div>} @empty {<p class="muted small">Not started.</p>}</div>
    }
    <div foot>@if (sel(); as s) {
      @if (s.status !== 'Completed' && s.status !== 'Cancelled') {
        @if (s.status === 'Scheduled') { <button class="btn ghost" style="color:var(--red)" [disabled]="busy()" (click)="cancel(s)">Cancel</button> }
        <button class="btn" [disabled]="(s.status === 'Pre-op' && checked(s) < 7) || busy()" (click)="advance(s)">{{ nextLabel(s) }}</button>
      }
    }</div>
  </cf-drawer>

  <cf-drawer [open]="book()" title="Book surgery" (closed)="book.set(false)">
    <div class="stack">
      <div class="field"><label>Patient</label><select class="inp" [(ngModel)]="b.patientId">@for (p of store.db.patients.slice(0, 50); track p.id) {<option [value]="p.id">{{ p.name }} · {{ p.id }}</option>}</select></div>
      <div class="field"><label>Procedure <span class="req">*</span></label><input class="inp" [(ngModel)]="b.procedure" placeholder="e.g. Laparoscopic appendicectomy"></div>
      <div class="form-grid"><div class="field"><label>Surgeon</label><select class="inp" [(ngModel)]="b.surgeonId">@for (d of doctors(); track d.id) {<option [value]="d.id">{{ d.name }}</option>}</select></div>
        <div class="field"><label>Room</label><select class="inp" [(ngModel)]="b.room">@for (r of rooms(); track r) {<option>{{ r }}</option>}</select></div>
        <div class="field"><label>Date</label><input class="inp" type="date" [(ngModel)]="b.date"></div><div class="field"><label>Start</label><input class="inp" type="time" [(ngModel)]="b.start"></div>
        <div class="field"><label>Duration (min)</label><input class="inp" type="number" step="15" [(ngModel)]="b.durationMin"></div><div class="field"><label>Anaesthesia</label><select class="inp" [(ngModel)]="b.anaesthesia"><option>General</option><option>Spinal</option><option>Regional block</option><option>Local with sedation</option></select></div></div>
      @if (clash(); as c) { <div class="alert-box crit"><lucide-icon name="circle-alert" [size]="16"></lucide-icon>{{ b.room }} is booked for {{ c.procedure }} at {{ c.start }} ({{ c.durationMin }} min).</div> }
      @else if (b.procedure) { <div class="alert-box ok"><lucide-icon name="circle-check" [size]="16"></lucide-icon>{{ b.room }} is free for this slot.</div> }
    </div>
    <div foot><button class="btn ghost" (click)="book.set(false)">Cancel</button><button class="btn" [disabled]="!b.procedure || !b.patientId || !!clash() || busy()" (click)="save()">Book</button></div>
  </cf-drawer>`
})
export class OtPage {
  store = inject(StoreService); toast = inject(ToastService);
  session = inject(SessionService); private api = inject(ErOtApi); live = this.session.live;
  rooms = signal(['OT-1', 'OT-2', 'OT-3']); hours = Array.from({ length: H1 - H0 }, (_, i) => H0 + i); px = PX;
  flow: Surgery['status'][] = ['Scheduled', 'Pre-op', 'In progress', 'Recovery', 'Completed']; statuses = ['Scheduled', 'Pre-op', 'In progress', 'Recovery', 'Completed', 'Cancelled'];
  date = signal(this.store.today()); sel = signal<Surgery | null>(null); book = signal(false); rev = signal(0); busy = signal(false); notes = '';
  liveDoctors = signal<DirectoryDoctor[]>([]);
  doctors = computed(() => this.live ? this.liveDoctors() : this.store.db.doctors);
  b = { patientId: '', procedure: '', surgeonId: 'D04', room: 'OT-3', date: this.store.today(), start: '15:00', durationMin: 60, anaesthesia: 'General', anaesthetist: 'Dr. Kiran Bhat' };
  cols = [{ key: 'procedure', label: 'Procedure' }, { key: 'patient', label: 'Patient', value: (s: Surgery) => this.pname(s) }, { key: 'room', label: 'Room' }, { key: 'time', label: 'Time', value: (s: Surgery) => s.start }, { key: 'surgeon', label: 'Surgeon', value: (s: Surgery) => this.surgeon(s) }, { key: 'check', label: 'Checklist', value: (s: Surgery) => this.checked(s) }, { key: 'status', label: 'Status' }];
  list = computed(() => { this.store.rev(); return this.store.db.surgeries.filter(s => s.date === this.date()).sort((a, b) => a.start.localeCompare(b.start)); });

  constructor() {
    if (!this.live) return;
    this.api.doctors().then(d => { this.liveDoctors.set(d); if (!d.some(x => x.id === this.b.surgeonId)) this.b.surgeonId = d[0]?.id ?? ''; }).catch(() => undefined);
    effect(() => { const br = this.session.branchId(); untracked(() => this.api.rooms(br).then(r => { if (r.length) { this.rooms.set(r); if (!r.includes(this.b.room)) this.b.room = r[0]; } }).catch(() => undefined)); });
    effect(() => { const br = this.session.branchId(), d = this.date(); untracked(() => this.load(br, d, true)); });
    // Theatre status changes all day, so refresh the schedule every minute.
    const t = setInterval(() => { if (!this.busy()) this.load(this.session.branchId(), this.date(), false); }, 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  /** Live mode: one day's bookings in the branch replace whatever the store held. */
  async load(branch: string, date: string, first: boolean) {
    try {
      const list = await this.api.surgeries(branch, date);
      if (branch !== this.session.branchId() || date !== this.date()) return;
      list.forEach(s => this.store.extraNames.set(s.patientId, s.patientName));
      this.store.db.surgeries = list;
      const s = this.sel(); if (s) this.select(list.find(x => x.id === s.id) ?? null);
      this.store.changed();
    } catch (e) { if (first) this.toast.err(apiMessage(e, 'Could not load the OT schedule from the server')); }
  }

  /** Live mode: runs a change on the server and puts the booking it returns into the schedule. */
  private async call(run: () => Promise<LiveSurgery>, ok: (s: LiveSurgery) => string): Promise<LiveSurgery | null> {
    this.busy.set(true);
    try {
      const s = await run();
      this.store.extraNames.set(s.patientId, s.patientName);
      const i = this.store.db.surgeries.findIndex(x => x.id === s.id);
      if (i >= 0) this.store.db.surgeries[i] = s; else this.store.db.surgeries.push(s);
      if (this.sel()?.id === s.id) this.select(s);
      this.store.changed(); this.toast.ok(ok(s));
      return s;
    } catch (e) { this.toast.err(apiMessage(e, 'Could not update the surgery')); this.load(this.session.branchId(), this.date(), false); return null; }
    finally { this.busy.set(false); }
  }

  select(s: Surgery | null) {
    const keepDraft = s && this.sel()?.id === s.id && this.notes !== (this.sel()!.postOpNotes || '');
    this.sel.set(s);
    if (s && !keepDraft) this.notes = s.postOpNotes || '';
  }
  pname(s: Surgery) { return (s as LiveSurgery).patientName ?? this.store.pname(s.patientId); }
  surgeon(s: Surgery) { return (s as LiveSurgery).surgeonName ?? this.store.dname(s.surgeonId); }
  allergies(s: Surgery) { return (s as LiveSurgery).patientAllergies ?? this.store.patient(s.patientId)?.allergies ?? []; }
  cancelReason(s: Surgery) { return (s as LiveSurgery).cancelReason; }
  by(t: { at: string; event: string }) { return (t as { by?: string }).by; }
  inRoom(r: string) { return this.list().filter(s => s.room === r && s.status !== 'Cancelled'); }
  count(s: string) { return this.list().filter(x => x.status === s).length; }
  tone(s: string): 'pri' | 'amber' | 'violet' | 'green' | 'red' | 'blue' { return ({ Scheduled: 'blue', 'Pre-op': 'amber', 'In progress': 'violet', Recovery: 'pri', Completed: 'green', Cancelled: 'red' } as Record<string, 'pri' | 'amber' | 'violet' | 'green' | 'red' | 'blue'>)[s]; }
  col(s: Surgery) { return ({ Scheduled: '--blue', 'Pre-op': '--amber', 'In progress': '--violet', Recovery: '--pri', Completed: '--green' } as Record<string, string>)[s.status] || '--mut'; }
  x(t: string) { return Math.max(0, (m(t) - H0 * 60) / 60 * PX); }
  nowX = computed(() => { this.store.rev(); return this.x(this.store.nowTime()); });
  keys(s: Surgery) { return Object.keys(s.checklist); }
  checked(s: Surgery) { return Object.values(s.checklist).filter(Boolean).length; }
  tick(s: Surgery, k: string) {
    if (this.live) { const done = !s.checklist[k]; this.call(() => this.api.check(s.id, k, done), () => `${k}: ${done ? 'done' : 'not done'}`); return; }
    s.checklist[k] = !s.checklist[k]; this.store.changed();
  }
  nextLabel(s: Surgery) { return ({ Scheduled: 'Start pre-op', 'Pre-op': 'Sign in · start surgery', 'In progress': 'Move to recovery', Recovery: 'Shift to ward' } as Record<string, string>)[s.status] || 'Next'; }
  advance(s: Surgery) {
    if (this.live) { this.call(() => this.api.advance(s.id, s.status), x => `${x.procedure}: ${x.status}`); return; }
    this.store.advanceSurgery(s); this.store.log('Updated', 'Surgery', `${s.id} → ${s.status}`); this.toast.ok(`${s.procedure}: ${s.status}`);
  }
  cancel(s: Surgery) {
    if (this.live) { this.call(() => this.api.cancel(s.id), () => 'Surgery cancelled. Room slot released.').then(x => { if (x) this.sel.set(null); }); return; }
    s.status = 'Cancelled'; s.timeline.push({ at: this.store.nowTime(), event: 'Cancelled' }); this.store.changed(); this.toast.warn('Surgery cancelled. Room slot released.'); this.sel.set(null);
  }
  saveNotes(s: Surgery) { this.call(() => this.api.notes(s.id, this.notes), () => 'Post-op notes saved'); }
  openBook() { this.b = { ...this.b, patientId: this.store.db.patients[this.live ? 0 : 5]?.id ?? '', procedure: '', date: this.date() }; this.book.set(true); }
  clash() { return this.b.procedure ? this.store.otClash(this.b.room, this.b.date, this.b.start, +this.b.durationMin) : undefined; }
  async save() {
    if (this.live) {
      const s = await this.call(() => this.api.book({ ...this.b, branchId: this.session.branchId(), durationMin: +this.b.durationMin }), x => `${x.procedure} booked in ${x.room} at ${x.start}`);
      if (s) { this.book.set(false); this.date.set(s.date); }
      return;
    }
    const s = this.store.bookSurgery({ ...this.b, durationMin: +this.b.durationMin }); this.toast.ok(`${s.procedure} booked in ${s.room} at ${s.start}`); this.book.set(false); this.date.set(s.date);
  }
}
