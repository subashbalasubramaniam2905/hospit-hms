import { Component, computed, inject, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { ToastService } from '../../core/services/toast.service';
import { ThemeService } from '../../core/services/theme.service';
import { apiMessage } from '../../core/api/auth.service';
import { PAppointment, PBill, PDoctor, PortalApi, PProfile, PRecords } from '../../core/api/insights-api';
import { PORTAL_STYLES } from './portal';

type Tab = 'home' | 'appts' | 'records' | 'bills' | 'feedback';
type Rx = PRecords['prescriptions'][number];
type Lab = PRecords['labs'][number];

/** Live patient portal: OTP sign-in and the patient's own records from the server. */
@Component({
  standalone: true, imports: [SHARED],
  styles: [PORTAL_STYLES, `.res td, .res th { padding:6px 8px } .flag { color:var(--red); font-weight:700 }`],
  template: `
  <header class="top"><div class="brand"><app-logo></app-logo> <span class="muted small hide-sm" style="font-weight:600">Patient portal</span></div><span class="spacer"></span>
    <button class="iconbtn" (click)="theme.toggle()" aria-label="Toggle theme"><lucide-icon [name]="theme.dark() ? 'sun' : 'moon'" [size]="17"></lucide-icon></button>
    @if (api.signedIn()) { <button class="btn ghost sm" (click)="out()">Sign out</button> } @else { <a class="btn ghost sm" routerLink="/login">Staff sign in</a> }</header>

  @if (!api.signedIn()) {
    <div class="login card stack">
      <h1 style="font-size:22px">Sign in to your health record</h1>
      <p class="muted">Use the mobile number you gave at registration. We send a 6-digit code to it.</p>
      @if (step() === 1) {
        <div class="field"><label>Mobile number</label><input class="inp" [(ngModel)]="mobile" inputmode="tel" autocomplete="tel" placeholder="98765 43210"></div>
        <button class="btn" [disabled]="busy()" (click)="sendOtp()">Send code</button>
      } @else {
        <div class="field"><label>Enter the 6-digit code</label><input class="inp" [(ngModel)]="otp" maxlength="6" inputmode="numeric" autocomplete="one-time-code"></div>
        @if (devCode()) {<p class="hint">Test server: the code is {{ devCode() }}. Real codes go by SMS once a gateway is connected.</p>}
        <button class="btn" [disabled]="busy() || otp.length !== 6" (click)="verify()">Verify and continue</button><button class="linkbtn small" (click)="step.set(1); otp = ''">Change number</button>
      }
    </div>
  } @else if (p(); as p) {
  <div class="wrap">
    <div class="hero"><cf-avatar [name]="p.name" size="lg"></cf-avatar><div style="flex:1"><h1>Namaste, {{ p.name.split(' ')[0] }}</h1><p>UHID {{ p.id }} · {{ p.branchName }} · {{ p.insurer || 'Self pay' }}</p>
        @if (profiles().length > 1) {<select class="inp" style="margin-top:8px;max-width:280px" [ngModel]="pid()" (ngModelChange)="pick($event)" aria-label="Family member">@for (x of profiles(); track x.id) {<option [value]="x.id">{{ x.name }}</option>}</select>}</div>
      @if (next(); as a) { <div style="background:rgba(255,255,255,.14);border-radius:14px;padding:10px 14px"><div class="small" style="opacity:.85">Next visit</div><b>{{ a.date | d }} · {{ a.time | time12 }}</b><div class="small">{{ a.doctorName }}</div></div> }</div>
    <nav class="nav">@for (t of tabs; track t.id) {<button [class.on]="tab() === t.id" (click)="tab.set(t.id)"><lucide-icon [name]="t.icon" [size]="17"></lucide-icon>{{ t.label }}</button>}</nav>

    @switch (tab()) {
    @case ('home') {
      <div class="quick">
        <button (click)="openBooking()"><span style="background:var(--pri-soft);color:var(--pri)"><lucide-icon name="calendar-plus" [size]="18"></lucide-icon></span>Book appointment</button>
        <button (click)="tab.set('records')"><span style="background:var(--blue-soft);color:var(--blue)"><lucide-icon name="file-text" [size]="18"></lucide-icon></span>Lab reports</button>
        <button (click)="tab.set('records')"><span style="background:var(--violet-soft);color:var(--violet)"><lucide-icon name="pill" [size]="18"></lucide-icon></span>Prescriptions</button>
        <button (click)="tab.set('bills')"><span style="background:var(--amber-soft);color:var(--amber)"><lucide-icon name="wallet" [size]="18"></lucide-icon></span>Bills @if (due()) {<small class="muted">{{ due() | inr }} due</small>}</button>
      </div>
      <div class="card"><div class="card-h"><h3>Your health at a glance</h3></div>
        <div class="kv"><div><small>Conditions</small><b>{{ p.conditions.join(', ') || 'None recorded' }}</b></div><div><small>Allergies</small><b style="color:var(--red)">{{ p.allergies.join(', ') || 'None recorded' }}</b></div><div><small>Blood group</small><b>{{ p.blood || '—' }}</b></div><div><small>Doctor</small><b>{{ p.primaryDoctorName || '—' }}</b></div></div>
        @if (p.followUpDue) { <div class="alert-box info" style="margin-top:12px"><lucide-icon name="calendar-clock" [size]="16"></lucide-icon><div style="flex:1">Follow-up due {{ p.followUpDue | d:true }}{{ p.followUpReason ? ' for ' + p.followUpReason : '' }}.</div><button class="btn sm" (click)="openBooking(p.primaryDoctorId)">Book</button></div> }
        <p class="hint" style="margin-top:12px">If something here is wrong, tell the registration desk on your next visit.</p></div>
    }
    @case ('appts') {
      @if (booking()) {
        <div class="card stack">
          <div class="row"><h3 style="font-size:16px">Book an appointment</h3><span class="spacer"></span><button class="btn ghost sm" (click)="booking.set(false)">Close</button></div>
          <div class="form-grid"><div class="field"><label>Doctor</label><select class="inp" [(ngModel)]="bDoc" (ngModelChange)="loadSlots()">@for (d of doctors(); track d.id) {<option [value]="d.id">{{ d.name }} · {{ d.deptName }} · {{ d.branchName }} · {{ d.fee | inr }}</option>}</select></div>
            <div class="field"><label>Date</label><input class="inp" type="date" [min]="tomorrow" [(ngModel)]="bDate" (ngModelChange)="loadSlots()"></div></div>
          <div class="slot">@for (t of slots(); track t) {<button [class.on]="bTime === t" (click)="bTime = t">{{ t | time12 }}</button>} @empty {<p class="muted small">{{ slotsLoading() ? 'Checking free times…' : 'No free times that day. Try another date.' }}</p>}</div>
          <div class="row"><mat-checkbox [(ngModel)]="bTele">Video consultation</mat-checkbox><span class="spacer"></span><button class="btn" [disabled]="!bTime || busy()" (click)="bookIt()">Confirm, pay {{ doctor()?.fee | inr }} at the hospital</button></div>
        </div>
      } @else { <button class="btn" style="align-self:flex-start" (click)="openBooking()"><lucide-icon name="calendar-plus" [size]="16"></lucide-icon>Book appointment</button> }
      <div class="card"><div class="list">@for (a of appts(); track a.id) {
        <div class="li"><cf-avatar [name]="a.doctorName"></cf-avatar><div class="grow"><b>{{ a.date | d:true }} · {{ a.time | time12 }}</b><span>{{ a.doctorName }} · {{ a.deptName }} · {{ a.type }}{{ a.token ? ' · token ' + a.token : '' }}{{ a.room ? ' · ' + a.room : '' }}</span></div><cf-status [s]="a.status"></cf-status>
          @if ((a.status === 'Scheduled' || a.status === 'Confirmed') && a.date >= today) { <button class="btn ghost sm" (click)="cancel(a)">Cancel</button> }</div>
      } @empty { <p class="muted small">No appointments.</p> }</div></div>
    }
    @case ('records') {
      <div class="grid">
        <div class="card c6"><div class="card-h"><h3>Lab reports</h3></div><div class="list">@for (o of rec()?.labs ?? []; track o.id) {
          <div class="li"><lucide-icon name="flask-conical" [size]="16" style="color:var(--blue)"></lucide-icon><div class="grow"><b>{{ o.tests }}</b><span>{{ o.date | d:true }}</span></div>
            @if (o.ready) {<button class="btn ghost sm" (click)="labOpen.set(o)">View</button>} @else {<cf-status s="Processing"></cf-status>}</div>
        } @empty { <p class="muted small">No reports yet.</p> }</div></div>
        <div class="card c6"><div class="card-h"><h3>Prescriptions</h3></div><div class="list">@for (r of rec()?.prescriptions ?? []; track r.id) {
          <div class="li"><lucide-icon name="pill" [size]="16" style="color:var(--violet)"></lucide-icon><div class="grow"><b>{{ r.date | d:true }} · {{ r.doctorName }}</b><span>{{ r.items.length }} medicines{{ r.diagnosis ? ' · ' + r.diagnosis : '' }}</span></div><button class="btn ghost sm" (click)="rxOpen.set(r)">View</button></div>
        } @empty { <p class="muted small">No prescriptions.</p> }</div></div>
        <div class="card c12"><div class="card-h"><h3>Visit summaries</h3></div><div class="list">@for (c of rec()?.visits ?? []; track c.id) {
          <div class="li"><lucide-icon name="stethoscope" [size]="16" style="color:var(--pri)"></lucide-icon><div class="grow"><b>{{ c.date | d:true }} · {{ c.doctorName }}</b><span>{{ c.diagnoses.join(', ') || 'Consultation' }}{{ c.followUp || c.plan ? ' · ' + (c.followUp || c.plan) : '' }}</span></div></div>
        } @empty { <p class="muted small">No visits yet.</p> }</div></div>
      </div>
    }
    @case ('bills') {
      <div class="card"><div class="list">@for (i of bills(); track i.id) {
        <div class="li"><lucide-icon name="receipt" [size]="16" style="color:var(--amber)"></lucide-icon><div class="grow"><b>{{ i.number }} · {{ i.total | inr }}</b><span>{{ i.date | d:true }} · {{ i.kind }}{{ i.due > 0 ? ' · ' : '' }}@if (i.due > 0) {<b style="color:var(--red)">{{ i.due | inr }} due</b>}</span></div><cf-status [s]="i.status"></cf-status></div>
      } @empty { <p class="muted small">No bills.</p> }</div>
      <p class="hint" style="margin-top:10px">Pay at the billing counter. Online payment comes once a payment gateway is connected.</p></div>
    }
    @case ('feedback') {
      <div class="card stack" style="max-width:640px">
        <h3 style="font-size:16px">How was your last visit?</h3>
        <div class="stars">@for (n of [1,2,3,4,5]; track n) {<button (click)="rating = n" [attr.aria-label]="n + ' stars'"><lucide-icon name="star" [size]="28" [style.color]="n <= rating ? 'var(--amber)' : 'var(--line)'" [style.fill]="n <= rating ? 'var(--amber)' : 'none'"></lucide-icon></button>}</div>
        <div class="field"><label>Department</label><select class="inp" [(ngModel)]="fbDept">@for (d of depts(); track d) {<option>{{ d }}</option>}</select></div>
        <div class="field"><label>Tell us more (optional)</label><textarea class="inp" [(ngModel)]="fbText" maxlength="1000" placeholder="What went well, what we can improve"></textarea></div>
        <button class="btn" style="align-self:flex-start" [disabled]="!rating || busy()" (click)="sendFb()">Submit feedback</button>
      </div>
    }
    }
  </div>
  <cf-drawer [open]="!!rxOpen()" title="Prescription" width="min(720px,100%)" (closed)="rxOpen.set(null)">@if (rxOpen(); as r) {
    <p><b>{{ r.doctorName }}</b> · {{ r.date | d:true }}</p>@if (r.diagnosis) {<p class="muted">{{ r.diagnosis }}</p>}
    <div class="tbl"><table class="t res"><thead><tr><th>Medicine</th><th>Dose</th><th>When</th><th>For</th></tr></thead><tbody>@for (it of r.items; track $index) {<tr><td><b>{{ it.name }}</b> {{ it.strength }}@if (it.instructions) {<div class="muted small">{{ it.instructions }}</div>}</td><td>{{ it.dose }}</td><td>{{ it.frequency }}{{ it.food ? ' · ' + it.food : '' }}</td><td>{{ it.duration }}</td></tr>}</tbody></table></div>
    @if (r.notes) {<p class="muted" style="margin-top:10px">{{ r.notes }}</p>}
  }</cf-drawer>
  <cf-drawer [open]="!!labOpen()" [title]="labOpen()?.tests || ''" width="min(720px,100%)" (closed)="labOpen.set(null)">@if (labOpen(); as o) {
    <p class="muted">{{ o.date | d:true }}</p>
    <div class="tbl"><table class="t res"><thead><tr><th>Test</th><th class="num">Result</th><th>Range</th></tr></thead><tbody>@for (x of o.results; track $index) {<tr><td>{{ x.param || x.test }}</td><td class="num" [class.flag]="x.flag && x.flag !== 'Normal'">{{ x.value ?? '—' }} {{ x.unit }}{{ x.flag && x.flag !== 'Normal' ? ' · ' + x.flag : '' }}</td><td class="muted">@if (x.low != null || x.high != null) {{{ x.low ?? '' }}–{{ x.high ?? '' }}}</td></tr>}</tbody></table></div>
    <p class="hint" style="margin-top:10px">Your doctor will explain what these results mean for you.</p>
  }</cf-drawer>
  } @else { <div class="login"><p class="muted">Loading your record…</p></div> }`
})
export class PortalLivePage {
  api = inject(PortalApi); toast = inject(ToastService); theme = inject(ThemeService);
  tabs: { id: Tab; label: string; icon: string }[] = [{ id: 'home', label: 'Home', icon: 'house' }, { id: 'appts', label: 'Appointments', icon: 'calendar-days' }, { id: 'records', label: 'Records', icon: 'file-text' }, { id: 'bills', label: 'Bills', icon: 'wallet' }, { id: 'feedback', label: 'Feedback', icon: 'star' }];
  tab = signal<Tab>('home'); step = signal(1); busy = signal(false); booking = signal(false); devCode = signal<string | null>(null);
  rxOpen = signal<Rx | null>(null); labOpen = signal<Lab | null>(null);
  profiles = signal<PProfile[]>([]); pid = signal<string>(''); doctors = signal<PDoctor[]>([]);
  appts = signal<PAppointment[]>([]); rec = signal<PRecords | null>(null); bills = signal<PBill[]>([]);
  slots = signal<string[]>([]); slotsLoading = signal(false);
  mobile = ''; otp = ''; bDoc = ''; bDate = ''; bTime = ''; bTele = false; rating = 0; fbDept = ''; fbText = '';
  today = iso(new Date()); tomorrow = iso(new Date(Date.now() + 864e5));

  p = computed(() => this.profiles().find(x => x.id === this.pid()) ?? null);
  doctor = computed(() => this.doctors().find(d => d.id === this.bDoc));
  next = computed(() => this.appts().filter(a => a.date >= this.today && !['Completed', 'Cancelled', 'No-show'].includes(a.status)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0]);
  due = computed(() => this.bills().reduce((t, b) => t + b.due, 0));
  depts = computed(() => [...new Set(this.doctors().map(d => d.deptName))].sort());

  constructor() { if (this.api.signedIn()) this.start(); }

  async sendOtp() {
    if (this.mobile.replace(/\D/g, '').length < 10) { this.toast.err('Enter your 10-digit mobile number'); return; }
    this.busy.set(true);
    try { const r = await this.api.requestOtp(this.mobile); this.devCode.set(r.devCode ?? null); this.step.set(2); this.toast.info('If this number is registered with us, a code is on its way'); }
    catch (e) { this.toast.err(apiMessage(e, 'Could not send the code')); }
    finally { this.busy.set(false); }
  }
  async verify() {
    this.busy.set(true);
    try { await this.api.verify(this.mobile, this.otp.trim()); this.otp = ''; this.step.set(1); await this.start(); }
    catch (e) { this.toast.err(apiMessage(e, 'That code did not work')); }
    finally { this.busy.set(false); }
  }
  out() { this.api.signOut(); this.profiles.set([]); this.pid.set(''); this.tab.set('home'); }

  private async start() {
    try {
      const [me, docs] = await Promise.all([this.api.me(), this.api.doctors()]);
      this.profiles.set(me); this.doctors.set(docs); this.fbDept = this.depts()[0] ?? '';
      if (me.length) await this.pick(me[0].id); else { this.toast.err('No patient record found for this number'); this.out(); }
    } catch (e) { this.toast.err(apiMessage(e, 'Your session has ended. Sign in again')); this.out(); }
  }
  async pick(id: string) {
    this.pid.set(id);
    try {
      const [a, r, b] = await Promise.all([this.api.appointments(id), this.api.records(id), this.api.bills(id)]);
      this.appts.set(a); this.rec.set(r); this.bills.set(b);
    } catch (e) { this.toast.err(apiMessage(e, 'Could not load your record')); }
  }
  openBooking(doctorId?: string) {
    this.tab.set('appts'); this.booking.set(true);
    this.bDoc = doctorId && this.doctors().some(d => d.id === doctorId) ? doctorId : this.bDoc || this.p()?.primaryDoctorId || this.doctors()[0]?.id || '';
    this.bDate = this.bDate || this.tomorrow; this.loadSlots();
  }
  async loadSlots() {
    this.bTime = ''; this.slots.set([]);
    if (!this.bDoc || !this.bDate) return;
    this.slotsLoading.set(true);
    try { this.slots.set((await this.api.slots(this.pid(), this.bDoc, this.bDate)).slice(0, 24)); }
    catch (e) { this.toast.err(apiMessage(e, 'Could not check free times')); }
    finally { this.slotsLoading.set(false); }
  }
  async bookIt() {
    this.busy.set(true);
    try {
      const a = await this.api.book(this.pid(), this.bDoc, this.bDate, this.bTime, this.bTele);
      this.toast.ok(`Booked with ${a.doctorName} on ${a.date} at ${a.time}`); this.booking.set(false); this.bTime = '';
      this.appts.set(await this.api.appointments(this.pid()));
    } catch (e) { this.toast.err(apiMessage(e, 'Could not book that time')); await this.loadSlots(); }
    finally { this.busy.set(false); }
  }
  async cancel(a: PAppointment) {
    try { await this.api.cancel(this.pid(), a.id); this.toast.ok('Appointment cancelled'); this.appts.set(await this.api.appointments(this.pid())); }
    catch (e) { this.toast.err(apiMessage(e, 'Could not cancel')); }
  }
  async sendFb() {
    this.busy.set(true);
    try { await this.api.feedback(this.pid(), this.rating, this.fbDept, this.fbText.trim()); this.toast.ok('Thank you. Your feedback reaches the quality team.'); this.rating = 0; this.fbText = ''; }
    catch (e) { this.toast.err(apiMessage(e, 'Could not send feedback')); }
    finally { this.busy.set(false); }
  }
}

function iso(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
