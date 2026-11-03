import { Component, computed, inject, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { Integration } from '../../core/models';

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.ig { display:flex; flex-direction:column; gap:10px; cursor:pointer } .ig:hover { border-color:var(--pri) } .ig .top { display:flex; gap:12px; align-items:flex-start }
  .ig .ic { width:42px; height:42px; border-radius:12px; display:grid; place-items:center; background:var(--pri-soft); color:var(--pri); flex:none }
  .log { font-family:ui-monospace,monospace; font-size:12px; background:#0f1c1a; color:#b7f5e3; border-radius:10px; padding:12px; white-space:pre-wrap; min-height:90px }`],
  template: `
  <div class="page">
    <cf-page-head title="Integrations" [crumbs]="['Organisation', 'Connections']" sub="Connections to government, diagnostic, payment and messaging systems. Every connection here is a mock: nothing leaves the prototype."></cf-page-head>
    <div class="alert-box warn"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon><div><b>Prototype only.</b> No external healthcare APIs are connected. Test connections return simulated results. Credentials shown are placeholders.</div></div>
    <div class="grid">
      <cf-stat class="c3" label="Connected" [value]="by('Connected')" icon="plug" tone="green"></cf-stat>
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
          <div class="row small muted"><span>{{ i.lastSync ? 'Last sync ' + i.lastSync.slice(11) : 'Never synced' }}</span><span class="spacer"></span><span (click)="$event.stopPropagation()"><mat-slide-toggle [checked]="i.enabled" (change)="toggle(i)" [attr.aria-label]="'Enable ' + i.name"></mat-slide-toggle></span></div>
        </div>
      }
    </div>
  </div>
  <cf-drawer [open]="!!sel()" [title]="sel()?.name || ''" [sub]="sel()?.category" (closed)="sel.set(null)" width="min(520px,100%)">
    @if (sel(); as i) {
      <p class="muted">{{ i.description }}</p>
      @for (f of i.fields; track f.key) {
        <div class="field"><label>{{ f.label }}</label><input class="inp" [type]="f.secret ? 'password' : 'text'" [(ngModel)]="f.value" [placeholder]="f.secret ? 'Stored in vault in production' : ''"></div>
      }
      <div class="field"><label>Connection test</label><div class="log" aria-live="polite">{{ log() || 'Press Test connection to run a simulated handshake.' }}</div></div>
    }
    @if (sel(); as i) {<div foot><button class="btn ghost" [disabled]="testing()" (click)="test(i)"><lucide-icon name="activity" [size]="16"></lucide-icon>{{ testing() ? 'Testing…' : 'Test connection' }}</button><button class="btn" (click)="save(i)">Save</button></div>}
  </cf-drawer>`
})
export class IntegrationsPage {
  store = inject(StoreService); toast = inject(ToastService);
  cat = signal(''); sel = signal<Integration | null>(null); log = signal(''); testing = signal(false);
  all = computed(() => { this.store.rev(); return this.store.db.integrations; });
  cats = computed(() => [...new Set(this.all().map(i => i.category))]);
  list = computed(() => this.all().filter(i => !this.cat() || i.category === this.cat()));
  by(s: Integration['status']) { return this.all().filter(i => i.status === s).length; }
  icon(c: string) { return ({ Government: 'landmark', Interoperability: 'git-merge', Diagnostics: 'microscope', Payments: 'credit-card', Messaging: 'message-circle', Insurance: 'shield-check', Finance: 'calculator', Devices: 'printer' } as Record<string, string>)[c] || 'plug'; }
  open(i: Integration) { this.log.set(''); this.sel.set(i); }
  toggle(i: Integration) {
    i.enabled = !i.enabled;
    i.status = !i.enabled ? 'Disabled' : i.fields.every(f => f.value) ? 'Connected' : 'Not configured';
    if (i.status === 'Connected') i.lastSync = this.store.nowStamp();
    this.store.log('Changed', 'Integration', `${i.name} ${i.enabled ? 'enabled' : 'disabled'}`, 'Sensitive'); this.store.changed();
    this.toast.ok(`${i.name} ${i.enabled ? 'enabled' : 'disabled'}`);
  }
  test(i: Integration) {
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
  save(i: Integration) { if (i.enabled && i.status !== 'Error') i.status = i.fields.every(f => f.value) ? 'Connected' : 'Not configured'; this.store.log('Changed', 'Integration', `${i.name} settings saved`, 'Sensitive'); this.store.changed(); this.toast.ok('Settings saved'); this.sel.set(null); }
}
