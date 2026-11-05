import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED } from '../../shared';
import { RxDocComponent } from '../../shared/rx-doc';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { SessionService } from '../../core/services/session.service';
import { ThemeService } from '../../core/services/theme.service';
import { Prescription } from '../../core/models';

type Tab = 'home' | 'appts' | 'records' | 'bills' | 'feedback';
const PATIENT = 'HS-23-01041';

/** Shared with the live portal. */
export const PORTAL_STYLES = `
    :host { display:block; min-height:100vh; background:var(--ground) }
    .top { position:sticky; top:0; z-index:20; background:var(--card); border-bottom:1px solid var(--line); display:flex; align-items:center; gap:12px; padding:12px max(16px,calc((100vw - 1080px)/2)) }
    .brand { display:flex; align-items:center; gap:8px; font-weight:800; font-size:17px } .brand i { width:26px; height:26px; border-radius:8px; background:var(--pri); display:grid; place-items:center; color:#fff; font-style:normal }
    .wrap { max-width:1080px; margin:0 auto; padding:20px 16px 96px; display:flex; flex-direction:column; gap:16px }
    .hero { background:var(--hero, var(--pri)); color:#fff; border-radius:20px; padding:22px 24px; display:flex; gap:16px; align-items:center; flex-wrap:wrap }
    .hero h1 { font-size:22px; font-weight:800 } .hero p { opacity:.88 }
    .nav { display:flex; gap:4px; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:4px; overflow-x:auto }
    .nav button { flex:1; border:0; background:none; padding:10px 12px; border-radius:10px; font-weight:600; color:var(--mut); display:flex; gap:6px; align-items:center; justify-content:center; white-space:nowrap }
    .nav button.on { background:var(--pri-soft); color:var(--pri) }
    .quick { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px } .quick button { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px; display:flex; flex-direction:column; gap:8px; align-items:flex-start; font-weight:700; color:var(--fg); text-align:left }
    .quick button span { width:38px; height:38px; border-radius:12px; display:grid; place-items:center }
    .login { max-width:420px; margin:8vh auto; padding:0 16px }
    .stars button { border:0; background:none; padding:2px } .slot { display:grid; grid-template-columns:repeat(auto-fill,minmax(80px,1fr)); gap:8px } .slot button { border:1px solid var(--line); border-radius:10px; padding:8px 0; background:var(--card); font-weight:600; color:var(--fg) } .slot button.on { background:var(--pri); color:#fff; border-color:var(--pri) }
    @media (max-width:760px){ .hide-sm { display:none } .quick { grid-template-columns:repeat(2,minmax(0,1fr)) } .nav { position:fixed; bottom:0; left:0; right:0; border-radius:0; z-index:30; padding:6px 6px calc(6px + env(safe-area-inset-bottom,0px)) } .nav button { flex-direction:column; font-size:11px; gap:2px; padding:6px 4px } }
  `;

