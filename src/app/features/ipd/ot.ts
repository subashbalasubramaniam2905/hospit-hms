import { Component, computed, inject, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { Surgery } from '../../core/models';

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
        @for (r of rooms; track r) {
          <div class="rl">{{ r }}</div>
          <div class="track">
            @if (date() === store.today()) { <div class="now" [style.left.px]="nowX()"></div> }
            @for (s of inRoom(r); track s.id) {
              <button class="blk" [style.left.px]="x(s.start)" [style.width.px]="s.durationMin / 60 * px" [style.--c]="'var(' + col(s) + ')'" (click)="sel.set(s)" [matTooltip]="s.procedure + ' · ' + store.pname(s.patientId)">
                <b>{{ s.procedure }}</b>{{ s.start | time12 }} · {{ store.pname(s.patientId) }}
              </button>
            }
          </div>
        }
      </div>
    </div>
    <div class="card">
      <cf-table [rows]="list()" [cols]="cols" [clickable]="true" (rowClick)="sel.set($event)">
        <ng-template cfCell="patient" let-s>{{ store.pname(s.patientId) }}</ng-template>
        <ng-template cfCell="time" let-s>{{ s.start | time12 }} · {{ s.durationMin }} min</ng-template>
        <ng-template cfCell="check" let-s><span [style.color]="checked(s) === 7 ? 'var(--green)' : 'var(--amber)'">{{ checked(s) }}/7</span></ng-template>
        <ng-template cfCell="status" let-s><cf-status [s]="s.status"></cf-status></ng-template>
      </cf-table>
    </div>
  </div>

  <cf-drawer [open]="!!sel()" [title]="sel()?.procedure || ''" [sub]="sel() ? store.pname(sel()!.patientId) + ' · ' + sel()!.room + ' · ' + sel()!.start : ''" width="min(540px,100%)" (closed)="sel.set(null)">
    @if (sel(); as s) {
      <div class="stepper">@for (st of flow; track st; let i = $index) {<span class="s" [class.done]="i < flow.indexOf(s.status)" [class.cur]="st === s.status">{{ st }}</span>}</div>
      <div class="kv"><div><small>Surgeon</small><b>{{ store.dname(s.surgeonId) }}</b></div><div><small>Anaesthetist</small><b>{{ s.anaesthetist }}</b></div><div><small>Anaesthesia</small><b>{{ s.anaesthesia }}</b></div><div><small>Duration</small><b>{{ s.durationMin }} min</b></div></div>
      @for (al of store.patient(s.patientId)?.allergies; track al) {<div class="alert-box crit"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon>{{ al }} allergy</div>}
      <div class="section-title">WHO surgical safety checklist</div>
      <div class="stack-s">@for (k of keys(s); track k) { <mat-checkbox [checked]="s.checklist[k]" (change)="tick(s, k)" [disabled]="s.status === 'Completed'">{{ k }}</mat-checkbox> }</div>
      @if (s.status === 'Pre-op' && checked(s) < 7) { <div class="alert-box warn"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon>Complete every checklist item before starting surgery.</div> }
      @if (s.status === 'Recovery' || s.status === 'Completed') { <div class="field"><label>Post-op notes</label><textarea class="inp" [(ngModel)]="s.postOpNotes" (ngModelChange)="store.changed()"></textarea></div> }
      <div class="section-title">Timeline</div>
      <div class="tl">@for (t of s.timeline; track $index) {<div class="tl-row"><time>{{ t.at }}</time><span class="dot"></span><div><b>{{ t.event }}</b></div></div>} @empty {<p class="muted small">Not started.</p>}</div>
    }
    <div foot>@if (sel(); as s) {
      @if (s.status !== 'Completed' && s.status !== 'Cancelled') {
        @if (s.status === 'Scheduled') { <button class="btn ghost" style="color:var(--red)" (click)="cancel(s)">Cancel</button> }
        <button class="btn" [disabled]="s.status === 'Pre-op' && checked(s) < 7" (click)="advance(s)">{{ nextLabel(s) }}</button>
      }
    }</div>
  </cf-drawer>

  <cf-drawer [open]="book()" title="Book surgery" (closed)="book.set(false)">
    <div class="stack">
      <div class="field"><label>Patient</label><select class="inp" [(ngModel)]="b.patientId">@for (p of store.db.patients.slice(0, 50); track p.id) {<option [value]="p.id">{{ p.name }} · {{ p.id }}</option>}</select></div>
      <div class="field"><label>Procedure <span class="req">*</span></label><input class="inp" [(ngModel)]="b.procedure" placeholder="e.g. Laparoscopic appendicectomy"></div>
      <div class="form-grid"><div class="field"><label>Surgeon</label><select class="inp" [(ngModel)]="b.surgeonId">@for (d of store.db.doctors; track d.id) {<option [value]="d.id">{{ d.name }}</option>}</select></div>
        <div class="field"><label>Room</label><select class="inp" [(ngModel)]="b.room">@for (r of rooms; track r) {<option>{{ r }}</option>}</select></div>
        <div class="field"><label>Date</label><input class="inp" type="date" [(ngModel)]="b.date"></div><div class="field"><label>Start</label><input class="inp" type="time" [(ngModel)]="b.start"></div>
        <div class="field"><label>Duration (min)</label><input class="inp" type="number" step="15" [(ngModel)]="b.durationMin"></div><div class="field"><label>Anaesthesia</label><select class="inp" [(ngModel)]="b.anaesthesia"><option>General</option><option>Spinal</option><option>Regional block</option><option>Local with sedation</option></select></div></div>
      @if (clash(); as c) { <div class="alert-box crit"><lucide-icon name="circle-alert" [size]="16"></lucide-icon>{{ b.room }} is booked for {{ c.procedure }} at {{ c.start }} ({{ c.durationMin }} min).</div> }
      @else if (b.procedure) { <div class="alert-box ok"><lucide-icon name="circle-check" [size]="16"></lucide-icon>{{ b.room }} is free for this slot.</div> }
    </div>
    <div foot><button class="btn ghost" (click)="book.set(false)">Cancel</button><button class="btn" [disabled]="!b.procedure || !!clash()" (click)="save()">Book</button></div>
  </cf-drawer>`
})
export class OtPage {
  store = inject(StoreService); toast = inject(ToastService);
  rooms = ['OT-1', 'OT-2', 'OT-3']; hours = Array.from({ length: H1 - H0 }, (_, i) => H0 + i); px = PX;
  flow: Surgery['status'][] = ['Scheduled', 'Pre-op', 'In progress', 'Recovery', 'Completed']; statuses = ['Scheduled', 'Pre-op', 'In progress', 'Recovery', 'Completed', 'Cancelled'];
  date = signal(this.store.today()); sel = signal<Surgery | null>(null); book = signal(false); rev = signal(0);
  b = { patientId: '', procedure: '', surgeonId: 'D04', room: 'OT-3', date: this.store.today(), start: '15:00', durationMin: 60, anaesthesia: 'General', anaesthetist: 'Dr. Kiran Bhat' };
  cols = [{ key: 'procedure', label: 'Procedure' }, { key: 'patient', label: 'Patient', value: (s: Surgery) => this.store.pname(s.patientId) }, { key: 'room', label: 'Room' }, { key: 'time', label: 'Time', value: (s: Surgery) => s.start }, { key: 'surgeon', label: 'Surgeon', value: (s: Surgery) => this.store.dname(s.surgeonId) }, { key: 'check', label: 'Checklist', value: (s: Surgery) => this.checked(s) }, { key: 'status', label: 'Status' }];
  list = computed(() => { this.store.rev(); return this.store.db.surgeries.filter(s => s.date === this.date()).sort((a, b) => a.start.localeCompare(b.start)); });
  inRoom(r: string) { return this.list().filter(s => s.room === r && s.status !== 'Cancelled'); }
  count(s: string) { return this.list().filter(x => x.status === s).length; }
  tone(s: string): 'pri' | 'amber' | 'violet' | 'green' | 'red' | 'blue' { return ({ Scheduled: 'blue', 'Pre-op': 'amber', 'In progress': 'violet', Recovery: 'pri', Completed: 'green', Cancelled: 'red' } as Record<string, 'pri' | 'amber' | 'violet' | 'green' | 'red' | 'blue'>)[s]; }
  col(s: Surgery) { return ({ Scheduled: '--blue', 'Pre-op': '--amber', 'In progress': '--violet', Recovery: '--pri', Completed: '--green' } as Record<string, string>)[s.status] || '--mut'; }
  x(t: string) { return Math.max(0, (m(t) - H0 * 60) / 60 * PX); }
  nowX = computed(() => { this.store.rev(); return this.x(this.store.nowTime()); });
  keys(s: Surgery) { return Object.keys(s.checklist); }
  checked(s: Surgery) { return Object.values(s.checklist).filter(Boolean).length; }
  tick(s: Surgery, k: string) { s.checklist[k] = !s.checklist[k]; this.store.changed(); }
  nextLabel(s: Surgery) { return ({ Scheduled: 'Start pre-op', 'Pre-op': 'Sign in · start surgery', 'In progress': 'Move to recovery', Recovery: 'Shift to ward' } as Record<string, string>)[s.status] || 'Next'; }
  advance(s: Surgery) { this.store.advanceSurgery(s); this.store.log('Updated', 'Surgery', `${s.id} → ${s.status}`); this.toast.ok(`${s.procedure}: ${s.status}`); }
  cancel(s: Surgery) { s.status = 'Cancelled'; s.timeline.push({ at: this.store.nowTime(), event: 'Cancelled' }); this.store.changed(); this.toast.warn('Surgery cancelled. Room slot released.'); this.sel.set(null); }
  openBook() { this.b = { ...this.b, patientId: this.store.db.patients[5].id, procedure: '', date: this.date() }; this.book.set(true); }
  clash() { return this.b.procedure ? this.store.otClash(this.b.room, this.b.date, this.b.start, +this.b.durationMin) : undefined; }
  save() { const s = this.store.bookSurgery({ ...this.b, durationMin: +this.b.durationMin }); this.toast.ok(`${s.procedure} booked in ${s.room} at ${s.start}`); this.book.set(false); this.date.set(s.date); }
}
