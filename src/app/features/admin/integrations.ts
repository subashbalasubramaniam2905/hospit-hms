import { Component, computed, inject, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { Integration } from '../../core/models';
import { API_URL, LIVE } from '../../core/api/api-config';
import { AdminApi, fromServerIntegration } from '../../core/api/admin-api';
import { apiMessage } from '../../core/api/auth.service';
import { KioskDevicesComponent } from '../kiosk/kiosk-devices';

@Component({
  standalone: true, imports: [SHARED, KioskDevicesComponent],
  styles: [`.ig { display:flex; flex-direction:column; gap:10px; cursor:pointer } .ig:hover { border-color:var(--pri) } .ig .top { display:flex; gap:12px; align-items:flex-start }
  .ig .ic { width:42px; height:42px; border-radius:12px; display:grid; place-items:center; background:var(--pri-soft); color:var(--pri); flex:none }
  .log { font-family:ui-monospace,monospace; font-size:12px; background:#0f1c1a; color:#b7f5e3; border-radius:10px; padding:12px; white-space:pre-wrap; min-height:90px }`],
  template: `
  <div class="page">
    <cf-page-head title="Integrations" [crumbs]="['Organisation', 'Connections']" [sub]="live ? 'Connection settings for government, diagnostic, payment and messaging systems.' : 'Connections to government, diagnostic, payment and messaging systems. Every connection here is a mock: nothing leaves the prototype.'"></cf-page-head>
    @if (live) {<div class="alert-box warn"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon><div><b>Only WhatsApp is live.</b> WhatsApp Business sends real messages once it is set up and turned on. The other connections only store their settings for now, so no SMS, claim or payment goes out. Secret values are encrypted on the server and never shown again. Only super administrators can open this page's data.</div></div>}
    @else {<div class="alert-box warn"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon><div><b>Prototype only.</b> No external healthcare APIs are connected. Test connections return simulated results. Credentials shown are placeholders.</div></div>}
    @if (live) {<cf-kiosk-devices></cf-kiosk-devices>}
    <div class="grid">
      <cf-stat class="c3" [label]="live ? 'Configured' : 'Connected'" [value]="live ? by('Configured') + by('Connected') : by('Connected')" icon="plug" tone="green"></cf-stat>
      <cf-stat class="c3" label="Errors" [value]="by('Error')" icon="circle-alert" tone="red" [clickable]="true" (click)="cat.set('')"></cf-stat>
      <cf-stat class="c3" label="Not configured" [value]="by('Not configured')" icon="settings" tone="amber"></cf-stat>
      <cf-stat class="c3" label="Disabled" [value]="by('Disabled')" icon="power" tone="violet"></cf-stat>
    </div>
    <div class="chips"><button class="chip" [class.on]="!cat()" (click)="cat.set('')">All</button>@for (c of cats(); track c) {<button class="chip" [class.on]="cat() === c" (click)="cat.set(c)">{{ c }}</button>}</div>
    <div class="cards-auto">
      @for (i of list(); track i.id) {
        <div class="card ig" (click)="open(i)">
          <div class="top"><span class="ic"><lucide-icon [name]="icon(i.category)" [size]="20"></lucide-icon></span><div class="grow"><b>{{ i.name }}</b><span>{{ i.category }}</span></div><cf-status [s]="i.status"></cf-status></div>
          <p class="muted small">{{ i.description }}</p>
          <div class="row small muted"><span>@if (live) {{{ i.lastSync ? 'Tested ' + i.lastSync : 'Never tested' }}} @else {{{ i.lastSync ? 'Last sync ' + i.lastSync.slice(11) : 'Never synced' }}}</span><span class="spacer"></span><span (click)="$event.stopPropagation()"><mat-slide-toggle [checked]="i.enabled" (change)="toggle(i)" [attr.aria-label]="'Enable ' + i.name"></mat-slide-toggle></span></div>
        </div>
      }
    </div>
  </div>
  <cf-drawer [open]="!!sel()" [title]="sel()?.name || ''" [sub]="sel()?.category" (closed)="sel.set(null)" width="min(520px,100%)">
    @if (sel(); as i) {
      <p class="muted">{{ i.description }}</p>
      @for (f of i.fields; track f.key) {
        <div class="field"><label>{{ f.label }}</label><input class="inp" [type]="f.secret ? 'password' : 'text'" [(ngModel)]="f.value" autocomplete="off" [placeholder]="f.secret ? (live ? (f.set ? 'Saved. Type a new value to replace it.' : 'Not set') : 'Stored in vault in production') : ''"></div>
      }
      @if (live && i.id === 'wa') {<div class="alert-box info"><lucide-icon name="info" [size]="16"></lucide-icon><div>In your Meta app, set the webhook callback URL to <code>{{ webhook }}</code>, use the same verify token as below, and subscribe to <b>messages</b> to get delivery and read receipts.</div></div>}
      <div class="field"><label>Connection test</label><div class="log" aria-live="polite">{{ log() || (live ? 'Press Test connection to check the settings. No patient is messaged.' : 'Press Test connection to run a simulated handshake.') }}</div></div>
    }
    @if (sel(); as i) {<div foot><button class="btn ghost" [disabled]="testing()" (click)="test(i)"><lucide-icon name="activity" [size]="16"></lucide-icon>{{ testing() ? 'Testing…' : 'Test connection' }}</button><button class="btn" [disabled]="testing()" (click)="save(i)">Save</button></div>}
  </cf-drawer>`
})
export class IntegrationsPage {
  store = inject(StoreService); toast = inject(ToastService); api = inject(AdminApi);
  live = LIVE; webhook = API_URL + '/api/webhooks/whatsapp'; cat = signal(''); sel = signal<Integration | null>(null); log = signal(''); testing = signal(false);
  all = computed(() => { this.store.rev(); return this.store.db.integrations; });
  cats = computed(() => [...new Set(this.all().map(i => i.category))]);
  list = computed(() => this.all().filter(i => !this.cat() || i.category === this.cat()));
  constructor() { if (LIVE) { this.store.db.integrations = []; this.reload(); } }
  private async reload() {
    try { this.store.db.integrations = (await this.api.integrations()).map(fromServerIntegration); this.store.changed(); }
    catch (e) { this.toast.err(apiMessage(e, 'Could not load integrations')); }
  }
  /** Replaces one integration with the copy the server returned. */
  private put(i: Integration) { const k = this.store.db.integrations.findIndex(x => x.id === i.id); if (k >= 0) this.store.db.integrations[k] = i; this.store.changed(); return i; }
  by(s: Integration['status']) { return this.all().filter(i => i.status === s).length; }
  icon(c: string) { return ({ Government: 'landmark', Interoperability: 'git-merge', Diagnostics: 'microscope', Payments: 'credit-card', Messaging: 'message-circle', Insurance: 'shield-check', Finance: 'calculator', Devices: 'printer' } as Record<string, string>)[c] || 'plug'; }
  open(i: Integration) { this.log.set(i.lastResult ? '> Last test: ' + i.lastResult : ''); this.sel.set(this.live ? structuredClone(i) : i); }
  async toggle(i: Integration) {
    if (this.live) {
      try { this.put(fromServerIntegration(await this.api.saveIntegration(i.id, { enabled: !i.enabled, values: {}, version: i.version ?? 0 }))); this.toast.ok(`${i.name} ${!i.enabled ? 'enabled' : 'disabled'}`); }
      catch (e) { this.toast.err(apiMessage(e, 'Could not change the integration')); this.reload(); }
      return;
    }
    i.enabled = !i.enabled;
    i.status = !i.enabled ? 'Disabled' : i.fields.every(f => f.value) ? 'Connected' : 'Not configured';
    if (i.status === 'Connected') i.lastSync = this.store.nowStamp();
    this.store.log('Changed', 'Integration', `${i.name} ${i.enabled ? 'enabled' : 'disabled'}`, 'Sensitive'); this.store.changed();
    this.toast.ok(`${i.name} ${i.enabled ? 'enabled' : 'disabled'}`);
  }
  async test(i: Integration) {
    if (this.live) {
      this.testing.set(true);
      try {
        if (i.fields.some(f => f.secret ? f.value : false) || this.changed(i)) { this.toast.info('Saving your changes first'); if (!(await this.saveLive(i, false))) return; }
        const r = await this.api.testIntegration(i.id); this.log.set(r.log.join('\n'));
        const u = this.put(fromServerIntegration(r.integration)); this.sel.set(structuredClone(u));
        r.ok ? this.toast.ok(`${i.name}: ${u.status === 'Connected' ? 'connected' : 'settings complete'}`) : this.toast.err(`${i.name}: ${u.status === 'Error' ? 'connection failed' : 'settings incomplete'}`);
      } catch (e) { this.toast.err(apiMessage(e, 'Could not test the connection')); }
      finally { this.testing.set(false); }
      return;
    }
    this.testing.set(true); const missing = i.fields.filter(f => !f.value).map(f => f.label);
    const lines = [`> Resolving ${i.fields[0]?.value || i.name}…`, '> Opening secure channel (simulated)…'];
    this.log.set(lines.join('\n'));
    setTimeout(() => {
      const ok = !missing.length && i.id !== 'lis';
      lines.push(ok ? '> Handshake OK · 142 ms' : missing.length ? `> FAILED: missing ${missing.join(', ')}` : '> FAILED: analyser did not answer on port ' + (i.fields.find(f => f.key === 'port')?.value || ''));
      lines.push(ok ? '> Sample message accepted. Status: Connected' : '> Status: Error');
      this.log.set(lines.join('\n')); this.testing.set(false);
      if (i.enabled) { i.status = ok ? 'Connected' : 'Error'; if (ok) i.lastSync = this.store.nowStamp(); this.store.changed(); }
      ok ? this.toast.ok(`${i.name}: connection OK (simulated)`) : this.toast.err(`${i.name}: connection failed (simulated)`);
    }, 1200);
  }
  /** True when a non-secret field differs from the saved copy. */
  private changed(i: Integration) { const o = this.store.db.integrations.find(x => x.id === i.id); return !!o && i.fields.some(f => !f.secret && f.value !== o.fields.find(x => x.key === f.key)?.value); }
  private async saveLive(i: Integration, close: boolean) {
    const values: Record<string, string> = {}; i.fields.forEach(f => values[f.key] = f.value ?? '');
    // The list holds the latest copy this browser has seen (a toggle may have saved since the drawer opened).
    const saved = this.store.db.integrations.find(x => x.id === i.id) ?? i;
    try {
      const u = this.put(fromServerIntegration(await this.api.saveIntegration(i.id, { enabled: saved.enabled, values, version: saved.version ?? 0 })));
      this.toast.ok('Settings saved'); if (close) this.sel.set(null); else this.sel.set(structuredClone(u)); return true;
    } catch (e) { this.toast.err(apiMessage(e, 'Could not save the settings')); return false; }
  }
  save(i: Integration) {
    if (this.live) { this.saveLive(i, true); return; }
    if (i.enabled && i.status !== 'Error') i.status = i.fields.every(f => f.value) ? 'Connected' : 'Not configured'; this.store.log('Changed', 'Integration', `${i.name} settings saved`, 'Sensitive'); this.store.changed(); this.toast.ok('Settings saved'); this.sel.set(null);
  }
}
