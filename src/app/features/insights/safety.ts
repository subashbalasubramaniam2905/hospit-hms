import { Component, computed, inject, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { safetyCheck, SafetyAlert } from '../../core/data/clinical';
import { Prescription } from '../../core/models';
import { SessionService } from '../../core/services/session.service';
import { LIVE } from '../../core/api/api-config';
import { InsightsApi, SSafety, SSafetyRow, scopeBranch } from '../../core/api/insights-api';

/** One alert, from the demo rules or from the server. */
interface View { key: string; level: SafetyAlert['level']; kind: string; title: string; detail: string; rxId: string; patientId: string; patientName: string; doctorName: string; status: string; medicines: string; row?: Row; live?: SSafetyRow; }

interface Row extends SafetyAlert { key: string; rx: Prescription; }

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.sa { display:flex; gap:12px; padding:14px; border-radius:14px; border:1px solid var(--line); align-items:flex-start; background:var(--card) } .sa .ic { width:36px; height:36px; border-radius:10px; display:grid; place-items:center; flex:none }
  .sa.crit .ic { background:var(--red-soft); color:var(--red) } .sa.warn .ic { background:var(--amber-soft); color:color-mix(in srgb,var(--amber) 70%,var(--fg)) } .sa.info .ic { background:var(--blue-soft); color:var(--blue) }`],
  template: `
  <div class="page">
    <cf-page-head title="Clinical safety" [crumbs]="['Insights', 'Medication safety']" [sub]="isLive ? 'The prescribing safety rules run again across prescriptions from the last 30 days that are not fully dispensed: allergies, interactions, duplicates, doses and conditions.' : 'Demo safety rules run across active prescriptions: allergies, interactions, duplicates, doses, conditions and potassium.'"></cf-page-head>
    <div class="alert-box crit"><lucide-icon name="shield-alert" [size]="16"></lucide-icon><div><b>{{ isLive ? 'Rule-based alerts' : 'Demo alerts' }}, not validated clinical decision support.</b> {{ isLive ? 'These rules are simplified and not a validated drug database.' : 'These rules are simplified examples for the prototype.' }} They can miss real problems and flag safe combinations. Prescribers and pharmacists make every decision.</div></div>
    <div class="grid">
      <cf-stat class="c3" label="Critical" [value]="lvl('crit')" icon="octagon-alert" tone="red" [clickable]="true" (click)="level.set('crit')"></cf-stat>
      <cf-stat class="c3" label="Warnings" [value]="lvl('warn')" icon="triangle-alert" tone="amber" [clickable]="true" (click)="level.set('warn')"></cf-stat>
      <cf-stat class="c3" label="Prescriptions checked" [value]="checked()" icon="file-check" tone="pri" sub="Last 30 days, not yet dispensed"></cf-stat>
      <cf-stat class="c3" label="Patients with allergies" [value]="allergic()" icon="hand-heart" tone="violet"></cf-stat>
    </div>
    <div class="grid">
      <div class="card c8">
        <div class="toolbar" style="margin-bottom:12px"><div class="seg"><button [class.on]="!level()" (click)="level.set('')">All</button><button [class.on]="level() === 'crit'" (click)="level.set('crit')">Critical</button><button [class.on]="level() === 'warn'" (click)="level.set('warn')">Warning</button><button [class.on]="level() === 'info'" (click)="level.set('info')">Info</button></div>
          <div class="chips">@for (k of kinds; track k) {<button class="chip" [class.on]="kind() === k" (click)="kind.set(kind() === k ? '' : k)">{{ k }}</button>}</div></div>
        <div class="stack-s">
          @for (a of rows(); track a.key) {
            <div class="sa {{ a.level }}"><span class="ic"><lucide-icon [name]="a.level === 'crit' ? 'octagon-alert' : a.level === 'warn' ? 'triangle-alert' : 'info'" [size]="18"></lucide-icon></span>
              <div class="grow"><div class="row"><b>{{ a.title }}</b><span class="demo-tag">{{ isLive ? 'Rule' : 'Demo rule' }}</span></div><div class="muted small">{{ a.detail }}</div>
                <div class="small" style="margin-top:6px"><a class="linkbtn" [routerLink]="['/patients', a.patientId]">{{ a.patientName }}</a> · {{ isLive ? a.rxId.slice(0, 8) : a.rxId }} · {{ a.doctorName }} · <cf-status [s]="a.status"></cf-status>@if (a.live?.overrideReason) { · <span class="muted">Overridden: {{ a.live!.overrideReason }}</span>}</div></div>
              <div class="stack-s"><button class="btn sm" (click)="review.set(a)">Review</button></div>
            </div>
          } @empty { <cf-empty icon="shield-check" title="No alerts in this view" text="The demo rules found nothing for this filter."></cf-empty> }
        </div>
      </div>
      <div class="stack c4">
        <div class="card"><div class="card-h"><h3>By rule type</h3></div>
          @if (byKind().data.length) {<cf-chart type="bar" [labels]="byKind().labels" [datasets]="[{ label: 'Alerts', data: byKind().data, backgroundColor: '--red', borderRadius: 6 }]" [height]="200"></cf-chart>} @else {<cf-empty icon="shield-check" title="No alerts"></cf-empty>}
        </div>
        <div class="card"><div class="card-h"><h3>Reviewed this session</h3></div>
          <div class="list">@for (r of reviewed(); track $index) {<div class="li"><lucide-icon name="circle-check" [size]="16"></lucide-icon><div class="grow"><b>{{ r.title }}</b><span>{{ r.note }}</span></div></div>} @empty {<p class="muted small">Nothing reviewed yet.</p>}</div>
        </div>
      </div>
    </div>
  </div>
  <cf-modal [open]="!!review()" [title]="review()?.title || ''" (closed)="review.set(null)">
    @if (review(); as a) {
      <p>{{ a.detail }}</p>
      <div class="kv"><div><small>Patient</small><b>{{ a.patientName }}</b></div><div><small>Prescription</small><b>{{ isLive ? a.rxId.slice(0, 8) : a.rxId }}</b></div><div><small>Medicines</small><b>{{ a.medicines }}</b></div></div>
      <div class="field"><label>Outcome</label><select class="inp" [(ngModel)]="outcome"><option>Prescriber contacted, change agreed</option><option>Prescriber confirmed, continue with monitoring</option><option>Not relevant for this patient</option>@if (!isLive) {<option>Prescription put on hold</option>}</select></div>
      <div class="field"><label>Note</label><textarea class="inp" rows="2" [(ngModel)]="note" placeholder="Optional"></textarea></div>
    }
    <div foot><button class="btn ghost" (click)="review.set(null)">Cancel</button><button class="btn" (click)="save()">Record review</button></div>
  </cf-modal>`
})
export class SafetyPage {
  store = inject(StoreService); toast = inject(ToastService);
  kinds = ['Allergy', 'Interaction', 'Duplicate', 'Dose', 'Condition', 'Lab'];
  level = signal(''); kind = signal(''); review = signal<View | null>(null); reviewed = signal<{ title: string; note: string }[]>([]); private done = signal<string[]>([]);
  outcome = 'Prescriber contacted, change agreed'; note = '';
  session = inject(SessionService); readonly isLive = LIVE; private api = inject(InsightsApi);
  private live = signal<SSafety | null>(null);
  constructor() { if (LIVE) this.reload(); }
  private async reload() {
    try { this.live.set(await this.api.safety(scopeBranch(this.session))); }
    catch { this.toast.err('Could not load the safety review'); }
  }
  checked = computed(() => this.live()?.checked ?? this.active().length);
  active = computed(() => { this.store.rev(); const since = this.store.day(-30); return this.store.db.prescriptions.filter(r => r.date >= since && r.status !== 'Dispensed'); });
  all = computed<Row[]>(() => this.active().flatMap(rx => { const p = this.store.patient(rx.patientId); const labs = this.store.db.labOrders.filter(o => o.patientId === rx.patientId);
    return safetyCheck(p, rx.items, labs).map((a, i) => ({ ...a, rx, key: rx.id + ':' + i })); }).filter(r => !this.done().includes(r.key)));
  /** Both sources in one shape. */
  views = computed<View[]>(() => {
    const L = this.live();
    if (L) return L.alerts.map(a => ({ key: a.key, level: a.level === 'Critical' ? 'crit' : a.level === 'Warning' ? 'warn' : 'info', kind: a.kind, title: a.title, detail: a.detail, rxId: a.prescriptionId,
      patientId: a.patientId, patientName: a.patientName, doctorName: a.doctorName, status: a.status, medicines: a.medicines.join(', '), live: a }));
    if (LIVE) return [];
    return this.all().map(r => ({ key: r.key, level: r.level, kind: r.kind, title: r.title, detail: r.detail, rxId: r.rx.id, patientId: r.rx.patientId, patientName: this.store.pname(r.rx.patientId),
      doctorName: this.store.dname(r.rx.doctorId), status: r.rx.status, medicines: this.meds(r.rx), row: r }));
  });
  rows = computed(() => { const o = { crit: 0, warn: 1, info: 2 }; return this.views().filter(a => (!this.level() || a.level === this.level()) && (!this.kind() || a.kind === this.kind())).sort((x, y) => o[x.level] - o[y.level]); });
  byKind = computed(() => { const m = new Map<string, number>(); this.views().forEach(a => m.set(a.kind, (m.get(a.kind) || 0) + 1)); return { labels: [...m.keys()], data: [...m.values()] }; });
  allergic = computed(() => { const L = this.live(); if (L) return L.patientsWithAllergies; this.store.rev(); return this.store.db.patients.filter(p => p.allergies.length).length; });
  lvl(l: SafetyAlert['level']) { return this.views().filter(a => a.level === l).length; }
  meds(rx: Prescription) { return rx.items.map(i => i.name).join(', '); }
  async save() {
    const v = this.review()!;
    if (v.live) {
      try { await this.api.safetyReview(v.live.prescriptionId, v.live.alertCode, this.outcome, this.note.trim()); }
      catch { this.toast.err('Could not record the review'); return; }
      this.reviewed.update(x => [{ title: v.title, note: this.outcome }, ...x]); this.toast.ok('Review recorded'); this.note = ''; this.review.set(null); await this.reload(); return;
    }
    const a = v.row!; const hold = this.outcome === 'Prescription put on hold';
    if (hold) a.rx.status = 'Draft';
    this.done.update(v => [...v, a.key]); this.reviewed.update(v => [{ title: a.title, note: this.outcome }, ...v]);
    this.store.log('Reviewed', 'Safety alert', `${a.rx.id} · ${a.title}: ${this.outcome}${this.note ? ' · ' + this.note : ''}`, a.level === 'crit' ? 'Sensitive' : 'Normal'); this.store.changed();
    this.toast.ok(hold ? 'Prescription put on hold and review recorded' : 'Review recorded'); this.note = ''; this.review.set(null);
  }
}
