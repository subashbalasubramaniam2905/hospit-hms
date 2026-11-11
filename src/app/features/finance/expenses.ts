import { Component, computed, inject, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { ToastService } from '../../core/services/toast.service';
import { ExportService } from '../../core/services/export.service';
import { SessionService } from '../../core/services/session.service';
import { FinanceService, MODE_LABEL } from '../../core/services/finance.service';
import { EXPENSE_GROUPS } from '../../core/services/tally';
import { apiError } from '../../core/api/billing-api';
import { ExpMode, Expense, ExpenseCategory } from '../../core/api/finance-api';
import { isoDay } from '../../core/data/seed';

type Period = 'This month' | 'Last month' | 'Last 3 months' | 'This financial year' | 'All';
interface Draft { date: string; categoryId: string; payee: string; description: string; billNo: string; amount: number | null; gstAmount: number | null; interstate: boolean; tdsAmount: number | null; payMode: ExpMode; reference: string; }

/** First and last day for a period, in the hospital's calendar (financial year from 1 April). */
export function periodRange(p: Period | 'FY' | 'Last month' | 'This month' | 'This quarter', today = isoDay(0)): { from?: string; to?: string } {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  const ymd = (yy: number, mm: number, dd: number) => isoDay(0, new Date(yy, mm - 1, dd));
  switch (p) {
    case 'This month': return { from: ymd(y, m, 1), to: today };
    case 'Last month': return { from: ymd(y, m - 1, 1), to: ymd(y, m, 0) };
    case 'Last 3 months': return { from: ymd(y, m - 2, 1), to: today };
    case 'This quarter': { const q = Math.floor(((m + 8) % 12) / 3); const startM = [4, 7, 10, 1][q]; const sy = startM === 1 ? y : (m < 4 ? y - 1 : y); return { from: ymd(sy, startM, 1), to: today }; }
    case 'This financial year': case 'FY': return { from: ymd(m >= 4 ? y : y - 1, 4, 1), to: today };
    default: return {};
  }
}

@Component({
  standalone: true, imports: [SHARED],
  styles: [`
    .tot { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-radius:12px; background:var(--pri-soft, var(--ground)); font-weight:600 }
    .tot b { font-size:20px; font-variant-numeric:tabular-nums }
    .cats { display:flex; flex-direction:column; gap:8px }
    .cat-row { display:grid; grid-template-columns: minmax(0,1.2fr) minmax(0,1.2fr) minmax(0,1fr) auto; gap:8px; align-items:center }
    .cat-row.head { font-size:12px; color:var(--mut); font-weight:600 }
    .bar-l { display:flex; flex-direction:column; gap:10px }
    .bar-l .r { display:flex; justify-content:space-between; font-size:13px } .bar-l .t { height:8px; border-radius:99px; background:var(--ground); overflow:hidden } .bar-l .t i { display:block; height:100%; background:var(--pri); border-radius:99px }
    @media (max-width:760px) { .cat-row { grid-template-columns: 1fr 1fr } .cat-row.head { display:none } }
  `],
  template: `
  <div class="page">
    <cf-page-head title="Hospital expenses" [crumbs]="['Finance', 'Expenses']" sub="Rent, salaries, utilities and every other payment outside pharmacy and store purchases.">
      @if (fin.live) { <button class="btn ghost" (click)="reload()" [disabled]="loading()"><lucide-icon name="rotate-ccw" [size]="16"></lucide-icon>Refresh</button> }
      @if (manager()) { <button class="btn ghost" (click)="openCats()"><lucide-icon name="layers" [size]="16"></lucide-icon>Categories</button> }
      <button class="btn ghost" (click)="exportCsv()"><lucide-icon name="download" [size]="16"></lucide-icon>Export</button>
      <a class="btn ghost" routerLink="/tally"><lucide-icon name="file-spreadsheet" [size]="16"></lucide-icon>Tally export</a>
      <button class="btn" (click)="openNew()"><lucide-icon name="plus" [size]="16"></lucide-icon>Record expense</button>
    </cf-page-head>
    <div class="grid">
      <cf-stat class="c3" label="Spent this month" [value]="(sm()?.thisMonth ?? 0) | inr" icon="wallet" tone="pri" [sub]="(sm()?.countThisMonth ?? 0) + ' entries'"></cf-stat>
      <cf-stat class="c3" label="Last month" [value]="(sm()?.lastMonth ?? 0) | inr" icon="calendar-days" tone="blue" [sub]="trend()"></cf-stat>
      <cf-stat class="c3" label="Not paid yet" [value]="(sm()?.unpaid ?? 0) | inr" icon="hourglass" tone="red" [clickable]="true" (click)="mode.set('UNPAID')" [sub]="(sm()?.unpaidCount ?? 0) + ' bills to pay'"></cf-stat>
      <cf-stat class="c3" label="Biggest head this month" [value]="top() ? (top()!.total | inr) : '—'" icon="chart-pie" tone="amber" [sub]="top() ? (top()!.name + ' · ' + topPct() + '% of spend') : 'nothing recorded yet'"></cf-stat>

      <div class="card c8"><div class="card-h"><h3>Spend, last 6 months</h3><span class="r muted small">including GST, cancelled entries left out</span></div>
        <cf-chart type="bar" [labels]="months().labels" [datasets]="[{ label: 'Expenses', data: months().data, backgroundColor: '--pri', borderRadius: 6 }]" [height]="230"></cf-chart></div>
      <div class="card c4"><div class="card-h"><h3>Where it went</h3><span class="r muted small">this month</span></div>
        @if (sm()?.byCategoryThisMonth?.length) {
          <div class="bar-l">@for (c of sm()!.byCategoryThisMonth.slice(0, 6); track c.categoryId) {
            <div><div class="r"><span>{{ c.name }}</span><b>{{ c.total | inr }}</b></div><div class="t"><i [style.width.%]="pct(c.total)"></i></div></div>
          }</div>
        } @else { <cf-empty icon="wallet" title="No expenses this month" text="Recorded expenses show up here by category."></cf-empty> }
      </div>

      @if (error()) { <div class="card c12"><div class="alert-box crit"><lucide-icon name="circle-x" [size]="16"></lucide-icon><div>{{ error() }}</div></div></div> }

      <div class="card c12">
        <div class="toolbar" style="margin-bottom:12px">
          <label class="search boxed" style="flex:1 1 220px;min-width:220px;max-width:320px"><lucide-icon name="search" [size]="16"></lucide-icon><input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Payee, bill or EXP number" aria-label="Search expenses"></label>
          <div class="chips">@for (p of periods; track p) {<button class="chip" [class.on]="period() === p" (click)="setPeriod(p)">{{ p }}</button>}</div>
          <select class="inp" style="width:auto" [ngModel]="cat()" (ngModelChange)="cat.set($event)" aria-label="Category"><option value="">All categories</option>@for (c of fin.categories(); track c.id) {<option [value]="c.id">{{ c.name }}</option>}</select>
          <select class="inp" style="width:auto" [ngModel]="mode()" (ngModelChange)="mode.set($event)" aria-label="Paid by"><option value="">Any payment</option>@for (m of modes; track m) {<option [value]="m">{{ modeLabel[m] }}</option>}</select>
          <label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" [ngModel]="showCancelled()" (ngModelChange)="showCancelled.set($event)">Show cancelled</label>
        </div>
        <div class="small muted" style="margin-bottom:8px">{{ rows().length }} entries · total {{ rowsTotal() | inr }}</div>
        <cf-table [rows]="rows()" [cols]="cols" [clickable]="true" (rowClick)="openEdit($event)" [pageSize]="12" emptyIcon="wallet" emptyTitle="No expenses here" emptyText="Record rent, salaries, bills and other payments with Record expense.">
          <ng-template cfCell="payee" let-e><div><b>{{ e.payee }}</b><div class="small muted">{{ e.number }}{{ e.description ? ' · ' + e.description : '' }}</div></div></ng-template>
          <ng-template cfCell="date" let-e>{{ e.date | d }}</ng-template>
          <ng-template cfCell="mode" let-e>{{ modeLabel[e.payMode] }}@if (e.reference) {<div class="small muted">{{ e.reference }}</div>}</ng-template>
          <ng-template cfCell="total" let-e><b [style.text-decoration]="e.status === 'CANCELLED' ? 'line-through' : ''">{{ e.total | inr }}</b>@if (e.gstAmount) {<div class="small muted">GST {{ e.gstAmount | inr }}</div>}</ng-template>
          <ng-template cfCell="status" let-e>@if (e.status === 'CANCELLED') {<cf-status s="Cancelled"></cf-status>} @else if (e.payMode === 'UNPAID') {<cf-status s="Unpaid" label="Not paid"></cf-status>} @else {<cf-status s="Paid" label="Recorded"></cf-status>}</ng-template>
        </cf-table>
      </div>
    </div>
  </div>

  <cf-drawer [open]="drawer()" [title]="editing() ? 'Expense ' + editing()!.number : 'Record expense'" [sub]="editing() ? 'Entered by ' + editing()!.createdBy : 'Goes to Tally as a payment voucher'" width="min(560px,100%)" (closed)="drawer.set(false)">
    @if (editing()?.status === 'CANCELLED') { <div class="alert-box warn"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon><div><b>Cancelled</b><div>{{ editing()!.cancelReason }}</div></div></div> }
    <div class="form-grid">
      <div class="field"><label>Date <span class="req">*</span></label><input class="inp" type="date" [max]="today" [(ngModel)]="f.date" [disabled]="locked()"></div>
      <div class="field"><label>Category <span class="req">*</span></label><select class="inp" [(ngModel)]="f.categoryId" [disabled]="locked()"><option value="" disabled>Choose…</option>@for (c of activeCats(); track c.id) {<option [value]="c.id">{{ c.name }}</option>}</select></div>
      <div class="field span-all"><label>Paid to <span class="req">*</span></label><input class="inp" [(ngModel)]="f.payee" maxlength="120" placeholder="Landlord, TANGEDCO, vendor or person" [disabled]="locked()"></div>
      <div class="field span-all"><label>What for</label><input class="inp" [(ngModel)]="f.description" maxlength="300" placeholder="e.g. EB bill for October, main block" [disabled]="locked()"></div>
      <div class="field"><label>Amount before GST (₹) <span class="req">*</span></label><input class="inp" type="number" min="0" step="0.01" [(ngModel)]="f.amount" [disabled]="locked()"></div>
      <div class="field"><label>GST on the bill (₹)</label><input class="inp" type="number" min="0" step="0.01" [(ngModel)]="f.gstAmount" [disabled]="locked()"><span class="hint"><label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" [(ngModel)]="f.interstate" [disabled]="locked()">Supplier from another state (IGST)</label></span></div>
      <div class="field"><label>TDS deducted (₹)</label><input class="inp" type="number" min="0" step="0.01" [(ngModel)]="f.tdsAmount" [disabled]="locked()"><span class="hint">Tax kept back for rent, contractors, professionals</span></div>
      <div class="field"><label>Bill / invoice number</label><input class="inp" [(ngModel)]="f.billNo" maxlength="40" [disabled]="locked()"></div>
      <div class="field span-all"><label>Paid by <span class="req">*</span></label><div class="chips">@for (m of modes; track m) {<button class="chip" [class.on]="f.payMode === m" (click)="!locked() && (f.payMode = m)">{{ modeLabel[m] }}</button>}</div></div>
      @if (f.payMode !== 'CASH' && f.payMode !== 'UNPAID') { <div class="field span-all"><label>Reference</label><input class="inp" [(ngModel)]="f.reference" maxlength="100" placeholder="UTR, cheque or transaction number" [disabled]="locked()"></div> }
    </div>
    <div class="tot" style="margin-top:14px"><span>Bill total<div class="small muted">{{ f.payMode === 'UNPAID' ? 'to be paid' : 'paid' }} {{ net() | inr }}{{ (f.tdsAmount ?? 0) > 0 ? ' after TDS' : '' }}</div></span><b>{{ gross() | inr }}</b></div>
    @if (catLedger()) { <div class="hint" style="margin-top:8px">Tally ledger: <b>{{ catLedger() }}</b></div> }
    @if (editing() && manager() && editing()!.status !== 'CANCELLED') {
      <div class="soft stack-s" style="margin-top:14px"><b>Cancel this expense</b><div class="field"><label>Reason</label><input class="inp" [(ngModel)]="cancelWhy" maxlength="300" placeholder="e.g. entered twice"></div>
        <button class="btn ghost sm" style="color:var(--red);align-self:flex-start" [disabled]="busy() || !cancelWhy.trim()" (click)="cancel()">Cancel expense</button></div>
    }
    <div foot><button class="btn ghost" (click)="drawer.set(false)">Close</button>@if (!locked()) {<button class="btn" [disabled]="busy()" (click)="save()"><lucide-icon name="save" [size]="16"></lucide-icon>{{ editing() ? 'Save changes' : 'Record expense' }}</button>}</div>
  </cf-drawer>

  <cf-drawer [open]="catsOpen()" title="Expense categories" sub="Each category posts to its own ledger in Tally" width="min(760px,100%)" (closed)="catsOpen.set(false)">
    <div class="cats">
      <div class="cat-row head"><span>Category</span><span>Tally ledger</span><span>Tally group</span><span>In use</span></div>
      @for (c of catDrafts; track c.id) {
        <div class="cat-row"><input class="inp" [(ngModel)]="c.name" maxlength="80" aria-label="Category name"><input class="inp" [(ngModel)]="c.tallyLedger" maxlength="120" aria-label="Tally ledger">
          <select class="inp" [(ngModel)]="c.tallyGroup" aria-label="Tally group">@for (g of groups; track g) {<option>{{ g }}</option>}</select>
          <input type="checkbox" [(ngModel)]="c.active" aria-label="In use"></div>
      }
      <div class="section-title" style="margin-top:8px">Add a category</div>
      <div class="cat-row"><input class="inp" [(ngModel)]="newCat.name" maxlength="80" placeholder="e.g. Pest control"><input class="inp" [(ngModel)]="newCat.tallyLedger" maxlength="120" placeholder="Ledger name in Tally">
        <select class="inp" [(ngModel)]="newCat.tallyGroup">@for (g of groups; track g) {<option>{{ g }}</option>}</select><span></span></div>
    </div>
    <div foot><button class="btn ghost" (click)="catsOpen.set(false)">Close</button><button class="btn" [disabled]="busy()" (click)="saveCats()"><lucide-icon name="save" [size]="16"></lucide-icon>Save categories</button></div>
  </cf-drawer>`
})
export class ExpensesPage {
  fin = inject(FinanceService); toast = inject(ToastService); exp = inject(ExportService); session = inject(SessionService);
  modeLabel: Record<string, string> = MODE_LABEL; modes: ExpMode[] = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'UNPAID']; groups = EXPENSE_GROUPS;
  periods: Period[] = ['This month', 'Last month', 'Last 3 months', 'This financial year', 'All'];
  today = isoDay(0);
  q = signal(''); period = signal<Period>('This month'); cat = signal(''); mode = signal(''); showCancelled = signal(false);
  loading = signal(false); busy = signal(false); error = signal('');
  drawer = signal(false); editing = signal<Expense | null>(null); catsOpen = signal(false);
  f: Draft = this.blank(); cancelWhy = '';
  catDrafts: ExpenseCategory[] = []; newCat = { name: '', tallyLedger: '', tallyGroup: 'Indirect Expenses' };

  manager = computed(() => ['super-admin', 'admin'].includes(this.session.roleId() ?? ''));
  sm = computed(() => this.fin.summary());
  activeCats = computed(() => this.fin.categories().filter(c => c.active || c.id === this.editing()?.categoryId));
  cols = [
    { key: 'payee', label: 'Paid to', value: (e: Expense) => e.payee }, { key: 'date', label: 'Date' }, { key: 'categoryName', label: 'Category' },
    { key: 'mode', label: 'Paid by', value: (e: Expense) => MODE_LABEL[e.payMode] }, { key: 'total', label: 'Amount', align: 'right' as const, value: (e: Expense) => e.total },
    { key: 'status', label: 'Status', value: (e: Expense) => e.status },
  ];

  constructor() { this.fin.loadCategories().catch(e => this.error.set(apiError(e, 'Could not load categories'))); this.reload(); }

  reload() {
    this.loading.set(true); this.error.set('');
    this.fin.loadExpenses(periodRange(this.period())).catch(e => this.error.set(apiError(e, 'Could not load expenses'))).finally(() => this.loading.set(false));
  }
  setPeriod(p: Period) { this.period.set(p); this.reload(); }

  rows = computed(() => {
    const q = this.q().trim().toLowerCase(), c = this.cat(), m = this.mode(), sc = this.showCancelled();
    return this.fin.expenses().filter(e => (sc || e.status !== 'CANCELLED') && (!c || e.categoryId === c) && (!m || e.payMode === m)
      && (!q || [e.payee, e.number, e.description ?? '', e.billNo ?? '', e.reference ?? ''].some(s => s.toLowerCase().includes(q))));
  });
  rowsTotal = computed(() => this.rows().filter(e => e.status !== 'CANCELLED').reduce((t, e) => t + e.total, 0));
  months = computed(() => { const l = this.sm()?.last6Months ?? []; return { labels: l.map(x => new Date(x.month + '-01T00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })), data: l.map(x => x.total) }; });
  top = computed(() => this.sm()?.byCategoryThisMonth?.[0]);
  topPct = computed(() => { const s = this.sm(); return s && s.thisMonth ? Math.round((this.top()?.total ?? 0) / s.thisMonth * 100) : 0; });
  pct(v: number) { const max = this.top()?.total ?? 0; return max ? Math.max(4, v / max * 100) : 0; }
  trend = computed(() => {
    const s = this.sm(); if (!s || !s.lastMonth) return 'no entries last month';
    const d = Math.round((s.thisMonth - s.lastMonth) / s.lastMonth * 100);
    return `this month is ${Math.abs(d)}% ${d >= 0 ? 'higher' : 'lower'} so far`;
  });

  // ---- form
  private blank(): Draft { return { date: isoDay(0), categoryId: '', payee: '', description: '', billNo: '', amount: null, gstAmount: null, interstate: false, tdsAmount: null, payMode: 'BANK_TRANSFER', reference: '' }; }
  locked = computed(() => this.editing()?.status === 'CANCELLED');
  gross() { return (+(this.f.amount ?? 0)) + (+(this.f.gstAmount ?? 0)); }
  net() { return this.gross() - (+(this.f.tdsAmount ?? 0)); }
  catLedger() { return this.fin.categories().find(c => c.id === this.f.categoryId)?.tallyLedger; }
  openNew() { this.editing.set(null); this.f = this.blank(); this.cancelWhy = ''; this.drawer.set(true); }
  openEdit(e: Expense) {
    this.editing.set(e); this.cancelWhy = '';
    this.f = { date: e.date, categoryId: e.categoryId, payee: e.payee, description: e.description ?? '', billNo: e.billNo ?? '', amount: e.amount, gstAmount: e.gstAmount || null,
      interstate: e.interstate, tdsAmount: e.tdsAmount || null, payMode: e.payMode, reference: e.reference ?? '' };
    this.drawer.set(true);
  }
  async save() {
    const f = this.f;
    if (!f.date || !f.categoryId || !f.payee.trim()) { this.toast.err('Fill in the date, category and who was paid'); return; }
    if (!f.amount || f.amount <= 0) { this.toast.err('Enter the amount before GST'); return; }
    if (f.date > this.today) { this.toast.err('The expense date cannot be in the future'); return; }
    this.busy.set(true);
    try {
      const cur = this.editing();
      const e = await this.fin.save(cur?.id ?? null, { date: f.date, categoryId: f.categoryId, payee: f.payee.trim(), description: f.description.trim() || undefined, billNo: f.billNo.trim() || undefined,
        amount: +f.amount, gstAmount: f.gstAmount ? +f.gstAmount : 0, interstate: f.interstate, tdsAmount: f.tdsAmount ? +f.tdsAmount : 0, payMode: f.payMode,
        reference: f.payMode === 'CASH' || f.payMode === 'UNPAID' ? undefined : f.reference.trim() || undefined, version: cur?.version });
      this.toast.ok(cur ? `${e.number} updated` : `${e.number} recorded: ₹${new Intl.NumberFormat('en-IN').format(e.total)} to ${e.payee}`);
      this.drawer.set(false); this.reload();
    } catch (e) { this.toast.err(apiError(e)); } finally { this.busy.set(false); }
  }
  async cancel() {
    const e = this.editing(); if (!e) return;
    this.busy.set(true);
    try { await this.fin.cancel(e, this.cancelWhy.trim()); this.toast.ok(`${e.number} cancelled. It stays in the list, struck out, and is left out of Tally.`); this.drawer.set(false); this.reload(); }
    catch (err) { this.toast.err(apiError(err)); } finally { this.busy.set(false); }
  }

  // ---- categories
  openCats() { this.catDrafts = this.fin.categories().map(c => ({ ...c })); this.newCat = { name: '', tallyLedger: '', tallyGroup: 'Indirect Expenses' }; this.catsOpen.set(true); }
  async saveCats() {
    this.busy.set(true);
    try {
      const orig = new Map(this.fin.categories().map(c => [c.id, c]));
      for (const c of this.catDrafts) {
        const o = orig.get(c.id)!;
        if (!c.name.trim() || !c.tallyLedger.trim()) throw { error: { detail: 'Every category needs a name and a Tally ledger' } };
        if (o.name !== c.name || o.tallyLedger !== c.tallyLedger || o.tallyGroup !== c.tallyGroup || o.active !== c.active) await this.fin.saveCategory(c);
      }
      if (this.newCat.name.trim()) {
        if (!this.newCat.tallyLedger.trim()) this.newCat.tallyLedger = this.newCat.name.trim();
        await this.fin.saveCategory({ ...this.newCat, active: true });
      }
      this.toast.ok('Categories saved'); this.catsOpen.set(false);
    } catch (e) { this.toast.err(apiError(e)); await this.fin.loadCategories().catch(() => undefined); } finally { this.busy.set(false); }
  }

  exportCsv() {
    this.exp.csv('expenses', this.rows().map(e => ({ Number: e.number, Date: e.date, Category: e.categoryName, 'Paid to': e.payee, Description: e.description ?? '', 'Bill no': e.billNo ?? '',
      'Amount before GST': e.amount, GST: e.gstAmount, TDS: e.tdsAmount, Total: e.total, 'Paid by': MODE_LABEL[e.payMode], Reference: e.reference ?? '', Status: e.status === 'CANCELLED' ? 'Cancelled' : 'Recorded' })));
  }
}
