import { Injectable, inject, signal } from '@angular/core';
import { LIVE } from '../api/api-config';
import { BillingApi, SCategory, SClaim, SClaimStatus, SInvoice, SKind, SMode, SNewLine, SSettingsView, SSummary } from '../api/billing-api';
import { Claim, ClaimStatus, Invoice, InvoiceItem, InvoiceTotals, PayMode } from '../models';
import { StoreService } from './store.service';

// ---- server <-> screen vocabulary ----
const KIND: Record<SKind, Invoice['kind']> = { OPD: 'OPD', IPD: 'IPD', PHARMACY: 'Pharmacy', LAB: 'Lab' };
export const CAT_LABEL: Record<SCategory, InvoiceItem['category']> = { CONSULTATION: 'Consultation', PROCEDURE: 'Procedure', LABORATORY: 'Laboratory', IMAGING: 'Imaging', PHARMACY: 'Pharmacy', ROOM: 'Room', NURSING: 'Nursing', OT: 'OT', OTHER: 'Other' };
const MODE: Record<SMode, PayMode> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK_TRANSFER: 'Bank transfer', ONLINE: 'Online', INSURANCE: 'Insurance', ADVANCE: 'Advance' };
const STATUS: Record<SInvoice['status'], Invoice['status']> = { UNPAID: 'Unpaid', PARTIALLY_PAID: 'Partially paid', PAID: 'Paid', REFUNDED: 'Refunded', CANCELLED: 'Cancelled' };
const CSTATUS: Record<SClaimStatus, ClaimStatus> = { DRAFT: 'Draft', SUBMITTED: 'Submitted', UNDER_REVIEW: 'Under review', APPROVED: 'Approved', REJECTED: 'Rejected', SETTLED: 'Settled' };
const CTYPE: Record<SClaim['type'], Claim['type']> = { PRE_AUTHORISATION: 'Pre-authorisation', FINAL_CLAIM: 'Final claim', REIMBURSEMENT: 'Reimbursement' };
const inv = <K extends string, V extends string>(m: Record<K, V>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k])) as Record<V, K>;
export const toServerKind = inv(KIND), toServerCategory = inv(CAT_LABEL), toServerMode = inv(MODE), toServerClaimStatus = inv(CSTATUS);
export const toServerStatus = inv(STATUS);

const day = (iso: string) => {
  // Instants from the server are shown as the Indian calendar day they fall on.
  const d = new Date(iso); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
};

export function fromServerInvoice(s: SInvoice): Invoice {
  const pays = s.payments ?? [];
  const totals: InvoiceTotals = { sub: s.subtotal, discount: s.discountAmount, tax: s.cgst + s.sgst + s.igst, cgst: s.cgst, sgst: s.sgst, igst: s.igst, roundOff: s.roundOff, total: s.total, paid: s.paid - s.refunded, due: s.due };
  return {
    id: s.id, number: s.number, patientId: s.patientId, patientName: s.patientName, gstin: s.gstin, date: s.invoiceDate, kind: KIND[s.kind], status: STATUS[s.status],
    discountPct: s.discountPct, createdBy: s.createdBy, claimId: s.claimId, claimNumber: s.claimNumber, admissionId: s.admissionRef, cancelReason: s.cancelReason, version: s.version, totals,
    items: (s.lines ?? []).map(l => ({ desc: l.description, category: CAT_LABEL[l.category], qty: l.qty, rate: l.rate, taxPct: l.taxPct, refId: l.refId, refType: l.refType, tariffCode: l.tariffCode, hsnSac: l.hsnSac, amount: l.amount })),
    payments: pays.filter(p => p.type === 'PAYMENT').map(p => ({ id: p.id, receipt: p.receiptNumber, date: day(p.receivedAt), mode: MODE[p.mode], amount: p.amount, ref: p.reference })),
    refunds: pays.filter(p => p.type === 'REFUND').map(p => ({ id: p.id, receipt: p.receiptNumber, date: day(p.receivedAt), mode: MODE[p.mode], amount: p.amount, ref: p.reason })),
  };
}

export function fromServerClaim(s: SClaim): Claim {
  return {
    id: s.id, number: s.number, patientId: s.patientId, patientName: s.patientName, invoiceId: s.invoiceId, invoiceNumber: s.invoiceNumber, providerId: s.providerId, providerName: s.providerName,
    tpa: s.tpa, policyNo: s.policyNo, claimed: s.claimed, approved: s.approved, copay: s.copayPct, status: CSTATUS[s.status], type: CTYPE[s.type], created: day(s.createdAt), docs: [...s.documents],
    rejectionReason: s.rejectionReason, version: s.version, history: (s.history ?? []).map(h => ({ date: day(h.at), status: CSTATUS[h.status], note: h.note ?? '' })),
  };
}

/**
 * One place for the billing screens to read and change invoices and claims. In demo mode it works on the
 * in-browser StoreService exactly as the prototype did; in live mode every call goes to the HospitOS API and
 * the server's GST totals are shown as they are.
 */
@Injectable({ providedIn: 'root' })
export class BillingService {
  readonly live = LIVE;
  private store = inject(StoreService);
  readonly api = inject(BillingApi);

  /** Live mode caches, refreshed by load*(). */
  readonly invoices = signal<Invoice[]>([]);
  readonly claims = signal<Claim[]>([]);
  readonly summary = signal<SSummary | null>(null);
  readonly settings = signal<SSettingsView | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  private providerNames = new Map<string, { name: string; tpa?: string }>();

