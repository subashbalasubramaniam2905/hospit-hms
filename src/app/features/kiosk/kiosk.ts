import { LIVE } from '../../core/api/api-config';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, Validators } from '@angular/forms';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ThemeService } from '../../core/services/theme.service';
import { Appointment, Patient } from '../../core/models';

type Step = 'home' | 'find' | 'confirm' | 'token' | 'register' | 'walkin';

@Component({
  standalone: true, imports: [SHARED],
  styles: [`
  :host { display:block; min-height:100vh; background:var(--ground) }
  .top { background:linear-gradient(135deg,var(--pri),color-mix(in srgb,var(--pri) 70%,#000)); color:#fff; padding:18px 28px; display:flex; align-items:center; gap:14px }
  .top b { font-size:20px } .top .r { margin-left:auto; display:flex; gap:10px; align-items:center }
  .top .btn.ghost { color:#fff; border-color:rgba(255,255,255,.4); background:transparent }
  .wrap { max-width:880px; margin:0 auto; padding:28px 20px 60px; display:flex; flex-direction:column; gap:20px }
  .big { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:16px }
  .tile { background:var(--card); border:1px solid var(--line); border-radius:20px; padding:26px; display:flex; flex-direction:column; gap:10px; text-align:left; cursor:pointer; min-height:170px; font:inherit; color:var(--fg) }
  .tile:hover { border-color:var(--pri); box-shadow:0 10px 30px -18px var(--pri) }
  .tile .ic { width:54px; height:54px; border-radius:16px; display:grid; place-items:center; background:var(--pri-soft); color:var(--pri) }
  .tile b { font-size:20px } .tile span { color:var(--mut) }
  h2 { font-size:28px; font-weight:800 } .lead { font-size:17px; color:var(--mut) }
  .keypad { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; max-width:360px }
  .keypad button { height:62px; font-size:24px; font-weight:700; border-radius:14px; border:1px solid var(--line); background:var(--card); color:var(--fg) }
  .keypad button:active { background:var(--pri-soft) }
  .entry { font-size:30px; font-weight:800; letter-spacing:.08em; padding:14px 18px; border-radius:14px; background:var(--card); border:2px solid var(--pri); min-height:66px; max-width:360px; font-variant-numeric:tabular-nums }
  .seg2 button { font-size:16px; padding:10px 18px }
  .slip { background:#fff; color:#111; border-radius:12px; padding:26px; width:300px; margin:0 auto; text-align:center; box-shadow:0 20px 40px -24px rgba(0,0,0,.4); font-family:ui-monospace,monospace }
  .slip .tok { font-size:56px; font-weight:900; letter-spacing:.04em; margin:8px 0 }
  .slip hr { border:0; border-top:1px dashed #999; margin:12px 0 }
  .appt { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:18px; display:flex; gap:14px; align-items:center }
  .btn.xl { font-size:17px; padding:14px 26px; border-radius:14px }
  .inp.xl { font-size:18px; padding:14px }
  @media (max-width:600px) { .top { padding:14px 16px; flex-wrap:wrap } .top .r { margin-left:0; width:100% } h2 { font-size:22px } }
  `],
  template: `
  <div class="top">
    <lucide-icon name="heart-pulse" [size]="26"></lucide-icon>
    <div><h1 style="font-size:20px;font-weight:800">Welcome to {{ store.db.config.name }}</h1><div class="small" style="opacity:.85">Self-service kiosk · demo</div></div>
    <div class="r">
      <div class="seg seg2" role="group" aria-label="Language">@for (l of langs; track l) {<button [class.on]="lang() === l" (click)="lang.set(l)">{{ l }}</button>}</div>
      <button class="btn ghost sm" (click)="theme.toggle()" aria-label="Toggle theme"><lucide-icon [name]="theme.dark() ? 'sun' : 'moon'" [size]="16"></lucide-icon></button>
      <button class="btn ghost sm" (click)="exit()">Exit</button>
    </div>
  </div>
  <div class="wrap">
    <div class="alert-box info"><lucide-icon name="info" [size]="16"></lucide-icon><div>Prototype kiosk. Printing, card readers and payments are simulated.@if (lang() !== 'English') { Translations are not included in the demo; screens stay in English.}</div></div>

    @switch (step()) {
      @case ('home') {
        <div><h2>How can we help you today?</h2><p class="lead">Tap an option to begin.</p></div>
        <div class="big">
          <button class="tile" (click)="go('find')"><span class="ic"><lucide-icon name="calendar-check" [size]="26"></lucide-icon></span><b>I have an appointment</b><span>Check in and get your token number</span></button>
          <button class="tile" (click)="go('walkin')"><span class="ic" style="background:var(--blue-soft);color:var(--blue)"><lucide-icon name="footprints" [size]="26"></lucide-icon></span><b>Walk-in visit</b><span>See a doctor today without a booking</span></button>
          <button class="tile" (click)="go('register')"><span class="ic" style="background:var(--violet-soft);color:var(--violet)"><lucide-icon name="user-plus" [size]="26"></lucide-icon></span><b>New patient</b><span>Register in under two minutes</span></button>
        </div>
        <div class="card row" style="gap:16px"><lucide-icon name="ticket" [size]="22"></lucide-icon><div class="grow"><b>Now serving</b><div class="muted small">@for (q of serving(); track q.token) {{{ q.token }} · {{ store.dept(q.deptId)?.name }}@if (!$last) {,&nbsp;}}</div></div><a class="linkbtn" routerLink="/portal">Use the patient app instead</a></div>
      }
      @case ('find') {
        <div><h2>Find your booking</h2><p class="lead">Enter your mobile number or UHID.</p></div>
        <div class="seg seg2"><button [class.on]="mode() === 'mobile'" (click)="mode.set('mobile'); entry.set('')">Mobile number</button><button [class.on]="mode() === 'uhid'" (click)="mode.set('uhid'); entry.set('')">UHID</button></div>
        <div class="entry" aria-live="polite">{{ mode() === 'uhid' ? 'HS-' : '+91 ' }}{{ entry() || '…' }}</div>
        <div class="keypad">@for (k of keys; track k) {<button (click)="press(k)" [attr.aria-label]="k === '⌫' ? 'Delete' : k">{{ k }}</button>}</div>
        <div class="row"><button class="btn ghost xl" (click)="go('home')">Back</button><button class="btn xl" (click)="find()">Find my appointment</button><button class="linkbtn" (click)="demoFill()">Fill demo number</button></div>
      }
      @case ('confirm') {
        @if (found(); as p) {
          <div><h2>Hello, {{ p.name.split(' ')[0] }}</h2><p class="lead">{{ p.id }} · {{ p.gender }}, {{ p.dob | age }}</p></div>
          @for (a of todays(); track a.id) {
            <div class="appt"><span class="ic" style="width:48px;height:48px;border-radius:12px;display:grid;place-items:center;background:var(--pri-soft);color:var(--pri)"><lucide-icon name="stethoscope" [size]="22"></lucide-icon></span>
              <div class="grow"><b style="font-size:17px">{{ store.dname(a.doctorId) }}</b><div class="muted">{{ store.dept(a.deptId)?.name }} · {{ a.time | time12 }} · Room {{ a.room }}</div></div>
              @if (a.status === 'Scheduled' || a.status === 'Confirmed') {<button class="btn xl" (click)="checkIn(a)">Check in</button>} @else {<cf-status [s]="a.status"></cf-status>}
            </div>
          } @empty {
            <div class="card"><cf-empty icon="calendar-x" title="No appointment today" text="You can still see a doctor as a walk-in."><button class="btn" (click)="go('walkin')">Walk-in visit</button></cf-empty></div>
          }
          <button class="btn ghost xl" style="align-self:flex-start" (click)="reset()">Not you? Start again</button>
        }
      }
      @case ('walkin') {
        <div><h2>Walk-in visit</h2><p class="lead">Choose a department. We will give you a token for the next available doctor.</p></div>
        @if (!found()) {
          <div class="field" style="max-width:360px"><label>Mobile number or UHID</label><input class="inp xl" [(ngModel)]="walkId" placeholder="98450 12345 or HS-23-01041"></div>
        } @else { <div class="appt"><cf-avatar [name]="found()!.name"></cf-avatar><div class="grow"><b>{{ found()!.name }}</b><div class="muted small">{{ found()!.id }}</div></div></div> }
        <div class="big">@for (d of walkDepts(); track d.id) {
          <button class="tile" style="min-height:120px" (click)="walkIn(d.id)"><b>{{ d.name }}</b><span>{{ d.wait }} waiting · about {{ d.wait * 8 }} min</span></button>
        }</div>
        <button class="btn ghost xl" style="align-self:flex-start" (click)="go('home')">Back</button>
      }
      @case ('register') {
        <div><h2>New patient registration</h2><p class="lead">Fields marked * are required. Staff will verify your ID at the desk.</p></div>
        <div class="card form-grid" [formGroup]="reg">
          <div class="field"><label>Full name *</label><input class="inp xl" formControlName="name" autocomplete="name"></div>
          <div class="field"><label>Mobile *</label><input class="inp xl" formControlName="mobile" inputmode="numeric" maxlength="10">@if (reg.controls.mobile.touched && reg.controls.mobile.invalid) {<span class="errmsg">Enter a 10 digit mobile number</span>}</div>
          <div class="field"><label>Date of birth *</label><input class="inp xl" type="date" formControlName="dob"></div>
          <div class="field"><label>Gender *</label><select class="inp xl" formControlName="gender"><option>Female</option><option>Male</option><option>Other</option></select></div>
          <div class="field"><label>City</label><input class="inp xl" formControlName="city"></div>
          <div class="field"><label>ABHA number (optional)</label><input class="inp xl" formControlName="abha" placeholder="14 digits"></div>
        </div>
        <label class="row"><mat-checkbox [checked]="consent()" (change)="consent.set(!consent())"></mat-checkbox> I agree that the hospital may store my details for treatment (demo consent text).</label>
        <div class="row"><button class="btn ghost xl" (click)="go('home')">Back</button><button class="btn xl" [disabled]="reg.invalid || !consent()" (click)="register()">Register and get token</button></div>
      }
      @case ('token') {
        <div style="text-align:center"><h2>You're checked in</h2><p class="lead">Please take your slip and wait for your token on the screen.</p></div>
        <div class="slip" id="slip">
          <div style="font-weight:700">{{ store.db.config.name }}</div><div style="font-size:12px">OPD token</div><hr>
          <div class="tok">{{ token() }}</div>
          <div>{{ found()?.name }}</div><div style="font-size:12px">{{ found()?.id }}</div><hr>
          <div style="font-size:13px">{{ slipLine() }}</div>
          <div style="font-size:12px;margin-top:6px">{{ ahead() }} patients ahead · {{ nowLabel }}</div><hr>
          <div style="font-size:11px">PROTOTYPE · not a real token</div>
        </div>
        <div class="row" style="justify-content:center"><button class="btn ghost xl" (click)="printSlip()"><lucide-icon name="printer" [size]="18"></lucide-icon>Print again</button><button class="btn xl" (click)="reset()">Done</button></div>
        <p class="muted small" style="text-align:center">This screen returns to the start in {{ countdown() }} seconds.</p>
      }
    }
  </div>`
})
export class KioskPage {
  store = inject(StoreService); toast = inject(ToastService); theme = inject(ThemeService); router = inject(Router);
  langs = ['English', 'हिन्दी', 'ಕನ್ನಡ']; lang = signal('English');
  step = signal<Step>('home'); mode = signal<'mobile' | 'uhid'>('mobile'); entry = signal('');
  found = signal<Patient | null>(null); token = signal(''); slipLine = signal(''); ahead = signal(0); countdown = signal(30); consent = signal(false);
  keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', '⌫'];
  walkId = ''; nowLabel = new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  private timer?: ReturnType<typeof setInterval>;
  reg = inject(FormBuilder).nonNullable.group({ name: ['', [Validators.required, Validators.minLength(3)]], mobile: ['', [Validators.required, Validators.pattern(/^[6-9]\d{9}$/)]], dob: ['', Validators.required], gender: ['Female'], city: ['Udumalpet'], abha: [''] });

