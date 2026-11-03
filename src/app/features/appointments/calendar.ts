import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED, fmtDate } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { Appointment, ApptStatus } from '../../core/models';
import { isoDay } from '../../core/data/seed';

type View = 'day' | 'week' | 'month' | 'list';
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const HH = 116;
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

@Component({
  standalone: true, imports: [SHARED],
  styles: [`
    .nav { display:flex; align-items:center; gap:8px }
    .nav h3 { font-size:16px; font-weight:700; min-width:200px } @media (max-width:600px){ .nav { flex-wrap:wrap } .nav h3 { min-width:0 } }
    .cal { display:grid; overflow-x:auto; border:1px solid var(--line); border-radius:12px; background:var(--card) }
    .cal .hd { position:sticky; top:0; background:var(--card); padding:10px; border-bottom:1px solid var(--line); font-weight:700; font-size:13px; z-index:2; display:flex; gap:8px; align-items:center; min-width:0 }
    .cal .hd small { display:block; color:var(--mut); font-weight:500; font-size:11.5px }
    .cal .tm { font-size:11.5px; color:var(--mut); padding:4px 8px; border-right:1px solid var(--line); text-align:right }
    .col { position:relative; border-left:1px solid var(--line) }
    .slotline { height:116px; border-bottom:1px dashed var(--line) }
    .slotline.lunch { background:repeating-linear-gradient(45deg,transparent 0 6px,color-mix(in srgb,var(--line) 60%,transparent) 6px 7px) }
    .ev { position:absolute; left:4px; right:4px; border-radius:8px; padding:4px 7px; font-size:11.5px; line-height:1.25; overflow:hidden; border:0; text-align:left; border-left:3px solid; cursor:pointer }
    .ev b { display:block; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
    .ev.t-g { background:var(--pri-soft); border-color:var(--pri); color:var(--fg) } .ev.t-a { background:var(--amber-soft); border-color:var(--amber); color:var(--fg) }
    .ev.t-v { background:var(--violet-soft); border-color:var(--violet); color:var(--fg) } .ev.t-b { background:var(--blue-soft); border-color:var(--blue); color:var(--fg) }
    .ev.t-n { background:var(--ground); border-color:var(--mut); color:var(--mut); text-decoration:line-through } .ev.t-r { background:var(--red-soft); border-color:var(--red); color:var(--fg) }
    .ev.t-ok { background:var(--green-soft); border-color:var(--green); color:var(--fg) } .ev.t-p { background:var(--pink-soft); border-color:var(--pink); color:var(--fg) }
    .now { position:absolute; left:0; right:0; height:2px; background:var(--red); z-index:1 }
    .month { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:6px }
    .month .dn { font-size:12px; color:var(--mut); font-weight:600; padding:4px 6px }
    .md { min-height:96px; border:1px solid var(--line); border-radius:10px; padding:6px 8px; background:var(--card); text-align:left; display:flex; flex-direction:column; gap:4px; color:var(--fg) }
    .md.out { opacity:.45 } .md.today { border-color:var(--pri); box-shadow:inset 0 0 0 1px var(--pri) }
    .md .n { font-weight:700; font-size:13px } .md .cnt { font-size:11.5px; color:var(--mut) }
    .md .pill { font-size:11px; border-radius:6px; padding:1px 6px; background:var(--pri-soft); color:var(--pri); white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
    .stats { display:flex; gap:16px; flex-wrap:wrap; font-size:13px; color:var(--mut) } .stats b { color:var(--fg) }
    @media (max-width:760px){ .md { min-height:116px } .md .pill { display:none } }
  `],
  template: `
  <div class="page">
    <cf-page-head title="Appointments" [crumbs]="['Front desk', 'Calendar']" sub="Doctor schedules, bookings and reminders. Click an appointment to manage it.">
      <button class="btn ghost" (click)="remindAll()"><lucide-icon name="send" [size]="16"></lucide-icon>Send tomorrow's reminders</button>
      <a class="btn" routerLink="/appointments/new"><lucide-icon name="calendar-plus" [size]="16"></lucide-icon>Book appointment</a>
    </cf-page-head>

    <div class="card">
      <div class="toolbar" style="margin-bottom:14px">
        <div class="nav">
          <button class="iconbtn" (click)="shift(-1)" aria-label="Previous"><lucide-icon name="chevron-left" [size]="18"></lucide-icon></button>
          <button class="btn ghost sm" (click)="date.set(store.today())">Today</button>
          <button class="iconbtn" (click)="shift(1)" aria-label="Next"><lucide-icon name="chevron-right" [size]="18"></lucide-icon></button>
          <h3>{{ title() }}</h3>
        </div>
        <span class="spacer"></span>
        <select class="inp" style="width:auto" [ngModel]="dept()" (ngModelChange)="dept.set($event); doc.set('')" aria-label="Department"><option value="">All departments</option>@for (d of store.db.departments; track d.id) {<option [value]="d.id">{{ d.name }}</option>}</select>
        <select class="inp" style="width:auto" [ngModel]="doc()" (ngModelChange)="doc.set($event)" aria-label="Doctor"><option value="">All doctors</option>@for (d of doctorsInDept(); track d.id) {<option [value]="d.id">{{ d.name }}</option>}</select>
        <div class="seg" role="group" aria-label="View">@for (v of views; track v) {<button [class.on]="view() === v" (click)="view.set(v)">{{ v | titlecase }}</button>}</div>
      </div>
      <div class="stats" style="margin-bottom:12px">
        <span><b>{{ stats().total }}</b> booked</span><span><b>{{ stats().arrived }}</b> arrived</span><span><b>{{ stats().done }}</b> completed</span>
        <span><b>{{ stats().cancelled }}</b> cancelled or no-show</span>
        <span class="legend"><span><i style="background:var(--blue)"></i>Scheduled</span><span><i style="background:var(--pri)"></i>Confirmed</span><span><i style="background:var(--amber)"></i>Arrived / waiting</span><span><i style="background:var(--violet)"></i>In consultation</span><span><i style="background:var(--green)"></i>Completed</span></span>
      </div>

      @switch (view()) {
      @case ('day') {
        <div class="cal" [style.grid-template-columns]="'56px repeat(' + dayCols().length + ', minmax(150px, 1fr))'">
          <div class="hd"></div>
          @for (d of dayCols(); track d.id) { <div class="hd"><cf-avatar [name]="d.name"></cf-avatar><div style="min-width:0">{{ d.name }}<small>{{ store.dept(d.deptId)?.name }} · {{ d.room }}</small></div></div> }
          <div>@for (h of hours; track h) { <div class="tm" style="height:116px">{{ h > 12 ? h - 12 : h }} {{ h >= 12 ? 'pm' : 'am' }}</div> }</div>
          @for (d of dayCols(); track d.id) {
            <div class="col">
              @for (h of hours; track h) { <div class="slotline" [class.lunch]="h === 13" (dblclick)="quickBook(d.id, h)"></div> }
              @if (isToday()) { <div class="now" [style.top.px]="nowTop()"></div> }
              @for (x of laid(d.id, date()); track x.a.id) { @let a = x.a;
                <button class="ev t-{{ tone(a.status) }}" [style.top.px]="top(a)" [style.height.px]="height(a)" [style.left]="'calc(' + (x.lane * 100 / x.lanes) + '% + 3px)'" [style.width]="'calc(' + (100 / x.lanes) + '% - 6px)'" [style.right]="'auto'" (click)="sel.set(a)">
                  <b>{{ store.pname(a.patientId) }}</b>{{ a.time | time12 }} · {{ a.type }}
                </button>
              }
            </div>
          }
        </div>
        <p class="hint" style="margin-top:8px">Hatched band is the 1–2 pm lunch break. Double-click an empty slot to book it.</p>
      }
      @case ('week') {
        <div class="cal" style="grid-template-columns:56px repeat(7, minmax(120px, 1fr))">
          <div class="hd"></div>
          @for (d of weekDays(); track d) { <div class="hd" [style.color]="d === store.today() ? 'var(--pri)' : ''"><div>{{ dayName(d) }}<small>{{ d | d }}</small></div></div> }
          <div>@for (h of hours; track h) { <div class="tm" style="height:116px">{{ h > 12 ? h - 12 : h }} {{ h >= 12 ? 'pm' : 'am' }}</div> }</div>
          @for (d of weekDays(); track d) {
            <div class="col">
              @for (h of hours; track h) { <div class="slotline" [class.lunch]="h === 13"></div> }
              @for (x of laid('', d); track x.a.id) { @let a = x.a;
                <button class="ev t-{{ tone(a.status) }}" [style.top.px]="top(a)" [style.height.px]="height(a)" [style.left]="'calc(' + (x.lane * 100 / x.lanes) + '% + 2px)'" [style.width]="'calc(' + (100 / x.lanes) + '% - 4px)'" [style.right]="'auto'" (click)="sel.set(a)" [matTooltip]="store.pname(a.patientId) + ' · ' + store.dname(a.doctorId)">
                  <b>{{ store.pname(a.patientId) }}</b>{{ a.time | time12 }}
                </button>
              }
            </div>
          }
        </div>
      }
      @case ('month') {
        <div class="month">
          @for (n of ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']; track n) { <div class="dn">{{ n }}</div> }
          @for (c of monthCells(); track c.date) {
            <button class="md" [class.out]="!c.inMonth" [class.today]="c.date === store.today()" (click)="date.set(c.date); view.set('day')">
              <span class="n">{{ c.day }}</span>
              @if (c.count) { <span class="cnt">{{ c.count }} appointments</span> }
              @for (a of c.first; track a.id) { <span class="pill">{{ a.time }} {{ store.pname(a.patientId) }}</span> }
            </button>
          }
        </div>
      }
      @case ('list') {
        <cf-table [rows]="listRows()" [cols]="cols" [clickable]="true" (rowClick)="sel.set($event)" [pageSize]="12" emptyTitle="No appointments" emptyText="Nothing booked for this filter.">
          <ng-template cfCell="patient" let-a><div class="pname"><cf-avatar [name]="store.pname(a.patientId)"></cf-avatar><div>{{ store.pname(a.patientId) }}<small>{{ a.patientId }}</small></div></div></ng-template>
          <ng-template cfCell="time" let-a>{{ a.date | d }} · {{ a.time | time12 }}</ng-template>
          <ng-template cfCell="status" let-a><cf-status [s]="a.status"></cf-status></ng-template>
          <ng-template cfCell="reminder" let-a>@if (a.reminderSent) {<span class="st ok">Sent</span>} @else {<span class="st n">Not sent</span>}</ng-template>
        </cf-table>
      }
      }
    </div>
  </div>

  <cf-drawer [open]="!!sel()" [title]="sel() ? store.pname(sel()!.patientId) : ''" [sub]="sel() ? sel()!.id + ' · ' + sel()!.type : ''" (closed)="sel.set(null); resch.set(false)">
    @if (sel(); as a) {
      <div class="stack">
        <div class="row"><cf-status [s]="a.status"></cf-status>@if (a.token) {<span class="st b">Token {{ a.token }}</span>}@if (a.recurring && a.recurring !== 'None') {<span class="st v">Repeats {{ a.recurring }}</span>}</div>
        <div class="kv">
          <div><small>Date</small><b>{{ a.date | d:true }}</b></div><div><small>Time</small><b>{{ a.time | time12 }} · {{ a.duration }} min</b></div>
          <div><small>Doctor</small><b>{{ store.dname(a.doctorId) }}</b></div><div><small>Room</small><b>{{ a.room }}</b></div>
          <div><small>Mobile</small><b>{{ store.patient(a.patientId)?.mobile }}</b></div><div><small>Reminder</small><b>{{ a.reminderSent ? 'Sent on WhatsApp' : 'Not sent' }}</b></div>
        </div>
        @if (a.notes) { <div class="soft small">{{ a.notes }}</div> }
        @if (resch()) {
          <div class="soft stack-s">
            <b>Reschedule</b>
            <div class="form-grid"><div class="field"><label>New date</label><input class="inp" type="date" [(ngModel)]="rDate" (ngModelChange)="rTime = ''"></div>
            <div class="field"><label>Free slot</label><select class="inp" [(ngModel)]="rTime"><option value="">Choose</option>@for (t of store.freeSlots(a.doctorId, rDate); track t) {<option [value]="t">{{ t | time12 }}</option>}</select></div></div>
            @if (rDate && !store.freeSlots(a.doctorId, rDate).length) { <span class="errmsg">No free slots on this date. {{ store.checkSlot(a.doctorId, rDate, '10:00', a.duration).reason }}</span> }
            <div class="row"><button class="btn sm" [disabled]="!rTime" (click)="doResch(a)">Confirm new time</button><button class="btn ghost sm" (click)="resch.set(false)">Cancel</button></div>
          </div>
        }
        <div class="section-title">Actions</div>
        <div class="row">
          @if (a.status === 'Scheduled') { <button class="btn sm" (click)="set(a, 'Confirmed')"><lucide-icon name="check" [size]="15"></lucide-icon>Confirm</button> }
          @if (canCheckIn(a)) { <button class="btn sm" (click)="set(a, 'Arrived')"><lucide-icon name="user-check" [size]="15"></lucide-icon>Check in</button> }
          @if (open(a)) {
            <button class="btn ghost sm" (click)="resch.set(true); rDate = a.date; rTime = ''"><lucide-icon name="calendar-clock" [size]="15"></lucide-icon>Reschedule</button>
            <button class="btn ghost sm" (click)="store.sendReminder(a.id); toast.ok('Reminder sent on WhatsApp (simulated)')"><lucide-icon name="send" [size]="15"></lucide-icon>Send reminder</button>
            <button class="btn ghost sm" (click)="set(a, 'No-show')"><lucide-icon name="user-x" [size]="15"></lucide-icon>No-show</button>
            <button class="btn ghost sm" style="color:var(--red)" (click)="set(a, 'Cancelled')"><lucide-icon name="circle-x" [size]="15"></lucide-icon>Cancel</button>
          }
        </div>
        <div class="row"><a class="linkbtn" [routerLink]="['/patients', a.patientId]">Open patient record</a>@if (a.status === 'In consultation' || a.status === 'Waiting' || a.status === 'Arrived') {<a class="linkbtn" [routerLink]="['/consultation', a.patientId]">Open consultation</a>}</div>
      </div>
    }
  </cf-drawer>`
})
export class CalendarPage {
  store = inject(StoreService); toast = inject(ToastService); router = inject(Router);
  views: View[] = ['day', 'week', 'month', 'list']; hours = HOURS;
  view = signal<View>('day'); date = signal(this.store.today()); dept = signal(''); doc = signal('');
  sel = signal<Appointment | null>(null); resch = signal(false); rDate = ''; rTime = '';
  cols = [
    { key: 'patient', label: 'Patient', value: (a: Appointment) => this.store.pname(a.patientId) }, { key: 'time', label: 'When', value: (a: Appointment) => a.date + a.time },
    { key: 'doctor', label: 'Doctor', value: (a: Appointment) => this.store.dname(a.doctorId) }, { key: 'type', label: 'Type' }, { key: 'token', label: 'Token' },
    { key: 'status', label: 'Status' }, { key: 'reminder', label: 'Reminder', value: (a: Appointment) => a.reminderSent ? 1 : 0 },
  ];

