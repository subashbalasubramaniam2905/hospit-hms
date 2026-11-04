import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { Claim, ClaimStatus } from '../../core/models';
import { BillingService } from '../../core/services/billing.service';
import { apiError } from '../../core/api/billing-api';

const FLOW: ClaimStatus[] = ['Draft', 'Submitted', 'Under review', 'Approved', 'Settled'];
const DOCS = ['Pre-auth form', 'ID proof', 'Policy card', 'Doctor notes', 'Investigation reports', 'Invoice', 'Discharge summary'];

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.pipe { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:10px } .pipe button { border:1px solid var(--line); background:var(--card); border-radius:12px; padding:12px; text-align:left; color:var(--fg) } .pipe button.on { border-color:var(--pri); box-shadow:inset 0 0 0 1px var(--pri) } .pipe b { font-size:20px; display:block } .pipe span { font-size:12px; color:var(--mut); font-weight:600 } .pipe small { display:block; font-size:12px; color:var(--mut) } @media (max-width:900px){ .pipe { grid-template-columns:repeat(3,1fr) } }`],
  template: `
  <div class="page">
    <cf-page-head title="Insurance & claims" [crumbs]="['Finance', 'Insurance']" sub="Pre-authorisations and claims with insurers and TPAs. Portal submission is simulated.">
      <span class="demo-tag">{{ bill.live ? 'Insurer responses are recorded by hand. TPA / NHCX not connected yet' : 'TPA / NHCX connection simulated' }}</span>
    </cf-page-head>
    <div class="pipe">@for (s of pipe; track s) { <button [class.on]="status() === s" (click)="status.set(status() === s ? '' : s)"><b>{{ count(s) }}</b><span>{{ s }}</span><small>{{ value(s) | inr:true }}</small></button> }</div>
    <div class="card">
      <cf-table [rows]="rows()" [cols]="cols" [clickable]="true" (rowClick)="open($event)">
        <ng-template cfCell="patient" let-c><div class="pname"><cf-avatar [name]="bill.pname(c)"></cf-avatar><div>{{ bill.pname(c) }}<small>{{ bill.claimLabel(c) }}</small></div></div></ng-template>
        <ng-template cfCell="provider" let-c>{{ c.providerName ?? bill.provider(c.providerId)?.name }}<div class="small muted">{{ c.tpa ?? bill.provider(c.providerId)?.tpa }}</div></ng-template>
        <ng-template cfCell="claimed" let-c>{{ c.claimed | inr }}</ng-template>
        <ng-template cfCell="approved" let-c>{{ c.approved ? (c.approved | inr) : '—' }}</ng-template>
        <ng-template cfCell="status" let-c><cf-status [s]="c.status"></cf-status></ng-template>
      </cf-table>
    </div>
  </div>
  <cf-drawer [open]="!!sel()" [title]="sel() ? bill.claimLabel(sel()!) : ''" [sub]="sel() ? bill.pname(sel()!) + ' · ' + sel()!.type : ''" width="min(560px,100%)" (closed)="sel.set(null)">
    @if (sel(); as c) {
      <div class="stepper">@for (s of flow; track s; let i = $index) {<span class="s" [class.done]="i < idx(c)" [class.cur]="i === idx(c)">{{ s }}</span>}</div>
      @if (c.status === 'Rejected') { <div class="alert-box crit"><lucide-icon name="circle-x" [size]="16"></lucide-icon><div><b>Rejected</b><div>{{ c.rejectionReason }}</div></div></div> }
      <div class="kv">
        <div><small>Insurer</small><b>{{ c.providerName ?? bill.provider(c.providerId)?.name }}</b></div><div><small>Policy</small><b>{{ c.policyNo }}</b></div>
        <div><small>Claimed</small><b>{{ c.claimed | inr }}</b></div><div><small>Approved</small><b>{{ c.approved | inr }}</b></div>
        <div><small>Co-pay</small><b>{{ c.copay }}%</b></div><div><small>Patient pays</small><b>{{ c.claimed - c.approved > 0 && c.approved ? (c.claimed - c.approved | inr) : '—' }}</b></div>
      </div>
      <div class="section-title">Documents</div>
      <div class="stack-s">@for (d of docs; track d) { <mat-checkbox [checked]="c.docs.includes(d)" (change)="toggleDoc(c, d)" [disabled]="busy() || !['Draft', 'Rejected'].includes(c.status)">{{ d }}</mat-checkbox> }</div>
      @if (c.status === 'Approved') { <div class="soft stack-s"><div class="field"><label>UTR / settlement reference <span class="req">*</span></label><input class="inp" [(ngModel)]="utr"></div></div> }
      @if (c.status === 'Under review') { <div class="soft stack-s"><b>Insurer decision{{ bill.live ? '' : ' (simulate)' }}</b><div class="field"><label>Approved amount</label><input class="inp" type="number" [(ngModel)]="appr"></div><div class="field"><label>Rejection reason (if rejecting)</label><input class="inp" [(ngModel)]="why"></div></div> }
      <div class="section-title">History</div>
      <div class="tl">@for (h of c.history; track $index) { <div class="tl-row"><time>{{ h.date | d }}</time><span class="dot"></span><div><b>{{ h.status }}</b><span class="sub">{{ h.note }}</span></div></div> }</div>
    }
    <div foot>@if (sel(); as c) {
      @switch (c.status) {
        @case ('Draft') { <button class="btn" [disabled]="busy() || c.docs.length < 2" (click)="submit(c)"><lucide-icon name="send" [size]="16"></lucide-icon>Submit to insurer</button> }
        @case ('Submitted') { <button class="btn" [disabled]="busy()" (click)="move(c, 'Under review', { note: 'Acknowledged by TPA' }, bill.live ? 'Marked as under review' : 'TPA acknowledged the claim (simulated)')">{{ bill.live ? 'TPA acknowledged' : 'Simulate TPA acknowledgement' }}</button> }
        @case ('Under review') { <button class="btn ghost" style="color:var(--red)" [disabled]="busy() || !why" (click)="reject(c)">Reject</button><button class="btn" [disabled]="busy()" (click)="approve(c)">Approve</button> }
        @case ('Approved') { <button class="btn" [disabled]="busy() || (bill.live && !utr)" (click)="settle(c)"><lucide-icon name="landmark" [size]="16"></lucide-icon>Record settlement</button> }
        @case ('Rejected') { <button class="btn" [disabled]="busy()" (click)="move(c, 'Submitted', { note: 'Resubmitted with additional documents' }, 'Claim resubmitted')">Resubmit</button> }
        @case ('Settled') { <span class="small muted">Settled. Amount posted to the invoice.</span> }
      }
    }</div>
  </cf-drawer>`
})
export class InsurancePage {
  store = inject(StoreService); bill = inject(BillingService); toast = inject(ToastService);
  flow = FLOW; pipe: ClaimStatus[] = ['Draft', 'Submitted', 'Under review', 'Approved', 'Rejected', 'Settled']; docs = DOCS;
  status = signal(''); sel = signal<Claim | null>(null); appr = 0; why = ''; utr = ''; busy = signal(false);
  cols = [
    { key: 'patient', label: 'Patient', value: (c: Claim) => this.bill.pname(c) }, { key: 'provider', label: 'Insurer / TPA', value: (c: Claim) => c.providerName ?? this.bill.provider(c.providerId)?.name },
    { key: 'type', label: 'Type' }, { key: 'created', label: 'Created' }, { key: 'claimed', label: 'Claimed', align: 'right' as const }, { key: 'approved', label: 'Approved', align: 'right' as const }, { key: 'status', label: 'Status' },
  ];
  constructor() {
    const id = inject(ActivatedRoute).snapshot.queryParamMap.get('claim');
    if (this.bill.live) {
      this.bill.loadClaims().then(() => { const c = this.bill.claims().find(x => x.id === id); if (c) this.open(c); }).catch(e => this.toast.err(apiError(e, 'Could not load claims')));
    } else { const c = this.store.db.claims.find(x => x.id === id); if (c) this.open(c); }
  }
  all = computed(() => { if (this.bill.live) return this.bill.claims(); this.store.rev(); return this.store.db.claims; });
  rows = computed(() => this.all().filter(c => !this.status() || c.status === this.status()));
  open(c: Claim) { this.sel.set(c); this.appr = c.approved || Math.round(c.claimed * 0.85); this.utr = ''; }
  count(s: ClaimStatus) { return this.all().filter(c => c.status === s).length; }
  value(s: ClaimStatus) { return this.all().filter(c => c.status === s).reduce((t, c) => t + (c.approved || c.claimed), 0); }
  idx(c: Claim) { return c.status === 'Rejected' ? 2 : FLOW.indexOf(c.status); }
  private async act(f: () => Promise<Claim>, ok: string, tone: 'ok' | 'warn' | 'info' = 'ok') {
    this.busy.set(true);
    try { const c = await f(); this.sel.set(c); this.toast[tone](ok); return c; }
    catch (e) { this.toast.err(apiError(e)); return null; } finally { this.busy.set(false); }
  }
  toggleDoc(c: Claim, d: string) { void this.act(() => this.bill.setClaimDocs(c, c.docs.includes(d) ? c.docs.filter(x => x !== d) : [...c.docs, d]), `Documents updated`, 'info'); }
  move(c: Claim, to: ClaimStatus, extra: { note?: string }, ok: string) { void this.act(() => this.bill.moveClaim(c, to, extra), ok, to === 'Under review' ? 'info' : 'ok'); }
  async submit(c: Claim) {
    const n = c.docs.length;
    if (await this.act(() => this.bill.moveClaim(c, 'Submitted', { note: `Submitted with ${n} documents` }), `${this.bill.claimLabel(c)} submitted to ${c.tpa ?? this.bill.provider(c.providerId)?.tpa}` + (this.bill.live ? '' : ' (simulated)'))) this.appr = Math.round(c.claimed * 0.85);
  }
  approve(c: Claim) { const a = +this.appr || Math.round(c.claimed * 0.85); void this.act(() => this.bill.moveClaim(c, 'Approved', { approved: a }), `Approved for ₹${new Intl.NumberFormat('en-IN').format(a)}`); }
  async reject(c: Claim) {
    const why = this.why;
    if (await this.act(() => this.bill.moveClaim(c, 'Rejected', { rejectionReason: why }), 'Claim rejected.' + (this.bill.live ? '' : ' Alert raised for the insurance desk.'), 'warn')) {
      if (!this.bill.live) this.store.raiseAlert({ priority: 'High', category: 'Billing', dept: 'Insurance desk', title: `Claim ${c.id} rejected`, detail: why, assignee: 'Kiran Shetty', link: '/insurance' });
      this.why = '';
    }
  }
  async settle(c: Claim) {
    const ref = this.bill.live ? this.utr.trim() : 'UTR DEMO' + Math.floor(Math.random() * 90000 + 10000);
    const inv = c.invoiceNumber ?? c.invoiceId;
    await this.act(() => this.bill.moveClaim(c, 'Settled', { settlementRef: ref }), 'Settlement recorded' + (inv ? ` and posted to ${inv}` : ''));
  }
}