  serving = computed(() => { this.store.rev(); return this.store.db.queue.filter(q => q.step === 4).slice(0, 4); });
  todays = computed(() => { this.store.rev(); const p = this.found(); return p ? this.store.db.appointments.filter(a => a.patientId === p.id && a.date === this.store.today()) : []; });
  walkDepts = computed(() => { this.store.rev(); return this.store.db.departments.filter(d => d.id !== 'EM').slice(0, 6).map(d => ({ ...d, wait: this.store.db.queue.filter(q => q.deptId === d.id && q.step < 4).length })); });

  go(s: Step) { this.step.set(s); if (s === 'home') { this.found.set(null); this.entry.set(''); } }
  press(k: string) {
    if (k === 'Clear') this.entry.set(''); else if (k === '⌫') this.entry.set(this.entry().slice(0, -1));
    else if (this.entry().length < (this.mode() === 'uhid' ? 7 : 10)) { let v = this.entry() + k; if (this.mode() === 'uhid' && v.length === 2) v += '-'; this.entry.set(v); }
  }
  demoFill() { const p = this.store.patient('HS-23-01041'); if (this.mode() === 'uhid') this.entry.set('23-01041'); else if (p) this.entry.set(p.mobile.replace(/\D/g, '').slice(-10)); }
  lookup(raw: string) {
    const v = raw.replace(/\s/g, '').toUpperCase(); if (!v) return undefined;
    return this.store.db.patients.find(p => p.id === v || p.id === 'HS-' + v || p.mobile.replace(/\D/g, '').endsWith(v.replace(/\D/g, '').slice(-10)));
  }
  find() {
    const p = this.lookup(this.mode() === 'uhid' ? 'HS-' + this.entry() : this.entry());
    if (!p || this.entry().length < 7) { this.toast.err('No patient found. Check the number or register as a new patient.'); return; }
    this.found.set(p); this.step.set('confirm');
  }
  checkIn(a: Appointment) {
    this.store.setApptStatus(a.id, 'Arrived');
    this.issue(a.token || '', `${this.store.dname(a.doctorId)} · Room ${a.room}`, a.deptId);
  }
  walkIn(deptId: string) {
    let p = this.found();
    if (!p) { p = this.lookup(this.walkId) ?? null; if (!p) { this.toast.err('Enter a registered mobile number or UHID, or register as a new patient.'); return; } this.found.set(p); }
    const doc = this.store.db.doctors.filter(d => d.deptId === deptId).sort((x, y) => this.load(x.id) - this.load(y.id))[0];
    if (!doc) { this.toast.err('No doctor available in this department today'); return; }
    const q = this.store.walkIn(p.id, doc.id);
    this.issue(q.token || '', `${doc.name} · Room ${doc.room}`, deptId);
  }
  private load(docId: string) { return this.store.db.queue.filter(q => q.doctorId === docId && q.step < 5).length; }
  register() {
    // The kiosk has no staff sign-in, so it cannot create real records yet.
    if (LIVE) { this.toast.info('New patients: please register at the front desk. Staff will give you your UHID.'); return; }
    const v = this.reg.getRawValue();
    const p = this.store.addPatient({ name: v.name.trim(), mobile: '+91 ' + v.mobile.slice(0, 5) + ' ' + v.mobile.slice(5), dob: v.dob, gender: v.gender as Patient['gender'], abha: v.abha || undefined, address: { line: '', city: v.city || 'Udumalpet', state: 'Tamil Nadu', pin: '' }, blood: 'Unknown', allergies: [], conditions: [], history: '', emergency: { name: '', relation: '', phone: '' }, consent: 'Given', primaryDoctorId: '' });
    this.toast.ok(`Registered as ${p.id}`); this.found.set(p); this.walkId = p.id; this.step.set('walkin');
  }
  private issue(token: string, line: string, deptId: string) {
    this.token.set(token); this.slipLine.set(line); this.ahead.set(this.store.db.queue.filter(q => q.deptId === deptId && q.step < 4 && q.token !== token).length);
    this.step.set('token'); this.toast.ok(`Token ${token} printed (simulated)`);
    this.countdown.set(30); clearInterval(this.timer);
    this.timer = setInterval(() => { this.countdown.update(n => n - 1); if (this.countdown() <= 0) this.reset(); }, 1000);
  }
  printSlip() { this.toast.info('Token slip sent to the kiosk printer (simulated)'); }
  reset() { clearInterval(this.timer); this.go('home'); this.walkId = ''; this.consent.set(false); this.reg.reset(); }
  exit() { clearInterval(this.timer); this.router.navigate(['/login']); }
}