  doctorsInDept = computed(() => this.store.db.doctors.filter(d => !this.dept() || d.deptId === this.dept()));
  dayCols = computed(() => this.doctorsInDept().filter(d => !this.doc() || d.id === this.doc()));
  isToday = computed(() => this.date() === this.store.today());
  private filtered = computed(() => { this.store.rev(); const ids = new Set(this.dayCols().map(d => d.id)); return this.store.db.appointments.filter(a => ids.has(a.doctorId)); });
  weekDays = computed(() => { const d = new Date(this.date() + 'T00:00'); const mon = (d.getDay() + 6) % 7; return Array.from({ length: 7 }, (_, i) => isoDay(i - mon, d)); });
  monthCells = computed(() => {
    const d = new Date(this.date() + 'T00:00'); const first = new Date(d.getFullYear(), d.getMonth(), 1); const lead = (first.getDay() + 6) % 7;
    const by = new Map<string, Appointment[]>(); this.filtered().forEach(a => { if (!by.has(a.date)) by.set(a.date, []); by.get(a.date)!.push(a); });
    return Array.from({ length: 42 }, (_, i) => { const iso = isoDay(i - lead, first); const list = (by.get(iso) || []).filter(a => a.status !== 'Cancelled'); return { date: iso, day: +iso.slice(8), inMonth: +iso.slice(5, 7) === d.getMonth() + 1, count: list.length, first: list.slice(0, 2) }; });
  });
  listRows = computed(() => { const w = this.weekDays(); return this.filtered().filter(a => a.date >= w[0] && a.date <= w[6]); });
  stats = computed(() => {
    const rows = this.view() === 'day' ? this.filtered().filter(a => a.date === this.date()) : this.view() === 'month' ? this.filtered().filter(a => a.date.slice(0, 7) === this.date().slice(0, 7)) : this.listRows();
    return { total: rows.length, arrived: rows.filter(a => ['Arrived', 'Waiting', 'In consultation'].includes(a.status)).length, done: rows.filter(a => a.status === 'Completed').length, cancelled: rows.filter(a => ['Cancelled', 'No-show'].includes(a.status)).length };
  });
  title = computed(() => {
    const d = new Date(this.date() + 'T00:00');
    if (this.view() === 'day') return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
    if (this.view() === 'month') return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const w = this.weekDays(); return `${fmtDate(w[0])} – ${fmtDate(w[6], true)}`;
  });
  nowTop = computed(() => { this.store.rev(); return (toMin(this.store.nowTime()) - HOURS[0] * 60) / 60 * HH; });

