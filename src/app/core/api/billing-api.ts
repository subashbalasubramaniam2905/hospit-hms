import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_URL } from './api-config';

// ---- Server shapes (see server/README.md, "API (billing)") ----
export type SKind = 'OPD' | 'IPD' | 'PHARMACY' | 'LAB';
export type SCategory = 'CONSULTATION' | 'PROCEDURE' | 'LABORATORY' | 'IMAGING' | 'PHARMACY' | 'ROOM' | 'NURSING' | 'OT' | 'OTHER';
export type SMode = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'ONLINE' | 'INSURANCE' | 'ADVANCE';
export type SInvoiceStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'REFUNDED' | 'CANCELLED';
export type SClaimStatus = 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SETTLED';

export interface SLine { lineNo: number; tariffCode?: string; description: string; category: SCategory; hsnSac?: string; qty: number; rate: number; gross: number; discount: number; taxable: number; taxPct: number; cgst: number; sgst: number; igst: number; amount: number; refType?: string; refId?: string; }
export interface SPayment { id: string; invoiceId: string; receiptNumber: string; type: 'PAYMENT' | 'REFUND'; mode: SMode; amount: number; reference?: string; reason?: string; receivedAt: string; receivedBy: string; }
export interface SInvoice {
  id: string; number: string; branchId: string; gstin: string; patientId: string; patientName: string; patientMobile: string; kind: SKind; status: SInvoiceStatus;
  invoiceDate: string; placeOfSupply: string; discountPct: number; subtotal: number; discountAmount: number; taxableAmount: number; cgst: number; sgst: number; igst: number;
  roundOff: number; total: number; paid: number; refunded: number; due: number; claimId?: string; claimNumber?: string; admissionRef?: string; notes?: string;
  cancelReason?: string; createdBy: string; createdAt: string; version: number; lines?: SLine[]; payments?: SPayment[];
}
export interface SNewLine { tariffCode?: string; description?: string; category?: SCategory; qty: number; rate?: number; taxPct?: number | null; refType?: string; refId?: string; }
export interface SNewInvoice { patientId: string; kind: SKind; branchId?: string; discountPct?: number; lines: SNewLine[]; admissionRef?: string; notes?: string; }
export interface STariff { id: string; code: string; name: string; category: SCategory; price: number; taxPct?: number; effectiveTaxPct: number; hsnSac?: string; department?: string; active: boolean; fromDoctor: boolean; version?: number; }
export interface SSettings { legalName: string; tradeName: string; gstin: string; stateCode: string; stateName: string; address: string; phone?: string; email?: string; discountApprovalPct: number; defaultCopayPct: number; invoiceFooter?: string; sampleData: boolean; version: number; }
export interface SSettingsView { settings: SSettings; taxRates: { category: SCategory; gstPct: number; hsnSac?: string; note?: string }[]; branchGstin: string; }
export interface SSummary { date: string; collectedToday: number; invoicesToday: number; outstanding: number; outstandingCount: number; insuranceReceivable: number; refundsThisMonth: number; byModeToday: Record<string, number>; last7Days: { date: string; byKind: Record<SKind, number> }[]; }
export interface SProvider { id: string; name: string; tpa?: string; type: string; phone?: string; cashless: boolean; }
export interface SClaim {
  id: string; number: string; branchId: string; patientId: string; patientName: string; invoiceId?: string; invoiceNumber?: string; providerId: string; providerName: string; tpa?: string;
  policyNo: string; type: 'PRE_AUTHORISATION' | 'FINAL_CLAIM' | 'REIMBURSEMENT'; status: SClaimStatus; claimed: number; approved: number; settled: number; copayPct: number;
  documents: string[]; rejectionReason?: string; settlementRef?: string; createdBy: string; createdAt: string; version: number; history?: { status: SClaimStatus; note?: string; at: string; by: string }[];
}
export interface SPatientLite { id: string; name: string; mobile: string; branchId: string; primaryDoctorId?: string; address?: { line?: string; city?: string }; insurance?: { providerId: string; policyNo: string } | null; }

