import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ExportService } from '../../core/services/export.service';
import { Medicine, StockMove } from '../../core/models';
import { SessionService } from '../../core/services/session.service';
import { PharmacyApi, LiveMedicine } from '../../core/api/pharmacy-api';
import { LiveSync } from '../../core/api/live-sync';
import { apiMessage } from '../../core/api/auth.service';

type Tab = 'stock' | 'expiry' | 'moves';

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.bt { width:100%; border-collapse:collapse; font-size:13px } .bt td, .bt th { padding:8px 10px; border-bottom:1px solid var(--line); text-align:left } .bt th { color:var(--mut); font-weight:600; font-size:12px }`],
  template: `
  <div class="page">
    <cf-page-head title="Pharmacy stock" [crumbs]="['Pharmacy', 'Inventory']" sub="Batch-wise stock with first-expiry-first-out dispensing.">
      <button class="btn ghost" (click)="exportCsv()"><lucide-icon name="download" [size]="16"></lucide-icon>Export</button>
      <button class="btn" (click)="reorderLow()"><lucide-icon name="truck" [size]="16"></lucide-icon>Reorder low stock</button>
    </cf-page-head>
    <div class="grid">
      <cf-stat class="c3" label="Medicines in formulary" [value]="store.db.medicines.length" icon="pill" tone="pri" [sub]="batches() + ' active batches'"></cf-stat>
      <cf-stat class="c3" label="Low or out of stock" [value]="low().length" icon="triangle-alert" tone="red" [clickable]="true" (click)="tab.set('stock'); filter.set('Low')" [sub]="out() + ' out of stock'"></cf-stat>
      <cf-stat class="c3" label="Expiring in 90 days" [value]="expiring().length" icon="hourglass" tone="amber" [clickable]="true" (click)="tab.set('expiry')" sub="batches to use first or return"></cf-stat>
      <cf-stat class="c3" label="Stock value at cost" [value]="(value() | inr:true)" icon="indian-rupee" tone="blue"></cf-stat>
    </div>
    <div class="tabs">
      <button [class.on]="tab() === 'stock'" (click)="tab.set('stock')">Stock</button>
      <button [class.on]="tab() === 'expiry'" (click)="tab.set('expiry')">Expiry watch · {{ expiring().length }}</button>
      <button [class.on]="tab() === 'moves'" (click)="tab.set('moves')">Movements</button>
    </div>
    @switch (tab()) {
    @case ('stock') {
      <div class="card">
        <div class="toolbar" style="margin-bottom:12px">
          <label class="search boxed" style="flex:1;max-width:320px"><lucide-icon name="search" [size]="16"></lucide-icon><input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Generic, brand or rack" aria-label="Search stock"></label>
          <div class="chips">@for (f of ['All', 'Low', 'Out', 'Expiring']; track f) {<button class="chip" [class.on]="filter() === f" (click)="filter.set(f)">{{ f }}</button>}</div>
          <select class="inp" style="width:auto" [ngModel]="cat()" (ngModelChange)="cat.set($event)" aria-label="Category"><option value="">All categories</option>@for (c of cats(); track c) {<option>{{ c }}</option>}</select>
        </div>
        <cf-table [rows]="rows()" [cols]="cols" [clickable]="true" (rowClick)="sel.set($event)" [pageSize]="12">
          <ng-template cfCell="name" let-m><div><b>{{ m.brand }} {{ m.strength }}</b><div class="small muted">{{ m.generic }} · {{ m.form }}</div></div></ng-template>
          <ng-template cfCell="stock" let-m><b class="tnum">{{ store.stock(m) }}</b> <span class="muted small">/ reorder {{ m.reorder }}</span></ng-template>
          <ng-template cfCell="expiry" let-m>{{ nearest(m) | d:true }}</ng-template>
          <ng-template cfCell="state" let-m><cf-status [s]="state(m)" [tone]="tone(m)"></cf-status></ng-template>
          <ng-template cfCell="price" let-m>{{ m.price | inr }}</ng-template>
        </cf-table>
      </div>
    }
    @case ('expiry') {
      <div class="card">
        <cf-table [rows]="expiring()" [cols]="expCols" [pageSize]="12" emptyTitle="Nothing expiring soon">
          <ng-template cfCell="med" let-r><b>{{ r.m.brand }} {{ r.m.strength }}</b></ng-template>
          <ng-template cfCell="expiry" let-r><span [style.color]="r.days < 30 ? 'var(--red)' : ''">{{ r.b.expiry | d:true }} · {{ r.days }} days</span></ng-template>
          <ng-template cfCell="value" let-r>{{ r.b.qty * r.b.cost | inr }}</ng-template>
          <ng-template cfCell="act" let-r><button class="btn ghost sm" (click)="returnBatch(r.m, r.b.batch, r.b.qty)">Return to supplier</button></ng-template>
        </cf-table>
      </div>
    }
    @case ('moves') {
      <div class="card">
        <cf-table [rows]="moves()" [cols]="moveCols" [pageSize]="14">
          <ng-template cfCell="qty" let-r><b [style.color]="r.qty < 0 ? 'var(--red)' : 'var(--green)'">{{ r.qty > 0 ? '+' : '' }}{{ r.qty }}</b></ng-template>
          <ng-template cfCell="kind" let-r><cf-status [s]="r.kind" [tone]="r.kind === 'Receipt' ? 'ok' : r.kind === 'Dispense' ? 'b' : 'a'"></cf-status></ng-template>
        </cf-table>
      </div>
    }
    }
  </div>

  <cf-drawer [open]="!!sel()" [title]="sel() ? sel()!.brand + ' ' + sel()!.strength : ''" [sub]="sel() ? sel()!.generic + ' · ' + sel()!.category + ' · Rack ' + sel()!.rack : ''" width="min(560px,100%)" (closed)="sel.set(null); mode.set('')">
    @if (sel(); as m) {
      <div class="kv"><div><small>Total stock</small><b>{{ store.stock(m) }}</b></div><div><small>Reorder level</small><b>{{ m.reorder }}</b></div><div><small>MRP</small><b>{{ m.price | inr }}</b></div><div><small>Schedule</small><b>{{ m.schedule || 'OTC' }}</b></div></div>
      <div class="section-title">Batches (dispensed first-expiry-first-out)</div>
      <table class="bt"><thead><tr><th>Batch</th><th>Expiry</th><th>Qty</th><th>Supplier</th></tr></thead><tbody>
        @for (b of m.batches; track b.batch; let i = $index) { <tr><td><b>{{ b.batch }}</b>@if (i === fefoIdx(m)) { <span class="st g" style="margin-left:6px">Next out</span> }</td><td [style.color]="b.expiry < soon ? 'var(--amber)' : ''">{{ b.expiry | d:true }}</td><td class="tnum">{{ b.qty }}</td><td class="small">{{ store.supplier(b.supplierId)?.name }}</td></tr> }
      </tbody></table>
      @if (mode() === 'adjust') {
        <div class="soft stack-s"><b>Adjust stock</b>
          <div class="form-grid"><div class="field"><label>Batch</label><select class="inp" [(ngModel)]="adj.batch">@for (b of m.batches; track b.batch) {<option>{{ b.batch }}</option>}</select></div>
          <div class="field"><label>Change (+/−)</label><input class="inp" type="number" [(ngModel)]="adj.delta"></div></div>
          <div class="field"><label>Reason</label><select class="inp" [(ngModel)]="adj.note"><option>Physical count correction</option><option>Damaged / broken</option><option>Expired, removed</option><option>Returned by patient</option></select></div>
          <div class="row"><button class="btn sm" (click)="doAdjust(m)">Save adjustment</button><button class="btn ghost sm" (click)="mode.set('')">Cancel</button></div></div>
      }
      @if (mode() === 'transfer') {
        <div class="soft stack-s"><b>Transfer to branch</b>
          <div class="form-grid"><div class="field"><label>To branch</label><select class="inp" [(ngModel)]="tr.branch">@for (b of store.db.branches; track b.id) { @if (b.id !== session.branchId()) {<option [value]="b.id">{{ b.name }}</option>} }</select></div>
          <div class="field"><label>Quantity</label><input class="inp" type="number" min="1" [(ngModel)]="tr.qty"></div></div>
          <div class="row"><button class="btn sm" (click)="doTransfer(m)">Send transfer</button><button class="btn ghost sm" (click)="mode.set('')">Cancel</button></div></div>
      }
    }
    <div foot>@if (sel(); as m) {
      <button class="btn ghost" (click)="mode.set('adjust'); adj.batch = m.batches[0]?.batch || ''">Adjust</button>
      <button class="btn ghost" (click)="mode.set('transfer'); tr.branch = otherBranch()">Transfer</button>
      <button class="btn" (click)="reorder(m)"><lucide-icon name="truck" [size]="16"></lucide-icon>Reorder</button>
    }</div>
  </cf-drawer>`
})
export class PharmacyInventoryPage {
  store = inject(StoreService); toast = inject(ToastService); exp = inject(ExportService); router = inject(Router); session = inject(SessionService);
  private api = inject(PharmacyApi); private sync = inject(LiveSync);
  live = this.session.live; liveMoves = signal<StockMove[]>([]);
  constructor() {
    // Live mode: stock and movements come from the server for the selected branch.
    if (this.live) effect(() => { const b = this.session.branchId(); untracked(() => this.reload(b)); });
  }
  async reload(b = this.session.branchId()) {
    try {
      const [, moves] = await Promise.all([this.sync.loadPharmacy(b), this.api.moves(b)]);
      this.liveMoves.set(moves.map(m => ({ id: m.id, date: m.at.slice(0, 16).replace('T', ' '), itemId: m.itemId, name: m.name, kind: m.kind, qty: m.qty, ref: m.ref, by: m.by, note: [m.batch, m.note].filter(Boolean).join(' · ') })));
      const s = this.sel(); if (s) this.sel.set(this.store.med(s.id) ?? null);
    } catch (e) { this.toast.err(apiMessage(e, 'Could not load pharmacy stock')); }
  }
  otherBranch() { return this.store.db.branches.find(b => b.id !== this.session.branchId())?.id ?? ''; }
  /** Live mode: runs a stock change on the server, then reloads stock and movements. */
  private async run(call: () => Promise<LiveMedicine>, ok: string) {
    try { await call(); this.toast.ok(ok); this.mode.set(''); await this.reload(); }
    catch (e) { this.toast.err(apiMessage(e, 'Could not update stock')); }
  }
  private batchId(m: Medicine, batch: string) { return (m as LiveMedicine).batches.find(b => b.batch === batch)?.id ?? ''; }
  tab = signal<Tab>('stock'); q = signal(''); filter = signal('All'); cat = signal(''); sel = signal<Medicine | null>(null); mode = signal('');
  soon = this.store.day(90); adj = { batch: '', delta: 0, note: 'Physical count correction' }; tr = { branch: 'BR2', qty: 10 };
  cols = [
    { key: 'name', label: 'Medicine', value: (m: Medicine) => m.brand }, { key: 'category', label: 'Category' }, { key: 'rack', label: 'Rack' },
    { key: 'stock', label: 'Stock', value: (m: Medicine) => this.store.stock(m) }, { key: 'expiry', label: 'Nearest expiry', value: (m: Medicine) => this.nearest(m) },
    { key: 'price', label: 'MRP', value: (m: Medicine) => m.price, align: 'right' as const }, { key: 'state', label: 'Status', value: (m: Medicine) => this.state(m) },
  ];
  expCols = [{ key: 'med', label: 'Medicine', value: (r: { m: Medicine }) => r.m.brand }, { key: 'batch', label: 'Batch', value: (r: { b: { batch: string } }) => r.b.batch }, { key: 'expiry', label: 'Expiry', value: (r: { days: number }) => r.days }, { key: 'qty', label: 'Qty', value: (r: { b: { qty: number } }) => r.b.qty }, { key: 'value', label: 'Value', sortable: false }, { key: 'act', label: '', sortable: false }];
  moveCols = [{ key: 'date', label: 'When' }, { key: 'name', label: 'Item' }, { key: 'kind', label: 'Type' }, { key: 'qty', label: 'Qty' }, { key: 'ref', label: 'Reference' }, { key: 'by', label: 'By' }, { key: 'note', label: 'Note' }];

  meds = computed(() => { this.store.rev(); return [...this.store.db.medicines]; });
  cats = computed(() => [...new Set(this.meds().map(m => m.category))].sort());
  low = computed(() => this.meds().filter(m => this.store.stock(m) <= m.reorder));
  out = computed(() => this.meds().filter(m => !this.store.stock(m)).length);
  batches = computed(() => this.meds().reduce((t, m) => t + m.batches.filter(b => b.qty > 0).length, 0));
  value = computed(() => this.meds().reduce((t, m) => t + m.batches.reduce((s, b) => s + b.qty * b.cost, 0), 0));
  expiring = computed(() => { const today = this.store.today(); return this.meds().flatMap(m => m.batches.filter(b => b.qty > 0 && b.expiry <= this.soon).map(b => ({ m, b, days: Math.round((new Date(b.expiry).getTime() - new Date(today).getTime()) / 864e5) }))).sort((a, b) => a.days - b.days); });
  moves = computed(() => { this.store.rev(); return this.live ? this.liveMoves() : this.store.db.stockMoves.filter(s => this.store.med(s.itemId)); });
  rows = computed(() => {
    const q = this.q().toLowerCase(), f = this.filter();
    return this.meds().filter(m => (!q || (m.generic + m.brand + m.rack).toLowerCase().includes(q)) && (!this.cat() || m.category === this.cat())
      && (f === 'All' || (f === 'Low' && this.store.stock(m) <= m.reorder) || (f === 'Out' && !this.store.stock(m)) || (f === 'Expiring' && this.nearest(m) <= this.soon)));
  });
  nearest(m: Medicine) { return [...m.batches].filter(b => b.qty > 0).sort((a, b) => a.expiry.localeCompare(b.expiry))[0]?.expiry || ''; }
  fefoIdx(m: Medicine) { const n = this.store.fefo(m.id, 1)[0]?.batch; return m.batches.findIndex(b => b.batch === n); }
  state(m: Medicine) { const s = this.store.stock(m); return !s ? 'Out of stock' : s <= m.reorder ? 'Low stock' : this.nearest(m) <= this.soon ? 'Expiring soon' : 'In stock'; }
  tone(m: Medicine) { return ({ 'Out of stock': 'r', 'Low stock': 'p', 'Expiring soon': 'a', 'In stock': 'ok' } as Record<string, string>)[this.state(m)]; }
  doAdjust(m: Medicine) { if (!this.adj.delta) { this.toast.err('Enter a quantity to add or remove'); return; }
    if (this.live) { const d = +this.adj.delta; this.run(() => this.api.adjust(this.batchId(m, this.adj.batch), d, this.adj.note), `Stock adjusted by ${d}. Audit entry recorded.`).then(() => this.adj.delta = 0); return; }
    this.store.adjustStock(m.id, this.adj.batch, +this.adj.delta, this.adj.note); this.toast.ok(`Stock adjusted by ${this.adj.delta}. Audit entry recorded.`); this.mode.set(''); this.adj.delta = 0; }
  doTransfer(m: Medicine) {
    if (this.live) { const to = this.tr.branch, qty = +this.tr.qty; this.run(() => this.api.transfer(m.id, this.session.branchId(), to, qty), `${qty} units sent to ${this.store.db.branches.find(b => b.id === to)?.name ?? to}`); return; }
    const plan = this.store.fefo(m.id, this.tr.qty); const got = plan.reduce((t, p) => t + p.take, 0); if (!got) { this.toast.err('No stock to transfer'); return; }
    plan.forEach(p => { m.batches.find(b => b.batch === p.batch)!.qty -= p.take; });
    const br = this.store.db.branches.find(b => b.id === this.tr.branch)?.name;
    this.store.db.stockMoves.unshift({ id: this.store.uid('SM'), date: this.store.nowStamp(), itemId: m.id, name: `${m.brand} ${m.strength}`, kind: 'Transfer', qty: -got, ref: `TR-${this.tr.branch}`, by: 'Farzana Ali', note: `To ${br}` });
    this.store.log('Created', 'Stock transfer', `${m.brand} ×${got} to ${br}`); this.store.changed(); this.toast.ok(`${got} units sent to ${br} (simulated transfer)`); this.mode.set('');
  }
  reorder(m: Medicine) { this.makePO([m]); }
  reorderLow() { const l = this.low(); if (!l.length) { this.toast.info('Nothing below reorder level'); return; } this.makePO(l); }
  private makePO(list: Medicine[]) {
    if (this.live) { this.toast.info('Purchase orders are not connected to the server yet. Raise this order outside HospitOS for now.'); return; }
    const bySup = new Map<string, Medicine[]>(); list.forEach(m => { const s = m.batches[0]?.supplierId || this.store.db.suppliers[0].id; bySup.set(s, [...(bySup.get(s) || []), m]); });
    bySup.forEach((ms, sup) => this.store.db.purchaseOrders.unshift({ id: 'PO-' + this.store.uid('').slice(-6), supplierId: sup, date: this.store.today(), kind: 'Pharmacy', items: ms.map(m => ({ itemId: m.id, name: `${m.brand} ${m.strength}`, qty: Math.max(m.reorder * 3 - this.store.stock(m), m.reorder), cost: +(m.price * 0.7).toFixed(2) })), status: 'Requested', requestedBy: 'Farzana Ali', expected: this.store.day(4) }));
    this.store.log('Created', 'Purchase order', `${bySup.size} PO(s) for ${list.length} medicines`); this.store.changed();
    this.toast.ok(`${bySup.size} purchase order(s) raised for approval`, { label: 'View', run: () => this.router.navigate(['/procurement']) });
    this.sel.set(null);
  }
  returnBatch(m: Medicine, batch: string, qty: number) {
    if (this.live) { this.run(() => this.api.adjust(this.batchId(m, batch), -qty, 'Returned to supplier (near expiry)', true), `${batch} returned to supplier`); return; }
    this.store.adjustStock(m.id, batch, -qty, 'Returned to supplier (near expiry)'); this.toast.ok(`${batch} returned to supplier. Credit note expected (simulated).`); }
  exportCsv() { this.exp.csv('pharmacy-stock', this.rows().map(m => ({ Generic: m.generic, Brand: m.brand, Strength: m.strength, Category: m.category, Rack: m.rack, Stock: this.store.stock(m), Reorder: m.reorder, NearestExpiry: this.nearest(m), MRP: m.price }))); }
}
