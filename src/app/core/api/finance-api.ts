import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_URL } from './api-config';

// ---- Server shapes for /api/expenses and /api/tally (see server/README.md, "API (expenses and Tally)") ----
export type ExpMode = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'CHEQUE' | 'UNPAID';
export type ExpStatus = 'RECORDED' | 'CANCELLED';
export type TallyGroup = string;

export interface ExpenseCategory { id: string; name: string; tallyLedger: string; tallyGroup: TallyGroup; active: boolean; sortOrder: number; version: number; }
export interface Expense {
  id: string; number: string; branchId: string; date: string; categoryId: string; categoryName: string; payee: string; description?: string; billNo?: string;
  amount: number; gstAmount: number; interstate: boolean; tdsAmount: number; total: number; paid: number; payMode: ExpMode; reference?: string;
  status: ExpStatus; cancelReason?: string; createdBy: string; createdAt: string; version: number;
}
export interface ExpenseInput {
  date: string; categoryId: string; payee: string; description?: string; billNo?: string; amount: number; gstAmount?: number; interstate?: boolean;
  tdsAmount?: number; payMode: ExpMode; reference?: string; branchId?: string; version?: number;
}
export interface ExpenseSummary {
  thisMonth: number; lastMonth: number; countThisMonth: number; unpaid: number; unpaidCount: number;
  byCategoryThisMonth: { categoryId: string; name: string; total: number; count: number }[]; last6Months: { month: string; total: number }[];
}
export interface TallyLedger { key: string; label: string; ledgerName: string; tallyGroup: TallyGroup; }
export interface TallySettings { companyName: string; ledgers: TallyLedger[]; groups: TallyGroup[]; updatedAt?: string; updatedBy?: string; }
export type VoucherSource = 'INVOICE' | 'RECEIPT' | 'REFUND' | 'EXPENSE';
/** amount > 0 is a debit, < 0 a credit. */
export interface TallyEntry { ledger: string; amount: number; }
export interface TallyVoucher { source: VoucherSource; type: 'Sales' | 'Receipt' | 'Payment' | 'Journal'; number: string; date: string; party: string; narration: string; remoteId: string; entries: TallyEntry[]; }
export interface TallyPreview {
  from: string; to: string; vouchers: number; bySource: Record<VoucherSource, { count: number; amount: number }>; skippedCancelled: number; ledgers: number;
  warnings: string[]; sample: TallyVoucher[];
}
export type TallyFormat = 'xml' | 'masters' | 'csv';
export interface TallyLog { id: string; branchId?: string; from: string; to: string; format: TallyFormat; vouchers: number; exportedBy: string; exportedAt: string; }

@Injectable({ providedIn: 'root' })
export class FinanceApi {
  private http = inject(HttpClient);
  private ex = `${API_URL}/api/expenses`;
  private ta = `${API_URL}/api/tally`;

  private p(o: Record<string, string | number | boolean | undefined | null>) {
    let hp = new HttpParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') hp = hp.set(k, String(v)); return hp;
  }

  expenses(f: { from?: string; to?: string; category?: string; status?: string; q?: string; branchId?: string } = {}) {
    return firstValueFrom(this.http.get<Expense[]>(this.ex, { params: this.p({ limit: 1000, ...f }) }));
  }
  summary(branchId?: string) { return firstValueFrom(this.http.get<ExpenseSummary>(`${this.ex}/summary`, { params: this.p({ branchId }) })); }
  create(b: ExpenseInput) { return firstValueFrom(this.http.post<Expense>(this.ex, b)); }
  update(id: string, b: ExpenseInput) { return firstValueFrom(this.http.put<Expense>(`${this.ex}/${id}`, b)); }
  cancel(id: string, reason: string, version: number) { return firstValueFrom(this.http.post<Expense>(`${this.ex}/${id}/cancel`, { reason, version })); }
  categories(includeInactive = false) { return firstValueFrom(this.http.get<ExpenseCategory[]>(`${this.ex}/categories`, { params: this.p({ includeInactive }) })); }
  createCategory(b: { name: string; tallyLedger: string; tallyGroup: string }) { return firstValueFrom(this.http.post<ExpenseCategory>(`${this.ex}/categories`, b)); }
  updateCategory(id: string, b: { name: string; tallyLedger: string; tallyGroup: string; active: boolean; version: number }) {
    return firstValueFrom(this.http.put<ExpenseCategory>(`${this.ex}/categories/${id}`, b));
  }

  tallySettings() { return firstValueFrom(this.http.get<TallySettings>(`${this.ta}/settings`)); }
  saveTallySettings(b: { companyName: string; ledgers: { key: string; ledgerName: string; tallyGroup: string }[] }) {
    return firstValueFrom(this.http.put<TallySettings>(`${this.ta}/settings`, b));
  }
  preview(from: string, to: string, branchId?: string) { return firstValueFrom(this.http.get<TallyPreview>(`${this.ta}/preview`, { params: this.p({ from, to, branchId }) })); }
  /** The file and the name the server gave it. */
  async export(from: string, to: string, format: TallyFormat, branchId?: string) {
    const r = await firstValueFrom(this.http.get(`${this.ta}/export`, { params: this.p({ from, to, format, branchId }), responseType: 'blob', observe: 'response' }));
    const cd = r.headers.get('Content-Disposition') ?? '';
    const name = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? `tally-${format}-${from}-to-${to}.${format === 'csv' ? 'csv' : 'xml'}`;
    return { blob: r.body!, name };
  }
  history() { return firstValueFrom(this.http.get<TallyLog[]>(`${this.ta}/history`)); }
}
