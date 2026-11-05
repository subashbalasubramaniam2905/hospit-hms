import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ExportService } from '../../core/services/export.service';
import { Channel, InAppNote, NotificationMsg, Patient } from '../../core/models';
import { LIVE } from '../../core/api/api-config';
import { OrgApi, fromServerMessage } from '../../core/api/org-api';
import { AdminApi } from '../../core/api/admin-api';
import { apiMessage } from '../../core/api/auth.service';
import { SessionService } from '../../core/services/session.service';
import { InboxService } from '../../core/services/inbox.service';
import { PatientsApi } from '../../core/api/patients-api';

const TEMPLATES: { type: NotificationMsg['type']; text: string }[] = [
  { type: 'Appointment reminder', text: 'Reminder: your appointment at HospitOS is tomorrow. Reply 1 to confirm or 2 to reschedule.' },
  { type: 'Follow-up reminder', text: 'Your follow-up visit is due this week. Book on the patient app or call +91 4252 221000.' },
  { type: 'Payment reminder', text: 'An amount is due on your recent invoice. Pay by UPI on the patient app.' },
  { type: 'Lab report ready', text: 'Your lab report is ready. View it securely in the patient app.' },
  { type: 'System', text: 'OPD will close early at 1 pm on Sunday for maintenance.' },
];

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.msg { max-width:52ch; white-space:nowrap; overflow:hidden; text-overflow:ellipsis } .ch { display:inline-flex; gap:6px; align-items:center; font-weight:600 }
  .phone { background:var(--ground); border-radius:18px; padding:14px; display:flex; flex-direction:column; gap:8px } .bub { background:#dcf8c6; color:#111; border-radius:12px 12px 2px 12px; padding:10px 12px; align-self:flex-end; max-width:90%; font-size:13.5px }
  .note { display:flex; gap:12px; padding:12px; border-radius:12px; cursor:pointer } .note:hover { background:var(--ground) } .note.unread { background:var(--pri-soft) }
  .note .ic { width:36px; height:36px; border-radius:10px; display:grid; place-items:center; flex:none }`],
  template: `
  <div class="page">
    <cf-page-head title="Notifications" [crumbs]="['Organisation', 'Messaging']" [sub]="live ? 'Patient messages and the staff inbox. No SMS, email or WhatsApp provider is connected yet, so patient messages wait as Queued and nothing is sent.' : 'SMS, email, WhatsApp and in-app messages sent by the hospital. Delivery is simulated; no real messages leave the prototype.'">
      <button class="btn ghost" (click)="exportCsv()"><lucide-icon name="download" [size]="16"></lucide-icon>Export</button>
      <button class="btn" (click)="compose.set(true)"><lucide-icon name="send" [size]="16"></lucide-icon>New message</button>
    </cf-page-head>
    <div class="grid">
      <cf-stat class="c3" [label]="live ? 'Messages today' : 'Sent today'" [value]="today().length" icon="send" tone="pri"></cf-stat>
      <cf-stat class="c3" label="Delivered" [value]="rate() + '%'" icon="check-check" tone="green" sub="Delivered or read"></cf-stat>
      <cf-stat class="c3" label="Failed" [value]="failed().length" icon="circle-alert" tone="red" [clickable]="true" (click)="status.set('Failed'); tab.set('log')"></cf-stat>
      <cf-stat class="c3" label="Unread in-app" [value]="unread()" icon="bell" tone="amber" [clickable]="true" (click)="tab.set('inbox')"></cf-stat>
    </div>
    <div class="tabs"><button [class.on]="tab() === 'log'" (click)="tab.set('log')">Message log</button><button [class.on]="tab() === 'inbox'" (click)="tab.set('inbox')">Staff inbox @if (unread()) {<span class="st r">{{ unread() }}</span>}</button><button [class.on]="tab() === 'rules'" (click)="tab.set('rules')">Channel rules</button></div>

    @if (tab() === 'log') {
      <div class="card">
        <div class="toolbar" style="margin-bottom:12px">
          <label class="search boxed" style="flex:1;max-width:300px"><lucide-icon name="search" [size]="16"></lucide-icon><input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Patient, number or text" aria-label="Search messages"></label>
          <div class="chips">@for (c of channels; track c) {<button class="chip" [class.on]="ch() === c" (click)="ch.set(ch() === c ? '' : c)">{{ c }}</button>}</div>
          <select class="inp" style="width:auto" [ngModel]="status()" (ngModelChange)="status.set($event)" aria-label="Status"><option value="">Any status</option>@for (s of statuses; track s) {<option>{{ s }}</option>}</select>
        </div>
        <cf-table [rows]="rows()" [cols]="cols" [clickable]="true" (rowClick)="sel.set($event)">
          <ng-template cfCell="channel" let-n><span class="ch"><lucide-icon [name]="icon(n.channel)" [size]="15"></lucide-icon>{{ n.channel }}</span></ng-template>
          <ng-template cfCell="message" let-n><div class="msg">{{ n.message }}</div></ng-template>
          <ng-template cfCell="status" let-n><cf-status [s]="n.status"></cf-status></ng-template>
        </cf-table>
      </div>
    } @else if (tab() === 'inbox') {
      <div class="card">
        <div class="card-h"><h3>Staff inbox</h3><button class="btn ghost sm r" (click)="readAll()">Mark all read</button></div>
        @for (n of inbox(); track n.id) {
          <div class="note" [class.unread]="!n.read" (click)="open(n)">
            <span class="ic st {{ n.tone }}"><lucide-icon [name]="n.icon" [size]="18"></lucide-icon></span>
            <div class="grow"><b>{{ n.title }}</b><span>{{ n.body }}</span></div><span class="muted small nowrap">{{ n.time.slice(11) }}</span>
          </div>
        } @empty { <cf-empty icon="bell-off" title="No notifications"></cf-empty> }
      </div>
    } @else {
      <div class="card">
        <div class="card-h"><h3>Which channels each message uses</h3><span class="r muted small">Saved to hospital settings</span></div>
        <div class="tbl"><table class="t"><thead><tr><th>Message</th><th>SMS</th><th>Email</th><th>WhatsApp</th><th>In-app</th></tr></thead><tbody>
          @for (r of store.db.config.notifyRules; track r.key) {<tr><td><b>{{ r.label }}</b></td>
            <td><mat-checkbox [checked]="r.sms" (change)="r.sms = !r.sms; save()"></mat-checkbox></td><td><mat-checkbox [checked]="r.email" (change)="r.email = !r.email; save()"></mat-checkbox></td>
            <td><mat-checkbox [checked]="r.whatsapp" (change)="r.whatsapp = !r.whatsapp; save()"></mat-checkbox></td><td><mat-checkbox [checked]="r.inapp" (change)="r.inapp = !r.inapp; save()"></mat-checkbox></td></tr>}
        </tbody></table></div>
        <p class="muted small" style="margin-top:10px">WhatsApp messages need pre-approved templates and SMS needs DLT registration in production. @if (live) {These rules are saved, but nothing sends automatically yet.} @else {Both are mocked here.}</p>
      </div>
    }
  </div>

  <cf-drawer [open]="!!sel()" [title]="sel()?.type || ''" [sub]="sel() ? sel()!.channel + ' · ' + sel()!.time : ''" (closed)="sel.set(null)">
    @if (sel(); as n) {
      <div class="kv"><div><small>To</small><b>{{ n.to }}</b></div><div><small>Status</small><b><cf-status [s]="n.status"></cf-status></b></div></div>
      @if (err(n); as e) {<div class="alert-box warn"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon><div>{{ e }}</div></div>}
      <div class="phone"><div class="muted small">Preview</div><div class="bub">{{ n.message }}</div></div>
      @if (n.patientId) {<a class="linkbtn" [routerLink]="['/patients', n.patientId]">Open patient record</a>}
    }
    @if (sel(); as n) {<div foot>@if (n.status === 'Failed') {<button class="btn ghost" (click)="fallback(n)">Send by SMS instead</button>}<button class="btn" (click)="resend(n)"><lucide-icon name="rotate-cw" [size]="16"></lucide-icon>Resend</button></div>}
  </cf-drawer>

  <cf-drawer [open]="compose()" title="New message" sub="Send to one patient or a group" (closed)="compose.set(false)">
    @if (!live) {<div class="field"><label>Send to</label><div class="seg"><button [class.on]="aud() === 'one'" (click)="aud.set('one')">One patient</button><button [class.on]="aud() === 'today'" (click)="aud.set('today')">Today's appointments</button><button [class.on]="aud() === 'overdue'" (click)="aud.set('overdue')">Overdue follow-ups</button></div></div>}
    @if (live) {<div class="field"><label>Patient</label><input class="inp" [ngModel]="pq()" (ngModelChange)="findPatients($event)" placeholder="Search name, UHID or mobile" aria-label="Find patient">
      <select class="inp" style="margin-top:6px" [(ngModel)]="pid" aria-label="Patient"><option value="">{{ found().length ? 'Choose a patient' : 'No patients found' }}</option>@for (p of found(); track p.id) {<option [value]="p.id">{{ p.name }} · {{ p.id }} · {{ p.mobile || 'no mobile' }}</option>}</select></div>}
    @else if (aud() === 'one') {<div class="field"><label>Patient</label><select class="inp" [(ngModel)]="pid">@for (p of store.db.patients.slice(0, 40); track p.id) {<option [value]="p.id">{{ p.name }} · {{ p.id }}</option>}</select></div>}
    @else {<div class="alert-box info"><lucide-icon name="users" [size]="16"></lucide-icon><div>{{ audience().length }} patients will receive this message.</div></div>}
    <div class="field"><label>Channel</label><div class="chips">@for (c of sendChannels; track c) {<button class="chip" [class.on]="cch === c" (click)="cch = c">{{ c }}</button>}</div></div>
    <div class="field"><label>Template</label><select class="inp" [ngModel]="tpl" (ngModelChange)="pick($event)">@for (t of templates; track t.type; let i = $index) {<option [ngValue]="i">{{ t.type }}</option>}</select></div>
    <div class="field"><label>Message</label><textarea class="inp" rows="4" [(ngModel)]="text" maxlength="320"></textarea><span class="muted small">{{ text.length }}/320 characters · {{ smsParts() }} SMS part(s)</span></div>
    <div foot><button class="btn ghost" (click)="compose.set(false)">Cancel</button><button class="btn" [disabled]="!text.trim() || busy() || (live && !pid)" (click)="send()"><lucide-icon name="send" [size]="16"></lucide-icon>{{ live ? 'Queue message' : 'Send now' }}</button></div>
  </cf-drawer>`
})
export class NotificationsPage {
  store = inject(StoreService); toast = inject(ToastService); exp = inject(ExportService); router = inject(Router);
  api = inject(OrgApi); admin = inject(AdminApi); session = inject(SessionService); box = inject(InboxService); patients = inject(PatientsApi);
  live = LIVE; busy = signal(false); private cfgVersion = 0;
  sendChannels: Channel[] = LIVE ? ['SMS', 'Email', 'WhatsApp'] : ['SMS', 'Email', 'WhatsApp', 'In-app'];
  tab = signal<'log' | 'inbox' | 'rules'>('log'); q = signal(''); ch = signal(''); status = signal(''); sel = signal<NotificationMsg | null>(null);
  compose = signal(false); aud = signal<'one' | 'today' | 'overdue'>('one');
  channels: Channel[] = ['SMS', 'Email', 'WhatsApp', 'In-app']; statuses = ['Queued', 'Sent', 'Delivered', 'Read', 'Failed'];
  templates = TEMPLATES; tpl = 0; text = TEMPLATES[0].text; cch: Channel = 'WhatsApp'; pid = 'HS-23-01041';
  cols = [{ key: 'time', label: 'Time', width: '130px' }, { key: 'channel', label: 'Channel' }, { key: 'type', label: 'Type' }, { key: 'to', label: 'To' }, { key: 'message', label: 'Message', sortable: false }, { key: 'status', label: 'Status' }];
  all = computed(() => { this.store.rev(); return this.store.db.notifications; });
  today = computed(() => this.all().filter(n => n.time.startsWith(this.store.today())));
  failed = computed(() => this.all().filter(n => n.status === 'Failed'));
  rate = computed(() => { const a = this.all(); return a.length ? Math.round(a.filter(n => n.status === 'Delivered' || n.status === 'Read').length / a.length * 100) : 0; });
  inbox = computed(() => { this.store.rev(); return this.store.db.inbox; });
  unread = computed(() => this.inbox().filter(n => !n.read).length);
  rows = computed(() => { const q = this.q().toLowerCase(); return this.all().filter(n => (!this.ch() || n.channel === this.ch()) && (!this.status() || n.status === this.status()) && (!q || (n.to + n.message + n.type).toLowerCase().includes(q))); });
  audience = computed(() => { this.store.rev(); const s = this.store;
    if (this.aud() === 'today') return [...new Set(s.db.appointments.filter(a => a.date === s.today() && !['Cancelled', 'Completed'].includes(a.status)).map(a => a.patientId))];
    if (this.aud() === 'overdue') return [...new Set(s.db.followUps.filter(f => f.status === 'Overdue').map(f => f.patientId))];
    return [this.pid]; });
  icon(c: Channel) { return c === 'SMS' ? 'message-square' : c === 'Email' ? 'mail' : c === 'WhatsApp' ? 'message-circle' : 'bell'; }
  smsParts() { return Math.max(1, Math.ceil(this.text.length / 160)); }
  pq = signal(''); found = signal<Patient[]>([]); private findSeq = 0;
  async findPatients(q: string) {
    this.pq.set(q); const seq = ++this.findSeq;
    try { const r = await this.patients.search(q.trim(), 20); if (seq === this.findSeq) { this.found.set(r); if (!r.some(p => p.id === this.pid)) this.pid = r[0]?.id ?? ''; } } catch { /* the list stays as it was */ }
  }
  pick(i: number) { this.tpl = i; this.text = TEMPLATES[i].text; }
  constructor() {
    if (!LIVE) return;
    this.store.db.notifications = []; this.cch = 'WhatsApp'; this.pid = ''; this.findPatients('');
    this.reload(); this.box.load().catch(() => undefined);
    this.admin.config().then(c => { this.store.db.config.notifyRules = c.notifyRules; this.cfgVersion = c.version; this.store.changed(); }).catch(() => undefined);
  }
  async reload() {
    try { this.store.db.notifications = (await this.api.messages()).map(fromServerMessage); this.store.changed(); }
    catch (e) { this.toast.err(apiMessage(e, 'Could not load messages')); }
  }
  err(n: NotificationMsg) { return (n as NotificationMsg & { error?: string }).error; }
  private async queue(channel: Channel, type: NotificationMsg['type'], ids: string[], message: string) {
    this.busy.set(true);
    try {
      const r = await this.api.send({ channel, type, patientIds: ids, message, branchId: this.session.branchId() });
      if (r.queued) this.toast.ok(`${r.queued} message(s) queued by ${channel}. Nothing is sent until a provider is connected.`);
      if (r.skipped.length) this.toast.warn(`Skipped: ${r.skipped.join(', ')}`);
      await this.reload(); return true;
    } catch (e) { this.toast.err(apiMessage(e, 'Could not queue the message')); return false; }
    finally { this.busy.set(false); }
  }
  async send() {
    const type = TEMPLATES[this.tpl].type;
    if (this.live) { if (await this.queue(this.cch, type, [this.pid], this.text.trim())) { this.compose.set(false); this.tab.set('log'); } return; }
    const ids = this.audience();
    ids.forEach(id => this.store.notify(this.cch, type, id, this.text));
    this.store.log('Sent', 'Notification', `${type} to ${ids.length} patient(s) by ${this.cch}`); this.store.changed();
    this.toast.ok(`${ids.length} message(s) queued by ${this.cch} (simulated)`); this.compose.set(false); this.tab.set('log');
  }
  resend(n: NotificationMsg) {
    if (this.live) { if (n.patientId) this.queue(n.channel, n.type, [n.patientId], n.message).then(ok => { if (ok) this.sel.set(null); }); return; }
    n.status = 'Sent'; n.time = this.store.nowStamp(); this.store.changed(); this.toast.ok('Message resent (simulated)'); setTimeout(() => { n.status = 'Delivered'; this.store.changed(); }, 2000); this.sel.set(null);
  }
  fallback(n: NotificationMsg) {
    if (this.live) { if (n.patientId) this.queue('SMS', n.type, [n.patientId], n.message).then(ok => { if (ok) this.sel.set(null); }); return; }
    if (n.patientId) this.store.notify('SMS', n.type, n.patientId, n.message); this.store.changed(); this.toast.ok('Sent by SMS instead (simulated)'); this.sel.set(null);
  }
  open(n: InAppNote) { this.box.read(n); if (n.link) this.router.navigate([n.link]); }
  readAll() { this.box.readAll(); this.toast.ok('All marked as read'); }
  async save() {
    if (this.live) {
      try {
        const c = await this.admin.config();
        const u = await this.admin.saveConfig({ ...c, notifyRules: this.store.db.config.notifyRules, version: this.cfgVersion || c.version });
        this.cfgVersion = u.version; this.toast.ok('Channel rules saved');
      } catch (e) { this.toast.err(apiMessage(e, 'Could not save the rules')); const c = await this.admin.config().catch(() => null); if (c) { this.store.db.config.notifyRules = c.notifyRules; this.cfgVersion = c.version; this.store.changed(); } }
      return;
    }
    this.store.log('Changed', 'Settings', 'Notification channel rules updated'); this.store.changed(); this.toast.ok('Channel rules saved');
  }
  exportCsv() { this.exp.csv('notifications', this.rows().map(n => ({ Time: n.time, Channel: n.channel, Type: n.type, To: n.to, Message: n.message, Status: n.status }))); }
}
