import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { InvoiceItem, PayMode, ServiceItem } from '../../core/models';

@Component({
  standalone: true, imports: [SHARED],
  styles: [`
    .drop { border:1px solid var(--line); border-radius:12px; overflow:hidden; margin-top:6px; max-height:260px; overflow-y:auto }
    .drop button { display:flex; gap:10px; width:100%; padding:9px 12px; border:0; border-bottom:1px solid var(--line); background:none; text-align:left; color:var(--fg) } .drop button:hover { background:var(--ground) }
    table.t .inp { padding:6px 8px; font-size:13px }
    .tot { display:grid; grid-template-columns:1fr auto; gap:6px 16px; font-size:14px } .tot b { text-align:right; font-variant-numeric:tabular-nums } .tot .g { font-size:18px; font-weight:800 }
    .sticky { position:sticky; top:84px }
  `],
  template: `
  <div class="page">
    <cf-page-head title="New invoice" [crumbs]="['Billing', 'Create']" sub="Add services from the tariff. GST is applied per item."><a class="btn ghost" routerLink="/billing">Cancel</a></cf-page-head>
    <div class="grid">
      <div class="c8 stack">
        <div class="card">
          <div class="form-grid">
            <div class="field"><label>Patient <span class="req">*</span></label>
              @if (patient(); as p) { <div class="soft row"><cf-avatar [name]="p.name"></cf-avatar><div style="flex:1"><b>{{ p.name }}</b><div class="small muted">{{ p.id }} · {{ p.insurance ? store.provider(p.insurance.providerId)?.name : 'Self pay' }}</div></div><button class="btn ghost sm" (click)="pid.set('')">Change</button></div> }
              @else { <input class="inp" [ngModel]="pq()" (ngModelChange)="pq.set($event)" placeholder="Search patient by name, UHID or mobile">
                @if (pq().length > 1) {<div class="drop">@for (p of matches(); track p.id) {<button (click)="setPatient(p.id)">{{ p.name }} · {{ p.id }}</button>}</div>} }</div>
            <div class="field"><label>Invoice type</label><select class="inp" [(ngModel)]="kind"><option>OPD</option><option>Lab</option><option>Pharmacy</option><option>IPD</option></select></div>
          </div>
          @if (pending().length) { <div class="alert-box info" style="margin-top:12px"><lucide-icon name="info" [size]="16"></lucide-icon><div style="flex:1">{{ pending().length }} unbilled item(s) found for this patient.</div><button class="btn sm" (click)="addPending()">Add them</button></div> }
        </div>
        <div class="card">
          <div class="card-h"><h3>Items</h3></div>
          <label class="search boxed"><lucide-icon name="search" [size]="16"></lucide-icon><input [ngModel]="sq()" (ngModelChange)="sq.set($event)" (keydown.enter)="addFirst()" placeholder="Search tariff: consultation, CBC, X-ray, room, dressing…" aria-label="Search services"></label>
          @if (sq().length > 1) { <div class="drop">@for (s of services(); track s.id) {<button (click)="add(s)"><div style="flex:1"><b>{{ s.name }}</b><div class="small muted">{{ s.category }}{{ s.taxPct ? ' · GST ' + s.taxPct + '%' : ' · GST exempt' }}</div></div><b>{{ s.price | inr }}</b></button>} @empty {<div style="padding:12px" class="small muted">No service found.</div>}</div> }
          <div class="tbl" style="margin-top:12px"><table class="t">
            <thead><tr><th>Description</th><th>Category</th><th style="width:80px">Qty</th><th style="width:110px">Rate</th><th style="width:80px">GST %</th><th class="num">Amount</th><th></th></tr></thead>
            <tbody>@for (it of items(); track $index; let i = $index) {
              <tr><td><input class="inp" [(ngModel)]="it.desc"></td><td class="small">{{ it.category }}</td>
                <td><input class="inp" type="number" min="1" [(ngModel)]="it.qty" (ngModelChange)="bump()"></td><td><input class="inp" type="number" min="0" [(ngModel)]="it.rate" (ngModelChange)="bump()"></td>
                <td><input class="inp" type="number" min="0" [(ngModel)]="it.taxPct" (ngModelChange)="bump()"></td><td class="num">{{ it.qty * it.rate * (1 + it.taxPct / 100) | inr }}</td>
                <td><button class="iconbtn" (click)="remove(i)" aria-label="Remove"><lucide-icon name="trash-2" [size]="15"></lucide-icon></button></td></tr>
            } @empty { <tr><td colspan="7" class="muted" style="text-align:center;padding:20px">Search the tariff above to add items.</td></tr> }</tbody>
          </table></div>
        </div>
      </div>
      <div class="c4">
        <div class="card sticky stack">
          <h3 style="font-size:15.5px">Summary</h3>
          <div class="tot">
            <span>Subtotal</span><b>{{ t().sub | inr }}</b>
            <span>Discount <input class="inp" type="number" min="0" max="100" style="width:64px;display:inline-block;padding:4px 6px" [(ngModel)]="disc" (ngModelChange)="bump()"> %</span><b>− {{ t().discount | inr }}</b>
            <span>GST</span><b>{{ t().tax | inr }}</b>
            <span class="g">Total</span><b class="g">{{ t().total | inr }}</b>
          </div>
          @if (disc > 10) { <div class="alert-box warn small"><lucide-icon name="triangle-alert" [size]="14"></lucide-icon>Discounts above 10% need billing manager approval (logged).</div> }
          @if (patient()?.insurance) {
            <mat-slide-toggle [(ngModel)]="useIns">Bill insurance ({{ store.provider(patient()!.insurance!.providerId)?.name }})</mat-slide-toggle>
            @if (useIns) { <div class="soft small">Claim {{ t().total * 0.9 | inr }} to insurer, patient pays 10% co-pay {{ t().total * 0.1 | inr }}. A draft claim will be created.</div> }
          }
          <div class="field"><label>Collect now</label><div class="chips">@for (m of modes; track m) {<button class="chip" [class.on]="mode === m" (click)="mode = m">{{ m }}</button>}</div></div>
          @if (mode !== 'Later') { <div class="field"><label>Amount received</label><input class="inp" type="number" [(ngModel)]="paid" [placeholder]="'' + payable()"></div> }
          <button class="btn" [disabled]="!patient() || !items().length" (click)="create()"><lucide-icon name="receipt" [size]="16"></lucide-icon>Create invoice</button>
        </div>
      </div>
    </div>
  </div>`
})
export class InvoiceNewPage {
  store = inject(StoreService); toast = inject(ToastService); router = inject(Router);
  modes: (PayMode | 'Later')[] = ['Cash', 'UPI', 'Card', 'Later'];
  pid = signal(''); pq = signal(''); sq = signal(''); items = signal<InvoiceItem[]>([]); rev = signal(0);
  kind: 'OPD' | 'IPD' | 'Pharmacy' | 'Lab' = 'OPD'; disc = 0; useIns = false; mode: PayMode | 'Later' = 'UPI'; paid: number | null = null;
  constructor() { const p = inject(ActivatedRoute).snapshot.queryParamMap.get('patient'); if (p) this.setPatient(p); }
  patient = computed(() => this.store.patient(this.pid()));
  matches = computed(() => { const q = this.pq().toLowerCase(); return this.store.db.patients.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || p.mobile.replace(/\D/g, '').includes(q)).slice(0, 6); });
  services = computed(() => { const q = this.sq().toLowerCase(); const docs: ServiceItem[] = this.store.db.doctors.map(d => ({ id: 'SV-C' + d.id, name: `Consultation · ${d.name}`, category: 'Consultation', price: d.fee, taxPct: 0 })); return [...docs, ...this.store.db.services].filter(s => s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)).slice(0, 10); });
  pending = computed(() => { this.store.rev(); return this.store.db.consultations.filter(c => c.patientId === this.pid() && c.status === 'Completed' && !c.billed && !this.items().some(i => i.refId === c.id)); });
  t = computed(() => { this.rev(); const inv = { items: this.items(), discountPct: this.disc || 0, payments: [], refunds: [] } as unknown as Parameters<StoreService['invoiceTotals']>[0]; return this.store.invoiceTotals(inv); });
  payable = computed(() => { this.rev(); return Math.round(this.useIns ? this.t().total * 0.1 : this.t().total); });

  setPatient(id: string) { this.pid.set(id); this.pq.set(''); const p = this.store.patient(id); this.useIns = false; const d = this.store.doctor(p?.primaryDoctorId); if (d && !this.items().length) this.items.set([{ desc: `Consultation · ${d.name}`, category: 'Consultation', qty: 1, rate: d.fee, taxPct: 0 }]); this.bump(); }
  add(s: ServiceItem) { this.items.update(l => [...l, { desc: s.name, category: s.category as InvoiceItem['category'], qty: 1, rate: s.price, taxPct: s.taxPct }]); this.sq.set(''); this.bump(); }
  addFirst() { const s = this.services()[0]; if (s) this.add(s); }
  addPending() { this.items.update(l => [...l, ...this.pending().map(c => ({ desc: `Consultation · ${this.store.dname(c.doctorId)} (${c.date})`, category: 'Consultation' as const, qty: 1, rate: this.store.doctor(c.doctorId)?.fee || 600, taxPct: 0, refId: c.id }))]); this.bump(); }
  remove(i: number) { this.items.update(l => l.filter((_, k) => k !== i)); this.bump(); }
  bump() { this.rev.update(v => v + 1); }
  create() {
    const p = this.patient()!; const inv = this.store.createInvoice(p.id, this.items().map(i => ({ ...i, qty: +i.qty, rate: +i.rate, taxPct: +i.taxPct })), +this.disc || 0, this.kind);
    if (this.disc > 10) this.store.log('Approved', 'Discount', `${inv.id} discount ${this.disc}%`, 'Flagged');
    if (this.useIns && p.insurance) {
      const total = this.store.invoiceTotals(inv).total;
      const c = { id: 'CLM-' + (3200 + this.store.db.claims.length), patientId: p.id, invoiceId: inv.id, providerId: p.insurance.providerId, policyNo: p.insurance.policyNo, claimed: Math.round(total * 0.9), approved: 0, copay: 10, status: 'Draft' as const, type: 'Final claim' as const, created: this.store.today(), docs: ['Invoice', 'Doctor notes'], history: [{ date: this.store.today(), status: 'Draft' as const, note: 'Created from invoice' }] };
      this.store.db.claims.unshift(c); inv.claimId = c.id;
    }
    if (this.mode !== 'Later') { const amt = this.paid ?? this.payable(); if (amt > 0) this.store.pay(inv, this.mode, Math.min(amt, this.store.invoiceTotals(inv).total)); }
    this.store.changed(); this.toast.ok(`${inv.id} created for ${p.name}`); this.router.navigate(['/billing/invoice', inv.id]);
  }
}
