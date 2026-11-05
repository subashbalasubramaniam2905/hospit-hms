import { Component, inject, signal } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, apiMessage } from '../../core/api/auth.service';
import { SessionService } from '../../core/services/session.service';
import { SHARED } from '../../shared';
import { ThemeService } from '../../core/services/theme.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  standalone: true, imports: [SHARED],
  template: `
  <div class="wrap">
    <section class="hero">
      <div class="brand"><app-logo [reverse]="true"></app-logo></div>
      <div class="pitch">
        <h1>One place for every patient, from the front desk to discharge.</h1>
        <p>Registration, appointments, consultations, pharmacy, lab, billing and inpatient care, connected for clinics and hospitals of any size.</p>
        <ul>
          <li><lucide-icon name="activity" [size]="18"></lucide-icon>Live patient journey across departments</li>
          <li><lucide-icon name="trending-down" [size]="18"></lucide-icon>Unbilled work flagged automatically</li>
          <li><lucide-icon name="building-2" [size]="18"></lucide-icon>Single-doctor clinics to multi-branch groups</li>
        </ul>
      </div>
      <figure class="docfig" aria-hidden="true">
        <span class="halo"></span>
        <span class="frame"><img src="img/doctor-portrait.webp" alt="" width="720" height="1189" decoding="async" fetchpriority="high"></span>
        <span class="float f1"><lucide-icon name="activity" [size]="16"></lucide-icon><span><b>Live queue</b><small>Every department, one view</small></span></span>
        <span class="float f2"><lucide-icon name="shield-check" [size]="16"></lucide-icon><span><b>Rx checked</b><small>Allergy and dose alerts</small></span></span>
      </figure>
    </section>
    <section class="panel">
      <div class="topline">@if (live) { <span class="demo-tag">Secure sign-in</span> } @else { <span class="demo-tag">Prototype · fictional data only</span> }<button class="iconbtn" (click)="theme.toggle()" aria-label="Toggle dark mode"><lucide-icon [name]="theme.dark() ? 'sun' : 'moon'" [size]="18"></lucide-icon></button></div>
      <form class="form" [formGroup]="f" (ngSubmit)="submit()" novalidate>
        <div><h2>Sign in</h2><p class="muted">@if (live) { Use the account your hospital administrator created for you. } @else { Use your hospital account. In this prototype any password of 6 or more characters works. }</p></div>
        @if (error()) { <div class="banner err" role="alert">{{ error() }}</div> }
        <div class="field"><label for="email">Work email</label><input id="email" class="inp" formControlName="email" autocomplete="username">
          @if (f.controls.email.touched && f.controls.email.invalid) { <span class="errmsg">Enter a valid email address.</span> }</div>
        <div class="field"><label for="pw">Password</label>
          <div class="pw"><input id="pw" class="inp" [type]="show() ? 'text' : 'password'" formControlName="password" autocomplete="current-password"><button type="button" class="linkbtn small" (click)="show.set(!show())">{{ show() ? 'Hide' : 'Show' }}</button></div>
          @if (f.controls.password.touched && f.controls.password.invalid) { <span class="errmsg">Password needs at least 6 characters.</span> }</div>
        <div class="row" style="justify-content:space-between"><label class="row small"><input type="checkbox" formControlName="remember"> Keep me signed in on this device</label><button type="button" class="linkbtn small" (click)="forgot()">Forgot password?</button></div>
        <button class="btn" type="submit" [disabled]="busy()">@if (busy()) { Signing in… } @else { Sign in }</button>
        @if (!live) {
        <div class="or"><span>or</span></div>
        <div class="row"><button type="button" class="btn ghost" style="flex:1" (click)="sso()"><lucide-icon name="key-round" [size]="16"></lucide-icon>Single sign-on</button><button type="button" class="btn ghost" style="flex:1" (click)="otp()"><lucide-icon name="smartphone" [size]="16"></lucide-icon>Mobile OTP</button></div>
        }
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
  .docfig{position:relative;margin:auto 0 0;align-self:flex-end;width:min(300px,58%);aspect-ratio:300/430;margin-right:clamp(0px,4vw,48px)}
  .docfig .halo{position:absolute;inset:-14% -22% -4%;border-radius:50%;background:radial-gradient(closest-side,rgba(255,255,255,.26),rgba(255,255,255,.07) 62%,transparent);filter:blur(6px)}
  .docfig::before{content:"";position:absolute;inset:-9px -9px 0;border-radius:999px 999px 0 0;background:rgba(255,255,255,.12);box-shadow:0 -10px 60px -10px rgba(0,0,0,.35)}
  .docfig .frame{position:absolute;inset:0;clip-path:inset(0 round 999px 999px 0 0);background:linear-gradient(170deg,#ffffff 0%,#eef8f5 55%,#d4ece6 100%)}
  .docfig img{position:absolute;left:0;top:0;width:100%;height:auto;mix-blend-mode:multiply}
  .float{position:absolute;display:flex;gap:10px;align-items:center;padding:10px 14px 10px 10px;border-radius:14px;background:rgba(255,255,255,.94);color:#173a33;box-shadow:0 14px 34px -12px rgba(0,0,0,.45);font-size:13px;line-height:1.25;white-space:nowrap}
  .float lucide-icon{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:#e3f2ee;color:#1b6457;flex:none}
  .float b{display:block;font-weight:800}.float small{color:#5b706b;font-size:12px}
  .float.f1{left:-34%;top:30%}.float.f2{right:-18%;top:62%}
  :host-context(html.dark) .docfig .frame{filter:brightness(.93)}
  .panel{display:flex;flex-direction:column;padding:calc(24px + env(safe-area-inset-top,0px)) max(24px,env(safe-area-inset-right,0px)) 24px 24px}
  .topline{display:flex;justify-content:space-between;align-items:center}
  .form{margin:auto;width:min(400px,100%);display:flex;flex-direction:column;gap:16px;padding:24px 0}.form h2{font-size:26px;font-weight:800;margin-bottom:6px}
  .pw{position:relative}.pw .linkbtn{position:absolute;right:12px;top:50%;transform:translateY(-50%)}
  .banner.err{background:var(--red-soft);color:var(--red);border-radius:10px;padding:10px 12px;font-size:14px;font-weight:600}
  .or{display:flex;align-items:center;gap:10px;color:var(--mut);font-size:12px}.or::before,.or::after{content:"";flex:1;border-top:1px solid var(--line)}
  @media(max-width:900px){.wrap{grid-template-columns:1fr}.hero{padding-bottom:24px;padding-right:max(24px,env(safe-area-inset-right,0px));padding-left:max(24px,env(safe-area-inset-left,0px))}.hero{padding-top:calc(24px + env(safe-area-inset-top,0px))}.brand{min-height:64px}.docfig{position:absolute;top:calc(20px + env(safe-area-inset-top,0px));right:max(24px,env(safe-area-inset-right,0px));width:64px;height:64px;aspect-ratio:auto;margin:0}.docfig .halo,.float{display:none}.docfig::before{inset:-4px;border-radius:50%;background:rgba(255,255,255,.18);box-shadow:0 10px 24px -8px rgba(0,0,0,.45)}.docfig .frame{clip-path:circle(50%)}.docfig img{width:200%;left:-50%;top:2%}}`]
})
export class LoginPage {
  theme = inject(ThemeService); toast = inject(ToastService); router = inject(Router);
  private auth = inject(AuthService); private session = inject(SessionService);
  live = this.session.live;
  show = signal(false); busy = signal(false); error = signal('');
  f = inject(FormBuilder).nonNullable.group({
    email: [this.live ? '' : 'meera.rao@hospit.demo', [Validators.required, Validators.email]],
    password: [this.live ? '' : 'demo1234', [Validators.required, Validators.minLength(6)]],
    remember: [!this.live],
  });
  constructor() {
    if (inject(ActivatedRoute).snapshot.queryParamMap.get('expired')) this.error.set('Your session ended. Please sign in again.');
  }
  async submit() {
    this.f.markAllAsTouched(); if (this.f.invalid) return;
    if (!this.live) { this.busy.set(true); setTimeout(() => { this.busy.set(false); this.router.navigate(['/select-role']); }, 700); return; }
    this.busy.set(true); this.error.set('');
    try {
      const v = this.f.getRawValue();
      const user = await this.auth.login(v.email.trim(), v.password, v.remember);
      this.session.signIn(user.role);
      this.router.navigate([user.mustChangePw ? '/change-password' : '/dashboard']);
    } catch (e) {
      this.error.set(apiMessage(e, 'Sign-in failed. Please try again'));
      this.f.controls.password.setValue('');
    } finally { this.busy.set(false); }
  }
  forgot() {
    if (this.live) { this.toast.info('Ask your hospital administrator to reset your password. They will give you a temporary one.'); return; }
    this.toast.info('Reset link sent to ' + (this.f.value.email || 'your email') + ' (simulated)');
  }
  sso() { this.toast.info('Redirected to the hospital identity provider (simulated)'); setTimeout(() => this.router.navigate(['/select-role']), 600); }
  otp() { this.toast.ok('OTP 482913 sent to +91 98450 ••••• (simulated). Signing you in.'); setTimeout(() => this.router.navigate(['/select-role']), 900); }
}
