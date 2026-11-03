import { Component, computed, inject, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { HospitalConfig, ServiceItem } from '../../core/models';

type Tab = 'general' | 'hours' | 'rules' | 'tariff' | 'taxes' | 'depts' | 'data';

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.lay { display:grid; grid-template-columns:220px minmax(0,1fr); gap:16px; align-items:start } .side button { display:flex; gap:10px; align-items:center; width:100%; padding:10px 12px; border:0; border-radius:10px; background:none; text-align:left; font-weight:600; color:var(--fg) }
  .side button.on { background:var(--pri-soft); color:var(--pri) } .hrs { display:grid; grid-template-columns:70px 1fr 1fr auto; gap:10px; align-items:center }
  @media (max-width:900px) { .lay { grid-template-columns:minmax(0,1fr) } .side { display:flex; overflow-x:auto } .side button { white-space:nowrap; width:auto } }`],
  template: `
  <div class="page">
    <cf-page-head title="Hospital settings" [crumbs]="['Organisation', 'Configuration']" sub="Branch details, working hours, booking rules, tariffs and taxes.">
      @if (dirty()) {<span class="st a">Unsaved changes</span>}
      <button class="btn ghost" [disabled]="!dirty()" (click)="discard()">Discard</button>
      <button class="btn" [disabled]="!dirty()" (click)="save()"><lucide-icon name="save" [size]="16"></lucide-icon>Save settings</button>
    </cf-page-head>
    <div class="lay">
      <div class="card side" style="padding:10px">@for (t of tabs; track t.id) {<button [class.on]="tab() === t.id" (click)="tab.set(t.id)"><lucide-icon [name]="t.icon" [size]="16"></lucide-icon>{{ t.label }}</button>}</div>
      <div class="card">
        @switch (tab()) {
          @case ('general') {
            <div class="card-h"><h3>Hospital profile</h3></div>
            <div class="form-grid">
              <div class="field"><label>Display name</label><input class="inp" [(ngModel)]="c.name" (ngModelChange)="touch()"></div>
              <div class="field"><label>Legal name</label><input class="inp" [(ngModel)]="c.legalName" (ngModelChange)="touch()"></div>
              <div class="field"><label>GSTIN</label><input class="inp" [(ngModel)]="c.gstin" (ngModelChange)="touch()"></div>
              <div class="field"><label>Registration number</label><input class="inp" [(ngModel)]="c.registration" (ngModelChange)="touch()"></div>
              <div class="field"><label>Phone</label><input class="inp" [(ngModel)]="c.phone" (ngModelChange)="touch()"></div>
              <div class="field"><label>Email</label><input class="inp" type="email" [(ngModel)]="c.email" (ngModelChange)="touch()"></div>
              <div class="field" style="grid-column:1/-1"><label>Address</label><input class="inp" [(ngModel)]="c.address" (ngModelChange)="touch()"></div>
            </div>
            <p class="muted small" style="margin-top:10px">The display name appears on prescriptions, invoices, lab reports and the kiosk.</p>
          }
          @case ('hours') {
            <div class="card-h"><h3>OPD working hours</h3><button class="btn ghost sm r" (click)="copyMon()">Copy Monday to all days</button></div>
            <div class="stack-s">@for (h of c.workingHours; track h.day) {
              <div class="hrs"><b>{{ h.day }}</b><input class="inp" type="time" [(ngModel)]="h.open" [disabled]="h.closed" (ngModelChange)="touch()" [attr.aria-label]="h.day + ' opens'"><input class="inp" type="time" [(ngModel)]="h.close" [disabled]="h.closed" (ngModelChange)="touch()" [attr.aria-label]="h.day + ' closes'"><mat-checkbox [checked]="h.closed" (change)="h.closed = !h.closed; touch()">Closed</mat-checkbox></div>
              @if (!h.closed && h.close <= h.open) {<span class="errmsg">Closing time must be after opening time</span>}
            }</div>
          }
          @case ('rules') {
            <div class="card-h"><h3>Appointment rules</h3></div>
            <div class="form-grid">
              <div class="field"><label>Default slot length (minutes)</label><select class="inp" [(ngModel)]="c.apptRules.slotMin" (ngModelChange)="touch()">@for (m of [10, 15, 20, 30]; track m) {<option [ngValue]="m">{{ m }}</option>}</select></div>
              <div class="field"><label>Book up to (days ahead)</label><input class="inp" type="number" min="1" max="180" [(ngModel)]="c.apptRules.maxAdvanceDays" (ngModelChange)="touch()"></div>
              <div class="field"><label>Mark no-show after (minutes)</label><input class="inp" type="number" [(ngModel)]="c.apptRules.noShowAfterMin" (ngModelChange)="touch()"></div>
              <div class="field"><label>Send reminder (hours before)</label><input class="inp" type="number" [(ngModel)]="c.apptRules.reminderHours" (ngModelChange)="touch()"></div>
            </div>
            <mat-slide-toggle [checked]="c.apptRules.allowOverbook" (change)="c.apptRules.allowOverbook = !c.apptRules.allowOverbook; touch()">Allow overbooking with a warning</mat-slide-toggle>
            <div class="card-h" style="margin-top:18px"><h3>Queue rules</h3></div>
            <div class="stack-s">
              <mat-slide-toggle [checked]="c.queueRules.tokenPrefixByDept" (change)="c.queueRules.tokenPrefixByDept = !c.queueRules.tokenPrefixByDept; touch()">Prefix tokens by department (G-012, C-004)</mat-slide-toggle>
              <mat-slide-toggle [checked]="c.queueRules.emergencyJumpsQueue" (change)="c.queueRules.emergencyJumpsQueue = !c.queueRules.emergencyJumpsQueue; touch()">Emergency patients go to the front of the queue</mat-slide-toggle>
              <mat-slide-toggle [checked]="c.queueRules.seniorPriority" (change)="c.queueRules.seniorPriority = !c.queueRules.seniorPriority; touch()">Priority for senior citizens and pregnant women</mat-slide-toggle>
              <div class="field" style="max-width:280px"><label>Raise a delay alert after (minutes)</label><input class="inp" type="number" [(ngModel)]="c.queueRules.delayAlertMin" (ngModelChange)="touch()"></div>
            </div>
          }
          @case ('tariff') {
            <div class="card-h"><h3>Service tariff</h3><span class="r muted small">{{ services().length }} services</span></div>
            <div class="toolbar" style="margin-bottom:10px"><label class="search boxed" style="flex:1;max-width:300px"><lucide-icon name="search" [size]="16"></lucide-icon><input [ngModel]="tq()" (ngModelChange)="tq.set($event)" placeholder="Search services" aria-label="Search services"></label>
              <select class="inp" style="width:auto" [ngModel]="tcat()" (ngModelChange)="tcat.set($event)" aria-label="Category"><option value="">All categories</option>@for (k of tcats(); track k) {<option>{{ k }}</option>}</select></div>
            <div class="tbl"><table class="t"><thead><tr><th>Service</th><th>Category</th><th class="num">Price ₹</th><th class="num">GST %</th></tr></thead><tbody>
              @for (s of services(); track s.id) {<tr><td>{{ s.name }}</td><td>{{ s.category }}</td><td class="num"><input class="inp" style="width:110px;text-align:right" type="number" min="0" [ngModel]="s.price" (ngModelChange)="price(s, $event)" [attr.aria-label]="'Price for ' + s.name"></td><td class="num">{{ s.taxPct }}</td></tr>}
            </tbody></table></div>
          }
          @case ('taxes') {
            <div class="card-h"><h3>Tax rates</h3></div>
            <div class="tbl"><table class="t"><thead><tr><th>Name</th><th>Applies to</th><th class="num">Rate %</th></tr></thead><tbody>
              @for (t of c.taxes; track t.name) {<tr><td><b>{{ t.name }}</b></td><td>{{ t.appliesTo }}</td><td class="num"><input class="inp" style="width:80px;text-align:right" type="number" [(ngModel)]="t.rate" (ngModelChange)="touch()" [attr.aria-label]="t.name + ' rate'"></td></tr>}
            </tbody></table></div>
            <p class="muted small" style="margin-top:10px">Demo rates for illustration. Confirm current GST rules with your tax adviser before go-live.</p>
          }
          @case ('depts') {
            <div class="card-h"><h3>Departments</h3><button class="btn soft-btn sm r" (click)="addDept()"><lucide-icon name="plus" [size]="14"></lucide-icon>Add department</button></div>
            <div class="list">@for (d of store.db.departments; track d.id) {
              <div class="li"><span class="av"><lucide-icon [name]="d.icon" [size]="16"></lucide-icon></span><div class="grow"><input class="inp" style="max-width:320px" [(ngModel)]="d.name" (change)="store.changed()" [attr.aria-label]="'Department name ' + d.id"><span>{{ d.floor }} · {{ doctorsIn(d.id) }} doctors</span></div><span class="muted small">{{ d.id }}</span></div>
            }</div>
          }
          @case ('data') {
            <div class="card-h"><h3>Demo data</h3></div>
            <p>All records in this prototype are fictional and stored only in this browser's local storage.</p>
            <div class="kv" style="margin:12px 0"><div><small>Patients</small><b>{{ store.db.patients.length }}</b></div><div><small>Appointments</small><b>{{ store.db.appointments.length }}</b></div><div><small>Invoices</small><b>{{ store.db.invoices.length }}</b></div><div><small>Audit events</small><b>{{ store.db.audit.length }}</b></div></div>
            <div class="alert-box warn"><lucide-icon name="rotate-ccw" [size]="16"></lucide-icon><div class="grow"><b>Reset demo data</b><div>Restores every screen to the original sample data. Changes you made will be lost.</div></div><button class="btn danger sm" (click)="confirmReset.set(true)">Reset</button></div>
          }
        }
      </div>
    </div>
  </div>
  <cf-modal [open]="confirmReset()" title="Reset all demo data?" (closed)="confirmReset.set(false)">
    <p>This replaces everything in local storage with fresh sample data.</p>
    <div foot><button class="btn ghost" (click)="confirmReset.set(false)">Cancel</button><button class="btn danger" (click)="reset()">Reset demo data</button></div>
  </cf-modal>`
})
export class ConfigPage {
  store = inject(StoreService); toast = inject(ToastService);
  tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'general', label: 'Hospital profile', icon: 'building-2' }, { id: 'hours', label: 'Working hours', icon: 'clock' }, { id: 'rules', label: 'Booking and queue', icon: 'calendar-cog' },
    { id: 'tariff', label: 'Service tariff', icon: 'indian-rupee' }, { id: 'taxes', label: 'Taxes', icon: 'percent' }, { id: 'depts', label: 'Departments', icon: 'layout-grid' }, { id: 'data', label: 'Demo data', icon: 'database' },
  ];
  tab = signal<Tab>('general'); dirty = signal(false); confirmReset = signal(false); tq = signal(''); tcat = signal('');
  c: HospitalConfig = structuredClone(this.store.db.config);
  tcats = computed(() => [...new Set(this.store.db.services.map(s => s.category))]);
  services = computed(() => { this.store.rev(); const q = this.tq().toLowerCase(); return this.store.db.services.filter(s => (!this.tcat() || s.category === this.tcat()) && (!q || s.name.toLowerCase().includes(q))).slice(0, 60); });
  touch() { this.dirty.set(true); }
  save() {
    if (this.c.workingHours.some(h => !h.closed && h.close <= h.open)) { this.toast.err('Fix the working hours before saving'); this.tab.set('hours'); return; }
    if (!this.c.name.trim()) { this.toast.err('Hospital name is required'); this.tab.set('general'); return; }
    this.store.db.config = structuredClone(this.c); this.store.log('Changed', 'Settings', 'Hospital settings updated', 'Sensitive'); this.store.changed(); this.dirty.set(false); this.toast.ok('Settings saved');
  }
  discard() { this.c = structuredClone(this.store.db.config); this.dirty.set(false); this.toast.info('Changes discarded'); }
  copyMon() { const m = this.c.workingHours[0]; this.c.workingHours.forEach(h => { h.open = m.open; h.close = m.close; h.closed = m.closed; }); this.touch(); }
  price(s: ServiceItem, v: number) { s.price = Math.max(0, +v || 0); this.store.log('Changed', 'Tariff', `${s.name} → ₹${s.price}`, 'Sensitive'); this.store.changed(); }
  doctorsIn(id: string) { return this.store.db.doctors.filter(d => d.deptId === id).length; }
  addDept() { const n = this.store.db.departments.length + 1; this.store.db.departments.push({ id: 'NEW' + n, name: 'New department ' + n, icon: 'layout-grid', floor: 'Floor 3' }); this.store.log('Created', 'Department', 'New department ' + n); this.store.changed(); this.toast.ok('Department added. Type a name to rename it.'); }
  reset() { this.store.reset(); this.c = structuredClone(this.store.db.config); this.dirty.set(false); this.confirmReset.set(false); this.toast.ok('Demo data reset'); }
}
