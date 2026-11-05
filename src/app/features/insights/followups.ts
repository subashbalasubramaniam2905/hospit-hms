import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { SessionService } from '../../core/services/session.service';
import { FollowUp } from '../../core/models';
import { LIVE } from '../../core/api/api-config';
import { InsightsApi, SFollowUp, scopeBranch } from '../../core/api/insights-api';

type Row = FollowUp & { patientName?: string; mobile?: string; doctorName?: string };

@Component({
  standalone: true, imports: [SHARED],
  template: `
  <div class="page">
    <cf-page-head title="Follow-ups" [crumbs]="['Insights', 'Continuity of care']" [sub]="isLive ? 'Review dates doctors set at the end of a consultation. A follow-up counts as booked once the patient has a later visit with the same doctor. No SMS or WhatsApp gateway is connected yet, so Remind records that the desk contacted the patient.' : 'Patients whose doctor asked them to come back. Send reminders and book the visit in one place.'">
      <button class="btn ghost" [disabled]="!selected().length" (click)="remindSel()"><lucide-icon name="send" [size]="16"></lucide-icon>Remind selected ({{ selected().length }})</button>
      <button class="btn" (click)="remindOverdue()"><lucide-icon name="message-circle" [size]="16"></lucide-icon>Remind all overdue</button>
    </cf-page-head>
    <div class="grid">
      <cf-stat class="c3" label="Overdue" [value]="by('Overdue')" icon="calendar-x" tone="red" [clickable]="true" (click)="st.set('Overdue')"></cf-stat>
      <cf-stat class="c3" label="Due in 7 days" [value]="dueWeek()" icon="calendar-clock" tone="amber" [clickable]="true" (click)="st.set('Due')"></cf-stat>
      <cf-stat class="c3" label="Booked" [value]="by('Booked')" icon="calendar-check" tone="blue" [clickable]="true" (click)="st.set('Booked')"></cf-stat>
      <cf-stat class="c3" label="Completion rate" [value]="rate() + '%'" icon="circle-check" tone="green" sub="Completed or booked"></cf-stat>
    </div>
    <div class="card">
      <div class="toolbar" style="margin-bottom:12px">
        <div class="seg">@for (s of statuses; track s) {<button [class.on]="st() === s" (click)="st.set(s)">{{ s || 'All' }}</button>}</div>
        <select class="inp" style="width:auto" [ngModel]="doc()" (ngModelChange)="doc.set($event)" aria-label="Doctor"><option value="">All doctors</option>@for (d of doctors(); track d.id) {<option [value]="d.id">{{ d.name }}</option>}</select>
        <span class="spacer"></span><span class="muted small">{{ rows().length }} patients</span>
      </div>
      <div class="tbl"><table class="t"><thead><tr><th style="width:36px"><mat-checkbox [checked]="allSel()" (change)="toggleAll()" aria-label="Select all"></mat-checkbox></th><th>Patient</th><th>Doctor</th><th>Reason</th><th>Due</th><th>Status</th><th>Reminder</th><th></th></tr></thead><tbody>
        @for (f of rows(); track f.id) {<tr>
          <td><mat-checkbox [checked]="sel().includes(f.id)" (change)="toggle(f.id)" [attr.aria-label]="'Select ' + pname(f)"></mat-checkbox></td>
          <td><a class="pname" [routerLink]="['/patients', f.patientId]"><cf-avatar [name]="pname(f)"></cf-avatar><div><b>{{ pname(f) }}</b><div class="muted small">{{ f.mobile ?? store.patient(f.patientId)?.mobile }}</div></div></a></td>
          <td>{{ f.doctorName ?? store.dname(f.doctorId) }}</td><td>{{ f.reason }}</td>
          <td class="nowrap" [style.color]="f.status === 'Overdue' ? 'var(--red)' : ''">{{ f.due | d }} <span class="muted small">{{ rel(f.due) }}</span></td>
          <td><cf-status [s]="f.status"></cf-status></td><td><cf-status [s]="f.reminder"></cf-status></td>
          <td><div class="row nowrap">@if (f.status === 'Due' || f.status === 'Overdue') {<button class="btn ghost sm" (click)="remind(f)">Remind</button><button class="btn sm" (click)="book(f)">Book</button>} @else if (f.status === 'Booked' && !isLive) {<button class="btn ghost sm" (click)="done(f)">Mark seen</button>}</div></td>
        </tr>} @empty {<tr><td colspan="8"><cf-empty icon="calendar-check" title="No follow-ups in this view"></cf-empty></td></tr>}
      </tbody></table></div>
    </div>
  </div>`
})
export class FollowUpsPage {
  store = inject(StoreService); toast = inject(ToastService); router = inject(Router); session = inject(SessionService);
  readonly isLive = LIVE; private api = inject(InsightsApi);
  statuses = ['Overdue', 'Due', 'Booked', 'Completed', '']; st = signal('Overdue'); doc = signal(!LIVE && this.session.is(['doctor']) ? 'D01' : ''); sel = signal<string[]>([]);
  /** Live mode: follow-ups from the server (the last 180 days and upcoming). */
  private live = signal<Row[] | null>(null);
  constructor() { if (LIVE) this.reload(); }
  private async reload() {
    try { this.live.set((await this.api.followUps(scopeBranch(this.session))).map((f: SFollowUp) => ({ ...f }))); }
    catch { this.toast.err('Could not load follow-ups'); }
  }
  all = computed<Row[]>(() => { const L = this.live(); if (L) return L; this.store.rev(); return this.store.db.followUps; });
  doctors = computed(() => { const L = this.live(); if (!L) return this.store.db.doctors.map(d => ({ id: d.id, name: d.name }));
    return [...new Map(L.map(f => [f.doctorId, { id: f.doctorId, name: f.doctorName ?? f.doctorId }])).values()]; });
  pname(f: Row) { return f.patientName ?? this.store.pname(f.patientId); }
  rows = computed(() => this.all().filter(f => (!this.st() || f.status === this.st()) && (!this.doc() || f.doctorId === this.doc())).sort((a, b) => a.due.localeCompare(b.due)));
  selected = computed(() => this.sel().filter(id => this.rows().some(r => r.id === id)));
  by(s: FollowUp['status']) { return this.all().filter(f => f.status === s).length; }
  dueWeek() { const w = this.store.day(7); return this.all().filter(f => f.status === 'Due' && f.due <= w).length; }
  rate() { const a = this.all(); return Math.round(a.filter(f => f.status === 'Completed' || f.status === 'Booked').length / Math.max(1, a.length) * 100); }
  rel(d: string) { const n = Math.round((new Date(d + 'T00:00').getTime() - new Date(this.store.today() + 'T00:00').getTime()) / 864e5); return n === 0 ? 'today' : n < 0 ? `${-n}d ago` : `in ${n}d`; }
  allSel() { return this.rows().length > 0 && this.rows().every(r => this.sel().includes(r.id)); }
  toggleAll() { this.sel.set(this.allSel() ? [] : this.rows().map(r => r.id)); }
  toggle(id: string) { this.sel.update(v => v.includes(id) ? v.filter(x => x !== id) : [...v, id]); }
  private send(f: FollowUp) { f.reminder = 'Sent'; this.store.notify('WhatsApp', 'Follow-up reminder', f.patientId, `Your follow-up with ${this.store.dname(f.doctorId)} for ${f.reason} is due on ${f.due}. Reply 1 to book.`); setTimeout(() => { if (f.reminder === 'Sent') { f.reminder = 'Delivered'; this.store.changed(); } }, 2500); }
  private async liveRemind(l: Row[], msg: string) {
    if (!l.length) { this.toast.info('Nobody to remind'); return; }
    try { const r = await this.api.remind(l.map(f => f.id)); this.toast.ok(msg.replace('#', String(r.reminded))); this.sel.set([]); await this.reload(); }
    catch { this.toast.err('Could not record the reminders'); }
  }
  remind(f: Row) { if (LIVE) { this.liveRemind([f], `Reminder recorded for ${this.pname(f)}`); return; } this.send(f); this.store.changed(); this.toast.ok(`Reminder sent to ${this.store.pname(f.patientId)} (simulated)`); }
  remindSel() { if (LIVE) { this.liveRemind(this.all().filter(f => this.selected().includes(f.id)), '# reminders recorded'); return; } const l = this.all().filter(f => this.selected().includes(f.id)); l.forEach(f => this.send(f)); this.store.changed(); this.sel.set([]); this.toast.ok(`${l.length} reminders sent (simulated)`); }
  remindOverdue() { if (LIVE) { this.liveRemind(this.all().filter(f => f.status === 'Overdue'), '# overdue patients marked as reminded'); return; } const l = this.all().filter(f => f.status === 'Overdue'); l.forEach(f => this.send(f)); this.store.log('Sent', 'Follow-up reminders', `${l.length} overdue patients`); this.store.changed(); this.toast.ok(`${l.length} overdue patients reminded by WhatsApp (simulated)`); }
  book(f: FollowUp) { if (!LIVE) { f.status = 'Booked'; this.store.changed(); } this.router.navigate(['/appointments/new'], { queryParams: { patient: f.patientId, doctor: f.doctorId, type: 'Follow-up' } }); }
  done(f: FollowUp) { f.status = 'Completed'; this.store.changed(); this.toast.ok('Follow-up marked as seen'); }
}
