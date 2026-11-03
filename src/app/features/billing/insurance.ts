import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { Claim, ClaimStatus } from '../../core/models';

const FLOW: ClaimStatus[] = ['Draft', 'Submitted', 'Under review', 'Approved', 'Settled'];
const DOCS = ['Pre-auth form', 'ID proof', 'Policy card', 'Doctor notes', 'Investigation reports', 'Invoice', 'Discharge summary'];

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.pipe { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:10px } .pipe button { border:1px solid var(--line); background:var(--card); border-radius:12px; padding:12px; text-align:left; color:var(--fg) } .pipe button.on { border-color:var(--pri); box-shadow:inset 0 0 0 1px var(--pri) } .pipe b { font-size:20px; display:block } .pipe span { font-size:12px; color:var(--mut); font-weight:600 } .pipe small { display:block; font-size:12px; color:var(--mut) } @media (max-width:900px){ .pipe { grid-template-columns:repeat(3,1fr) } }`],
  template: `
  <div class="page">
    <cf-page-head title="Insurance & claims" [crumbs]="['Finance', 'Insurance']" sub="Pre-authorisations and claims with insurers and TPAs. Portal submission is simulated.">
      <span class="demo-tag">TPA / NHCX connection simulated</span>
    </cf-page-head>
    <div class="pipe">@for (s of pipe; track s) { <button [class.on]="status() === s" (click)="status.set(status() === s ? '' : s)"><b>{{ count(s) }}</b><span>{{ s }}</span><small>{{ value(s) | inr:true }}</small></button> }</div>
    <div class="card">
      <cf-table [rows]="rows()" [cols]="cols" [clickable]="true" (rowClick)="sel.set($event)">
        <ng-template cfCell="patient" let-c><div class="pname"><cf-avatar [name]="store.pname(c.patientId)"></cf-avatar><div>{{ store.pname(c.patientId) }}<small>{{ c.id }}</small></div></div></ng-template>
        <ng-template cfCell="provider" let-c>{{ store.provider(c.providerId)?.name }}<div class="small muted">{{ store.provider(c.providerId)?.tpa }}</div></ng-template>
        <ng-template cfCell="claimed" let-c>{{ c.claimed | inr }}</ng-template>
        <ng-template cfCell="approved" let-c>{{ c.approved ? (c.approved | inr) : '—' }}</ng-template>
        <ng-template cfCell="status" let-c><cf-status [s]="c.status"></cf-status></ng-template>
      </cf-table>
    </div>
  </div>
  <cf-drawer [open]="!!sel()" [title]="sel()?.id || ''" [sub]="sel() ? store.pname(sel()!.patientId) + ' · ' + sel()!.type : ''" width="min(560px,100%)" (closed)="sel.set(null)">
    @if (sel(); as c) {
      <div class="stepper">@for (s of flow; track s; let i = $index) {<span class="s" [class.done]="i < idx(c)" [class.cur]="i === idx(c)">{{ s }}</span>}</div>
      @if (c.status === 'Rejected') { <div class="alert-box crit"><lucide-icon name="circle-x" [size]="16"></lucide-icon><div><b>Rejected</b><div>{{ c.rejectionReason }}</div></div></div> }
      <div class="kv">
        <div><small>Insurer</small><b>{{ store.provider(c.providerId)?.name }}</b></div><div><small>Policy</small><b>{{ c.policyNo }}</b></div>
        <div><small>Claimed</small><b>{{ c.claimed | inr }}</b></div><div><small>Approved</small><b>{{ c.approved | inr }}</b></div>
        <div><small>Co-pay</small><b>{{ c.copay }}%</b></div><div><small>Patient pays</small><b>{{ c.claimed - c.approved > 0 && c.approved ? (c.claimed - c.approved | inr) : '—' }}</b></div>
      </div>
      <div class="section-title">Documents</div>
      <div class="stack-s">@for (d of docs; track d) { <mat-checkbox [checked]="c.docs.includes(d)" (change)="toggleDoc(c, d)" [disabled]="idx(c) >= 3">{{ d }}</mat-checkbox> }</div>
      @if (c.status === 'Under review') { <div class="soft stack-s"><b>Insurer decision (simulate)</b><div class="field"><label>Approved amount</label><input class="inp" type="number" [(ngModel)]="appr"></div><div class="field"><label>Rejection reason (if rejecting)</label><input class="inp" [(ngModel)]="why"></div></div> }
      <div class="section-title">History</div>
      <div class="tl">@for (h of c.history; track $index) { <div class="tl-row"><time>{{ h.date | d }}</time><span class="dot"></span><div><b>{{ h.status }}</b><span class="sub">{{ h.note }}</span></div></div> }</div>
    }
    <div foot>@if (sel(); as c) {
      @switch (c.status) {
        @case ('Draft') { <button class="btn" [disabled]="c.docs.length < 2" (click)="submit(c)"><lucide-icon name="send" [size]="16"></lucide-icon>Submit to insurer</button> }
        @case ('Submitted') { <button class="btn" (click)="store.setClaim(c, 'Under review', 'Acknowledged by TPA'); toast.info('TPA acknowledged the claim (simulated)')">Simulate TPA acknowledgement</button> }
        @case ('Under review') { <button class="btn ghost" style="color:var(--red)" [disabled]="!why" (click)="reject(c)">Reject</button><button class="btn" (click)="approve(c)">Approve</button> }
        @case ('Approved') { <button class="btn" (click)="settle(c)"><lucide-icon name="landmark" [size]="16"></lucide-icon>Record settlement</button> }
        @case ('Rejected') { <button class="btn" (click)="store.setClaim(c, 'Submitted', 'Resubmitted with additional documents'); toast.ok('Claim resubmitted')">Resubmit</button> }
        @case ('Settled') { <span class="small muted">Settled. Amount posted to the invoice.</span> }
      }
    }</div>
  </cf-drawer>`
})
export class InsurancePage {
  store = inject(StoreService); toast = inject(ToastService);
  flow = FLOW; pipe: ClaimStatus[] = ['Draft', 'Submitted', 'Under review', 'Approved', 'Rejected', 'Settled']; docs = DOCS;
  status = signal(''); sel = signal<Claim | null>(null); appr = 0; why = '';
  cols = [
    { key: 'patient', label: 'Patient', value: (c: Claim) => this.store.pname(c.patientId) }, { key: 'provider', label: 'Insurer / TPA', value: (c: Claim) => this.store.provider(c.providerId)?.name },
    { key: 'type', label: 'Type' }, { key: 'created', label: 'Created' }, { key: 'claimed', label: 'Claimed', align: 'right' as const }, { key: 'approved', label: 'Approved', align: 'right' as const }, { key: 'status', label: 'Status' },
  ];
  constructor() { const id = inject(ActivatedRoute).snapshot.queryParamMap.get('claim'); const c = this.store.db.claims.find(x => x.id === id); if (c) this.sel.set(c); }
  all = computed(() => { this.store.rev(); return this.store.db.claims; });
  rows = computed(() => this.all().filter(c => !this.status() || c.status === this.status()));
  count(s: ClaimStatus) { return this.all().filter(c => c.status === s).length; }
  value(s: ClaimStatus) { return this.all().filter(c => c.status === s).reduce((t, c) => t + (c.approved || c.claimed), 0); }
  idx(c: Claim) { return c.status === 'Rejected' ? 2 : FLOW.indexOf(c.status); }
  toggleDoc(c: Claim, d: string) { c.docs = c.docs.includes(d) ? c.docs.filter(x => x !== d) : [...c.docs, d]; this.store.changed(); }
  submit(c: Claim) { this.store.setClaim(c, 'Submitted', `Submitted with ${c.docs.length} documents`); this.toast.ok(`${c.id} submitted to ${this.store.provider(c.providerId)?.tpa} (simulated)`); this.appr = Math.round(c.claimed * 0.85); }
  approve(c: Claim) { const a = +this.appr || Math.round(c.claimed * 0.85); this.store.setClaim(c, 'Approved', `Approved ₹${a}`, { approved: a }); this.toast.ok(`Approved for ₹${new Intl.NumberFormat('en-IN').format(a)}`); }
  reject(c: Claim) { this.store.setClaim(c, 'Rejected', this.why, { rejectionReason: this.why }); this.store.raiseAlert({ priority: 'High', category: 'Billing', dept: 'Insurance desk', title: `Claim ${c.id} rejected`, detail: this.why, assignee: 'Kiran Shetty', link: '/insurance' }); this.toast.warn('Claim rejected. Alert raised for the insurance desk.'); this.why = ''; }
  settle(c: Claim) {
    this.store.setClaim(c, 'Settled', 'UTR DEMO' + Math.floor(Math.random() * 90000 + 10000));
    const inv = this.store.db.invoices.find(i => i.id === c.invoiceId); if (inv) this.store.pay(inv, 'Insurance', Math.min(c.approved, this.store.invoiceTotals(inv).due));
    this.toast.ok('Settlement recorded' + (inv ? ` and posted to ${inv.id}` : ''));
  }
}
