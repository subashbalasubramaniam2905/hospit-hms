import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { SHARED } from '../../shared';
import { AuthService, apiMessage } from '../../core/api/auth.service';
import { SessionService } from '../../core/services/session.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  standalone: true, imports: [SHARED],
  template: `
  <div class="wrap">
    <form class="card form" [formGroup]="f" (ngSubmit)="submit()" novalidate>
      <app-logo></app-logo>
      <div>
        <h1>{{ first() ? 'Choose your password' : 'Change password' }}</h1>
        <p class="muted">@if (first()) { You signed in with a temporary password. Choose your own before you continue. } @else { Changing your password signs you out on other devices. }</p>
      </div>
      @if (error()) { <div class="alert-box err" role="alert">{{ error() }}</div> }
      <div class="field"><label for="cur">{{ first() ? 'Temporary password' : 'Current password' }}</label>
        <input id="cur" class="inp" type="password" formControlName="current" autocomplete="current-password"></div>
      <div class="field"><label for="new">New password</label>
        <input id="new" class="inp" type="password" formControlName="next" autocomplete="new-password">
        <span class="hint" [class.ok]="strong()">At least 10 characters, with a letter and a number.</span></div>
      <div class="field"><label for="rep">Repeat new password</label>
        <input id="rep" class="inp" type="password" formControlName="repeat" autocomplete="new-password">
        @if (f.controls.repeat.touched && mismatch()) { <span class="errmsg">The passwords do not match.</span> }</div>
      <button class="btn" type="submit" [disabled]="busy()">@if (busy()) { Saving… } @else { Save and continue }</button>
      <button type="button" class="linkbtn small" (click)="out()">Sign out instead</button>
    </form>
  </div>`,
  styles: [`.wrap{min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--ground)}
  .form{width:min(420px,100%);display:flex;flex-direction:column;gap:16px;padding:28px}
  h1{font-size:24px;font-weight:800;margin-bottom:6px}.hint.ok{color:var(--green)}
  .alert-box.err{background:var(--red-soft);color:var(--red)}`]
})
export class ChangePasswordPage {
  private auth = inject(AuthService); private session = inject(SessionService); private router = inject(Router); private toast = inject(ToastService);
  busy = signal(false); error = signal('');
  first = computed(() => !!this.auth.account()?.mustChangePw);
  f = inject(FormBuilder).nonNullable.group({ current: ['', Validators.required], next: ['', Validators.required], repeat: ['', Validators.required] });
  private v = toSignal(this.f.valueChanges, { initialValue: this.f.getRawValue() });
  strong = computed(() => { const p = this.v().next ?? ''; return p.length >= 10 && /[A-Za-z]/.test(p) && /\d/.test(p); });
  mismatch = computed(() => (this.v().next ?? '') !== (this.v().repeat ?? ''));

  async submit() {
    this.f.markAllAsTouched(); this.error.set('');
    if (this.f.invalid) return;
    if (!this.strong()) { this.error.set('The new password needs at least 10 characters, including a letter and a number.'); return; }
    if (this.mismatch()) { this.error.set('The new passwords do not match.'); return; }
    this.busy.set(true);
    try {
      const v = this.f.getRawValue();
      await this.auth.changePassword(v.current, v.next);
      this.toast.ok('Password changed');
      this.router.navigate(['/dashboard']);
    } catch (e) { this.error.set(apiMessage(e)); } finally { this.busy.set(false); }
  }
  out() { this.session.signOut(); this.router.navigate(['/login']); }
}
