import { Component, computed, inject, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ExportService } from '../../core/services/export.service';
import { Asset, InventoryItem } from '../../core/models';
import { LIVE } from '../../core/api/api-config';
import { OrgApi, fromServerAsset, fromServerItem } from '../../core/api/org-api';
import { apiMessage } from '../../core/api/auth.service';
import { SessionService } from '../../core/services/session.service';

@Component({
  standalone: true, imports: [SHARED],
  template: `
  <div class="page">
    <cf-page-head title="Inventory & assets" [crumbs]="['Organisation', 'Stores']" sub="Consumables, surgical supplies and equipment with service schedules.">
      <button class="btn ghost" (click)="exportCsv()"><lucide-icon name="download" [size]="16"></lucide-icon>Export</button>
      <button class="btn ghost" (click)="newOpen.set(tab())"><lucide-icon name="plus" [size]="16"></lucide-icon>{{ tab() === 'stock' ? 'Add item' : 'Add asset' }}</button>
      <a class="btn" routerLink="/procurement"><lucide-icon name="truck" [size]="16"></lucide-icon>Requisitions and POs</a>
    </cf-page-head>
    <div class="grid">
      <cf-stat class="c3" label="Stock items" [value]="items().length" icon="boxes" tone="pri"></cf-stat>
      <cf-stat class="c3" label="Below reorder" [value]="low().length" icon="triangle-alert" tone="red" [clickable]="true" (click)="tab.set('stock'); onlyLow.set(true)"></cf-stat>
      <cf-stat class="c3" label="Assets" [value]="assets().length" icon="monitor" tone="blue" [sub]="(assetValue() | inr:true) + ' book value'"></cf-stat>
      <cf-stat class="c3" label="Service due in 30 days" [value]="serviceDue().length" icon="settings" tone="amber" [clickable]="true" (click)="tab.set('assets')"></cf-stat>
    </div>
    <div class="tabs"><button [class.on]="tab() === 'stock'" (click)="tab.set('stock')">Stock</button><button [class.on]="tab() === 'assets'" (click)="tab.set('assets')">Assets</button></div>
    @if (tab() === 'stock') {
      <div class="card">
        <div class="toolbar" style="margin-bottom:12px"><label class="search boxed" style="flex:1;max-width:300px"><lucide-icon name="search" [size]="16"></lucide-icon><input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Item or location" aria-label="Search inventory"></label>
          <select class="inp" style="width:auto" [ngModel]="cat()" (ngModelChange)="cat.set($event)" aria-label="Category"><option value="">All categories</option>@for (c of cats(); track c) {<option>{{ c }}</option>}</select>
          <mat-slide-toggle [checked]="onlyLow()" (change)="onlyLow.set(!onlyLow())">Below reorder only</mat-slide-toggle></div>
        <cf-table [rows]="rows()" [cols]="cols" [clickable]="true" (rowClick)="sel.set($event)">
          <ng-template cfCell="stock" let-i><b [style.color]="i.stock <= i.reorder ? 'var(--red)' : ''">{{ i.stock }}</b> <span class="muted small">{{ i.unit }} · reorder {{ i.reorder }}</span></ng-template>
          <ng-template cfCell="cost" let-i>{{ i.cost | inr }}</ng-template>
          <ng-template cfCell="expiry" let-i>{{ i.expiry ? (i.expiry | d:true) : '—' }}</ng-template>
        </cf-table>
      </div>
    } @else {
      <div class="card">
        <cf-table [rows]="assets()" [cols]="assetCols" [clickable]="true" (rowClick)="asset.set($event)">
          <ng-template cfCell="status" let-a><cf-status [s]="a.status"></cf-status></ng-template>
          <ng-template cfCell="value" let-a>{{ a.value | inr }}</ng-template>
          <ng-template cfCell="next" let-a><span [style.color]="a.nextService <= soon ? 'var(--amber)' : ''">{{ a.nextService | d:true }}</span></ng-template>
        </cf-table>
      </div>
    }
  </div>
  <cf-drawer [open]="!!sel()" [title]="sel()?.name || ''" [sub]="sel() ? sel()!.category + ' · ' + sel()!.location : ''" (closed)="sel.set(null)">
    @if (sel(); as i) {
      <div class="kv"><div><small>In stock</small><b>{{ i.stock }} {{ i.unit }}</b></div><div><small>Reorder level</small><b>{{ i.reorder }}</b></div><div><small>Unit cost</small><b>{{ i.cost | inr }}</b></div><div><small>Supplier</small><b>{{ store.supplier(i.supplierId)?.name }}</b></div></div>
      <div class="field"><label>Issue to department</label><div class="row"><select class="inp" style="flex:1" [(ngModel)]="issueDept">@for (d of depts; track d) {<option>{{ d }}</option>}</select><input class="inp" style="width:90px" type="number" min="1" [(ngModel)]="issueQty"><button class="btn sm" (click)="issue(i)">Issue</button></div></div>
      <div class="field"><label>Stock count correction</label><div class="row"><input class="inp" style="width:120px" type="number" [(ngModel)]="count"><button class="btn ghost sm" (click)="correct(i)">Save count</button></div></div>
    }
  </cf-drawer>
  <cf-drawer [open]="!!asset()" [title]="asset()?.name || ''" [sub]="asset() ? asset()!.tag + ' · ' + asset()!.location : ''" (closed)="asset.set(null)">
    @if (asset(); as a) {
      <div class="kv"><div><small>Status</small><b>{{ a.status }}</b></div><div><small>Purchased</small><b>{{ a.purchased | d:true }}</b></div><div><small>Book value</small><b>{{ a.value | inr }}</b></div><div><small>Next service</small><b>{{ a.nextService | d:true }}</b></div></div>
      <div class="field"><label>Set status</label><div class="chips">@for (s of assetStatuses; track s) {<button class="chip" [class.on]="a.status === s" (click)="setAsset(a, s)">{{ s }}</button>}</div></div>
      <button class="btn soft-btn" (click)="service(a)"><lucide-icon name="settings" [size]="16"></lucide-icon>Log service done today</button>
    }
  </cf-drawer>
  <cf-drawer [open]="newOpen() === 'stock'" title="Add stock item" (closed)="newOpen.set(null)">
    <div class="field"><label>Name</label><input class="inp" [(ngModel)]="ni.name" aria-label="Item name"></div>
    <div class="row"><div class="field" style="flex:1"><label>Category</label><select class="inp" [(ngModel)]="ni.category">@for (c of itemCats; track c) {<option>{{ c }}</option>}</select></div>
      <div class="field" style="width:110px"><label>Unit</label><input class="inp" [(ngModel)]="ni.unit" aria-label="Unit"></div></div>
    <div class="row"><div class="field" style="flex:1"><label>Opening stock</label><input class="inp" type="number" min="0" [(ngModel)]="ni.stock" aria-label="Opening stock"></div>
      <div class="field" style="flex:1"><label>Reorder level</label><input class="inp" type="number" min="0" [(ngModel)]="ni.reorder" aria-label="Reorder level"></div>
      <div class="field" style="flex:1"><label>Unit cost</label><input class="inp" type="number" min="0" [(ngModel)]="ni.cost" aria-label="Unit cost"></div></div>
    <div class="field"><label>Location</label><input class="inp" [(ngModel)]="ni.location" aria-label="Location"></div>
    <div class="field"><label>Usual supplier</label><select class="inp" [(ngModel)]="ni.supplierId"><option value="">None</option>@for (s of store.db.suppliers; track s.id) {<option [value]="s.id">{{ s.name }}</option>}</select></div>
    <button class="btn" [disabled]="!ni.name.trim() || !ni.unit.trim()" (click)="addItem()">Add item</button>
  </cf-drawer>
  <cf-drawer [open]="newOpen() === 'assets'" title="Add asset" (closed)="newOpen.set(null)">
    <div class="field"><label>Name</label><input class="inp" [(ngModel)]="na.name" aria-label="Asset name"></div>
    <div class="row"><div class="field" style="flex:1"><label>Category</label><input class="inp" [(ngModel)]="na.category" aria-label="Asset category"></div>
      <div class="field" style="flex:1"><label>Asset tag</label><input class="inp" [(ngModel)]="na.tag" aria-label="Asset tag"></div></div>
    <div class="row"><div class="field" style="flex:1"><label>Location</label><input class="inp" [(ngModel)]="na.location" aria-label="Asset location"></div>
      <div class="field" style="flex:1"><label>Book value</label><input class="inp" type="number" min="0" [(ngModel)]="na.value" aria-label="Book value"></div></div>
    <div class="row"><div class="field" style="flex:1"><label>Purchased</label><input class="inp" type="date" [(ngModel)]="na.purchased"></div>
      <div class="field" style="flex:1"><label>Next service</label><input class="inp" type="date" [(ngModel)]="na.nextService"></div></div>
    <button class="btn" [disabled]="!na.name.trim() || !na.category.trim() || !na.tag.trim()" (click)="addAsset()">Add asset</button>
  </cf-drawer>`
})
export class InventoryPage {
  store = inject(StoreService); toast = inject(ToastService); exp = inject(ExportService); api = inject(OrgApi); session = inject(SessionService);
  live = LIVE;
  tab = signal<'stock' | 'assets'>('stock'); q = signal(''); cat = signal(''); onlyLow = signal(false); sel = signal<InventoryItem | null>(null); asset = signal<Asset | null>(null);
  soon = this.store.day(30); depts = ['OT', 'ICU', 'General ward A', 'Emergency', 'OPD', 'Laboratory', 'Housekeeping']; issueDept = 'OT'; issueQty = 5; count = 0;
  newOpen = signal<'stock' | 'assets' | null>(null);
  itemCats: InventoryItem['category'][] = ['Consumables', 'Surgical supplies', 'Medical equipment', 'General supplies', 'Linen', 'Housekeeping'];
  ni = { name: '', category: 'Consumables' as InventoryItem['category'], unit: 'pcs', stock: 0, reorder: 10, cost: 0, location: 'Central store', supplierId: '' };
  na = { name: '', category: 'Medical equipment', tag: '', location: '', value: 0, purchased: '', nextService: '' };
  assetStatuses: Asset['status'][] = ['In use', 'Available', 'Under maintenance', 'Retired'];
  cols = [{ key: 'name', label: 'Item' }, { key: 'category', label: 'Category' }, { key: 'location', label: 'Location' }, { key: 'stock', label: 'Stock' }, { key: 'cost', label: 'Unit cost', align: 'right' as const }, { key: 'expiry', label: 'Expiry' }];
  assetCols = [{ key: 'name', label: 'Asset' }, { key: 'tag', label: 'Tag' }, { key: 'category', label: 'Category' }, { key: 'location', label: 'Location' }, { key: 'status', label: 'Status' }, { key: 'value', label: 'Value', align: 'right' as const }, { key: 'next', label: 'Next service', value: (a: Asset) => a.nextService }];
  items = computed(() => { this.store.rev(); return this.store.db.inventory; });
  assets = computed(() => { this.store.rev(); return this.store.db.assets; });
  cats = computed(() => [...new Set(this.items().map(i => i.category))]);
  low = computed(() => this.items().filter(i => i.stock <= i.reorder));
  assetValue = computed(() => this.assets().reduce((t, a) => t + a.value, 0));
  serviceDue = computed(() => this.assets().filter(a => !!a.nextService && a.nextService <= this.soon));
  rows = computed(() => { const q = this.q().toLowerCase(); return this.items().filter(i => (!this.cat() || i.category === this.cat()) && (!this.onlyLow() || i.stock <= i.reorder) && (!q || (i.name + i.location).toLowerCase().includes(q))); });
  constructor() { if (LIVE) { this.store.db.inventory = []; this.store.db.assets = []; this.reload(); } }
  async reload() {
    try {
      const b = this.session.branchId();
      const [items, assets, sup] = await Promise.all([this.api.items(b), this.api.assets(b), this.api.suppliers()]);
      this.store.db.inventory = items.map(fromServerItem); this.store.db.assets = assets.map(fromServerAsset); this.store.db.suppliers = sup; this.store.changed();
      const cur = this.sel(); if (cur) this.sel.set(this.store.db.inventory.find(x => x.id === cur.id) ?? null);
      const a = this.asset(); if (a) this.asset.set(this.store.db.assets.find(x => x.id === a.id) ?? null);
    } catch (e) { this.toast.err(apiMessage(e, 'Could not load stores')); }
  }
  private async run(f: () => Promise<unknown>, ok: string, fail: string) {
    try { await f(); this.toast.ok(ok); await this.reload(); return true; } catch (e) { this.toast.err(apiMessage(e, fail)); return false; }
  }
  issue(i: InventoryItem) {
    const q = +this.issueQty; if (q <= 0 || q > i.stock) { this.toast.err(`Only ${i.stock} ${i.unit} available`); return; }
    if (this.live) { this.run(async () => { const u = await this.api.issue(i.id, q, this.issueDept); if (u.stock <= u.reorder) this.toast.warn(`${i.name} is now below reorder level`); }, `${q} ${i.unit} issued to ${this.issueDept}`, 'Could not issue the stock'); return; }
    i.stock -= q; this.store.db.stockMoves.unshift({ id: this.store.uid('SM'), date: this.store.nowStamp(), itemId: i.id, name: i.name, kind: 'Issue', qty: -q, ref: this.issueDept, by: 'Stores' }); this.store.changed();
    this.toast.ok(`${q} ${i.unit} issued to ${this.issueDept}`); if (i.stock <= i.reorder) this.toast.warn(`${i.name} is now below reorder level`);
  }
  correct(i: InventoryItem) {
    if (this.live) { this.run(() => this.api.count(i.id, Math.max(0, Math.round(+this.count))), 'Count saved', 'Could not save the count'); return; }
    const d = +this.count - i.stock; i.stock = +this.count; this.store.log('Changed', 'Inventory', `${i.name} count corrected by ${d}`); this.store.changed(); this.toast.ok('Count saved');
  }
  setAsset(a: Asset, s: Asset['status']) {
    if (this.live) { this.run(() => this.api.assetStatus(a.id, s), `${a.name}: ${s}`, 'Could not change the asset'); return; }
    a.status = s; this.store.changed(); this.toast.ok(`${a.name}: ${s}`);
  }
  service(a: Asset) {
    if (this.live) { this.run(() => this.api.assetServiced(a.id), 'Service logged. Next service in 6 months.', 'Could not log the service'); return; }
    a.nextService = this.store.day(180); if (a.status === 'Under maintenance') a.status = 'In use'; this.store.log('Updated', 'Asset', `${a.tag} serviced`); this.store.changed(); this.toast.ok('Service logged. Next service in 6 months.');
  }
  addItem() {
    const n = this.ni;
    if (this.live) {
      this.run(() => this.api.addItem({ name: n.name.trim(), category: n.category, unit: n.unit.trim(), reorder: Math.max(0, +n.reorder), location: n.location.trim(), cost: Math.max(0, +n.cost),
        supplierId: n.supplierId || undefined, branchId: this.session.branchId(), openingStock: Math.max(0, Math.round(+n.stock)) }), `${n.name} added`, 'Could not add the item')
        .then(done => { if (done) { this.newOpen.set(null); n.name = ''; } });
      return;
    }
    this.store.db.inventory.unshift({ id: this.store.uid('INV'), name: n.name.trim(), category: n.category, unit: n.unit.trim(), stock: +n.stock, reorder: +n.reorder, location: n.location, cost: +n.cost, supplierId: n.supplierId });
    this.store.changed(); this.toast.ok(`${n.name} added`); this.newOpen.set(null); n.name = '';
  }
  addAsset() {
    const n = this.na;
    if (this.live) {
      this.run(() => this.api.addAsset({ name: n.name.trim(), category: n.category.trim(), tag: n.tag.trim(), location: n.location.trim(), value: Math.max(0, +n.value),
        purchased: n.purchased || undefined, nextService: n.nextService || undefined, branchId: this.session.branchId() }), `${n.name} added`, 'Could not add the asset')
        .then(done => { if (done) { this.newOpen.set(null); n.name = ''; n.tag = ''; } });
      return;
    }
    this.store.db.assets.unshift({ id: this.store.uid('AS'), name: n.name.trim(), category: n.category, tag: n.tag.toUpperCase(), location: n.location, status: 'Available', purchased: n.purchased, value: +n.value, nextService: n.nextService });
    this.store.changed(); this.toast.ok(`${n.name} added`); this.newOpen.set(null); n.name = ''; n.tag = '';
  }
  exportCsv() { if (this.tab() === 'stock') this.exp.csv('inventory', this.rows().map(i => ({ Item: i.name, Category: i.category, Location: i.location, Stock: i.stock, Unit: i.unit, Reorder: i.reorder, Cost: i.cost }))); else this.exp.csv('assets', this.assets().map(a => ({ Asset: a.name, Tag: a.tag, Status: a.status, Value: a.value, NextService: a.nextService }))); }
}
