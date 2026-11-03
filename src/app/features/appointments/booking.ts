import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SHARED, fmtDate } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { Appointment, Patient } from '../../core/models';

@Component({
  standalone: true, imports: [SHARED],
  styles: [`
    .slots { display:grid; grid-template-columns:repeat(auto-fill,minmax(84px,1fr)); gap:8px }
    .slots button { border:1px solid var(--line); background:var(--card); border-radius:10px; padding:8px 0; font-weight:600; font-size:13px; color:var(--fg) }
    .slots button.on { background:var(--pri); color:#fff; border-color:var(--pri) }
    .slots button:disabled { color:var(--mut); background:var(--ground); text-decoration:line-through; cursor:not-allowed }
    .pick { display:flex; flex-direction:column; border:1px solid var(--line); border-radius:12px; max-height:240px; overflow:auto }
    .pick button { display:flex; gap:10px; align-items:center; padding:9px 12px; border:0; border-bottom:1px solid var(--line); background:none; text-align:left; color:var(--fg) }
    .pick button:hover { background:var(--ground) }
    .docs { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:10px }
    .docs button { border:1px solid var(--line); background:var(--card); border-radius:12px; padding:10px 12px; display:flex; gap:10px; align-items:center; text-align:left; color:var(--fg) }
    .docs button.on { border-color:var(--pri); box-shadow:inset 0 0 0 1px var(--pri); background:var(--pri-soft) }
    .docs small { display:block; color:var(--mut); font-size:12px }
    .sum .kv { grid-template-columns:1fr 1fr }
    .sticky { position:sticky; top:84px }
  `],
  template: `
  <div class="page">
    <cf-page-head title="Book appointment" [crumbs]="['Appointments', 'New booking']" sub="Availability and conflicts are checked as you choose.">
      <a class="btn ghost" routerLink="/appointments">Cancel</a>
    </cf-page-head>
    <div class="grid">
      <div class="c8 stack">
        <div class="card">
          <div class="card-h"><h3>1. Patient</h3><div class="r seg"><button [class.on]="!walkIn()" (click)="walkIn.set(false)">Scheduled</button><button [class.on]="walkIn()" (click)="walkIn.set(true); date.set(store.today())">Walk-in now</button></div></div>
          @if (patient(); as p) {
            <div class="soft row"><cf-avatar [name]="p.name"></cf-avatar><div class="grow" style="flex:1"><b>{{ p.name }}</b><div class="muted small">{{ p.id }} · {{ p.dob | age }} y {{ p.gender }} · {{ p.mobile }}</div></div>
              @for (a of p.allergies; track a) {<span class="st r">{{ a }} allergy</span>}<button class="btn ghost sm" (click)="patientId.set('')">Change</button></div>
            @if (existing().length) { <div class="alert-box info" style="margin-top:10px"><lucide-icon name="info" [size]="16"></lucide-icon><div>{{ p.name.split(' ')[0] }} already has {{ existing().length }} upcoming: {{ existingText() }}</div></div> }
          } @else {
            <label class="search boxed"><lucide-icon name="search" [size]="16"></lucide-icon><input [ngModel]="pq()" (ngModelChange)="pq.set($event)" placeholder="Search by name, UHID or mobile" aria-label="Find patient"></label>
            @if (pq().length > 1) {
              <div class="pick" style="margin-top:8px">
                @for (p of matches(); track p.id) { <button (click)="patientId.set(p.id); pq.set('')"><cf-avatar [name]="p.name"></cf-avatar><div><b>{{ p.name }}</b><div class="muted small">{{ p.id }} · {{ p.mobile }}</div></div></button> }
                @empty { <div style="padding:12px" class="muted small">No match. <a routerLink="/patients/new">Register a new patient</a></div> }
              </div>
            }
            @if (touched() && !patientId()) { <div class="errmsg" style="margin-top:6px">Choose a patient first.</div> }
          }
        </div>

        <div class="card">
          <div class="card-h"><h3>2. Doctor</h3>
            <select class="inp r" style="width:auto" [ngModel]="dept()" (ngModelChange)="dept.set($event)" aria-label="Department"><option value="">All departments</option>@for (d of store.db.departments; track d.id) {<option [value]="d.id">{{ d.name }}</option>}</select></div>
          <div class="docs">
            @for (d of doctors(); track d.id) {
              <button [class.on]="doctorId() === d.id" (click)="doctorId.set(d.id); time.set('')"><cf-avatar [name]="d.name"></cf-avatar>
                <div style="min-width:0"><b>{{ d.name }}</b><small>{{ store.dept(d.deptId)?.name }} · {{ d.fee | inr }}</small><small><cf-status [s]="d.status"></cf-status></small></div></button>
            }
          </div>
        </div>

        <div class="card">
          <div class="card-h"><h3>3. Date and time</h3>@if (doctor(); as d) {<span class="r muted small">{{ d.days.join(', ') }} · {{ d.start }}–{{ d.end }} · {{ d.slotMin }} min slots</span>}</div>
          @if (!walkIn()) {
          <div class="form-grid three">
            <div class="field"><label>Date <span class="req">*</span></label><input class="inp" type="date" [min]="store.today()" [ngModel]="date()" (ngModelChange)="date.set($event); time.set('')"></div>
            <div class="field"><label>Visit type</label><select class="inp" [(ngModel)]="type"><option>New consultation</option><option>Follow-up</option><option>Review</option><option>Procedure</option><option>Teleconsult</option></select></div>
            <div class="field"><label>Duration</label><select class="inp" [ngModel]="duration()" (ngModelChange)="duration.set(+$event)"><option [value]="10">10 min</option><option [value]="15">15 min</option><option [value]="20">20 min</option><option [value]="30">30 min</option><option [value]="45">45 min</option></select></div>
          </div>
          @if (doctorId()) {
            <div class="section-title" style="margin-top:14px">Slots on {{ dateLabel() }}</div>
            @if (dayBlock()) { <div class="alert-box warn"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon>{{ dayBlock() }}</div> }
            @else {
            <div class="slots" style="margin-top:8px">
              @for (s of grid(); track s.t) { <button [class.on]="time() === s.t" [disabled]="!s.ok" (click)="time.set(s.t)" [matTooltip]="s.reason || ''">{{ s.t | time12 }}</button> }
            </div>
            <p class="hint" style="margin-top:6px">{{ freeCount() }} free · struck-out slots are booked, passed or in the lunch break. Hover for the reason.</p>
            }
            <div class="field" style="margin-top:12px;max-width:260px"><label>Or type a specific time</label><input class="inp" type="time" [ngModel]="time()" (ngModelChange)="time.set($event)"></div>
          } @else { <p class="muted small">Pick a doctor to see free slots.</p> }
          <div class="form-grid" style="margin-top:14px">
            <div class="field"><label>Repeat</label><select class="inp" [(ngModel)]="recurring"><option>None</option><option>Weekly</option><option>Every 2 weeks</option><option>Monthly</option></select><span class="hint">Creates up to 3 more visits where the slot is free.</span></div>
            <div class="field"><label>Reminder</label><select class="inp" [(ngModel)]="reminder"><option>WhatsApp + SMS</option><option>SMS only</option><option>Email</option><option>No reminder</option></select></div>
          </div>
          } @else {
            <div class="alert-box info"><lucide-icon name="info" [size]="16"></lucide-icon><div>Walk-in visits are booked for now ({{ store.nowTime() | time12 }}) and the patient joins the queue with a token straight away.</div></div>
          }
          <div class="field" style="margin-top:12px"><label>Notes for the doctor</label><textarea class="inp" [(ngModel)]="notes" placeholder="Reason for visit, referral, interpreter needed…"></textarea></div>
        </div>
      </div>

      <div class="c4">
        <div class="card sum sticky stack">
          <h3 style="font-size:15.5px">Booking summary</h3>
          <div class="kv">
            <div><small>Patient</small><b>{{ patient()?.name || '—' }}</b></div><div><small>Doctor</small><b>{{ doctor()?.name || '—' }}</b></div>
            <div><small>Date</small><b>{{ walkIn() ? 'Today' : dateLabel() }}</b></div><div><small>Time</small><b>{{ walkIn() ? 'Now' : (time() ? (time() | time12) : '—') }}</b></div>
            <div><small>Type</small><b>{{ walkIn() ? 'Walk-in' : type }}</b></div><div><small>Fee</small><b>{{ (doctor()?.fee || 0) | inr }}</b></div>
          </div>
          @if (conflict(); as c) {
            @if (c.ok) { <div class="alert-box ok"><lucide-icon name="circle-check" [size]="16"></lucide-icon>Slot is free. No clashes found.</div> }
            @else { <div class="alert-box crit"><lucide-icon name="circle-alert" [size]="16"></lucide-icon><div><b>Can't book this slot</b><div>{{ c.reason }}</div></div></div>
              @if (alts().length) { <div class="small muted">Nearest free: @for (t of alts(); track t) { <button class="chip" style="margin:2px" (click)="time.set(t)">{{ t | time12 }}</button> }</div> } }
          }
          <button class="btn" [disabled]="busy()" (click)="confirm()">@if (busy()) {Booking…} @else {<lucide-icon name="check" [size]="16"></lucide-icon>{{ walkIn() ? 'Add walk-in to queue' : 'Confirm booking' }}}</button>
          <p class="hint">Confirmation is sent as a simulated WhatsApp message. No real message leaves the prototype.</p>
        </div>
      </div>
    </div>
  </div>

  <cf-modal [open]="!!done()" title="Appointment booked" (closed)="router.navigate(['/appointments'])">
    @if (done(); as a) {
      <div class="stack">
        <div class="alert-box ok"><lucide-icon name="circle-check" [size]="16"></lucide-icon><div>{{ store.pname(a.patientId) }} is booked with {{ store.dname(a.doctorId) }} on {{ a.date | d:true }} at {{ a.time | time12 }}.</div></div>
        <div class="kv"><div><small>Appointment ID</small><b>{{ a.id }}</b></div><div><small>Room</small><b>{{ a.room }}</b></div>@if (a.token) {<div><small>Token</small><b>{{ a.token }}</b></div>}@if (extra()) {<div><small>Repeats</small><b>{{ extra() }} more visits</b></div>}</div>
      </div>
    }
    <div foot><a class="btn ghost" routerLink="/queue">View queue</a><button class="btn ghost" (click)="reset()">Book another</button><a class="btn" routerLink="/appointments">Go to calendar</a></div>
  </cf-modal>`
})
export class BookingPage {
  store = inject(StoreService); toast = inject(ToastService); router = inject(Router);
  patientId = signal(''); pq = signal(''); dept = signal(''); doctorId = signal(''); date = signal(this.store.today()); time = signal(''); duration = signal(15);
  walkIn = signal(false); touched = signal(false); busy = signal(false); done = signal<Appointment | null>(null); extra = signal(0);
  type: Appointment['type'] = 'New consultation'; recurring = 'None'; reminder = 'WhatsApp + SMS'; notes = '';

