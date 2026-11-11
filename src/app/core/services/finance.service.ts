import { Injectable, inject, signal } from '@angular/core';
import { LIVE } from '../api/api-config';
import {
  ExpMode, Expense, ExpenseCategory, ExpenseInput, ExpenseSummary, FinanceApi, TallyFormat, TallyLog, TallyPreview, TallySettings, VoucherSource
} from '../api/finance-api';
import { isoDay } from '../data/seed';
import { StoreService } from './store.service';
import { SessionService } from './session.service';
import { toServerCategory, toServerMode } from './billing.service';
import { DEFAULT_LEDGERS, TALLY_GROUPS, TExpense, TInvoice, TMoney, buildBook, download, writeBook } from './tally';

export const MODE_LABEL: Record<ExpMode, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK_TRANSFER: 'Bank transfer', CHEQUE: 'Cheque', UNPAID: 'Not paid yet' };

const C = (id: string, name: string, tallyLedger: string, tallyGroup: string, sortOrder: number): ExpenseCategory => ({ id, name, tallyLedger, tallyGroup, active: true, sortOrder, version: 1 });
/** Same list as the server's V32 migration. */
const DEFAULT_CATEGORIES: ExpenseCategory[] = [
  C('RENT', 'Rent and lease', 'Rent', 'Indirect Expenses', 10), C('SALARY', 'Salaries and wages', 'Salaries and Wages', 'Indirect Expenses', 20),
  C('DOCTOR_FEE', 'Visiting doctor fees', 'Professional Fees - Doctors', 'Direct Expenses', 30), C('ELECTRICITY', 'Electricity', 'Electricity Charges', 'Indirect Expenses', 40),
  C('WATER', 'Water', 'Water Charges', 'Indirect Expenses', 50), C('DIESEL', 'Diesel and generator', 'Generator Fuel', 'Indirect Expenses', 60),
  C('PHONE', 'Telephone and internet', 'Telephone and Internet', 'Indirect Expenses', 70), C('REPAIRS', 'Repairs and maintenance', 'Repairs and Maintenance', 'Indirect Expenses', 80),
  C('EQUIP_AMC', 'Equipment AMC and service', 'Equipment AMC', 'Indirect Expenses', 90), C('HOUSEKEEP', 'Housekeeping and laundry', 'Housekeeping and Laundry', 'Indirect Expenses', 100),
  C('SECURITY', 'Security services', 'Security Charges', 'Indirect Expenses', 110), C('BMW', 'Biomedical waste disposal', 'Biomedical Waste Disposal', 'Direct Expenses', 120),
  C('OXYGEN', 'Medical gases (oxygen)', 'Medical Gases', 'Direct Expenses', 130), C('AMBULANCE', 'Ambulance and vehicle running', 'Vehicle Running Expenses', 'Indirect Expenses', 140),
  C('CANTEEN', 'Canteen and patient food', 'Canteen Expenses', 'Indirect Expenses', 150), C('STATIONERY', 'Printing and stationery', 'Printing and Stationery', 'Indirect Expenses', 160),
  C('ADVERT', 'Advertising and camps', 'Advertisement and Publicity', 'Indirect Expenses', 170), C('INSURANCE', 'Insurance premium', 'Insurance Premium', 'Indirect Expenses', 180),
  C('LICENCE', 'Licences, fees and taxes', 'Rates and Taxes', 'Indirect Expenses', 190), C('PROF_FEE', 'Audit, legal and consultancy', 'Professional Fees', 'Indirect Expenses', 200),
  C('BANK', 'Bank charges', 'Bank Charges', 'Indirect Expenses', 210), C('SOFTWARE', 'Software and IT', 'Software and IT Expenses', 'Indirect Expenses', 220),
  C('TRAVEL', 'Travel and conveyance', 'Travel and Conveyance', 'Indirect Expenses', 230), C('EQUIPMENT', 'Equipment purchase (capital)', 'Medical Equipment', 'Fixed Assets', 240),
  C('MISC', 'Miscellaneous', 'Miscellaneous Expenses', 'Indirect Expenses', 900),
];

