import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ExportService } from '../../core/services/export.service';

type Kind = 'Consultation not billed' | 'Lab test not billed' | 'Imaging not billed' | 'High discount' | 'Unpaid over 3 days' | 'Claim rejected';
interface Leak { id: string; kind: Kind; patientId: string; date: string; detail: string; amount: number; ref: string; }

@Component({
  standalone: true, imports: [SHARED],
  template: `
  <div class="page">
    <cf-page-head title="Revenue leakage" [crumbs]="['Finance', 'Leakage']" sub="Services delivered without an invoice, unusual discounts and money still outstanding. Found by simple rules on the demo data.">
      <button class="btn ghost" (click)="exportCsv()"><lucide-icon name="download" [size]="16"></lucide-icon>Export</button>
    </cf-page-head>
    <div class="grid">
      <cf-stat class="c4" label="Possible leakage" [value]="(total() | inr)" icon="trending-down" tone="red" [sub]="leaks().length + ' items'"></cf-stat>
      <cf-stat class="c4" label="Not billed" [value]="(unbilledTotal() | inr)" icon="receipt" tone="amber" sub="Consultations, lab and imaging"></cf-stat>
      <cf-stat class="c4" label="Reviewed this session" sub="Waived or approved, with reasons logged" [value]="(recovered() | inr)" icon="hand-coins" tone="green"></cf-stat>
    </div>
    <div class="grid">
      <div class="card c5"><div class="card-h"><h3>By source</h3></div>
        @if (byKind().data.length) {<cf-chart type="doughnut" [labels]="byKind().labels" [datasets]="[{ data: byKind().data, backgroundColor: palette }]" [height]="220" [legend]="true"></cf-chart>} @else {<cf-empty icon="circle-check" title="Nothing to recover"></cf-empty>}
      </div>
      <div class="card c7"><div class="card-h"><h3>What the rules check</h3></div>
        <div class="list">@for (r of rules; track r.k) {<div class="li"><lucide-icon [name]="r.icon" [size]="16"></lucide-icon><div class="grow"><b>{{ r.k }}</b><span>{{ r.d }}</span></div><b>{{ count(r.k) }}</b></div>}</div>
      </div>
    </div>
    <div class="card">
      <div class="toolbar" style="margin-bottom:12px"><div class="chips"><button class="chip" [class.on]="!kind()" (click)="kind.set('')">All</button>@for (r of rules; track r.k) {<button class="chip" [class.on]="kind() === r.k" (click)="kind.set(r.k)">{{ r.k }}</button>}</div></div>
      <cf-table [rows]="rows()" [cols]="cols" emptyIcon="circle-check" emptyTitle="No leakage found" emptyText="Every delivered service in this filter has been billed.">
        <ng-template cfCell="patient" let-l><a class="linkbtn" [routerLink]="['/patients', l.patientId]">{{ store.pname(l.patientId) }}</a></ng-template>
        <ng-template cfCell="kind" let-l><cf-status [s]="l.kind" [tone]="l.kind.includes('billed') ? 'a' : l.kind === 'High discount' ? 'v' : 'r'"></cf-status></ng-template>
        <ng-template cfCell="amount" let-l><b>{{ l.amount | inr }}</b></ng-template>
        <ng-template cfCell="act" let-l><div class="row nowrap">
          @if (l.kind.includes('billed')) {<button class="btn sm" (click)="bill(l)">Create invoice</button><button class="btn ghost sm" (click)="waive.set(l)">Waive</button>}
          @else if (l.kind === 'Unpaid over 3 days') {<button class="btn sm" (click)="remind(l)">Send reminder</button><a class="btn ghost sm" [routerLink]="['/billing/invoice', l.ref]">Open</a>}
          @else if (l.kind === 'Claim rejected') {<a class="btn sm" routerLink="/insurance">Review claim</a>}
          @else {<a class="btn ghost sm" [routerLink]="['/billing/invoice', l.ref]">Review</a><button class="btn ghost sm" (click)="approve(l)">Mark approved</button>}
        </div></ng-template>
      </cf-table>
    </div>
  </div>
  <cf-modal [open]="!!waive()" title="Waive this charge?" (closed)="waive.set(null)">
    <p>{{ waive()?.detail }} · {{ waive()?.amount | inr }}</p>
    <div class="field"><label>Reason (recorded in the audit log)</label><select class="inp" [(ngModel)]="reason"><option>Free follow-up within 7 days</option><option>Staff or family concession</option><option>Charity case</option><option>Duplicate order</option></select></div>
    <div foot><button class="btn ghost" (click)="waive.set(null)">Cancel</button><button class="btn" (click)="doWaive()">Waive charge</button></div>
  </cf-modal>`
})
export class LeakagePage {
  store = inject(StoreService); toast = inject(ToastService); exp = inject(ExportService); router = inject(Router);
  kind = signal(''); waive = signal<Leak | null>(null); reason = 'Free follow-up within 7 days'; recovered = signal(0);
  private ok = signal<string[]>([]);
  palette = ['--amber', '--blue', '--violet', '--pink', '--red', '--pri'];
  rules: { k: Kind; d: string; icon: string }[] = [
    { k: 'Consultation not billed', d: 'Completed consultation with no invoice line', icon: 'stethoscope' },
    { k: 'Lab test not billed', d: 'Lab order with billed flag off', icon: 'flask-conical' },
    { k: 'Imaging not billed', d: 'Imaging study with billed flag off', icon: 'scan-line' },
    { k: 'High discount', d: 'Invoice discount above 10%', icon: 'percent' },
    { k: 'Unpaid over 3 days', d: 'Balance due on an invoice older than 3 days', icon: 'clock' },
    { k: 'Claim rejected', d: 'Insurance claim rejected and not appealed', icon: 'shield-alert' },
  ];
  cols = [{ key: 'date', label: 'Date' }, { key: 'patient', label: 'Patient', value: (l: Leak) => this.store.pname(l.patientId) }, { key: 'kind', label: 'Issue' }, { key: 'detail', label: 'Detail', sortable: false }, { key: 'amount', label: 'Amount', align: 'right' as const }, { key: 'act', label: '', sortable: false }];
  leaks = computed<Leak[]>(() => {
    this.store.rev(); const s = this.store; const out: Leak[] = []; const old = s.day(-3);
    s.db.consultations.filter(c => c.status === 'Completed' && !c.billed).forEach(c => out.push({ id: c.id, kind: 'Consultation not billed', patientId: c.patientId, date: c.date, detail: `Consultation with ${s.dname(c.doctorId)}`, amount: s.doctor(c.doctorId)?.fee || 0, ref: c.id }));
    s.db.labOrders.filter(o => !o.billed).forEach(o => out.push({ id: o.id, kind: 'Lab test not billed', patientId: o.patientId, date: o.date, detail: s.names(o.testIds), amount: o.testIds.reduce((t, id) => t + (s.test(id)?.price || 0), 0), ref: o.id }));
    s.db.imaging.filter(o => !o.billed).forEach(o => out.push({ id: o.id, kind: 'Imaging not billed', patientId: o.patientId, date: o.date, detail: o.study, amount: o.price, ref: o.id }));
    s.db.invoices.forEach(i => { const t = s.invoiceTotals(i);
      if (i.discountPct > 10) out.push({ id: 'D' + i.id, kind: 'High discount', patientId: i.patientId, date: i.date, detail: `${i.id}: ${i.discountPct}% discount`, amount: Math.round(t.sub * i.discountPct / 100), ref: i.id });
      if (t.due > 0 && i.date < old && i.status !== 'Cancelled' && !i.claimId) out.push({ id: 'U' + i.id, kind: 'Unpaid over 3 days', patientId: i.patientId, date: i.date, detail: `${i.id} balance due`, amount: t.due, ref: i.id }); });
    s.db.claims.filter(c => c.status === 'Rejected').forEach(c => out.push({ id: c.id, kind: 'Claim rejected', patientId: c.patientId, date: c.created, detail: `${c.id}: ${c.rejectionReason || 'Rejected'}`, amount: c.claimed, ref: c.id }));
    return out.filter(l => !this.ok().includes(l.id)).sort((a, b) => b.date.localeCompare(a.date));
  });
  rows = computed(() => this.leaks().filter(l => !this.kind() || l.kind === this.kind()));
  total = computed(() => this.leaks().reduce((t, l) => t + l.amount, 0));
  unbilledTotal = computed(() => this.leaks().filter(l => l.kind.includes('billed')).reduce((t, l) => t + l.amount, 0));
  byKind = computed(() => { const m = new Map<string, number>(); this.leaks().forEach(l => m.set(l.kind, (m.get(l.kind) || 0) + l.amount)); return { labels: [...m.keys()], data: [...m.values()] }; });
  count(k: Kind) { return this.leaks().filter(l => l.kind === k).length; }
  bill(l: Leak) { this.router.navigate(['/billing/new'], { queryParams: { patient: l.patientId } }); }
  doWaive() { const l = this.waive()!; this.markBilled(l); this.recovered.update(v => v + l.amount); this.store.log('Waived', 'Charge', `${l.detail} ₹${l.amount}: ${this.reason}`, 'Sensitive'); this.store.changed(); this.toast.ok('Charge waived and logged'); this.waive.set(null); }
  private markBilled(l: Leak) { const s = this.store.db;
    if (l.kind === 'Consultation not billed') { const c = s.consultations.find(x => x.id === l.ref); if (c) c.billed = true; }
    else if (l.kind === 'Lab test not billed') { const o = s.labOrders.find(x => x.id === l.ref); if (o) o.billed = true; }
    else if (l.kind === 'Imaging not billed') { const o = s.imaging.find(x => x.id === l.ref); if (o) o.billed = true; } }
  remind(l: Leak) { this.store.notify('WhatsApp', 'Payment reminder', l.patientId, `A balance of ₹${new Intl.NumberFormat('en-IN').format(l.amount)} is due on ${l.ref}. Pay by UPI on the patient app.`); this.store.changed(); this.toast.ok('Payment reminder sent (simulated)'); }
  approve(l: Leak) { this.ok.update(v => [...v, l.id]); this.recovered.update(v => v + l.amount); this.store.log('Approved', 'Discount', l.detail, 'Sensitive'); this.store.changed(); this.toast.ok('Discount approved and logged'); }
  exportCsv() { this.exp.csv('revenue-leakage', this.rows().map(l => ({ Date: l.date, Patient: this.store.pname(l.patientId), Issue: l.kind, Detail: l.detail, Amount: l.amount }))); }
}
