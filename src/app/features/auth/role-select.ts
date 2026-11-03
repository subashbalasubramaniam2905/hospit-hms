import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED } from '../../shared';
import { SessionService } from '../../core/services/session.service';
import { RoleId } from '../../core/models';

const ICONS: Record<RoleId, string> = { 'super-admin': 'shield-check', admin: 'building-2', doctor: 'stethoscope', nurse: 'heart-handshake', receptionist: 'clipboard-list', pharmacist: 'pill', 'lab-tech': 'flask-conical', radiologist: 'scan-line', billing: 'indian-rupee', hr: 'id-card', inventory: 'boxes', patient: 'user-round' };
const TONE: Record<RoleId, string> = { 'super-admin': 'v', admin: 'g', doctor: 'b', nurse: 'p', receptionist: 'a', pharmacist: 'g', 'lab-tech': 'b', radiologist: 'v', billing: 'a', hr: 'p', inventory: 'n', patient: 'ok' };

@Component({
  standalone: true, imports: [SHARED],
  template: `
  <div class="wrap">
    <header>
      <div class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="12" y="2" width="8" height="28" rx="4" fill="var(--pri)"/><rect x="2" y="12" width="28" height="8" rx="4" fill="var(--amber)"/><circle cx="16" cy="16" r="4" fill="var(--card)"/></svg>Hospit HMS</div>
      <span class="demo-tag">Role selection is a demo feature</span>
    </header>
    <div class="intro"><h1>Choose how you want to explore</h1><p class="muted">Each role sees its own dashboard, menu and actions. You can switch roles at any time from the account menu.</p></div>
    <div class="grid-r">
      @for (r of session.roles; track r.id) {
        <button class="rc" (click)="pick(r.id)">
          <span class="ic st {{ tone[r.id] }}"><lucide-icon [name]="icons[r.id]" [size]="22"></lucide-icon></span>
          <b>{{ r.name }}</b><span class="muted small">{{ r.description }}</span>
          <span class="who"><cf-avatar [name]="r.userName"></cf-avatar>{{ r.userName }}</span>
        </button>
      }
    </div>
    <p class="muted small foot">Also available: <a routerLink="/kiosk">patient self-service kiosk</a> · <a routerLink="/login">back to sign in</a></p>
  </div>`,
  styles: [`.wrap{min-height:100vh;padding:calc(24px + env(safe-area-inset-top,0px)) max(24px,env(safe-area-inset-right,0px)) 40px max(24px,env(safe-area-inset-left,0px));max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:24px}
  header{display:flex;justify-content:space-between;align-items:center}.brand{display:flex;gap:10px;align-items:center;font-weight:800;font-size:18px}.brand svg{width:28px;height:28px}
  .intro h1{font-size:28px;font-weight:800;margin-bottom:6px}
  .grid-r{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
  .rc{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:18px;text-align:left;display:flex;flex-direction:column;gap:8px;transition:border-color .15s,transform .15s;color:var(--fg)}
  .rc:hover{border-color:var(--pri);transform:translateY(-2px)}.rc b{font-size:15.5px}
  .ic{width:44px;height:44px;border-radius:12px;padding:0;justify-content:center}
  .who{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:8px;border-top:1px dashed var(--line);font-weight:600;font-size:13px}
  .foot{text-align:center}`]
})
export class RoleSelectPage {
  session = inject(SessionService); router = inject(Router); icons = ICONS; tone = TONE;
  pick(r: RoleId) { this.session.signIn(r); this.router.navigate([r === 'patient' ? '/portal' : '/dashboard']); }
}