/** Thin HTTP client for /api/billing. Errors surface as HttpErrorResponse with a problem detail body. */
@Injectable({ providedIn: 'root' })
export class BillingApi {
  private http = inject(HttpClient);
  private url = `${API_URL}/api/billing`;

  private p(o: Record<string, string | number | boolean | undefined | null>) {
    let hp = new HttpParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') hp = hp.set(k, String(v)); return hp;
  }

  settings() { return firstValueFrom(this.http.get<SSettingsView>(`${this.url}/settings`)); }
  summary() { return firstValueFrom(this.http.get<SSummary>(`${this.url}/summary`)); }
  tariff(q: string, category?: SCategory) { return firstValueFrom(this.http.get<STariff[]>(`${this.url}/tariff`, { params: this.p({ q, category }) })); }
  invoices(f: { q?: string; status?: string; kind?: SKind; patientId?: string; limit?: number } = {}) {
    return firstValueFrom(this.http.get<SInvoice[]>(`${this.url}/invoices`, { params: this.p({ limit: 500, ...f }) }));
  }
  invoice(id: string) { return firstValueFrom(this.http.get<SInvoice>(`${this.url}/invoices/${encodeURIComponent(id)}`)); }
  createInvoice(b: SNewInvoice) { return firstValueFrom(this.http.post<SInvoice>(`${this.url}/invoices`, b)); }
  pay(id: string, mode: SMode, amount: number, reference?: string) { return firstValueFrom(this.http.post<SInvoice>(`${this.url}/invoices/${id}/payments`, { mode, amount, reference })); }
  refund(id: string, amount: number, reason: string, mode?: SMode) { return firstValueFrom(this.http.post<SInvoice>(`${this.url}/invoices/${id}/refunds`, { amount, reason, mode })); }
  cancel(id: string, reason: string) { return firstValueFrom(this.http.post<SInvoice>(`${this.url}/invoices/${id}/cancel`, { reason })); }
  providers() { return firstValueFrom(this.http.get<SProvider[]>(`${this.url}/insurance-providers`)); }
  claims(status?: SClaimStatus) { return firstValueFrom(this.http.get<SClaim[]>(`${this.url}/claims`, { params: this.p({ status }) })); }
  claim(id: string) { return firstValueFrom(this.http.get<SClaim>(`${this.url}/claims/${id}`)); }
  createClaim(b: { invoiceId?: string; patientId?: string; providerId: string; policyNo: string; type?: SClaim['type']; claimed?: number; copayPct?: number; documents?: string[] }) {
    return firstValueFrom(this.http.post<SClaim>(`${this.url}/claims`, b));
  }
  claimDocuments(id: string, documents: string[], version: number) { return firstValueFrom(this.http.put<SClaim>(`${this.url}/claims/${id}/documents`, { documents, version })); }
  claimStatus(id: string, b: { status: SClaimStatus; version: number; note?: string; approved?: number; rejectionReason?: string; settlementRef?: string; settledAmount?: number }) {
    return firstValueFrom(this.http.post<SClaim>(`${this.url}/claims/${id}/status`, b));
  }
  // Patient lookups billing needs (foundation API).
  patients(q: string) { return firstValueFrom(this.http.get<SPatientLite[]>(`${API_URL}/api/patients`, { params: this.p({ q, limit: 8 }) })); }
  patient(id: string) { return firstValueFrom(this.http.get<SPatientLite>(`${API_URL}/api/patients/${encodeURIComponent(id)}`)); }
}

/** The human-readable message from an API error (RFC 7807 "detail"), or a fallback. */
export function apiError(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const err = e as { error?: { detail?: string; fields?: Record<string, string> }; status?: number };
  if (err?.status === 0) return 'Cannot reach the HospitOS server. Check your connection.';
  const f = err?.error?.fields; if (f && Object.keys(f).length) return `${err.error!.detail}: ${Object.entries(f).map(([k, v]) => `${k} ${v}`).join(', ')}`;
  return err?.error?.detail || fallback;
}