@Component({
  standalone: true, imports: [SHARED, RxDocComponent],
  styles: [PORTAL_STYLES],
  template: `
  <header class="top"><div class="brand"><app-logo></app-logo> <span class="muted small hide-sm" style="font-weight:600">Patient portal</span></div><span class="spacer"></span>
    <span class="demo-tag">Demo</span>
    <button class="iconbtn" (click)="theme.toggle()" aria-label="Toggle theme"><lucide-icon [name]="theme.dark() ? 'sun' : 'moon'" [size]="17"></lucide-icon></button>
    @if (signedIn()) { <button class="btn ghost sm" (click)="out()">Sign out</button> } @else { <a class="btn ghost sm" routerLink="/login">Staff sign in</a> }</header>

  @if (!signedIn()) {
    <div class="login card stack">
      <h1 style="font-size:22px">Sign in to your health record</h1>
      <p class="muted">Use the mobile number registered at HospitOS. This prototype signs you in as the fictional patient Lakshmi Narayan.</p>
      @if (step() === 1) {
        <div class="field"><label>Mobile number</label><input class="inp" [(ngModel)]="mobile" placeholder="+91 99160 825672"></div>
        <button class="btn" (click)="sendOtp()">Send OTP</button>
      } @else {
        <div class="field"><label>Enter the 6-digit OTP</label><input class="inp" [(ngModel)]="otp" maxlength="6" inputmode="numeric" placeholder="Demo OTP is 123456"></div>
        <button class="btn" (click)="verify()">Verify and continue</button><button class="linkbtn small" (click)="step.set(1)">Change number</button>
      }
      <p class="hint">No SMS is sent. OTP is simulated.</p>
    </div>
  } @else { @let p = me()!;
  <div class="wrap">
    <div class="hero"><cf-avatar [name]="p.name" size="lg"></cf-avatar><div style="flex:1"><h1>Namaste, {{ p.name.split(' ')[0] }}</h1><p>UHID {{ p.id }} · {{ p.insurance ? store.provider(p.insurance.providerId)?.name : 'Self pay' }}</p></div>
      @if (next(); as a) { <div style="background:rgba(255,255,255,.14);border-radius:14px;padding:10px 14px"><div class="small" style="opacity:.85">Next visit</div><b>{{ a.date | d }} · {{ a.time | time12 }}</b><div class="small">{{ store.dname(a.doctorId) }}</div></div> }</div>
    <nav class="nav">@for (t of tabs; track t.id) {<button [class.on]="tab() === t.id" (click)="tab.set(t.id)"><lucide-icon [name]="t.icon" [size]="17"></lucide-icon>{{ t.label }}</button>}</nav>

    @switch (tab()) {
    @case ('home') {
      <div class="quick">
        <button (click)="tab.set('appts'); booking.set(true)"><span style="background:var(--pri-soft);color:var(--pri)"><lucide-icon name="calendar-plus" [size]="18"></lucide-icon></span>Book appointment</button>
        <button (click)="tab.set('records')"><span style="background:var(--blue-soft);color:var(--blue)"><lucide-icon name="file-text" [size]="18"></lucide-icon></span>Lab reports</button>
        <button (click)="tab.set('records')"><span style="background:var(--violet-soft);color:var(--violet)"><lucide-icon name="pill" [size]="18"></lucide-icon></span>Prescriptions</button>
        <button (click)="tab.set('bills')"><span style="background:var(--amber-soft);color:var(--amber)"><lucide-icon name="wallet" [size]="18"></lucide-icon></span>Pay bills @if (due()) {<small class="muted">{{ due() | inr }} due</small>}</button>
      </div>
      <div class="grid">
        <div class="card c6"><div class="card-h"><h3>Messages</h3></div><div class="list">@for (n of messages(); track n.id) {<div class="li"><lucide-icon name="message-circle" [size]="16" style="color:var(--pri)"></lucide-icon><div class="grow"><b>{{ n.type }}</b><span>{{ n.message }}</span></div><span class="small muted">{{ n.time.slice(5, 10) }}</span></div>} @empty {<p class="muted small">No messages.</p>}</div></div>
        <div class="card c6"><div class="card-h"><h3>Your health at a glance</h3></div>
          <div class="kv"><div><small>Conditions</small><b>{{ p.conditions.join(', ') || 'None recorded' }}</b></div><div><small>Allergies</small><b style="color:var(--red)">{{ p.allergies.join(', ') || 'None' }}</b></div><div><small>Blood group</small><b>{{ p.blood }}</b></div><div><small>Doctor</small><b>{{ store.dname(p.primaryDoctorId) }}</b></div></div>
          @if (fu(); as f) { <div class="alert-box info" style="margin-top:12px"><lucide-icon name="calendar-clock" [size]="16"></lucide-icon><div style="flex:1">Follow-up due {{ f.due | d:true }} for {{ f.reason }}.</div><button class="btn sm" (click)="tab.set('appts'); booking.set(true)">Book</button></div> }</div>
      </div>
    }
    @case ('appts') {
      @if (booking()) {
        <div class="card stack">
          <div class="row"><h3 style="font-size:16px">Book an appointment</h3><span class="spacer"></span><button class="btn ghost sm" (click)="booking.set(false)">Close</button></div>
          <div class="form-grid"><div class="field"><label>Doctor</label><select class="inp" [(ngModel)]="bDoc" (ngModelChange)="bTime = ''">@for (d of store.db.doctors; track d.id) { @if (d.status !== 'On leave') {<option [value]="d.id">{{ d.name }} · {{ store.dept(d.deptId)?.name }} · {{ d.fee | inr }}</option>} }</select></div>
            <div class="field"><label>Date</label><input class="inp" type="date" [min]="store.day(1)" [(ngModel)]="bDate" (ngModelChange)="bTime = ''"></div></div>
          <div class="slot">@for (t of store.freeSlots(bDoc, bDate).slice(0, 18); track t) {<button [class.on]="bTime === t" (click)="bTime = t">{{ t | time12 }}</button>} @empty {<p class="muted small">No free slots that day. {{ store.checkSlot(bDoc, bDate, '10:00', 15).reason }}</p>}</div>
          <div class="row"><mat-checkbox [(ngModel)]="bTele">Video consultation</mat-checkbox><span class="spacer"></span><button class="btn" [disabled]="!bTime" (click)="bookIt()">Confirm and pay {{ store.doctor(bDoc)?.fee | inr }} at hospital</button></div>
        </div>
      } @else { <button class="btn" style="align-self:flex-start" (click)="booking.set(true)"><lucide-icon name="calendar-plus" [size]="16"></lucide-icon>Book appointment</button> }
      <div class="card"><div class="list">@for (a of appts(); track a.id) {
        <div class="li"><cf-avatar [name]="store.dname(a.doctorId)"></cf-avatar><div class="grow"><b>{{ a.date | d:true }} · {{ a.time | time12 }}</b><span>{{ store.dname(a.doctorId) }} · {{ a.type }}{{ a.token ? ' · token ' + a.token : '' }}</span></div><cf-status [s]="a.status"></cf-status>
          @if (a.status === 'Scheduled' || a.status === 'Confirmed') { <button class="btn ghost sm" (click)="cancel(a.id)">Cancel</button> }</div>
      } @empty { <p class="muted small">No appointments.</p> }</div></div>
    }
    @case ('records') {
      <div class="grid">
        <div class="card c6"><div class="card-h"><h3>Lab reports</h3></div><div class="list">@for (o of labs(); track o.id) {
          <div class="li"><lucide-icon name="flask-conical" [size]="16" style="color:var(--blue)"></lucide-icon><div class="grow"><b>{{ store.names(o.testIds) }}</b><span>{{ o.date | d:true }}</span></div>
            @if (o.status === 'Delivered' || o.status === 'Verified') {<a class="btn ghost sm" [routerLink]="['/lab/report', o.id]">View</a>} @else {<cf-status [s]="'Processing'"></cf-status>}</div>
        } @empty { <p class="muted small">No reports yet.</p> }</div></div>
        <div class="card c6"><div class="card-h"><h3>Prescriptions</h3></div><div class="list">@for (r of rx(); track r.id) {
          <div class="li"><lucide-icon name="pill" [size]="16" style="color:var(--violet)"></lucide-icon><div class="grow"><b>{{ r.date | d:true }} · {{ store.dname(r.doctorId) }}</b><span>{{ r.items.length }} medicines</span></div><button class="btn ghost sm" (click)="rxOpen.set(r)">View</button></div>
        } @empty { <p class="muted small">No prescriptions.</p> }</div></div>
        <div class="card c12"><div class="card-h"><h3>Visit summaries</h3></div><div class="list">@for (c of visits(); track c.id) {
          <div class="li"><lucide-icon name="stethoscope" [size]="16" style="color:var(--pri)"></lucide-icon><div class="grow"><b>{{ c.date | d:true }} · {{ store.dname(c.doctorId) }}</b><span>{{ c.dx[0]?.label }} · {{ c.followUp || c.plan }}</span></div></div>
        }</div></div>
      </div>
    }
    @case ('bills') {
      <div class="card"><div class="list">@for (i of bills(); track i.id) { @let t = store.invoiceTotals(i);
        <div class="li"><lucide-icon name="receipt" [size]="16" style="color:var(--amber)"></lucide-icon><div class="grow"><b>{{ i.id }} · {{ t.total | inr }}</b><span>{{ i.date | d:true }} · {{ i.kind }}</span></div><cf-status [s]="i.status"></cf-status>
          @if (t.due > 0) {<button class="btn sm" (click)="payBill(i.id)">Pay {{ t.due | inr }}</button>}</div>
      } @empty { <p class="muted small">No bills.</p> }</div>
      <p class="hint" style="margin-top:10px">Online payment is simulated. No payment gateway is connected.</p></div>
    }
    @case ('feedback') {
      <div class="card stack" style="max-width:640px">
        <h3 style="font-size:16px">How was your last visit?</h3>
        <div class="stars">@for (n of [1,2,3,4,5]; track n) {<button (click)="rating = n" [attr.aria-label]="n + ' stars'"><lucide-icon name="star" [size]="28" [style.color]="n <= rating ? 'var(--amber)' : 'var(--line)'" [style.fill]="n <= rating ? 'var(--amber)' : 'none'"></lucide-icon></button>}</div>
        <div class="field"><label>Department</label><select class="inp" [(ngModel)]="fbDept">@for (d of store.db.departments; track d.id) {<option>{{ d.name }}</option>}</select></div>
        <div class="field"><label>Tell us more (optional)</label><textarea class="inp" [(ngModel)]="fbText" placeholder="What went well, what we can improve"></textarea></div>
        <button class="btn" style="align-self:flex-start" [disabled]="!rating" (click)="sendFb()">Submit feedback</button>
      </div>
    }
    }
  </div>
  <cf-drawer [open]="!!rxOpen()" title="Prescription" width="min(720px,100%)" (closed)="rxOpen.set(null)">@if (rxOpen(); as r) {<cf-rx-doc [rx]="r"></cf-rx-doc>}</cf-drawer>
  }`
})
export class PortalPage {
  store = inject(StoreService); toast = inject(ToastService); session = inject(SessionService); theme = inject(ThemeService); router = inject(Router);
  tabs: { id: Tab; label: string; icon: string }[] = [{ id: 'home', label: 'Home', icon: 'house' }, { id: 'appts', label: 'Appointments', icon: 'calendar-days' }, { id: 'records', label: 'Records', icon: 'file-text' }, { id: 'bills', label: 'Bills', icon: 'wallet' }, { id: 'feedback', label: 'Feedback', icon: 'star' }];
  tab = signal<Tab>('home'); step = signal(1); booking = signal(false); rxOpen = signal<Prescription | null>(null);
  mobile = '+91 99160 825672'; otp = ''; bDoc = 'D01'; bDate = this.store.day(1); bTime = ''; bTele = false; rating = 0; fbDept = 'General medicine'; fbText = '';
  signedIn = computed(() => this.session.roleId() === 'patient');
  me = computed(() => { this.store.rev(); return this.store.patient(PATIENT); });
  appts = computed(() => { this.store.rev(); return this.store.db.appointments.filter(a => a.patientId === PATIENT).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)); });
  next = computed(() => this.appts().filter(a => a.date >= this.store.today() && !['Completed', 'Cancelled', 'No-show'].includes(a.status)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0]);
  labs = computed(() => { this.store.rev(); return this.store.db.labOrders.filter(o => o.patientId === PATIENT); });
  rx = computed(() => { this.store.rev(); return this.store.db.prescriptions.filter(r => r.patientId === PATIENT && r.status !== 'Draft'); });
  visits = computed(() => { this.store.rev(); return this.store.db.consultations.filter(c => c.patientId === PATIENT && c.status === 'Completed'); });
  bills = computed(() => { this.store.rev(); return this.store.db.invoices.filter(i => i.patientId === PATIENT); });
  due = computed(() => this.bills().reduce((t, i) => t + this.store.invoiceTotals(i).due, 0));
  messages = computed(() => { this.store.rev(); return this.store.db.notifications.filter(n => n.patientId === PATIENT).slice(0, 4); });
  fu = computed(() => { this.store.rev(); return this.store.db.followUps.find(f => f.patientId === PATIENT && f.status !== 'Completed' && f.status !== 'Booked'); });
  sendOtp() { if (!/\d{5}\s?\d{5}$/.test(this.mobile.replace(/\s/g, '').slice(-10).replace(/(\d{5})(\d{5})/, '$1 $2'))) { this.toast.err('Enter a valid mobile number'); return; } this.step.set(2); this.toast.info('OTP sent (simulated). Use 123456.'); }
  verify() { if (this.otp !== '123456') { this.toast.err('Incorrect OTP. The demo OTP is 123456.'); return; } this.session.signIn('patient'); this.toast.ok('Signed in to the patient portal'); }
  out() { this.session.signOut(); this.router.navigate(['/login']); }
  bookIt() { const d = this.store.doctor(this.bDoc)!; this.store.book({ patientId: PATIENT, doctorId: d.id, date: this.bDate, time: this.bTime, duration: d.slotMin, type: this.bTele ? 'Teleconsult' : 'New consultation', notes: 'Booked from patient portal' }); this.toast.ok(`Booked with ${d.name} on ${this.bDate} at ${this.bTime}. Confirmation sent on WhatsApp (simulated).`); this.booking.set(false); this.bTime = ''; }
  cancel(id: string) { this.store.setApptStatus(id, 'Cancelled'); this.toast.ok('Appointment cancelled'); }
  payBill(id: string) { const i = this.store.db.invoices.find(x => x.id === id)!; this.store.pay(i, 'Online', this.store.invoiceTotals(i).due, 'PG-DEMO'); this.toast.ok('Payment successful (simulated gateway). Receipt emailed.'); }
  sendFb() { this.store.db.feedback.unshift({ id: this.store.uid('FB'), patientId: PATIENT, date: this.store.today(), rating: this.rating, comment: this.fbText, dept: this.fbDept }); this.store.changed(); this.toast.ok('Thank you. Your feedback reaches the quality team.'); this.rating = 0; this.fbText = ''; }
}
