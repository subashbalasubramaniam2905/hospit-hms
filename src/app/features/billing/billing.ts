import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED, fmtDate } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ExportService } from '../../core/services/export.service';
import { BillingService } from '../../core/services/billing.service';
import { apiError } from '../../core/api/billing-api';
import { Invoice, PayMode } from '../../core/models';

@Component({
  standalone: true, imports: [SHARED],
  template: `
  <div class="page">
    <cf-page-head title="Billing" [crumbs]="['Finance', 'Billing overview']" sub="OPD, IPD, pharmacy and lab invoices with payments and refunds.">
      @if (bill.live) { <button class="btn ghost" (click)="reload()" [disabled]="bill.loading()"><lucide-icon name="rotate-ccw" [size]="16"></lucide-icon>Refresh</button> }
      <button class="btn ghost" (click)="exportCsv()"><lucide-icon name="download" [size]="16"></lucide-icon>Export</button>
      <a class="btn" routerLink="/billing/new"><lucide-icon name="plus" [size]="16"></lucide-icon>New invoice</a>
    </cf-page-head>
    <div class="grid">
      <cf-stat class="c3" label="Collected today" [value]="(k().collected | inr)" icon="wallet" tone="pri" [sub]="k().countToday + ' invoices today'"></cf-stat>
      <cf-stat class="c3" label="Outstanding" [value]="(k().due | inr)" icon="hourglass" tone="red" [clickable]="true" (click)="status.set('Unpaid')" [sub]="k().unpaid + ' unpaid or partly paid'"></cf-stat>
      <cf-stat class="c3" label="Insurance receivable" [value]="(k().ins | inr)" icon="shield-check" tone="blue" [clickable]="true" (click)="router.navigate(['/insurance'])" sub="claims awaiting settlement"></cf-stat>
      <cf-stat class="c3" label="Refunds this month" [value]="(k().refunds | inr)" icon="rotate-ccw" tone="amber"></cf-stat>
      <div class="card c8"><div class="card-h"><h3>Collections, last 7 days</h3><span class="muted small">excluding IPD advances</span><span class="r legend"><span><i style="background:var(--pri)"></i>OPD</span><span><i style="background:var(--blue)"></i>Pharmacy</span><span><i style="background:var(--amber)"></i>Lab</span><span><i style="background:var(--violet)"></i>IPD</span></span></div>
        <cf-chart type="bar" [labels]="week().labels" [datasets]="week().sets" [height]="230" [options]="{ scales: { x: { stacked: true }, y: { stacked: true } } }"></cf-chart></div>
      <div class="card c4"><div class="card-h"><h3>By payment mode</h3><span class="r muted small">today</span></div>
        <cf-chart type="doughnut" [labels]="modes().labels" [datasets]="[{ data: modes().data, backgroundColor: ['--pri', '--blue', '--amber', '--violet', '--pink', '--green'] }]" [height]="200" [legend]="true"></cf-chart></div>
      @if (bill.error()) { <div class="card c12"><div class="alert-box crit"><lucide-icon name="circle-x" [size]="16"></lucide-icon><div>{{ bill.error() }}</div></div></div> }
      @if (!bill.live && unbilled().length) {
      <div class="card c12"><div class="alert-box warn"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon><div style="flex:1"><b>{{ unbilled().length }} completed consultations have no invoice</b><div>Possible revenue leakage worth {{ unbilledValue() | inr }}.</div></div><a class="btn sm" routerLink="/revenue-leakage">Review</a></div></div>
      }
      <div class="card c12">
        <div class="toolbar" style="margin-bottom:12px">
          <label class="search boxed" style="flex:1;max-width:320px"><lucide-icon name="search" [size]="16"></lucide-icon><input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Invoice number or patient" aria-label="Search invoices"></label>
          <div class="chips">@for (s of statuses; track s) {<button class="chip" [class.on]="status() === s" (click)="status.set(s)">{{ s }}</button>}</div>
          <select class="inp" style="width:auto" [ngModel]="kind()" (ngModelChange)="kind.set($event)" aria-label="Type"><option value="">All types</option><option>OPD</option><option>IPD</option><option>Pharmacy</option><option>Lab</option></select>
        </div>
        <cf-table [rows]="rows()" [cols]="cols" [clickable]="true" (rowClick)="router.navigate(['/billing/invoice', $event.id])" [pageSize]="10">
          <ng-template cfCell="patient" let-i><div class="pname"><cf-avatar [name]="bill.pname(i)"></cf-avatar><div>{{ bill.pname(i) }}<small>{{ bill.label(i) }}</small></div></div></ng-template>
          <ng-template cfCell="date" let-i>{{ i.date | d:true }}</ng-template>
          <ng-template cfCell="total" let-i><b>{{ bill.totals(i).total | inr }}</b></ng-template>
          <ng-template cfCell="due" let-i><span [style.color]="bill.totals(i).due > 0 ? 'var(--red)' : ''">{{ bill.totals(i).due | inr }}</span></ng-template>
          <ng-template cfCell="status" let-i><cf-status [s]="i.status"></cf-status></ng-template>
          <ng-template cfCell="act" let-i>@if (bill.totals(i).due > 0) {<button class="btn soft-btn sm" (click)="$event.stopPropagation(); payOpen.set(i); payAmt = bill.totals(i).due">Collect</button>}</ng-template>
        </cf-table>
      </div>
    </div>
  </div>
  <cf-drawer [open]="!!payOpen()" title="Collect payment" [sub]="payOpen() ? bill.label(payOpen()!) : ''" (closed)="payOpen.set(null)">
    @if (payOpen(); as i) {
      <div class="kv"><div><small>Patient</small><b>{{ bill.pname(i) }}</b></div><div><small>Balance due</small><b>{{ bill.totals(i).due | inr }}</b></div></div>
      <div class="field"><label>Mode</label><div class="chips">@for (m of payModes; track m) {<button class="chip" [class.on]="payMode === m" (click)="payMode = m">{{ m }}</button>}</div></div>
      <div class="field"><label>Amount</label><input class="inp" type="number" [(ngModel)]="payAmt"></div>
      @if (payMode === 'UPI') { <div class="soft small">A UPI collect request will be sent to the patient's mobile <span class="sim">Simulated</span></div> }
      @if (payMode === 'Card') { <div class="soft small">Card machine at counter 2 will show the amount <span class="sim">Simulated</span></div> }
    }
    <div foot><button class="btn ghost" (click)="payOpen.set(null)">Cancel</button><button class="btn" [disabled]="busy()" (click)="collect()">Record payment</button></div>
  </cf-drawer>`
})
export class BillingPage {
  store = inject(StoreService); bill = inject(BillingService); toast = inject(ToastService); router = inject(Router); exp = inject(ExportService);
  statuses = ['All', 'Unpaid', 'Partially paid', 'Paid', 'Refunded']; payModes: PayMode[] = ['Cash', 'UPI', 'Card', 'Bank transfer', 'Advance'];
  q = signal(''); status = signal('All'); kind = signal(''); payOpen = signal<Invoice | null>(null); payAmt = 0; payMode: PayMode = 'UPI'; busy = signal(false);
  cols = [
    { key: 'patient', label: 'Invoice', value: (i: Invoice) => this.bill.pname(i) }, { key: 'date', label: 'Date' }, { key: 'kind', label: 'Type' },
    { key: 'total', label: 'Amount', align: 'right' as const, value: (i: Invoice) => this.bill.totals(i).total }, { key: 'due', label: 'Due', align: 'right' as const, value: (i: Invoice) => this.bill.totals(i).due },
    { key: 'status', label: 'Status' }, { key: 'act', label: '', sortable: false },
  ];
  all = computed(() => { if (this.bill.live) return this.bill.invoices(); this.store.rev(); return this.store.db.invoices; });
  constructor() { this.reload(); }
  reload() { this.bill.loadInvoices().catch(e => this.bill.error.set(apiError(e, 'Could not load invoices'))); }
  rows = computed(() => { const q = this.q().toLowerCase(), s = this.status(); return this.all().filter(i => (s === 'All' || i.status === s) && (!this.kind() || i.kind === this.kind()) && (!q || this.bill.label(i).toLowerCase().includes(q) || i.patientId.toLowerCase().includes(q) || this.bill.pname(i).toLowerCase().includes(q))).sort((a, b) => b.date.localeCompare(a.date)); });
  k = computed(() => {
    const sm = this.bill.summary();
    if (this.bill.live) return { collected: sm?.collectedToday ?? 0, due: sm?.outstanding ?? 0, refunds: sm?.refundsThisMonth ?? 0, unpaid: sm?.outstandingCount ?? 0, ins: sm?.insuranceReceivable ?? 0, countToday: sm?.invoicesToday ?? 0 };
    const today = this.store.today(), month = today.slice(0, 7); let collected = 0, due = 0, refunds = 0, unpaid = 0;
    this.all().forEach(i => { const t = this.bill.totals(i); i.payments.forEach(p => { if (p.date === today && p.mode !== 'Insurance') collected += p.amount; }); if (t.due > 0 && i.status !== 'Cancelled') { due += t.due; unpaid++; } i.refunds.forEach(r => { if (r.date.startsWith(month)) refunds += r.amount; }); });
    const ins = this.store.db.claims.filter(c => ['Submitted', 'Under review', 'Approved'].includes(c.status)).reduce((t, c) => t + (c.approved || c.claimed), 0);
    return { collected, due, refunds, unpaid, ins, countToday: this.all().filter(i => i.date === today).length };
  });
  week = computed(() => {
    const sm = this.bill.summary();
    if (this.bill.live) { const ks = ['OPD', 'PHARMACY', 'LAB', 'IPD'] as const, labels = ['OPD', 'Pharmacy', 'Lab', 'IPD'], colors = ['--pri', '--blue', '--amber', '--violet']; const days = sm?.last7Days ?? []; return { labels: days.map(d => fmtDate(d.date)), sets: ks.map((k, n) => ({ label: labels[n], backgroundColor: colors[n], borderRadius: 4, data: days.map(d => d.byKind[k] ?? 0) })) }; }
    const days = Array.from({ length: 7 }, (_, i) => this.store.day(i - 6)); const kinds: Invoice['kind'][] = ['OPD', 'Pharmacy', 'Lab', 'IPD']; const colors = ['--pri', '--blue', '--amber', '--violet'];
    return { labels: days.map(d => fmtDate(d)), sets: kinds.map((k, n) => ({ label: k, backgroundColor: colors[n], borderRadius: 4, data: days.map(d => this.all().filter(i => i.kind === k).reduce((t, i) => t + i.payments.filter(p => p.date === d && p.mode !== 'Advance').reduce((s, p) => s + p.amount, 0), 0)) })) };
  });
  modes = computed(() => { const sm = this.bill.summary(); if (this.bill.live) { const names: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK_TRANSFER: 'Bank transfer', ONLINE: 'Online', INSURANCE: 'Insurance', ADVANCE: 'Advance' }; const e = Object.entries(sm?.byModeToday ?? {}); return { labels: e.map(x => names[x[0]] ?? x[0]), data: e.map(x => x[1]) }; } const m = new Map<string, number>(); this.all().forEach(i => i.payments.filter(p => p.date === this.store.today()).forEach(p => m.set(p.mode, (m.get(p.mode) || 0) + p.amount))); return { labels: [...m.keys()], data: [...m.values()] }; });
  unbilled = computed(() => { this.store.rev(); return this.store.db.consultations.filter(c => c.status === 'Completed' && !c.billed); });
  unbilledValue = computed(() => this.unbilled().reduce((t, c) => t + (this.store.doctor(c.doctorId)?.fee || 0), 0));
  async collect() {
    const i = this.payOpen()!; const due = this.bill.totals(i).due;
    if (!this.payAmt || this.payAmt <= 0) { this.toast.err('Enter an amount'); return; } if (this.payAmt > due) { this.toast.err(`Amount is more than the balance of ₹${due}`); return; }
    this.busy.set(true);
    try {
      await this.bill.pay(i, this.payMode, this.payAmt);
      this.toast.ok(`₹${new Intl.NumberFormat('en-IN').format(this.payAmt)} received by ${this.payMode}.` + (this.bill.live ? '' : ' Receipt sent (simulated).')); this.payOpen.set(null);
      if (this.bill.live) this.reload();
    } catch (e) { this.toast.err(apiError(e)); } finally { this.busy.set(false); }
  }
  exportCsv() { this.exp.csv('invoices', this.rows().map(i => { const t = this.bill.totals(i); return { Invoice: this.bill.label(i), Date: i.date, Patient: this.bill.pname(i), Type: i.kind, Total: t.total, Paid: t.paid, Due: t.due, Status: i.status }; })); }
}
