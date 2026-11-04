import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ExportService } from '../../core/services/export.service';
import { BillingService } from '../../core/services/billing.service';
import { apiError } from '../../core/api/billing-api';
import { Invoice } from '../../core/models';
import { PayMode } from '../../core/models';

const words = (n: number): string => {
  const a = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const b = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const two = (x: number) => x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? '-' + a[x % 10] : '');
  const three = (x: number) => (x >= 100 ? a[Math.floor(x / 100)] + ' hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '');
  if (n === 0) return 'zero'; let s = ''; const cr = Math.floor(n / 1e7), l = Math.floor(n / 1e5) % 100, th = Math.floor(n / 1e3) % 100, r = n % 1000;
  if (cr) s += three(cr) + ' crore '; if (l) s += two(l) + ' lakh '; if (th) s += two(th) + ' thousand '; if (r) s += three(r);
  return s.trim();
};

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.lay { display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:16px; align-items:start } @media (max-width:1000px){ .lay { grid-template-columns:minmax(0,1fr) } } .num { text-align:right }`],
  template: `
  @if (inv(); as i) { @let p = pt(); @let t = totals(); @let h = head();
  <div class="page">
    <cf-page-head [title]="'Invoice ' + bill.label(i)" [crumbs]="['Billing', i.kind]" [sub]="bill.pname(i) + ' · ' + (i.date | d:true)">
      <a class="btn ghost" routerLink="/billing">All invoices</a>
      <button class="btn ghost" (click)="printer.printDoc()"><lucide-icon name="printer" [size]="16"></lucide-icon>Print / PDF</button>
      <button class="btn ghost" (click)="send()"><lucide-icon name="send" [size]="16"></lucide-icon>Send receipt</button>
    </cf-page-head>
    <div class="lay">
      <div class="doc">
        <header>
          <div><div class="brand">{{ h.name }}</div><div style="color:#6f7d79;font-size:12px">{{ h.legalName }}<br>{{ h.address }}<br>GSTIN {{ i.gstin || h.gstin }}</div></div>
          <div style="text-align:right"><div style="font-size:18px;font-weight:800">{{ i.status === 'Cancelled' ? 'CANCELLED INVOICE' : (t.tax > 0 ? 'TAX INVOICE' : 'BILL OF SUPPLY') }}</div><div style="font-size:12px">{{ bill.label(i) }}<br>{{ i.date | d:true }}<br>{{ i.kind }} bill</div></div>
        </header>
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:12.5px">
          <div>Billed to<br><b>{{ bill.pname(i) }}</b><br>UHID {{ i.patientId }}{{ p?.mobile ? ' · ' + p?.mobile : '' }}@if (p?.address?.line) {<br>{{ p?.address?.line }}, {{ p?.address?.city }}}</div>
          <div style="text-align:right">@if (i.claimId) {Claim {{ i.claimNumber || i.claimId }}<br>}{{ p?.insurance ? bill.provider(p!.insurance!.providerId)?.name : 'Self pay' }}<br>Prepared by {{ i.createdBy }}</div>
        </div>
        <table><thead><tr><th>#</th><th>Description</th><th>Category</th><th>HSN/SAC</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">GST</th><th class="num">Amount</th></tr></thead>
          <tbody>@for (it of i.items; track $index) { <tr><td>{{ $index + 1 }}</td><td>{{ it.desc }}</td><td>{{ it.category }}</td><td>{{ it.hsnSac || '' }}</td><td class="num">{{ it.qty }}</td><td class="num">{{ it.rate | inr }}</td><td class="num">{{ it.taxPct }}%</td><td class="num">{{ it.qty * it.rate | inr }}</td></tr> }</tbody></table>
        <div style="display:grid;grid-template-columns:1fr auto;gap:4px 24px;margin-left:auto;min-width:260px;font-size:13px">
          <span>Subtotal</span><b class="num">{{ t.sub | inr }}</b>
          @if (t.discount) {<span>Discount ({{ i.discountPct }}%)</span><b class="num">− {{ t.discount | inr }}</b>}
          @if (t.igst) {<span>IGST</span><b class="num">{{ t.igst | inr }}</b>} @else {<span>CGST</span><b class="num">{{ t.cgst | inr }}</b><span>SGST</span><b class="num">{{ t.sgst | inr }}</b>}
          @if (t.roundOff) {<span>Round off</span><b class="num">{{ t.roundOff | inr }}</b>}
          <span style="font-size:15px;font-weight:800">Total</span><b class="num" style="font-size:15px">{{ t.total | inr }}</b>
          <span>Paid</span><b class="num">{{ t.paid | inr }}</b><span>Balance</span><b class="num" [style.color]="t.due ? '#b42318' : '#15803d'">{{ t.due | inr }}</b>
        </div>
        <div style="font-size:12px">Amount in words: <b>Rupees {{ inWords() }} only</b></div>
        @if (i.payments.length) { <div style="font-size:12px">Payments: @for (py of i.payments; track py.id) {<span>{{ py.date | d }} {{ py.mode }} {{ py.amount | inr }}{{ $last ? '' : ' · ' }}</span>}</div> }
        <div class="foot">@if (h.sample) {<b style="color:#b45309">{{ bill.live ? 'SAMPLE GSTIN AND HOSPITAL DETAILS · NOT A VALID TAX DOCUMENT' : 'PROTOTYPE INVOICE · FICTIONAL DATA · NOT A TAX DOCUMENT' }}</b><br>}{{ h.footer }}@if (i.cancelReason) {<br><b>Cancelled:</b> {{ i.cancelReason }}}</div>
      </div>
      <div class="stack">
        <div class="card stack-s">
          <div class="row"><cf-status [s]="i.status"></cf-status><span class="spacer"></span><b class="big-num">{{ t.due | inr }}</b></div><span class="muted small">Balance due</span>
          @if (t.due > 0) {
            <div class="field"><label>Mode</label><div class="chips">@for (m of modes; track m) {<button class="chip" [class.on]="mode === m" (click)="mode = m">{{ m }}</button>}</div></div>
            <div class="field"><label>Amount</label><input class="inp" type="number" [(ngModel)]="amt"></div>
            <button class="btn" [disabled]="busy()" (click)="pay()">Record payment</button>
          }
        </div>
        <div class="card stack-s">
          <b>Payments and refunds</b>
          <div class="list">
            @for (py of i.payments; track py.id) { <div class="li"><div class="grow"><b>{{ py.amount | inr }} · {{ py.mode }}</b><span>{{ py.date | d:true }} · {{ py.receipt || py.id }}</span></div><span class="st ok">Paid</span></div> }
            @for (r of i.refunds; track r.id) { <div class="li"><div class="grow"><b>− {{ r.amount | inr }} refund</b><span>{{ r.ref }}{{ r.receipt ? ' · ' + r.receipt : '' }}</span></div><span class="st v">Refund</span></div> }
            @if (!i.payments.length && !i.refunds.length) { <p class="muted small">No payments yet.</p> }
          </div>
          @if (t.paid > 0) {
            @if (refundOpen()) {
              <div class="soft stack-s"><div class="field"><label>Refund amount</label><input class="inp" type="number" [(ngModel)]="refAmt"></div>
                <div class="field"><label>Reason <span class="req">*</span></label><input class="inp" [(ngModel)]="refWhy" placeholder="e.g. Test cancelled"></div>
                <div class="row"><button class="btn danger sm" [disabled]="busy() || !refWhy || !refAmt || refAmt > t.paid" (click)="refund()">Refund</button><button class="btn ghost sm" (click)="refundOpen.set(false)">Cancel</button></div></div>
            } @else { <button class="btn ghost sm" (click)="refundOpen.set(true); refAmt = t.paid">Issue refund</button> }
          }
        </div>
        @if (i.claimId) { <a class="btn ghost" routerLink="/insurance" [queryParams]="{ claim: i.claimId }"><lucide-icon name="shield-check" [size]="16"></lucide-icon>Open claim {{ i.claimNumber || i.claimId }}</a> }
      </div>
    </div>
  </div>
  } @else if (loading()) { <div class="page"><p class="muted">Loading invoice…</p></div> } @else { <cf-empty icon="receipt" [title]="err() || 'Invoice not found'"><a class="btn" routerLink="/billing" style="margin-top:10px">Back to billing</a></cf-empty> }`
})
export class InvoiceViewPage {
  store = inject(StoreService); bill = inject(BillingService); toast = inject(ToastService); printer = inject(ExportService);
  id = input<string>(''); modes: PayMode[] = ['Cash', 'UPI', 'Card', 'Bank transfer']; mode: PayMode = 'UPI'; amt = 0; refundOpen = signal(false); refAmt = 0; refWhy = '';
  busy = signal(false); loading = signal(false); err = signal('');
  /** Live mode: the invoice from the server. Demo mode reads the store. */
  private remote = signal<Invoice | undefined>(undefined);
  private patientInfo = signal<{ mobile?: string; address?: { line?: string; city?: string }; insurance?: { providerId: string; policyNo: string } | null } | undefined>(undefined);
  constructor() {
    effect(() => { const id = this.id(); if (this.bill.live && id) void this.fetch(id); });
  }
  private async fetch(id: string) {
    this.loading.set(true); this.err.set('');
    try {
      await this.bill.loadSettings(); await this.bill.loadProviders();
      const i = await this.bill.invoice(id); this.remote.set(i); if (i) this.amt = this.bill.totals(i).due;
      this.bill.api.patient(i!.patientId).then(p => this.patientInfo.set(p)).catch(() => this.patientInfo.set(undefined));
    } catch (e) { this.err.set(apiError(e, 'Invoice not found')); this.remote.set(undefined); } finally { this.loading.set(false); }
  }
  inv = computed(() => {
    if (this.bill.live) return this.remote();
    this.store.rev(); const i = this.store.db.invoices.find(x => x.id === this.id()); if (i) this.amt = this.store.invoiceTotals(i).due; return i;
  });
  pt = computed(() => this.bill.live ? this.patientInfo() : this.store.patient(this.inv()?.patientId));
  totals = computed(() => { this.store.rev(); return this.bill.totals(this.inv()!); });
  head = computed(() => {
    const s = this.bill.settings()?.settings, c = this.store.db.config;
    return this.bill.live && s ? { name: s.tradeName, legalName: s.legalName, address: s.address, gstin: s.gstin, sample: s.sampleData, footer: s.invoiceFooter ?? '' }
      : { name: c.name, legalName: c.legalName, address: c.address, gstin: c.gstin, sample: true, footer: 'GST rates shown are illustrative. Healthcare services are generally GST-exempt in India; pharmacy items are not.' };
  });
  inWords = computed(() => { const w = words(Math.round(this.totals().total)); return w.charAt(0).toUpperCase() + w.slice(1); });
  async pay() {
    const i = this.inv()!; if (!this.amt || this.amt > this.totals().due) { this.toast.err('Enter an amount up to the balance due'); return; }
    this.busy.set(true);
    try { const r = await this.bill.pay(i, this.mode, this.amt); if (this.bill.live) { this.remote.set(r); this.amt = this.bill.totals(r).due; } this.toast.ok(`Payment of ₹${new Intl.NumberFormat('en-IN').format(this.amt)} recorded`); }
    catch (e) { this.toast.err(apiError(e)); } finally { this.busy.set(false); }
  }
  async refund() {
    this.busy.set(true);
    try { const r = await this.bill.refund(this.inv()!, this.refAmt, this.refWhy); if (this.bill.live) this.remote.set(r); this.toast.ok('Refund recorded and flagged in the audit log'); this.refundOpen.set(false); this.refWhy = ''; }
    catch (e) { this.toast.err(apiError(e)); } finally { this.busy.set(false); }
  }
  send() {
    const i = this.inv()!;
    if (!this.bill.live) this.store.notify('WhatsApp', 'Payment reminder', i.patientId, `Receipt for ${i.id}: ₹${this.totals().total}. Thank you.`);
    this.toast.ok('Receipt sent on WhatsApp and email (simulated)');
  }
}