  apptsFor(docId: string, date: string) { return this.filtered().filter(a => a.date === date && (!docId || a.doctorId === docId)); }
  /** Appointments in one column, with side-by-side lanes for overlapping visits. */
  laid(docId: string, date: string) {
    const list = this.apptsFor(docId, date).filter(a => a.status !== 'Cancelled').sort((a, b) => a.time.localeCompare(b.time));
    const out: { a: Appointment; lane: number; lanes: number }[] = []; let group: typeof out = []; let end = -1;
    const flush = () => { const n = Math.max(...group.map(g => g.lane)) + 1; group.forEach(g => g.lanes = n); group = []; };
    for (const a of list) {
      const s = toMin(a.time), e = s + Math.max(a.duration, 20);
      if (s >= end && group.length) flush();
      const used = new Set(group.filter(g => toMin(g.a.time) + Math.max(g.a.duration, 20) > s).map(g => g.lane)); let lane = 0; while (used.has(lane)) lane++;
      const item = { a, lane, lanes: 1 }; group.push(item); out.push(item); end = Math.max(end, e);
    }
    if (group.length) flush();
    return out;
  }
  top(a: Appointment) { return Math.max(0, (toMin(a.time) - HOURS[0] * 60) / 60 * HH) + 1; }
  height(a: Appointment) { return Math.max(26, a.duration / 60 * HH - 3); }
  tone(s: ApptStatus) { return ({ Scheduled: 'b', Confirmed: 'g', Arrived: 'a', Waiting: 'a', 'In consultation': 'v', Completed: 'ok', Cancelled: 'n', 'No-show': 'r' } as Record<string, string>)[s]; }
  dayName(d: string) { return new Date(d + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short' }); }
  shift(n: number) { const d = new Date(this.date() + 'T00:00'); if (this.view() === 'month') { d.setMonth(d.getMonth() + n); this.date.set(isoDay(0, d)); } else this.date.set(isoDay(n * (this.view() === 'day' ? 1 : 7), d)); }
  open(a: Appointment) { return !['Completed', 'Cancelled', 'No-show', 'In consultation'].includes(a.status); }
  canCheckIn(a: Appointment) { return a.date === this.store.today() && (a.status === 'Scheduled' || a.status === 'Confirmed'); }
  set(a: Appointment, s: ApptStatus) {
    this.store.setApptStatus(a.id, s);
    const msg: Record<string, string> = { Confirmed: 'Appointment confirmed. Patient notified on WhatsApp (simulated).', Arrived: `Checked in. Token ${a.token} added to the queue.`, Cancelled: 'Appointment cancelled. The slot is free again.', 'No-show': 'Marked as no-show. A follow-up call task was not created in this demo.' };
    this.toast.ok(msg[s] ?? `Marked ${s}`);
    this.sel.set(this.store.db.appointments.find(x => x.id === a.id) ?? null);
  }
  doResch(a: Appointment) { this.store.reschedule(a.id, this.rDate, this.rTime); this.toast.ok(`Moved to ${fmtDate(this.rDate)} at ${this.rTime}. Patient notified (simulated).`); this.resch.set(false); this.date.set(this.rDate); }
  quickBook(docId: string, h: number) { this.router.navigate(['/appointments/new'], { queryParams: { doctor: docId, date: this.date(), time: `${String(h).padStart(2, '0')}:00` } }); }
  remindAll() {
    const t = this.store.day(1); const list = this.store.db.appointments.filter(a => a.date === t && !a.reminderSent && a.status !== 'Cancelled');
    list.forEach(a => this.store.sendReminder(a.id)); this.toast.ok(list.length ? `${list.length} reminders sent for tomorrow (simulated WhatsApp)` : 'All reminders for tomorrow are already sent');
  }
}