  totals(i: Invoice): InvoiceTotals {
    if (i.totals) return i.totals;
    const t = this.store.invoiceTotals(i); return { ...t, cgst: t.tax / 2, sgst: t.tax / 2, igst: 0, roundOff: 0 };
  }
  pname(i: { patientId: string; patientName?: string }) { return i.patientName ?? this.store.pname(i.patientId); }
  label(i: Invoice) { return i.number ?? i.id; }
  claimLabel(c: Claim) { return c.number ?? c.id; }
  provider(id?: string) {
    if (!id) return undefined;
    if (!this.live) return this.store.provider(id);
    const p = this.providerNames.get(id); return p ? { name: p.name, tpa: p.tpa ?? '' } : undefined;
  }

  // ---------------------------------------------------------------- loading (live)

  private async run<T>(f: () => Promise<T>): Promise<T> {
    this.loading.set(true); this.error.set('');
    try { return await f(); } finally { this.loading.set(false); }
  }

  async loadInvoices() {
    if (!this.live) return;
    await this.run(async () => {
      const [list, sum] = await Promise.all([this.api.invoices(), this.api.summary()]);
      this.invoices.set(list.map(fromServerInvoice)); this.summary.set(sum);
    });
  }

  async loadSettings() {
    if (!this.live || this.settings()) return this.settings();
    const s = await this.api.settings(); this.settings.set(s); return s;
  }

  async loadProviders() {
    if (!this.live) return this.store.db.providers;
    const list = await this.api.providers(); list.forEach(p => this.providerNames.set(p.id, { name: p.name, tpa: p.tpa })); return list;
  }

  async loadClaims() {
    if (!this.live) return;
    await this.run(async () => { await this.loadProviders(); this.claims.set((await this.api.claims()).map(fromServerClaim)); });
  }

  async invoice(id: string): Promise<Invoice | undefined> {
    if (!this.live) return this.store.db.invoices.find(x => x.id === id);
    return fromServerInvoice(await this.api.invoice(id));
  }

  // ---------------------------------------------------------------- changes

  async createInvoice(patientId: string, items: InvoiceItem[], discountPct: number, kind: Invoice['kind']): Promise<Invoice> {
    if (!this.live) return this.store.createInvoice(patientId, items, discountPct, kind);
    const lines: SNewLine[] = items.map(i => ({ tariffCode: i.tariffCode, description: i.desc, category: toServerCategory[i.category], qty: +i.qty, rate: +i.rate, taxPct: +i.taxPct, refType: i.refType, refId: i.refId }));
    return fromServerInvoice(await this.api.createInvoice({ patientId, kind: toServerKind[kind], discountPct, lines }));
  }

  async pay(i: Invoice, mode: PayMode, amount: number, ref?: string): Promise<Invoice> {
    if (!this.live) { this.store.pay(i, mode, amount, ref); return i; }
    return this.replace(fromServerInvoice(await this.api.pay(i.id, toServerMode[mode], amount, ref)));
  }

  async refund(i: Invoice, amount: number, reason: string): Promise<Invoice> {
    if (!this.live) { this.store.refund(i, amount, reason); return i; }
    return this.replace(fromServerInvoice(await this.api.refund(i.id, amount, reason)));
  }

  private replace(i: Invoice) { this.invoices.update(l => l.map(x => x.id === i.id ? i : x)); return i; }

  async createClaim(i: Invoice, providerId: string, policyNo: string, copayPct: number): Promise<Claim> {
    if (!this.live) {
      const total = this.store.invoiceTotals(i).total;
      const c: Claim = { id: 'CLM-' + (3200 + this.store.db.claims.length), patientId: i.patientId, invoiceId: i.id, providerId, policyNo, claimed: Math.round(total * (100 - copayPct) / 100), approved: 0, copay: copayPct, status: 'Draft', type: 'Final claim', created: this.store.today(), docs: ['Invoice', 'Doctor notes'], history: [{ date: this.store.today(), status: 'Draft', note: 'Created from invoice' }] };
      this.store.db.claims.unshift(c); i.claimId = c.id; this.store.changed(); return c;
    }
    return fromServerClaim(await this.api.createClaim({ invoiceId: i.id, providerId, policyNo, copayPct, documents: ['Invoice', 'Doctor notes'] }));
  }

  async setClaimDocs(c: Claim, docs: string[]): Promise<Claim> {
    if (!this.live) { c.docs = docs; this.store.changed(); return c; }
    return this.replaceClaim(fromServerClaim(await this.api.claimDocuments(c.id, docs, c.version!)));
  }

  async moveClaim(c: Claim, to: ClaimStatus, extra: { note?: string; approved?: number; rejectionReason?: string; settlementRef?: string } = {}): Promise<Claim> {
    if (!this.live) {
      this.store.setClaim(c, to, extra.note ?? extra.rejectionReason ?? (extra.settlementRef ? 'UTR ' + extra.settlementRef : ''), { ...(extra.approved ? { approved: extra.approved } : {}), ...(extra.rejectionReason ? { rejectionReason: extra.rejectionReason } : {}) });
      if (to === 'Settled') { const i = this.store.db.invoices.find(x => x.id === c.invoiceId); if (i) this.store.pay(i, 'Insurance', Math.min(c.approved, this.store.invoiceTotals(i).due), extra.settlementRef); }
      return c;
    }
    const saved = fromServerClaim(await this.api.claimStatus(c.id, { status: toServerClaimStatus[to], version: c.version!, ...extra }));
    return this.replaceClaim(saved);
  }

  private replaceClaim(c: Claim) { this.claims.update(l => l.map(x => x.id === c.id ? c : x)); return c; }
}
