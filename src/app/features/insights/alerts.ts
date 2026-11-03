import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { SessionService } from '../../core/services/session.service';
import { Alert } from '../../core/models';

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.al { display:flex; gap:14px; padding:14px; border-radius:14px; border:1px solid var(--line); background:var(--card); cursor:pointer; align-items:flex-start }
  .al:hover { border-color:var(--pri) } .al .bar { width:4px; align-self:stretch; border-radius:4px; flex:none } .al.Resolved { opacity:.65 }
  .al .meta { display:flex; gap:8px; flex-wrap:wrap; align-items:center; font-size:12px; color:var(--mut); margin-top:6px }`],
  template: `
  <div class="page">
    <cf-page-head title="Alerts" [crumbs]="['Home', 'Alerts centre']" sub="Clinical, lab, pharmacy, billing and operational alerts in one place. Clinical alerts are demo rules, not validated decision support.">
      <button class="btn ghost" (click)="ackAll()" [disabled]="!openLow()">Acknowledge all low priority</button>
    </cf-page-head>
    <div class="grid">
      <cf-stat class="c3" label="Critical open" [value]="n('Critical')" icon="siren" tone="red" [clickable]="true" (click)="prio.set('Critical'); status.set('Open')"></cf-stat>
      <cf-stat class="c3" label="Open" [value]="byStatus('Open')" icon="bell-ring" tone="pink" [clickable]="true" (click)="status.set('Open'); prio.set('')"></cf-stat>
      <cf-stat class="c3" label="Acknowledged" [value]="byStatus('Acknowledged')" icon="eye" tone="amber" [clickable]="true" (click)="status.set('Acknowledged'); prio.set('')"></cf-stat>
      <cf-stat class="c3" label="Resolved today" [value]="byStatus('Resolved')" icon="circle-check" tone="green" [clickable]="true" (click)="status.set('Resolved'); prio.set('')"></cf-stat>
    </div>
    <div class="card" style="padding:12px 16px"><div class="toolbar">
      <div class="seg">@for (s of statuses; track s) {<button [class.on]="status() === s" (click)="status.set(s)">{{ s || 'All' }}</button>}</div>
      <select class="inp" style="width:auto" [ngModel]="prio()" (ngModelChange)="prio.set($event)" aria-label="Priority"><option value="">Any priority</option>@for (p of prios; track p) {<option>{{ p }}</option>}</select>
      <select class="inp" style="width:auto" [ngModel]="cat()" (ngModelChange)="cat.set($event)" aria-label="Category"><option value="">All categories</option>@for (c of cats; track c) {<option>{{ c }}</option>}</select>
      <mat-slide-toggle [checked]="mine()" (change)="mine.set(!mine())">Assigned to me</mat-slide-toggle>
      <span class="spacer"></span><span class="muted small">{{ rows().length }} alerts</span>
    </div></div>
    <div class="stack-s">
      @for (a of rows(); track a.id) {
        <div class="al {{ a.status }}" (click)="sel.set(a)">
          <span class="bar" [style.background]="color(a.priority)"></span>
          <div class="grow"><div class="row"><b style="font-size:15px">{{ a.title }}</b><cf-status [s]="a.priority"></cf-status>@if (a.category === 'Clinical' || a.category === 'Safety' || a.category === 'Lab') {<span class="demo-tag">Demo rule</span>}</div>
            <div class="muted">{{ a.detail }}</div>
            <div class="meta"><span>{{ a.category }}</span>·<span>{{ a.dept }}</span>·<span>{{ a.time.slice(11) }}</span>·<span><lucide-icon name="user-round" [size]="12"></lucide-icon> {{ a.assignee }}</span></div></div>
          <cf-status [s]="a.status"></cf-status>
        </div>
      } @empty { <div class="card"><cf-empty icon="bell-off" title="No alerts match" text="Clear the filters to see everything."></cf-empty></div> }
    </div>
  </div>
  <cf-drawer [open]="!!sel()" [title]="sel()?.title || ''" [sub]="sel() ? sel()!.priority + ' · ' + sel()!.category + ' · ' + sel()!.dept : ''" (closed)="sel.set(null)">
    @if (sel(); as a) {
      <p>{{ a.detail }}</p>
      @if (a.category === 'Clinical' || a.category === 'Safety' || a.category === 'Lab') {<div class="alert-box warn"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon><div>Demo alert, not validated clinical decision support. The treating clinician decides what to do.</div></div>}
      <div class="kv"><div><small>Raised</small><b>{{ a.time }}</b></div><div><small>Status</small><b><cf-status [s]="a.status"></cf-status></b></div></div>
      <div class="field"><label>Assigned to</label><select class="inp" [ngModel]="a.assignee" (ngModelChange)="assign(a, $event)">@for (p of people(); track p) {<option>{{ p }}</option>}</select></div>
      @if (a.status !== 'Resolved') {<div class="field"><label>Resolution note</label><textarea class="inp" rows="3" [(ngModel)]="note" placeholder="What was done?"></textarea></div>}
      @if (a.link) {<button class="linkbtn" (click)="go(a)">Open the related screen →</button>}
    }
    @if (sel(); as a) {<div foot>@if (a.status === 'Open') {<button class="btn ghost" (click)="ack(a)">Acknowledge</button>}@if (a.status !== 'Resolved') {<button class="btn" (click)="resolve(a)"><lucide-icon name="check" [size]="16"></lucide-icon>Resolve</button>} @else {<button class="btn ghost" (click)="reopen(a)">Reopen</button>}</div>}
  </cf-drawer>`
})
export class AlertsPage {
  store = inject(StoreService); toast = inject(ToastService); session = inject(SessionService); router = inject(Router);
  statuses = ['Open', 'Acknowledged', 'Resolved', '']; prios = ['Critical', 'High', 'Medium', 'Low']; cats = ['Clinical', 'Lab', 'Pharmacy', 'Billing', 'Operations', 'Bed', 'Safety', 'System'];
  status = signal('Open'); prio = signal(''); cat = signal(''); mine = signal(false); sel = signal<Alert | null>(null); note = '';
  all = computed(() => { this.store.rev(); return this.store.db.alerts; });
  rows = computed(() => { const me = this.session.role()?.userName; const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    return this.all().filter(a => (!this.status() || a.status === this.status()) && (!this.prio() || a.priority === this.prio()) && (!this.cat() || a.category === this.cat()) && (!this.mine() || a.assignee === me))
      .sort((x, y) => order[x.priority] - order[y.priority] || y.time.localeCompare(x.time)); });
  people = computed(() => [...new Set([...this.all().map(a => a.assignee), ...this.store.db.users.map(u => u.name)])]);
  n(p: Alert['priority']) { return this.all().filter(a => a.priority === p && a.status === 'Open').length; }
  byStatus(s: Alert['status']) { return this.all().filter(a => a.status === s).length; }
  openLow() { return this.all().filter(a => a.priority === 'Low' && a.status === 'Open').length; }
  color(p: Alert['priority']) { return p === 'Critical' ? 'var(--red)' : p === 'High' ? 'var(--pink)' : p === 'Medium' ? 'var(--amber)' : 'var(--line)'; }
  ack(a: Alert) { a.status = 'Acknowledged'; this.store.log('Acknowledged', 'Alert', a.title); this.store.changed(); this.toast.ok('Alert acknowledged'); }
  resolve(a: Alert) { a.status = 'Resolved'; if (this.note.trim()) a.detail += ` Resolution: ${this.note.trim()}`; this.store.log('Resolved', 'Alert', `${a.title}${this.note ? ': ' + this.note : ''}`); this.note = ''; this.store.changed(); this.toast.ok('Alert resolved'); this.sel.set(null); }
  reopen(a: Alert) { a.status = 'Open'; this.store.changed(); this.toast.info('Alert reopened'); }
  assign(a: Alert, who: string) { a.assignee = who; this.store.log('Assigned', 'Alert', `${a.title} → ${who}`); this.store.changed(); this.toast.ok(`Assigned to ${who}`); }
  ackAll() { const l = this.all().filter(a => a.priority === 'Low' && a.status === 'Open'); l.forEach(a => a.status = 'Acknowledged'); this.store.changed(); this.toast.ok(`${l.length} low priority alerts acknowledged`); }
  go(a: Alert) { this.sel.set(null); this.router.navigateByUrl(a.link!); }
}