const KEY = 'hospit-hms:finance:v1';
interface DemoState { expenses: Expense[]; categories: ExpenseCategory[]; tally: { companyName: string; ledgers: TallySettings['ledgers'] }; history: TallyLog[]; seq: number; }

/** Fictional expenses for the browser demo, spread over this month and the two before. */
function demoSeed(): DemoState {
  const today = isoDay(0), first = today.slice(0, 8) + '01';
  const monthDay = (back: number, day: number) => { const d = new Date(first + 'T00:00:00'); d.setMonth(d.getMonth() - back); d.setDate(day); const s = isoDay(0, d); return s > today ? today : s; };
  const rows: [number, number, string, string, string, number, number, number, ExpMode, string?][] = [];
  for (const back of [2, 1, 0]) {
    rows.push([back, 1, 'RENT', 'Sri Murugan Estates', 'Hospital building rent', 185000, 0, 18500, 'BANK_TRANSFER', 'NEFT']);
    rows.push([back, 2, 'SALARY', 'Staff payroll', 'Monthly salaries, nursing and support staff', 642000, 0, 0, 'BANK_TRANSFER', 'Salary upload']);
    rows.push([back, 5, 'ELECTRICITY', 'TANGEDCO', 'EB bill, main block', 48200 + back * 3100, 0, 0, 'UPI']);
    rows.push([back, 6, 'DOCTOR_FEE', 'Dr. K. Senthil (visiting ortho)', 'Visiting consultant fees', 60000, 0, 6000, 'BANK_TRANSFER']);
    rows.push([back, 8, 'BMW', 'Tiruppur Biomedical Services', 'Monthly collection', 9500, 1710, 0, 'BANK_TRANSFER']);
    rows.push([back, 10, 'OXYGEN', 'Kovai Medical Gases', 'Oxygen cylinders refill', 22400 - back * 1200, 1120, 0, 'CHEQUE', 'CHQ 4411' + back]);
    rows.push([back, 12, 'DIESEL', 'Indian Oil, Palani Road', 'Generator diesel', 14800, 0, 0, 'CASH']);
    rows.push([back, 15, 'HOUSEKEEP', 'Clean Care Services', 'Housekeeping contract', 38000, 6840, 760, 'BANK_TRANSFER']);
  }
  rows.push([1, 18, 'REPAIRS', 'Kumar AC Service', 'OT air conditioner repair', 12500, 2250, 0, 'CASH']);
  rows.push([0, 3, 'PHONE', 'BSNL', 'Leased line and phones', 4800, 864, 0, 'UPI']);
  rows.push([0, 9, 'STATIONERY', 'Sakthi Printers', 'OP cards and bill books', 6200, 744, 0, 'CASH']);
  rows.push([0, 14, 'EQUIP_AMC', 'Medi Tech Solutions', 'X-ray machine AMC, quarter', 35000, 6300, 700, 'UNPAID']);
  let seq = 1001;
  const expenses: Expense[] = rows.map(([back, day, cat, payee, desc, amount, gst, tds, mode, ref]) => {
    const c = DEFAULT_CATEGORIES.find(x => x.id === cat)!;
    const date = monthDay(back, day);
    return { id: `DEXP-${seq}`, number: `EXP-${seq++}`, branchId: 'BR1', date, categoryId: cat, categoryName: c.name, payee, description: desc, amount, gstAmount: gst, interstate: false,
      tdsAmount: tds, total: amount + gst, paid: amount + gst - tds, payMode: mode, reference: ref, status: 'RECORDED' as const, createdBy: 'Meera Rao', createdAt: date + 'T10:00:00+05:30', version: 1 };
  }).filter(e => e.date <= today);
  return { expenses, categories: DEFAULT_CATEGORIES.map(c => ({ ...c })), tally: { companyName: '', ledgers: DEFAULT_LEDGERS.map(l => ({ ...l })) }, history: [], seq };
}

/**
 * Expenses and the Tally export. Live mode calls /api/expenses and /api/tally; demo mode keeps sample expenses in the
 * browser and builds the Tally files from the prototype's invoices.
 */
@Injectable({ providedIn: 'root' })
export class FinanceService {
  readonly live = LIVE;
  private api = inject(FinanceApi);
  private store = inject(StoreService);
  private session = inject(SessionService);
  private demo: DemoState = this.loadDemo();

