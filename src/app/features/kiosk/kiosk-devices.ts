import { Component, inject, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { ToastService } from '../../core/services/toast.service';
import { SessionService } from '../../core/services/session.service';
import { StoreService } from '../../core/services/store.service';
import { apiMessage } from '../../core/api/auth.service';
import { KDevice, KioskApi } from '../../core/api/insights-api';

/** Live mode: the admin list of self-service kiosks, with pairing codes and sign-out. */
@Component({
  selector: 'cf-kiosk-devices', standalone: true, imports: [SHARED],
  styles: [`.code { font-family:ui-monospace,monospace; font-size:28px; font-weight:800; letter-spacing:.14em; padding:12px 16px; border-radius:12px; background:var(--pri-soft); color:var(--pri); display:inline-block }`],
  template: `
  <div class="card">
    <div class="card-h"><h3>Self-service kiosks</h3><span class="muted small">Each kiosk signs in with a one-time pairing code and can only check patients in, give walk-in tokens and register new patients at its branch.</span></div>
    @if (code(); as c) {
      <div class="alert-box info" style="margin-bottom:12px"><lucide-icon name="key-round" [size]="16"></lucide-icon><div style="flex:1">Open <b>/kiosk</b> on the kiosk and enter <span class="code">{{ c.code }}</span><div class="small muted">Valid for 15 minutes, once. It is not shown again.</div></div><button class="btn ghost sm" (click)="code.set(null)">Done</button></div>
    }
    <div class="toolbar" style="margin-bottom:12px">
      <select class="inp" style="width:auto" [(ngModel)]="branch" aria-label="Branch">@for (b of branches(); track b.id) {<option [value]="b.id">{{ b.name }}</option>}</select>
      <input class="inp" style="width:auto" [(ngModel)]="name" placeholder="Kiosk name, e.g. OPD entrance" maxlength="60" aria-label="Kiosk name">
      <button class="btn" [disabled]="!name.trim() || busy()" (click)="create()"><lucide-icon name="plus" [size]="16"></lucide-icon>Add kiosk</button>
    </div>
    <div class="list">@for (d of devices(); track d.id) {
      <div class="li"><lucide-icon name="monitor-smartphone" [size]="16"></lucide-icon><div class="grow"><b>{{ d.name }}</b><span>{{ branchName(d.branchId) }} · {{ !d.active ? 'Signed out' : d.paired ? 'Paired' + (d.lastSeen ? ', last seen ' + (d.lastSeen | d:true) : '') : 'Waiting for pairing' }}</span></div>
        @if (d.active) {<button class="btn ghost sm" [disabled]="busy()" (click)="newCode(d)">New pairing code</button><button class="btn ghost sm" [disabled]="busy()" (click)="revoke(d)">Sign out</button>}
        @else {<button class="btn ghost sm" [disabled]="busy()" (click)="newCode(d)">Pair again</button>}</div>
    } @empty {<p class="muted small">No kiosks yet.</p>}</div>
  </div>`
})
export class KioskDevicesComponent {
  private api = inject(KioskApi); private toast = inject(ToastService); private session = inject(SessionService); private store = inject(StoreService);
  devices = signal<KDevice[]>([]); busy = signal(false); code = signal<{ code: string } | null>(null);
  branch = this.session.branchId(); name = '';
  branches() { const a = this.session.allowedBranches(); return this.store.db.branches.filter(b => a === null || a.includes(b.id)); }
  branchName(id: string) { return this.store.db.branches.find(b => b.id === id)?.name ?? id; }
  constructor() { this.reload(); }
  private async reload() { try { this.devices.set(await this.api.devices()); } catch (e) { this.toast.err(apiMessage(e, 'Could not load kiosks')); } }
  private async run(f: () => Promise<unknown>, ok: string) {
    this.busy.set(true);
    try { await f(); this.toast.ok(ok); await this.reload(); } catch (e) { this.toast.err(apiMessage(e)); } finally { this.busy.set(false); }
  }
  create() { this.run(async () => { this.code.set(await this.api.createDevice(this.branch, this.name.trim())); this.name = ''; }, 'Kiosk added'); }
  newCode(d: KDevice) { this.run(async () => this.code.set(await this.api.newCode(d.id)), `New pairing code for ${d.name}`); }
  revoke(d: KDevice) { this.run(() => this.api.revoke(d.id), `${d.name} signed out`); }
}
