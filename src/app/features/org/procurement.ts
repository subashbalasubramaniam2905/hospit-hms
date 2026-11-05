import { Component, computed, inject, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { POItem, PurchaseOrder, Requisition } from '../../core/models';
import { LIVE } from '../../core/api/api-config';
import { OrgApi, fromServerItem, fromServerPo, fromServerReq } from '../../core/api/org-api';
import { apiMessage } from '../../core/api/auth.service';
import { SessionService } from '../../core/services/session.service';
import { LiveSync } from '../../core/api/live-sync';

type GrnLine = POItem & { batch?: string; expiry?: string };

type Tab = 'req' | 'po' | 'grn' | 'suppliers';

@Component({
  standalone: true, imports: [SHARED],
  template: `
  <div class="page">
    <cf-page-head title="Procurement" [crumbs]="['Organisation', 'Purchasing']" [sub]="live ? 'Requisition → approval → purchase order → goods receipt. Orders are not emailed to suppliers yet: send them yourself.' : 'Requisition → approval → purchase order → goods receipt. Supplier portals are simulated.'">
      <button class="btn" (click)="newPo.set(true)"><lucide-icon name="plus" [size]="16"></lucide-icon>New purchase order</button>
    </cf-page-head>
    <div class="grid">
      <cf-stat class="c3" label="Requisitions pending" [value]="reqPending()" icon="clipboard-list" tone="amber" [clickable]="true" (click)="tab.set('req')"></cf-stat>
      <cf-stat class="c3" label="POs awaiting approval" [value]="poCount('Requested')" icon="file-check" tone="violet" [clickable]="true" (click)="tab.set('po')"></cf-stat>
      <cf-stat class="c3" label="Open orders" [value]="poCount('Ordered') + poCount('Approved')" icon="truck" tone="blue" [clickable]="true" (click)="tab.set('grn')"></cf-stat>
      <cf-stat class="c3" label="Spend this month" [value]="(spend() | inr:true)" icon="indian-rupee" tone="pri"></cf-stat>
    </div>
    <div class="tabs">@for (t of tabs; track t.id) {<button [class.on]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button>}</div>
    @switch (tab()) {
    @case ('req') {
      <div class="card"><cf-table [rows]="reqs()" [cols]="reqCols">
        <ng-template cfCell="items" let-r><span class="small">{{ reqItems(r) }}</span></ng-template>
        <ng-template cfCell="status" let-r><cf-status [s]="r.status"></cf-status></ng-template>
        <ng-template cfCell="act" let-r>@if (r.status === 'Pending') {<div class="row" style="gap:6px"><button class="btn sm" (click)="setReq(r, 'Approved')">Approve</button><button class="btn ghost sm" (click)="setReq(r, 'Rejected')">Reject</button></div>} @else if (r.status === 'Approved') {<button class="btn soft-btn sm" (click)="issueReq(r)">Issue from store</button>}</ng-template>
      </cf-table></div>
    }
    @case ('po') {
      <div class="card"><cf-table [rows]="pos()" [cols]="poCols" [clickable]="true" (rowClick)="sel.set($event)">
        <ng-template cfCell="supplier" let-p>{{ store.supplier(p.supplierId)?.name }}</ng-template>
        <ng-template cfCell="value" let-p>{{ total(p) | inr }}</ng-template>
        <ng-template cfCell="status" let-p><cf-status [s]="p.status"></cf-status></ng-template>
      </cf-table></div>
    }
    @case ('grn') {
      <div class="cards-auto" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">
        @for (p of openPos(); track p.id) {
          <div class="card stack-s">
            <div class="row"><b>{{ p.id }}</b><cf-status [s]="p.status"></cf-status><span class="spacer"></span><span class="small muted">expected {{ p.expected ? (p.expected | d) : '—' }}</span></div>
            <div class="small">{{ store.supplier(p.supplierId)?.name }}</div>
            @for (i of grn(p); track i.itemId) { <div class="row small" style="flex-wrap:wrap"><span style="flex:1">{{ i.name }}</span><span class="muted">ordered {{ i.qty }}</span><input class="inp" style="width:80px;padding:5px 8px" type="number" [(ngModel)]="i.received" [placeholder]="'' + i.qty" aria-label="Received quantity">
              @if (live && p.kind === 'Pharmacy') {<input class="inp" style="width:110px;padding:5px 8px" [(ngModel)]="i.batch" placeholder="Batch" aria-label="Batch number"><input class="inp" style="width:140px;padding:5px 8px" type="date" [(ngModel)]="i.expiry" aria-label="Expiry date">}</div> }
            <button class="btn sm" [disabled]="busy() || p.status !== 'Ordered'" (click)="receive(p)"><lucide-icon name="package" [size]="14"></lucide-icon>Record goods receipt</button>@if (p.status === 'Approved') {<span class="muted small">Send it to the supplier first</span>}
          </div>
        } @empty { <div class="card"><cf-empty icon="truck" title="No open orders"></cf-empty></div> }
      </div>
    }
    @case ('suppliers') {
      <div class="card"><cf-table [rows]="store.db.suppliers" [cols]="supCols">
        <ng-template cfCell="rating" let-s>@for (n of [1,2,3,4,5]; track n) {<lucide-icon name="star" [size]="13" [style.color]="n <= s.rating ? 'var(--amber)' : 'var(--line)'"></lucide-icon>}</ng-template>
      </cf-table></div>
    }
    }
  </div>
  <cf-drawer [open]="!!sel()" [title]="sel()?.id || ''" [sub]="sel() ? store.supplier(sel()!.supplierId)?.name + ' · ' + sel()!.kind : ''" width="min(560px,100%)" (closed)="sel.set(null)">
    @if (sel(); as p) {
      <div class="stepper">@for (s of flow; track s; let i = $index) {<span class="s" [class.done]="i < flow.indexOf(p.status)" [class.cur]="s === p.status">{{ s }}</span>}</div>
      <div class="tbl"><table class="t"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>@for (i of p.items; track i.itemId) {<tr><td>{{ i.name }}</td><td class="num">{{ i.qty }}</td><td class="num">{{ i.cost | inr }}</td><td class="num">{{ i.qty * i.cost | inr }}</td></tr>}</tbody>
        <tfoot><tr><td colspan="3" class="num"><b>Total</b></td><td class="num"><b>{{ total(p) | inr }}</b></td></tr></tfoot></table></div>
      @if (total(p) > 100000 && p.status === 'Requested') { <div class="alert-box warn"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon>@if (live) {Above ₹1 lakh: needs a super administrator to approve.} @else {Above ₹1 lakh: needs a second approver (simulated rule).}</div> }
      <div class="small muted">Requested by {{ p.requestedBy }} on {{ p.date | d:true }}</div>
    }
    <div foot>@if (sel(); as p) {
      @if (p.status === 'Draft' || p.status === 'Requested') { <button class="btn ghost" style="color:var(--red)" (click)="setPo(p, 'Cancelled')">Cancel</button><button class="btn" (click)="setPo(p, 'Approved')">Approve</button> }
      @if (p.status === 'Approved') { <button class="btn" (click)="setPo(p, 'Ordered')"><lucide-icon name="send" [size]="16"></lucide-icon>Send to supplier</button> }
      @if (p.status === 'Ordered') { <button class="btn" (click)="sel.set(null); tab.set('grn')">Receive goods</button> }
    }</div>
  </cf-drawer>
  <cf-drawer [open]="newPo()" title="New purchase order" (closed)="newPo.set(false)">
    <div class="stack">
      <div class="form-grid"><div class="field"><label>Type</label><select class="inp" [(ngModel)]="np.kind"><option>Pharmacy</option><option>Inventory</option></select></div><div class="field"><label>Supplier</label><select class="inp" [(ngModel)]="np.supplierId">@for (s of store.db.suppliers; track s.id) {<option [value]="s.id">{{ s.name }}</option>}</select></div></div>
      <div class="field"><label>Add item</label><select class="inp" [(ngModel)]="np.pick" (ngModelChange)="addLine($event)"><option value="">Choose</option>@if (np.kind === 'Pharmacy') { @for (m of store.db.medicines; track m.id) {<option [value]="m.id">{{ m.brand }} {{ m.strength }}</option>} } @else { @for (i of store.db.inventory; track i.id) {<option [value]="i.id">{{ i.name }}</option>} }</select></div>
      @for (l of np.items; track l.itemId; let k = $index) { <div class="row"><span style="flex:1" class="small">{{ l.name }}</span><input class="inp" style="width:80px" type="number" [(ngModel)]="l.qty"><input class="inp" style="width:90px" type="number" [(ngModel)]="l.cost"><button class="iconbtn" (click)="np.items.splice(k, 1)" aria-label="Remove"><lucide-icon name="x" [size]="14"></lucide-icon></button></div> }
    </div>
    <div foot><button class="btn ghost" (click)="newPo.set(false)">Cancel</button><button class="btn" [disabled]="!np.items.length || busy()" (click)="createPo()">Raise PO</button></div>
  </cf-drawer>`
})
export class ProcurementPage {
  store = inject(StoreService); toast = inject(ToastService); api = inject(OrgApi); session = inject(SessionService); sync = inject(LiveSync);
  live = LIVE; busy = signal(false); private grnLines = new Map<string, GrnLine[]>();
  tabs: { id: Tab; label: string }[] = [{ id: 'req', label: 'Requisitions' }, { id: 'po', label: 'Purchase orders' }, { id: 'grn', label: 'Goods receipt' }, { id: 'suppliers', label: 'Suppliers' }];
  flow: PurchaseOrder['status'][] = ['Requested', 'Approved', 'Ordered', 'Received'];
  tab = signal<Tab>('po'); sel = signal<PurchaseOrder | null>(null); newPo = signal(false);
  np = { kind: 'Pharmacy' as 'Pharmacy' | 'Inventory', supplierId: 'SP1', pick: '', items: [] as POItem[] };
  reqCols = [{ key: 'id', label: 'Req no.' }, { key: 'date', label: 'Date' }, { key: 'dept', label: 'Department' }, { key: 'items', label: 'Items', sortable: false }, { key: 'requestedBy', label: 'By' }, { key: 'status', label: 'Status' }, { key: 'act', label: '', sortable: false }];
  poCols = [{ key: 'id', label: 'PO' }, { key: 'date', label: 'Date' }, { key: 'supplier', label: 'Supplier', value: (p: PurchaseOrder) => this.store.supplier(p.supplierId)?.name }, { key: 'kind', label: 'Type' }, { key: 'value', label: 'Value', align: 'right' as const, value: (p: PurchaseOrder) => this.total(p) }, { key: 'status', label: 'Status' }];
  supCols = [{ key: 'name', label: 'Supplier' }, { key: 'type', label: 'Type' }, { key: 'contact', label: 'Contact' }, { key: 'phone', label: 'Phone' }, { key: 'city', label: 'City' }, { key: 'gst', label: 'GSTIN' }, { key: 'rating', label: 'Rating' }];
  reqs = computed(() => { this.store.rev(); return this.store.db.requisitions; });
  pos = computed(() => { this.store.rev(); return this.store.db.purchaseOrders; });
  openPos = computed(() => this.pos().filter(p => p.status === 'Ordered' || p.status === 'Approved'));
  reqPending = computed(() => this.reqs().filter(r => r.status === 'Pending').length);
  poCount(s: PurchaseOrder['status']) { return this.pos().filter(p => p.status === s).length; }
  spend = computed(() => this.pos().filter(p => p.status === 'Received' && p.date.slice(0, 7) === this.store.today().slice(0, 7)).reduce((t, p) => t + this.total(p), 0) || this.pos().filter(p => p.status === 'Received').reduce((t, p) => t + this.total(p), 0));
  total(p: PurchaseOrder) { return Math.round(p.items.reduce((t, i) => t + i.qty * i.cost, 0)); }
  reqItems(r: Requisition) { return r.items.map(i => `${i.name} × ${i.qty}`).join(', '); }
  constructor() { if (LIVE) { this.store.db.requisitions = []; this.store.db.purchaseOrders = []; this.reload(); } }
  async reload() {
    try {
      const b = this.session.branchId();
      const [reqs, pos, sup, items] = await Promise.all([this.api.requisitions(), this.api.orders(), this.api.suppliers(), this.api.items(b), this.sync.loadPharmacy(b).catch(() => undefined)]);
      this.store.db.requisitions = reqs.map(fromServerReq); this.store.db.purchaseOrders = pos.map(fromServerPo); this.store.db.suppliers = sup;
      this.store.db.inventory = items.map(fromServerItem); this.grnLines.clear(); this.store.changed();
      if (!sup.some(x => x.id === this.np.supplierId) && sup.length) this.np.supplierId = sup[0].id;
    } catch (e) { this.toast.err(apiMessage(e, 'Could not load procurement')); }
  }
  private async run(f: () => Promise<unknown>, ok: string, fail: string) {
    this.busy.set(true);
    try { await f(); this.toast.ok(ok); await this.reload(); return true; } catch (e) { this.toast.err(apiMessage(e, fail)); return false; } finally { this.busy.set(false); }
  }
  /** Lines for the goods receipt form. Live mode keeps them apart from the order, so the order shows what the server holds. */
  grn(p: PurchaseOrder): GrnLine[] {
    if (!this.live) return p.items;
    let l = this.grnLines.get(p.id); if (!l) { l = p.items.map(i => ({ ...i, received: undefined })); this.grnLines.set(p.id, l); } return l;
  }
  setReq(r: Requisition, s: Requisition['status']) {
    if (this.live) { this.run(() => this.api.decideReq(r.id, s as 'Approved' | 'Rejected'), `${r.id} ${s.toLowerCase()}`, 'Could not update the requisition'); return; }
    r.status = s; this.store.log(s, 'Requisition', r.id); this.store.changed(); this.toast.ok(`${r.id} ${s.toLowerCase()}`);
  }
  issueReq(r: Requisition) {
    if (this.live) { this.run(() => this.api.issueReq(r.id), `${r.id} issued to ${r.dept}. Stock reduced.`, 'Could not issue the requisition'); return; }
    r.items.forEach(i => { const it = this.store.db.inventory.find(x => x.id === i.itemId); if (it) it.stock = Math.max(0, it.stock - i.qty); }); r.status = 'Issued'; this.store.log('Issued', 'Requisition', r.id); this.store.changed(); this.toast.ok(`${r.id} issued to ${r.dept}. Stock reduced.`);
  }
  setPo(p: PurchaseOrder, s: PurchaseOrder['status']) {
    if (this.live) {
      const v = (p as PurchaseOrder & { version?: number }).version ?? 0;
      const ok = s === 'Ordered' ? `${p.id} marked as sent to ${this.store.supplier(p.supplierId)?.name}. Send the order to them yourself.` : `${p.id} ${s.toLowerCase()}`;
      this.run(() => this.api.orderStatus(p.id, s, v), ok, 'Could not update the order').then(done => { if (done) this.sel.set(null); });
      return;
    }
    p.status = s; if (s === 'Ordered') { p.expected = this.store.day(3); this.toast.ok(`${p.id} emailed to ${this.store.supplier(p.supplierId)?.name} (simulated)`); } else this.toast.ok(`${p.id} ${s.toLowerCase()}`); this.store.log(s, 'Purchase order', p.id); this.store.changed();
  }
  receive(p: PurchaseOrder) {
    if (this.live) {
      const v = (p as PurchaseOrder & { version?: number }).version ?? 0;
      const lines = this.grn(p).map(i => ({ itemId: i.itemId, received: i.received == null || (i.received as unknown) === '' ? i.qty : +i.received, batch: i.batch?.trim() || undefined, expiry: i.expiry || undefined }));
      this.run(() => this.api.receive(p.id, v, lines), `Goods received against ${p.id}. Stock updated.`, 'Could not record the goods receipt');
      return;
    }
    p.items.forEach(i => { if (i.received == null || (i.received as unknown) === '') i.received = i.qty; i.qty = +i.received!; }); this.store.receivePO(p); this.toast.ok(`Goods received against ${p.id}. Stock and batches updated.`);
  }
  addLine(id: string) {
    if (!id) return; const m = this.store.med(id); const inv = this.store.db.inventory.find(x => x.id === id);
    if (!this.np.items.some(i => i.itemId === id)) this.np.items.push({ itemId: id, name: m ? `${m.brand} ${m.strength}` : inv!.name, qty: m ? m.reorder * 2 : (inv?.reorder || 10) * 2, cost: m ? +(m.price * 0.7).toFixed(2) : inv!.cost });
    setTimeout(() => this.np.pick = '');
  }
  async createPo() {
    if (this.live) {
      const np = this.np;
      if (await this.run(() => this.api.createOrder({ kind: np.kind, supplierId: np.supplierId, branchId: this.session.branchId(), items: np.items.map(i => ({ itemId: i.itemId, qty: +i.qty, cost: +i.cost })) }), 'Purchase order raised for approval', 'Could not raise the order')) { this.newPo.set(false); this.np.items = []; this.tab.set('po'); }
      return;
    }
    const po: PurchaseOrder = { id: 'PO-' + (4100 + this.pos().length), supplierId: this.np.supplierId, date: this.store.today(), kind: this.np.kind, items: this.np.items.map(i => ({ ...i, qty: +i.qty, cost: +i.cost })), status: 'Requested', requestedBy: 'Meera Rao' }; this.store.db.purchaseOrders.unshift(po); this.store.log('Created', 'Purchase order', po.id); this.store.changed(); this.toast.ok(`${po.id} raised for approval`); this.newPo.set(false); this.np.items = []; this.tab.set('po');
  }
}
