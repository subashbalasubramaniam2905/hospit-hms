import { Component, computed, inject, input, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ExportService } from '../../core/services/export.service';
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
  @if (inv(); as i) { @let p = store.patient(i.patientId); @let t = totals();
  <div class="page">
    <cf-page-head [title]="'Invoice ' + i.id" [crumbs]="['Billing', i.kind]" [sub]="store.pname(i.patientId) + ' · ' + (i.date | d:true)">
      <a class="btn ghost" routerLink="/billing">All invoices</a>
      <button class="btn ghost" (click)="printer.printDoc()"><lucide-icon name="printer" [size]="16"></lucide-icon>Print / PDF</button>
      <button class="btn ghost" (click)="send()"><lucide-icon name="send" [size]="16"></lucide-icon>Send receipt</button>
    </cf-page-head>
    <div class="lay">
      <div class="doc">
        <header>
          <div><div class="brand">{{ store.db.config.name }}</div><div style="color:#6f7d79;font-size:12px">{{ store.db.config.legalName }}<br>{{ store.db.config.address }}<br>GSTIN {{ store.db.config.gstin }}</div></div>
          <div style="text-align:right"><div style="font-size:18px;font-weight:800">TAX INVOICE</div><div style="font-size:12px">{{ i.id }}<br>{{ i.date | d:true }}<br>{{ i.kind }} bill</div></div>
        </header>
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:12.5px">
          <div>Billed to<br><b>{{ p?.name }}</b><br>UHID {{ p?.id }} · {{ p?.mobile }}<br>{{ p?.address?.line }}, {{ p?.address?.city }}</div>
          <div style="text-align:right">@if (i.claimId) {Claim {{ i.claimId }}<br>}{{ p?.insurance ? store.provider(p!.insurance!.providerId)?.name : 'Self pay' }}<br>Prepared by {{ i.createdBy }}</div>
        </div>
        <table><thead><tr><th>#</th><th>Description</th><th>Category</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">GST</th><th class="num">Amount</th></tr></thead>
          <tbody>@for (it of i.items; track $index) { <tr><td>{{ $index + 1 }}</td><td>{{ it.desc }}</td><td>{{ it.category }}</td><td class="num">{{ it.qty }}</td><td class="num">{{ it.rate | inr }}</td><td class="num">{{ it.taxPct }}%</td><td class="num">{{ it.qty * it.rate | inr }}</td></tr> }</tbody></table>
        <div style="display:grid;grid-template-columns:1fr auto;gap:4px 24px;margin-left:auto;min-width:260px;font-size:13px">
          <span>Subtotal</span><b class="num">{{ t.sub | inr }}</b>
          @if (t.discount) {<span>Discount ({{ i.discountPct }}%)</span><b class="num">− {{ t.discount | inr }}</b>}
          <span>GST (CGST + SGST)</span><b class="num">{{ t.tax | inr }}</b>
          <span style="font-size:15px;font-weight:800">Total</span><b class="num" style="font-size:15px">{{ t.total | inr }}</b>
          <span>Paid</span><b class="num">{{ t.paid | inr }}</b><span>Balance</span><b class="num" [style.color]="t.due ? '#b42318' : '#15803d'">{{ t.due | inr }}</b>
        </div>
        <div style="font-size:12px">Amount in words: <b>Rupees {{ inWords() }} only</b></div>
        @if (i.payments.length) { <div style="font-size:12px">Payments: @for (py of i.payments; track py.id) {<span>{{ py.date | d }} {{ py.mode }} {{ py.amount | inr }}{{ $last ? '' : ' · ' }}</span>}</div> }
        <div class="foot"><b style="color:#b45309">PROTOTYPE INVOICE · FICTIONAL DATA · NOT A TAX DOCUMENT</b><br>GST rates shown are illustrative. Healthcare services are generally GST-exempt in India; pharmacy items are not.</div>
      </div>
      <div class="stack">
        <div class="card stack-s">
          <div class="row"><cf-status [s]="i.status"></cf-status><span class="spacer"></span><b class="big-num">{{ t.due | inr }}</b></div><span class="muted small">Balance due</span>
          @if (t.due > 0) {
            <div class="field"><label>Mode</label><div class="chips">@for (m of modes; track m) {<button class="chip" [class.on]="mode === m" (click)="mode = m">{{ m }}</button>}</div></div>
            <div class="field"><label>Amount</label><input class="inp" type="number" [(ngModel)]="amt"></div>
            <button class="btn" (click)="pay()">Record payment</button>
          }
        </div>
        <div class="card stack-s">
          <b>Payments and refunds</b>
          <div class="list">
            @for (py of i.payments; track py.id) { <div class="li"><div class="grow"><b>{{ py.amount | inr }} · {{ py.mode }}</b><span>{{ py.date | d:true }} · {{ py.id }}</span></div><span class="st ok">Paid</span></div> }
            @for (r of i.refunds; track r.id) { <div class="li"><div class="grow"><b>− {{ r.amount | inr }} refund</b><span>{{ r.ref }}</span></div><span class="st v">Refund</span></div> }
            @if (!i.payments.length && !i.refunds.length) { <p class="muted small">No payments yet.</p> }
          </div>
          @if (t.paid > 0) {
            @if (refundOpen()) {
              <div class="soft stack-s"><div class="field"><label>Refund amount</label><input class="inp" type="number" [(ngModel)]="refAmt"></div>
                <div class="field"><label>Reason <span class="req">*</span></label><input class="inp" [(ngModel)]="refWhy" placeholder="e.g. Test cancelled"></div>
                <div class="row"><button class="btn danger sm" [disabled]="!refWhy || !refAmt || refAmt > t.paid" (click)="refund()">Refund</button><button class="btn ghost sm" (click)="refundOpen.set(false)">Cancel</button></div></div>
            } @else { <button class="btn ghost sm" (click)="refundOpen.set(true); refAmt = t.paid">Issue refund</button> }
          }
        </div>
        @if (i.claimId) { <a class="btn ghost" routerLink="/insurance" [queryParams]="{ claim: i.claimId }"><lucide-icon name="shield-check" [size]="16"></lucide-icon>Open claim {{ i.claimId }}</a> }
      </div>
    </div>
  </div>
  } @else { <cf-empty icon="receipt" title="Invoice not found"><a class="btn" routerLink="/billing" style="margin-top:10px">Back to billing</a></cf-empty> }`
})
export class InvoiceViewPage {
  store = inject(StoreService); toast = inject(ToastService); printer = inject(ExportService);
  id = input<string>(''); modes: PayMode[] = ['Cash', 'UPI', 'Card', 'Bank transfer']; mode: PayMode = 'UPI'; amt = 0; refundOpen = signal(false); refAmt = 0; refWhy = '';
  inv = computed(() => { this.store.rev(); const i = this.store.db.invoices.find(x => x.id === this.id()); if (i) this.amt = this.store.invoiceTotals(i).due; return i; });
  totals = computed(() => { this.store.rev(); return this.store.invoiceTotals(this.inv()!); });
  inWords = computed(() => { const w = words(this.totals().total); return w.charAt(0).toUpperCase() + w.slice(1); });
  pay() { const i = this.inv()!; if (!this.amt || this.amt > this.totals().due) { this.toast.err('Enter an amount up to the balance due'); return; } this.store.pay(i, this.mode, this.amt); this.toast.ok(`Payment of ₹${new Intl.NumberFormat('en-IN').format(this.amt)} recorded`); }
  refund() { this.store.refund(this.inv()!, this.refAmt, this.refWhy); this.toast.ok('Refund recorded and flagged in the audit log'); this.refundOpen.set(false); this.refWhy = ''; }
  send() { const i = this.inv()!; this.store.notify('WhatsApp', 'Payment reminder', i.patientId, `Receipt for ${i.id}: ₹${this.totals().total}. Thank you.`); this.toast.ok('Receipt sent on WhatsApp and email (simulated)'); }
}