  readonly categories = signal<ExpenseCategory[]>([]);
  readonly expenses = signal<Expense[]>([]);
  readonly summary = signal<ExpenseSummary | null>(null);

  private loadDemo(): DemoState {
    if (LIVE) return demoSeed();
    try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s?.expenses) return s; } catch { /* ignore */ }
    return demoSeed();
  }
  private saveDemo() { try { localStorage.setItem(KEY, JSON.stringify(this.demo)); } catch { /* ignore */ } }
  private branch() { return this.session.branchId(); }
  private user() { return this.session.role()?.userName ?? 'Demo user'; }

  // ------------------------------------------------------------ categories

  async loadCategories(includeInactive = true) {
    const list = this.live ? await this.api.categories(includeInactive) : this.demo.categories.filter(c => includeInactive || c.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    this.categories.set(list); return list;
  }
  async saveCategory(c: { id?: string; name: string; tallyLedger: string; tallyGroup: string; active: boolean; version?: number }) {
    if (this.live) {
      if (c.id) await this.api.updateCategory(c.id, { name: c.name, tallyLedger: c.tallyLedger, tallyGroup: c.tallyGroup, active: c.active, version: c.version ?? 1 });
      else await this.api.createCategory({ name: c.name, tallyLedger: c.tallyLedger, tallyGroup: c.tallyGroup });
    } else {
      const dup = this.demo.categories.find(x => x.name.toLowerCase() === c.name.trim().toLowerCase() && x.id !== c.id);
      if (dup) throw demoError(`A category called ${c.name.trim()} already exists`);
      const cur = c.id ? this.demo.categories.find(x => x.id === c.id) : undefined;
      if (cur) Object.assign(cur, { name: c.name.trim(), tallyLedger: c.tallyLedger.trim(), tallyGroup: c.tallyGroup, active: c.active, version: cur.version + 1 });
      else this.demo.categories.push({ id: c.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 24) + '_' + Date.now().toString(36).slice(-3).toUpperCase(),
        name: c.name.trim(), tallyLedger: c.tallyLedger.trim(), tallyGroup: c.tallyGroup, active: true, sortOrder: 500, version: 1 });
      this.saveDemo(); this.store.log(c.id ? 'Updated' : 'Created', 'Expense category', c.name);
    }
    await this.loadCategories();
  }

  // ------------------------------------------------------------ expenses

  async loadExpenses(f: { from?: string; to?: string } = {}) {
    if (this.live) {
      const [list, sm] = await Promise.all([this.api.expenses({ ...f, branchId: this.branch() }), this.api.summary(this.branch())]);
      this.expenses.set(list); this.summary.set(sm);
    } else {
      this.expenses.set([...this.demo.expenses].filter(e => (!f.from || e.date >= f.from) && (!f.to || e.date <= f.to)).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)));
      this.summary.set(this.demoSummary());
    }
  }

  private demoSummary(): ExpenseSummary {
    const rec = this.demo.expenses.filter(e => e.status === 'RECORDED');
    const today = isoDay(0), m0 = today.slice(0, 7);
    const prev = (k: number) => { const d = new Date(m0 + '-01T00:00:00'); d.setMonth(d.getMonth() - k); return isoDay(0, d).slice(0, 7); };
    const inMonth = (m: string) => rec.filter(e => e.date.startsWith(m));
    const sum = (l: Expense[]) => l.reduce((t, e) => t + e.total, 0);
    const byCat = new Map<string, { categoryId: string; name: string; total: number; count: number }>();
    inMonth(m0).forEach(e => { const c = byCat.get(e.categoryId) ?? { categoryId: e.categoryId, name: e.categoryName, total: 0, count: 0 }; c.total += e.total; c.count++; byCat.set(e.categoryId, c); });
    const unpaid = rec.filter(e => e.payMode === 'UNPAID');
    return { thisMonth: sum(inMonth(m0)), lastMonth: sum(inMonth(prev(1))), countThisMonth: inMonth(m0).length, unpaid: unpaid.reduce((t, e) => t + e.paid, 0), unpaidCount: unpaid.length,
      byCategoryThisMonth: [...byCat.values()].sort((a, b) => b.total - a.total), last6Months: [5, 4, 3, 2, 1, 0].map(k => ({ month: prev(k), total: sum(inMonth(prev(k))) })) };
  }

  async save(id: string | null, b: ExpenseInput): Promise<Expense> {
    if (this.live) return id ? this.api.update(id, b) : this.api.create({ ...b, branchId: this.branch() });
    if (b.date > isoDay(0)) throw demoError('The expense date cannot be in the future');
    if ((b.gstAmount ?? 0) > b.amount) throw demoError('GST is more than the amount before tax. Enter the amount before GST');
    if ((b.tdsAmount ?? 0) > b.amount + (b.gstAmount ?? 0)) throw demoError('TDS cannot be more than the bill amount');
    const c = this.demo.categories.find(x => x.id === b.categoryId)!;
    const gst = b.gstAmount ?? 0, tds = b.tdsAmount ?? 0;
    const fields = { date: b.date, categoryId: b.categoryId, categoryName: c.name, payee: b.payee.trim(), description: b.description?.trim() || undefined, billNo: b.billNo?.trim() || undefined,
      amount: b.amount, gstAmount: gst, interstate: !!b.interstate, tdsAmount: tds, total: b.amount + gst, paid: b.amount + gst - tds, payMode: b.payMode, reference: b.reference?.trim() || undefined };
    let e: Expense;
    if (id) { e = this.demo.expenses.find(x => x.id === id)!; Object.assign(e, fields, { version: e.version + 1 }); this.store.log('Updated', 'Expense', `${e.number} ${e.payee}`); }
    else {
      const n = this.demo.seq++;
      e = { id: `DEXP-${n}`, number: `EXP-${n}`, branchId: this.branch(), status: 'RECORDED', createdBy: this.user(), createdAt: new Date().toISOString(), version: 1, ...fields };
      this.demo.expenses.push(e); this.store.log('Created', 'Expense', `${e.number} ${e.payee}, ₹${e.total}`);
    }
    this.saveDemo(); return e;
  }

  async cancel(e: Expense, reason: string) {
    if (this.live) return this.api.cancel(e.id, reason, e.version);
    const cur = this.demo.expenses.find(x => x.id === e.id)!;
    Object.assign(cur, { status: 'CANCELLED', cancelReason: reason, version: cur.version + 1 });
    this.store.log('Cancelled', 'Expense', `${cur.number}: ${reason}`, 'Sensitive'); this.saveDemo(); return cur;
  }

  // ------------------------------------------------------------ Tally

  async tallySettings(): Promise<TallySettings> {
    if (this.live) return this.api.tallySettings();
    return { companyName: this.demo.tally.companyName, ledgers: this.demo.tally.ledgers.map(l => ({ ...l })), groups: TALLY_GROUPS };
  }
  async saveTallySettings(companyName: string, ledgers: TallySettings['ledgers']) {
    if (this.live) return this.api.saveTallySettings({ companyName, ledgers: ledgers.map(l => ({ key: l.key, ledgerName: l.ledgerName.trim(), tallyGroup: l.tallyGroup })) });
    const groups = new Map<string, string>();
    for (const l of ledgers) { const g = groups.get(l.ledgerName.trim()); if (g && g !== l.tallyGroup) throw demoError(`The ledger "${l.ledgerName.trim()}" is set under two different Tally groups. Use one group for it`); groups.set(l.ledgerName.trim(), l.tallyGroup); }
    this.demo.tally = { companyName: companyName.trim(), ledgers: ledgers.map(l => ({ ...l, ledgerName: l.ledgerName.trim() })) };
    this.saveDemo(); this.store.log('Updated', 'Tally settings', companyName); return this.tallySettings();
  }

  private demoBook(from: string, to: string) {
    const inRange = (d: string) => d >= from && d <= to;
    const invs: TInvoice[] = [], money: TMoney[] = [];
    let cancelled = 0;
    for (const i of this.store.db.invoices) {
      const label = i.number ?? i.id, who = `${this.store.pname(i.patientId)} (${i.patientId})`;
      if (inRange(i.date) && (i.status === 'Cancelled' || i.status === 'Draft')) { cancelled++; continue; }
      if (inRange(i.date)) {
        const t = this.store.invoiceTotals(i), f = 1 - i.discountPct / 100, income: Record<string, number> = {};
        i.items.forEach(it => { const k = toServerCategory[it.category]; income[k] = (income[k] ?? 0) + Math.round(it.qty * it.rate * f * 100) / 100; });
        const tax = Math.round(t.tax * 100) / 100, half = Math.round(tax / 2 * 100) / 100;
        invs.push({ id: i.id, number: label, date: i.date, patient: who, total: t.total, cgst: half, sgst: Math.round((tax - half) * 100) / 100, igst: 0, income });
      }
      i.payments.filter(p => inRange(p.date)).forEach(p => money.push({ id: p.id, number: p.receipt ?? p.id, date: p.date, type: 'PAYMENT', mode: toServerMode[p.mode], amount: p.amount, invoice: label, patient: who, note: p.ref }));
      i.refunds.filter(p => inRange(p.date)).forEach(p => money.push({ id: p.id, number: p.receipt ?? p.id, date: p.date, type: 'REFUND', mode: toServerMode[p.mode] ?? 'CASH', amount: p.amount, invoice: label, patient: who, note: p.ref }));
    }
    const exps: TExpense[] = this.demo.expenses.filter(e => inRange(e.date) && e.status === 'RECORDED');
    cancelled += this.demo.expenses.filter(e => inRange(e.date) && e.status === 'CANCELLED').length;
    return { book: buildBook(this.demo.tally.ledgers, this.demo.categories, invs, money, exps), cancelled };
  }

  async preview(from: string, to: string, branchId?: string): Promise<TallyPreview> {
    if (to < from) throw demoError('The to date is before the from date');
    if (this.live) return this.api.preview(from, to, branchId);
    const { book, cancelled } = this.demoBook(from, to);
    const by = { INVOICE: { count: 0, amount: 0 }, RECEIPT: { count: 0, amount: 0 }, REFUND: { count: 0, amount: 0 }, EXPENSE: { count: 0, amount: 0 } } as TallyPreview['bySource'];
    book.vouchers.forEach(v => { const s = by[v.source as VoucherSource]; s.count++; s.amount += v.entries.filter(e => e.amount > 0).reduce((t, e) => t + e.amount, 0); });
    const warnings = ['Demo data: invoices and expenses here are fictional.'];
    if (!this.demo.tally.companyName) warnings.push('No Tally company name is set, so Tally imports into whichever company is open.');
    if (cancelled) warnings.push(`${cancelled} cancelled invoices or expenses are left out.`);
    return { from, to, vouchers: book.vouchers.length, bySource: by, skippedCancelled: cancelled, ledgers: book.groups.size, warnings, sample: book.vouchers.slice(0, 50) };
  }

  async export(from: string, to: string, format: TallyFormat, branchId?: string) {
    if (this.live) { const f = await this.api.export(from, to, format, branchId); download(f.blob, f.name); return f.name; }
    const { book } = this.demoBook(from, to);
    const text = writeBook(book, format, this.demo.tally.companyName);
    const name = `${format === 'xml' ? 'tally-vouchers' : format === 'masters' ? 'tally-ledgers' : 'daybook'}-${from}-to-${to}.${format === 'csv' ? 'csv' : 'xml'}`;
    download(new Blob([text], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/xml' }), name);
    this.demo.history.unshift({ id: String(Date.now()), branchId, from, to, format, vouchers: format === 'masters' ? book.groups.size : book.vouchers.length, exportedBy: this.user(), exportedAt: new Date().toISOString() });
    this.demo.history = this.demo.history.slice(0, 30); this.saveDemo(); this.store.log('Exported', 'Tally', `${format} ${from} to ${to}`, 'Sensitive');
    return name;
  }

  async history(): Promise<TallyLog[]> { return this.live ? this.api.history() : [...this.demo.history]; }
}

/** Shaped like an API error so screens show it with apiError(). */
function demoError(detail: string) { return { error: { detail }, status: 422 }; }
