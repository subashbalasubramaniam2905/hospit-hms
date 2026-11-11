import { Component, computed, inject, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { ToastService } from '../../core/services/toast.service';
import { SessionService } from '../../core/services/session.service';
import { StoreService } from '../../core/services/store.service';
import { FinanceService } from '../../core/services/finance.service';
import { apiError } from '../../core/api/billing-api';
import { TallyFormat, TallyLedger, TallyLog, TallyPreview, TallyVoucher } from '../../core/api/finance-api';
import { isoDay } from '../../core/data/seed';
import { periodRange } from './expenses';

type Quick = 'This month' | 'Last month' | 'This quarter' | 'FY' | 'Custom';
const SOURCE: Record<TallyVoucher['source'], string> = { INVOICE: 'Invoice', RECEIPT: 'Receipt', REFUND: 'Refund', EXPENSE: 'Expense' };

@Component({
  standalone: true, imports: [SHARED],
  styles: [`
    .dl { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px }
    .dl button { text-align:left; border:1px solid var(--line); background:var(--card); border-radius:14px; padding:14px; color:var(--fg); display:flex; flex-direction:column; gap:6px; cursor:pointer }
    .dl button:hover:not(:disabled) { border-color:var(--pri); box-shadow:inset 0 0 0 1px var(--pri) }
    .dl button:disabled { opacity:.55; cursor:not-allowed }
    .dl .ic { width:36px; height:36px; border-radius:10px; display:grid; place-items:center; background:var(--pri-soft, var(--ground)); color:var(--pri) }
    .dl b { font-size:14.5px } .dl small { color:var(--mut); font-size:12.5px; line-height:1.4 }
    .steps { margin:0; padding-left:18px; display:flex; flex-direction:column; gap:8px; font-size:13.5px } .steps b { font-weight:600 }
    .ent { width:100%; border-collapse:collapse; font-size:12.5px; margin-top:6px } .ent td { padding:3px 6px; border-top:1px dashed var(--line) } .ent td.n { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap }
    .led { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.3fr) minmax(0,1fr); gap:8px; align-items:center }
    .led.head { font-size:12px; color:var(--mut); font-weight:600 }
    @media (max-width:900px) { .dl { grid-template-columns:1fr } .led { grid-template-columns:1fr 1fr } .led .lb { grid-column:1/-1; font-weight:600; font-size:13px } .led.head { display:none } }
  `],
  template: `
  <div class="page">
    <cf-page-head title="Tally export" [crumbs]="['Finance', 'Tally export']" sub="Send invoices, receipts, refunds and expenses to TallyPrime, or open them in Excel.">
      <a class="btn ghost" routerLink="/expenses"><lucide-icon name="wallet" [size]="16"></lucide-icon>Expenses</a>
    </cf-page-head>
    <div class="grid">
      <div class="card c8">
        <div class="card-h"><h3>Period</h3></div>
        <div class="toolbar">
          <div class="seg">@for (p of quicks; track p) {<button [class.on]="quick() === p" (click)="setQuick(p)">{{ p === 'FY' ? 'This financial year' : p }}</button>}</div>
          @if (quick() === 'Custom') {
            <input class="inp" style="width:auto" type="date" [max]="today" [ngModel]="from()" (ngModelChange)="from.set($event); refresh()" aria-label="From">
            <span class="muted small">to</span>
            <input class="inp" style="width:auto" type="date" [max]="today" [ngModel]="to()" (ngModelChange)="to.set($event); refresh()" aria-label="To">
          }
          @if (branches().length > 1) {
            <select class="inp" style="width:auto" [ngModel]="branch()" (ngModelChange)="branch.set($event); refresh()" aria-label="Branch">
              <option value="">All my branches</option>@for (b of branches(); track b.id) {<option [value]="b.id">{{ b.name }}</option>}
            </select>
          }
        </div>
        <div class="small muted" style="margin-top:8px">{{ from() | d:true }} to {{ to() | d:true }}{{ branch() ? ' · ' + branchName(branch()) : '' }}</div>

        <div class="grid" style="margin-top:14px;gap:12px">
          <cf-stat class="c3" label="Sales invoices" [value]="n('INVOICE')" icon="file-text" tone="pri" [sub]="(amt('INVOICE') | inr) + ' billed'"></cf-stat>
          <cf-stat class="c3" label="Receipts" [value]="n('RECEIPT')" icon="hand-coins" tone="green" [sub]="(amt('RECEIPT') | inr) + ' received'"></cf-stat>
          <cf-stat class="c3" label="Refunds" [value]="n('REFUND')" icon="rotate-ccw" tone="amber" [sub]="(amt('REFUND') | inr) + ' paid back'"></cf-stat>
          <cf-stat class="c3" label="Expenses" [value]="n('EXPENSE')" icon="wallet" tone="red" [sub]="(amt('EXPENSE') | inr) + ' spent'"></cf-stat>
        </div>
        @for (w of preview()?.warnings ?? []; track w) { <div class="alert-box warn" style="margin-top:10px"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon><div>{{ w }}</div></div> }
        @if (error()) { <div class="alert-box crit" style="margin-top:10px"><lucide-icon name="circle-x" [size]="16"></lucide-icon><div>{{ error() }}</div></div> }

        <div class="section-title" style="margin-top:16px">Download</div>
        <div class="dl" style="margin-top:8px">
          <button (click)="download('masters')" [disabled]="busy() || !preview()?.ledgers"><span class="ic"><lucide-icon name="layers" [size]="18"></lucide-icon></span><b>1. Ledgers for Tally</b><small>{{ preview()?.ledgers ?? 0 }} ledgers used in this period. Import once before the vouchers, and again after adding a category.</small></button>
          <button (click)="download('xml')" [disabled]="busy() || !preview()?.vouchers"><span class="ic"><lucide-icon name="file-code" [size]="18"></lucide-icon></span><b>2. Vouchers for Tally</b><small>{{ preview()?.vouchers ?? 0 }} sales, receipt, payment and journal vouchers as TallyPrime XML.</small></button>
          <button (click)="download('csv')" [disabled]="busy() || !preview()?.vouchers"><span class="ic"><lucide-icon name="file-spreadsheet" [size]="18"></lucide-icon></span><b>Day book for Excel</b><small>Every ledger line with debit and credit columns, for your auditor or a quick check.</small></button>
        </div>
      </div>

      <div class="card c4">
        <div class="card-h"><h3>Import into TallyPrime</h3></div>
        <ol class="steps">
          <li>Open the hospital's company in TallyPrime. Set the company name below so the files go to the right one.</li>
          <li>Download <b>Ledgers for Tally</b>. In Tally press <b>Alt+O</b> (Import) &gt; <b>Masters</b>, choose the file. Ledgers that already exist are kept.</li>
          <li>Download <b>Vouchers for Tally</b>, then <b>Alt+O</b> &gt; <b>Transactions</b> and choose it.</li>
          <li>Check the Day Book in Tally for the same dates. Totals should match the cards here.</li>
        </ol>
        <div class="soft small" style="margin-top:12px">Each voucher carries its HospitOS number and a fixed id. Export each period once; if you need to export it again, delete that period's vouchers in Tally first so nothing is counted twice. Cancelled invoices and expenses are never exported.</div>
      </div>

      <div class="card c12">
        <div class="tabs" style="margin-bottom:14px">
          <button [class.on]="tab() === 'preview'" (click)="tab.set('preview')">Vouchers</button>
          <button [class.on]="tab() === 'ledgers'" (click)="tab.set('ledgers'); loadSettings()">Ledger names</button>
          <button [class.on]="tab() === 'history'" (click)="tab.set('history'); loadHistory()">Export history</button>
        </div>
        @switch (tab()) {
          @case ('preview') {
            @if ((preview()?.vouchers ?? 0) > (preview()?.sample?.length ?? 0)) { <div class="small muted" style="margin-bottom:8px">Showing the first {{ preview()!.sample.length }} of {{ preview()!.vouchers }} vouchers. The files have all of them.</div> }
            <cf-table [rows]="preview()?.sample ?? []" [cols]="cols" [pageSize]="10" [clickable]="true" (rowClick)="open.set(open() === $event.remoteId ? '' : $event.remoteId)" emptyIcon="file-spreadsheet" emptyTitle="Nothing to export" emptyText="No invoices, payments or expenses in this period.">
              <ng-template cfCell="number" let-v><b>{{ v.number }}</b><div class="small muted">{{ source[v.source] }}</div></ng-template>
              <ng-template cfCell="date" let-v>{{ v.date | d }}</ng-template>
              <ng-template cfCell="narration" let-v><div class="small">{{ v.narration }}</div>
                @if (open() === v.remoteId) { <table class="ent">@for (e of v.entries; track e.ledger) {<tr><td>{{ e.amount > 0 ? 'Dr' : 'Cr' }}</td><td>{{ e.ledger }}</td><td class="n">{{ abs(e.amount) | inr }}</td></tr>}</table> }
                @else { <span class="small muted">Click to see ledger lines</span> }</ng-template>
              <ng-template cfCell="amount" let-v><b>{{ dr(v) | inr }}</b></ng-template>
            </cf-table>
          }
          @case ('ledgers') {
            @if (settings(); as s) {
              <div class="form-grid" style="margin-bottom:14px">
                <div class="field"><label>Tally company name</label><input class="inp" [(ngModel)]="company" maxlength="120" [disabled]="!manager()" placeholder="Exactly as it appears in TallyPrime"><span class="hint">Leave empty to import into whichever company is open in Tally.</span></div>
                <div class="field"><label>Expense ledgers</label><a class="btn ghost sm" style="align-self:flex-start" routerLink="/expenses">Set them on each expense category</a></div>
              </div>
              <div class="led head"><span>Used for</span><span>Ledger name in Tally</span><span>Under group</span></div>
              <div class="stack-s" style="margin-top:6px">@for (l of ledgers; track l.key) {
                <div class="led"><span class="lb small">{{ l.label }}</span><input class="inp" [(ngModel)]="l.ledgerName" maxlength="120" [disabled]="!manager()" [attr.aria-label]="l.label">
                  <select class="inp" [(ngModel)]="l.tallyGroup" [disabled]="!manager()" [attr.aria-label]="l.label + ' group'">@for (g of s.groups; track g) {<option>{{ g }}</option>}</select></div>
              }</div>
              <div class="toolbar" style="margin-top:14px;justify-content:flex-end">
                @if (!manager()) { <span class="small muted">Only an administrator can change ledger names.</span> }
                @else { <button class="btn ghost" (click)="resetLedgers()">Undo changes</button><button class="btn" [disabled]="busy()" (click)="saveSettings()"><lucide-icon name="save" [size]="16"></lucide-icon>Save ledger names</button> }
              </div>
            } @else { <cf-skeleton [rows]="6"></cf-skeleton> }
          }
          @case ('history') {
            <cf-table [rows]="history()" [cols]="hcols" [pageSize]="10" emptyIcon="history" emptyTitle="Nothing exported yet" emptyText="Each download is listed here with who made it.">
              <ng-template cfCell="period" let-h>{{ h.from | d:true }} to {{ h.to | d:true }}</ng-template>
              <ng-template cfCell="format" let-h>{{ fmtName[h.format] }}</ng-template>
              <ng-template cfCell="at" let-h>{{ h.exportedAt | d:true }} {{ time(h.exportedAt) }}</ng-template>
              <ng-template cfCell="branch" let-h>{{ h.branchId ? branchName(h.branchId) : 'All branches' }}</ng-template>
            </cf-table>
          }
        }
      </div>
    </div>
  </div>`
})
export class TallyPage {
  fin = inject(FinanceService); toast = inject(ToastService); session = inject(SessionService); store = inject(StoreService);
  quicks: Quick[] = ['This month', 'Last month', 'This quarter', 'FY', 'Custom'];
  source: Record<string, string> = SOURCE; fmtName: Record<string, string> = { xml: 'Vouchers (XML)', masters: 'Ledgers (XML)', csv: 'Day book (CSV)' };
  today = isoDay(0);
  quick = signal<Quick>('Last month');
  from = signal(periodRange('Last month').from!); to = signal(periodRange('Last month').to!);
  branch = signal(this.fin.live ? this.session.branchId() : '');
  tab = signal<'preview' | 'ledgers' | 'history'>('preview');
  preview = signal<TallyPreview | null>(null); history = signal<TallyLog[]>([]);
  settings = signal<{ companyName: string; ledgers: TallyLedger[]; groups: string[] } | null>(null);
  ledgers: TallyLedger[] = []; company = '';
  busy = signal(false); error = signal(''); open = signal('');
  manager = computed(() => ['super-admin', 'admin'].includes(this.session.roleId() ?? ''));
  branches = computed(() => { const a = this.session.allowedBranches(); return this.fin.live ? this.store.db.branches.filter(b => !a || a.includes(b.id)) : []; });
  cols = [
    { key: 'number', label: 'Voucher', value: (v: TallyVoucher) => v.number }, { key: 'date', label: 'Date' }, { key: 'type', label: 'Tally type' },
    { key: 'narration', label: 'Narration', sortable: false }, { key: 'amount', label: 'Amount', align: 'right' as const, value: (v: TallyVoucher) => this.dr(v) },
  ];
  hcols = [{ key: 'at', label: 'When', value: (h: TallyLog) => h.exportedAt }, { key: 'period', label: 'Period', value: (h: TallyLog) => h.from }, { key: 'format', label: 'File' },
    { key: 'vouchers', label: 'Records', align: 'right' as const }, { key: 'branch', label: 'Branch', value: (h: TallyLog) => h.branchId ?? '' }, { key: 'exportedBy', label: 'By' }];

  constructor() { this.refresh(); }

  setQuick(p: Quick) {
    this.quick.set(p);
    if (p !== 'Custom') { const r = periodRange(p); this.from.set(r.from!); this.to.set(r.to!); }
    this.refresh();
  }
  async refresh() {
    if (!this.from() || !this.to()) return;
    this.error.set('');
    try { this.preview.set(await this.fin.preview(this.from(), this.to(), this.branch() || undefined)); }
    catch (e) { this.preview.set(null); this.error.set(apiError(e, 'Could not prepare the export')); }
  }
  n(s: TallyVoucher['source']) { return String(this.preview()?.bySource?.[s]?.count ?? 0); }
  amt(s: TallyVoucher['source']) { return this.preview()?.bySource?.[s]?.amount ?? 0; }
  dr(v: TallyVoucher) { return v.entries.filter(e => e.amount > 0).reduce((t, e) => t + e.amount, 0); }
  abs(n: number) { return Math.abs(n); }
  time(iso: string) { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }); }
  branchName(id: string) { return this.store.db.branches.find(b => b.id === id)?.name ?? id; }

  async download(f: TallyFormat) {
    this.busy.set(true);
    try { const name = await this.fin.export(this.from(), this.to(), f, this.branch() || undefined); this.toast.ok(`Downloaded ${name}`); if (this.tab() === 'history') this.loadHistory(); }
    catch (e) { this.toast.err(apiError(e, 'Could not export')); } finally { this.busy.set(false); }
  }
  async loadSettings() {
    try { const s = await this.fin.tallySettings(); this.settings.set(s); this.resetLedgers(); }
    catch (e) { this.toast.err(apiError(e, 'Could not load ledger names')); }
  }
  resetLedgers() { const s = this.settings(); if (!s) return; this.company = s.companyName; this.ledgers = s.ledgers.map(l => ({ ...l })); }
  async saveSettings() {
    if (this.ledgers.some(l => !l.ledgerName.trim())) { this.toast.err('Every ledger needs a name'); return; }
    this.busy.set(true);
    try { const s = await this.fin.saveTallySettings(this.company, this.ledgers); this.settings.set(s); this.resetLedgers(); this.toast.ok('Ledger names saved'); this.refresh(); }
    catch (e) { this.toast.err(apiError(e)); } finally { this.busy.set(false); }
  }
  async loadHistory() { try { this.history.set(await this.fin.history()); } catch (e) { this.toast.err(apiError(e, 'Could not load history')); } }
}