  constructor() {
    const q = inject(ActivatedRoute).snapshot.queryParamMap;
    if (q.get('patient')) this.patientId.set(q.get('patient')!);
    if (q.get('doctor')) { this.doctorId.set(q.get('doctor')!); }
    if (q.get('date')) this.date.set(q.get('date')!);
    if (q.get('time')) this.time.set(q.get('time')!);
    if (q.get('walkin')) this.walkIn.set(true);
    if (q.get('type')) this.type = q.get('type') as Appointment['type'];
    if (!this.doctorId() && this.patientId()) this.doctorId.set(this.store.patient(this.patientId())?.primaryDoctorId || '');
    const d = this.store.doctor(this.doctorId()); if (d) this.duration.set(d.slotMin);
  }

  patient = computed(() => this.store.patient(this.patientId()));
  doctor = computed(() => this.store.doctor(this.doctorId()));
  doctors = computed(() => this.store.db.doctors.filter(d => !this.dept() || d.deptId === this.dept()));
  matches = computed(() => { const q = this.pq().toLowerCase(); const dg = q.replace(/\D/g, ''); return this.store.db.patients.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || (dg.length > 3 && p.mobile.replace(/\D/g, '').includes(dg))).slice(0, 6); });
  existing = computed(() => { this.store.rev(); return this.store.db.appointments.filter(a => a.patientId === this.patientId() && a.date >= this.store.today() && ['Scheduled', 'Confirmed'].includes(a.status)); });
  existingText = computed(() => this.existing().slice(0, 2).map(a => `${fmtDate(a.date)} ${a.time} with ${this.store.dname(a.doctorId)}`).join('; '));
  dateLabel = computed(() => fmtDate(this.date(), true));
  dayBlock = computed(() => { const d = this.doctor(); if (!d) return ''; const r = this.store.checkSlot(d.id, this.date(), d.start, d.slotMin); return r.ok || !(r.reason?.includes('does not consult') || r.reason?.includes('on leave')) ? '' : r.reason; });
  grid = computed(() => {
    this.store.rev(); const d = this.doctor(); if (!d) return [];
    const out: { t: string; ok: boolean; reason?: string }[] = []; const [h0] = d.start.split(':').map(Number); const [h1] = d.end.split(':').map(Number);
    for (let h = h0; h < h1; h++) for (let m = 0; m < 60; m += d.slotMin) { const t = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; const r = this.store.checkSlot(d.id, this.date(), t, this.duration()); out.push({ t, ok: r.ok, reason: r.reason }); }
    return out;
  });
  freeCount = computed(() => this.grid().filter(s => s.ok).length);
  conflict = computed(() => { if (this.walkIn() || !this.doctorId() || !this.time()) return null; return this.store.checkSlot(this.doctorId(), this.date(), this.time(), this.duration()); });
  alts = computed(() => { const t = this.time(); if (!t) return []; const free = this.grid().filter(s => s.ok).map(s => s.t); return free.sort((a, b) => Math.abs(this.m(a) - this.m(t)) - Math.abs(this.m(b) - this.m(t))).slice(0, 3).sort(); });
  private m(t: string) { const [h, mm] = t.split(':').map(Number); return h * 60 + mm; }

  confirm() {
    this.touched.set(true);
    if (!this.patientId()) { this.toast.err('Choose a patient first'); return; }
    if (!this.doctorId()) { this.toast.err('Choose a doctor'); return; }
    if (this.walkIn()) {
      const a = this.store.walkIn(this.patientId(), this.doctorId());
      this.toast.ok(`${this.store.pname(a.patientId)} added to the queue with token ${a.token}`); this.router.navigate(['/queue']); return;
    }
    if (!this.time()) { this.toast.err('Choose a time slot'); return; }
    const c = this.conflict(); if (c && !c.ok) { this.toast.err(c.reason || 'Slot not available'); return; }
    this.busy.set(true);
    setTimeout(() => {
      const before = this.store.db.appointments.length;
      const a = this.store.book({ patientId: this.patientId(), doctorId: this.doctorId(), date: this.date(), time: this.time(), duration: this.duration(), type: this.type, notes: this.notes, recurring: this.recurring });
      if (this.reminder === 'No reminder') a.reminderSent = false;
      this.extra.set(this.store.db.appointments.length - before - 1);
      this.busy.set(false); this.done.set(a);
    }, 450);
  }
  reset() { this.done.set(null); this.time.set(''); this.notes = ''; this.recurring = 'None'; this.patientId.set(''); }
}
