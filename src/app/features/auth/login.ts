import { Component, inject, signal } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { SHARED } from '../../shared';
import { ThemeService } from '../../core/services/theme.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  standalone: true, imports: [SHARED],
  template: `
  <div class="wrap">
    <section class="hero">
      <div class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="12" y="2" width="8" height="28" rx="4" fill="#fff"/><rect x="2" y="12" width="28" height="8" rx="4" fill="var(--amber)"/><circle cx="16" cy="16" r="4" fill="var(--hero)"/></svg>Hospit HMS</div>
      <div class="pitch">
        <h1>One place for every patient, from the front desk to discharge.</h1>
        <p>Registration, appointments, consultations, pharmacy, lab, billing and inpatient care, connected for clinics and hospitals of any size.</p>
        <ul>
          <li><lucide-icon name="activity" [size]="18"></lucide-icon>Live patient journey across departments</li>
          <li><lucide-icon name="trending-down" [size]="18"></lucide-icon>Unbilled work flagged automatically</li>
          <li><lucide-icon name="building-2" [size]="18"></lucide-icon>Single-doctor clinics to multi-branch groups</li>
        </ul>
      </div>
      <svg class="art" viewBox="0 0 320 220" aria-hidden="true">
        <circle cx="210" cy="120" r="96" fill="rgba(255,255,255,.08)"/>
        <rect x="150" y="118" width="132" height="102" rx="44" fill="#fff"/><path d="M196 118h44l-22 36z" fill="var(--pri-soft)"/>
        <circle cx="218" cy="84" r="32" fill="#f2c9a5"/><path d="M186 80c0-24 15-34 32-34s34 10 32 36c-6-11-19-15-32-15s-26 4-32 13z" fill="#3a2a22"/>
        <path d="M184 132c-8 20-6 38 6 44" stroke="var(--pri-2)" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="192" cy="178" r="6" fill="var(--pri-2)"/>
        <rect x="234" y="140" width="44" height="58" rx="6" fill="var(--blue)" transform="rotate(-10 256 169)"/><rect x="241" y="151" width="28" height="4" rx="2" fill="#fff" transform="rotate(-10 256 169)"/><rect x="241" y="162" width="20" height="4" rx="2" fill="#fff" transform="rotate(-10 256 169)"/>
        <rect x="40" y="60" width="96" height="60" rx="14" fill="rgba(255,255,255,.16)"/><path d="M54 96h14l6-14 8 24 6-10h34" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="60" y="138" width="62" height="40" rx="12" fill="rgba(255,255,255,.16)"/><path d="M91 148v20M81 158h20" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
      </svg>
    </section>
    <section class="panel">
      <div class="topline"><span class="demo-tag">Prototype · fictional data only</span><button class="iconbtn" (click)="theme.toggle()" aria-label="Toggle dark mode"><lucide-icon [name]="theme.dark() ? 'sun' : 'moon'" [size]="18"></lucide-icon></button></div>
      <form class="form" [formGroup]="f" (ngSubmit)="submit()" novalidate>
        <div><h2>Sign in</h2><p class="muted">Use your hospital account. In this prototype any password of 6 or more characters works.</p></div>
        <div class="field"><label for="email">Work email</label><input id="email" class="inp" formControlName="email" autocomplete="username">
          @if (f.controls.email.touched && f.controls.email.invalid) { <span class="errmsg">Enter a valid email address.</span> }</div>
        <div class="field"><label for="pw">Password</label>
          <div class="pw"><input id="pw" class="inp" [type]="show() ? 'text' : 'password'" formControlName="password" autocomplete="current-password"><button type="button" class="linkbtn small" (click)="show.set(!show())">{{ show() ? 'Hide' : 'Show' }}</button></div>
          @if (f.controls.password.touched && f.controls.password.invalid) { <span class="errmsg">Password needs at least 6 characters.</span> }</div>
        <div class="row" style="justify-content:space-between"><label class="row small"><input type="checkbox" formControlName="remember"> Keep me signed in on this device</label><button type="button" class="linkbtn small" (click)="toast.info('Reset link sent to ' + (f.value.email || 'your email') + ' (simulated)')">Forgot password?</button></div>
        <button class="btn" type="submit" [disabled]="busy()">@if (busy()) { Signing in… } @else { Sign in }</button>
        <div class="or"><span>or</span></div>
        <div class="row"><button type="button" class="btn ghost" style="flex:1" (click)="sso()"><lucide-icon name="key-round" [size]="16"></lucide-icon>Single sign-on</button><button type="button" class="btn ghost" style="flex:1" (click)="otp()"><lucide-icon name="smartphone" [size]="16"></lucide-icon>Mobile OTP</button></div>
        <p class="small muted">Visiting as a patient? <a routerLink="/portal">Open the patient portal</a> · <a routerLink="/kiosk">Self-service kiosk</a></p>
      </form>
    </section>
  </div>`,
  styles: [`.wrap{min-height:100vh;display:grid;grid-template-columns:1.1fr 1fr;background:var(--card)}
  .hero{background:var(--hero);color:#fff;padding:calc(36px + env(safe-area-inset-top,0px)) 48px 0 max(48px,env(safe-area-inset-left,0px));display:flex;flex-direction:column;gap:28px;position:relative;overflow:hidden}
  .hero::before{content:"";position:absolute;inset:0;background-image:radial-gradient(circle at 1px 1px,rgba(255,255,255,.13) 1px,transparent 0);background-size:18px 18px;mask-image:linear-gradient(160deg,transparent 30%,#000 80%)}
  .brand{display:flex;gap:10px;align-items:center;font-weight:800;font-size:19px;position:relative}.brand svg{width:30px;height:30px}
  .pitch{position:relative;display:flex;flex-direction:column;gap:14px;max-width:46ch}.pitch h1{font-size:clamp(26px,3vw,36px);font-weight:800;letter-spacing:-.01em}
  .pitch p{opacity:.88;font-size:15px}.pitch ul{list-style:none;padding:0;margin:6px 0 0;display:flex;flex-direction:column;gap:10px}.pitch li{display:flex;gap:10px;align-items:center;font-weight:600}
  .art{position:relative;margin-top:auto;width:min(420px,100%);align-self:flex-end}
  .panel{display:flex;flex-direction:column;padding:calc(24px + env(safe-area-inset-top,0px)) max(24px,env(safe-area-inset-right,0px)) 24px 24px}
  .topline{display:flex;justify-content:space-between;align-items:center}
  .form{margin:auto;width:min(400px,100%);display:flex;flex-direction:column;gap:16px;padding:24px 0}.form h2{font-size:26px;font-weight:800;margin-bottom:6px}
  .pw{position:relative}.pw .linkbtn{position:absolute;right:12px;top:50%;transform:translateY(-50%)}
  .or{display:flex;align-items:center;gap:10px;color:var(--mut);font-size:12px}.or::before,.or::after{content:"";flex:1;border-top:1px solid var(--line)}
  @media(max-width:900px){.wrap{grid-template-columns:1fr}.hero{padding-bottom:24px;padding-right:max(24px,env(safe-area-inset-right,0px));padding-left:max(24px,env(safe-area-inset-left,0px))}.art{display:none}}`]
})
export class LoginPage {
  theme = inject(ThemeService); toast = inject(ToastService); router = inject(Router);
  show = signal(false); busy = signal(false);
  f = inject(FormBuilder).nonNullable.group({ email: ['meera.rao@hospit.demo', [Validators.required, Validators.email]], password: ['demo1234', [Validators.required, Validators.minLength(6)]], remember: [true] });
  submit() {
    this.f.markAllAsTouched(); if (this.f.invalid) return;
    this.busy.set(true); setTimeout(() => { this.busy.set(false); this.router.navigate(['/select-role']); }, 700);
  }
  sso() { this.toast.info('Redirected to the hospital identity provider (simulated)'); setTimeout(() => this.router.navigate(['/select-role']), 600); }
  otp() { this.toast.ok('OTP 482913 sent to +91 98450 ••••• (simulated). Signing you in.'); setTimeout(() => this.router.navigate(['/select-role']), 900); }
}
