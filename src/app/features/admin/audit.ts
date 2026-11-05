import { Component, computed, inject, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ExportService } from '../../core/services/export.service';
import { SessionService } from '../../core/services/session.service';
import { AuditLog } from '../../core/models';
import { LIVE } from '../../core/api/api-config';
import { AdminApi, fromServerAudit, fromServerLogin } from '../../core/api/admin-api';
import { apiMessage } from '../../core/api/auth.service';

type Row = AuditLog & { serverId?: number; flaggedBy?: string; flagNote?: string };

@Component({
  standalone: true, imports: [SHARED],
  template: `
  <div class="page">
    <cf-page-head title="Audit logs" [crumbs]="['Organisation', 'Security']" [sub]="live ? 'Every sign-in, record opened, change and export, read from the append-only trail on the server.' : 'Every view, change and export in the prototype is recorded here, including actions you take in this session.'">
      @if (live && canVerify) {<button class="btn ghost" (click)="verify()"><lucide-icon name="shield-check" [size]="16"></lucide-icon>Check integrity</button>}
      <button class="btn ghost" (click)="exportCsv()"><lucide-icon name="download" [size]="16"></lucide-icon>Export CSV</button>
    </cf-page-head>
    <div class="grid">
      <cf-stat class="c3" label="Events today" [value]="today().length" icon="scroll-text" tone="pri"></cf-stat>
      <cf-stat class="c3" label="Sensitive" [value]="byRisk('Sensitive')" icon="eye" tone="amber" sub="Exports, role and refund changes" [clickable]="true" (click)="risk.set('Sensitive')"></cf-stat>
      <cf-stat class="c3" label="Flagged" [value]="byRisk('Flagged')" icon="flag" tone="red" [clickable]="true" (click)="risk.set('Flagged')"></cf-stat>
      <cf-stat class="c3" label="Failed sign-ins" [value]="failedLogins()" icon="lock" tone="violet" [clickable]="true" (click)="tab.set('logins')"></cf-stat>
    </div>
    <div class="tabs"><button [class.on]="tab() === 'events'" (click)="tab.set('events')">Activity</button><button [class.on]="tab() === 'logins'" (click)="tab.set('logins')">Sign-in history</button></div>
    @if (tab() === 'events') {
      <div class="card">
        <div class="toolbar" style="margin-bottom:12px">
          <label class="search boxed" style="flex:1;max-width:320px"><lucide-icon name="search" [size]="16"></lucide-icon><input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="User, record or UHID" aria-label="Search audit"></label>
          <select class="inp" style="width:auto" [ngModel]="action()" (ngModelChange)="action.set($event)" aria-label="Action"><option value="">All actions</option>@for (a of actions(); track a) {<option>{{ a }}</option>}</select>
          <div class="chips">@for (r of risks; track r) {<button class="chip" [class.on]="risk() === r" (click)="risk.set(risk() === r ? '' : r)">{{ r }}</button>}</div>
        </div>
        <cf-table [rows]="rows()" [cols]="cols" [pageSize]="15" [clickable]="true" (rowClick)="sel.set($event)">
          <ng-template cfCell="user" let-a><b>{{ a.user }}</b> <span class="muted small">{{ a.role }}</span></ng-template>
          <ng-template cfCell="risk" let-a><cf-status [s]="a.risk"></cf-status></ng-template>
        </cf-table>
      </div>
    } @else {
      <div class="card">
        <cf-table [rows]="logins()" [cols]="loginCols">
          <ng-template cfCell="result" let-l><cf-status [s]="l.result"></cf-status></ng-template>
        </cf-table>
      </div>
    }
  </div>
  <cf-drawer [open]="!!sel()" [title]="sel() ? sel()!.action + ' · ' + sel()!.entity : ''" [sub]="sel()?.time" (closed)="sel.set(null)">
    @if (sel(); as a) {
      <div class="kv"><div><small>User</small><b>{{ a.user }}</b></div><div><small>Role</small><b>{{ a.role }}</b></div><div><small>IP address</small><b>{{ a.ip }}</b></div><div><small>Branch</small><b>{{ a.branch }}</b></div><div><small>Risk</small><b><cf-status [s]="a.risk"></cf-status></b></div><div><small>Event ID</small><b>{{ a.id }}</b></div></div>
      <div class="field"><label>Detail</label><div class="soft" style="padding:12px;border-radius:10px">{{ a.detail }}</div></div>
      @if (a.flaggedBy) {<div class="field"><label>Flagged by {{ a.flaggedBy }}</label><div class="soft" style="padding:12px;border-radius:10px">{{ a.flagNote || 'No note' }}</div></div>}
      @if (live && a.risk !== 'Flagged') {<div class="field"><label>Note for the reviewer (optional)</label><input class="inp" [(ngModel)]="note" maxlength="300"></div>}
      @if (live) {<p class="muted small">Audit entries cannot be edited or deleted. Each entry is chained to the one before it, so any change made directly in the database is detectable.</p>}
      @else {<p class="muted small">Audit entries cannot be edited or deleted. In production they would be written to append-only storage.</p>}
    }
    @if (sel(); as a) {<div foot>@if (a.risk !== 'Flagged') {<button class="btn ghost" (click)="flag(a)"><lucide-icon name="flag" [size]="16"></lucide-icon>Flag for review</button>}<button class="btn" (click)="sel.set(null)">Close</button></div>}
  </cf-drawer>`
})
export class AuditPage {
  store = inject(StoreService); toast = inject(ToastService); exp = inject(ExportService); api = inject(AdminApi); session = inject(SessionService);
  live = LIVE; note = ''; canVerify = this.session.is(['super-admin']);
  constructor() { if (LIVE) { this.store.db.audit = []; this.store.db.logins = []; this.reload(); } }
  tab = signal<'events' | 'logins'>('events'); q = signal(''); action = signal(''); risk = signal(''); sel = signal<Row | null>(null);
  risks = ['Normal', 'Sensitive', 'Flagged'];
  cols = [{ key: 'time', label: 'Time', width: '140px' }, { key: 'user', label: 'User' }, { key: 'action', label: 'Action' }, { key: 'entity', label: 'Record' }, { key: 'detail', label: 'Detail', sortable: false }, { key: 'branch', label: 'Branch' }, { key: 'risk', label: 'Risk' }];
  loginCols = [{ key: 'time', label: 'Time' }, { key: 'user', label: 'User' }, { key: 'role', label: 'Role' }, { key: 'device', label: 'Device' }, { key: 'ip', label: 'IP address' }, { key: 'result', label: 'Result' }];
  all = computed<Row[]>(() => { this.store.rev(); return this.store.db.audit; });
  today = computed(() => this.all().filter(a => a.time.startsWith(this.store.today())));
  actions = computed(() => [...new Set(this.all().map(a => a.action))].sort());
  logins = computed(() => { this.store.rev(); return this.store.db.logins; });
  failedLogins = computed(() => this.logins().filter(l => l.result !== 'Success').length);
  rows = computed(() => { const q = this.q().toLowerCase(); return this.all().filter(a => (!this.action() || a.action === this.action()) && (!this.risk() || a.risk === this.risk()) && (!q || (a.user + a.entity + a.detail).toLowerCase().includes(q))); });
  byRisk(r: AuditLog['risk']) { return this.all().filter(a => a.risk === r).length; }
  async flag(a: Row) {
    if (LIVE) {
      try { await this.api.flag(a.serverId!, this.note.trim()); this.toast.ok('Flagged for review'); this.note = ''; this.sel.set(null); await this.reload(); }
      catch (e) { this.toast.err(apiMessage(e, 'Could not flag the entry')); }
      return;
    }
    a.risk = 'Flagged'; this.store.log('Flagged', 'Audit entry', `${a.id} flagged for review`, 'Flagged'); this.store.changed(); this.toast.ok('Flagged for the compliance team'); this.sel.set(null);
  }
  exportCsv() {
    const rows = this.rows();
    if (LIVE) this.api.exported('Audit log', rows.length).catch(() => undefined); else { this.store.log('Exported', 'Audit log', `${rows.length} rows`, 'Sensitive'); this.store.changed(); }
    this.exp.csv('audit-log', rows.map(a => ({ Time: a.time, User: a.user, Role: a.role, Action: a.action, Record: a.entity, Detail: a.detail, IP: a.ip, Branch: a.branch, Risk: a.risk })));
  }
  async reload() {
    try {
      const name = (id?: string) => id ? this.store.db.branches.find(b => b.id === id)?.name.replace('HospitOS ', '') || id : 'All branches';
      const [entries, logins] = await Promise.all([this.api.audit(), this.api.logins()]);
      this.store.db.audit = entries.map(e => fromServerAudit(e, name)); this.store.db.logins = logins.map(fromServerLogin); this.store.changed();
    } catch (e) { this.toast.err(apiMessage(e, 'Could not load the audit trail')); }
  }
  async verify() {
    try { const v = await this.api.verify(); v.intact ? this.toast.ok(`Audit trail intact: ${v.entries} entries checked`) : this.toast.err(`Audit trail broken at entry ${v.firstBrokenId}. Report this to your security officer.`); }
    catch (e) { this.toast.err(apiMessage(e, 'Could not check the audit trail')); }
  }
}
