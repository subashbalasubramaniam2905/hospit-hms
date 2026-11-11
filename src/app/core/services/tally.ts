import { ExpenseCategory, TallyEntry, TallyFormat, TallyLedger, TallyVoucher } from '../api/finance-api';

/**
 * Demo mode only: the same voucher mapping and file formats as the server's TallyExporter, run in the browser on the
 * prototype's sample data. In live mode the server builds the files; keep the two in step.
 */
export const TALLY_GROUPS = ['Bank Accounts', 'Bank OD A/c', 'Cash-in-Hand', 'Current Assets', 'Current Liabilities', 'Direct Expenses', 'Direct Incomes',
  'Duties & Taxes', 'Fixed Assets', 'Indirect Expenses', 'Indirect Incomes', 'Loans & Advances (Asset)', 'Loans (Liability)', 'Provisions', 'Sales Accounts',
  'Sundry Creditors', 'Sundry Debtors'];
export const EXPENSE_GROUPS = ['Direct Expenses', 'Indirect Expenses', 'Fixed Assets', 'Current Assets', 'Loans (Liability)'];
const CASH_BANK = ['Cash-in-Hand', 'Bank Accounts', 'Bank OD A/c'];

const L = (key: string, label: string, ledgerName: string, tallyGroup: string): TallyLedger => ({ key, label, ledgerName, tallyGroup });
export const DEFAULT_LEDGERS: TallyLedger[] = [
  L('PATIENTS', 'Patients (receivable)', 'Patient Receivables', 'Sundry Debtors'),
  L('SALES_CONSULTATION', 'Income: consultation', 'OPD Consultation Income', 'Sales Accounts'),
  L('SALES_PROCEDURE', 'Income: procedures', 'Procedure Income', 'Sales Accounts'),
  L('SALES_LABORATORY', 'Income: laboratory', 'Laboratory Income', 'Sales Accounts'),
  L('SALES_IMAGING', 'Income: imaging', 'Radiology Income', 'Sales Accounts'),
  L('SALES_PHARMACY', 'Income: pharmacy', 'Pharmacy Sales', 'Sales Accounts'),
  L('SALES_ROOM', 'Income: room and bed', 'Room Rent Income', 'Sales Accounts'),
  L('SALES_NURSING', 'Income: nursing', 'Nursing Income', 'Sales Accounts'),
  L('SALES_OT', 'Income: operation theatre', 'OT Income', 'Sales Accounts'),
  L('SALES_OTHER', 'Income: other services', 'Other Operating Income', 'Sales Accounts'),
  L('OUTPUT_CGST', 'Output CGST', 'Output CGST', 'Duties & Taxes'), L('OUTPUT_SGST', 'Output SGST', 'Output SGST', 'Duties & Taxes'),
  L('OUTPUT_IGST', 'Output IGST', 'Output IGST', 'Duties & Taxes'), L('INPUT_CGST', 'Input CGST', 'Input CGST', 'Duties & Taxes'),
  L('INPUT_SGST', 'Input SGST', 'Input SGST', 'Duties & Taxes'), L('INPUT_IGST', 'Input IGST', 'Input IGST', 'Duties & Taxes'),
  L('TDS_PAYABLE', 'TDS deducted on expenses', 'TDS Payable', 'Duties & Taxes'),
  L('ROUND_OFF', 'Round off', 'Round Off', 'Indirect Expenses'),
  L('MODE_CASH', 'Money in/out: cash', 'Cash', 'Cash-in-Hand'),
  L('MODE_UPI', 'Money in/out: UPI', 'Bank Account', 'Bank Accounts'),
  L('MODE_CARD', 'Money in/out: card', 'Bank Account', 'Bank Accounts'),
  L('MODE_BANK_TRANSFER', 'Money in/out: bank transfer', 'Bank Account', 'Bank Accounts'),
  L('MODE_ONLINE', 'Money in: online payment', 'Bank Account', 'Bank Accounts'),
  L('MODE_CHEQUE', 'Money out: cheque', 'Bank Account', 'Bank Accounts'),
  L('MODE_INSURANCE', 'Money in: insurer settlement', 'Bank Account', 'Bank Accounts'),
  L('MODE_ADVANCE', 'Patient advances adjusted', 'Patient Advances', 'Current Liabilities'),
  L('EXPENSES_PAYABLE', 'Expenses not yet paid', 'Expenses Payable', 'Current Liabilities'),
];

/** Plain inputs, so the builder does not depend on the prototype's store. */
export interface TInvoice { id: string; number: string; date: string; patient: string; total: number; cgst: number; sgst: number; igst: number; income: Record<string, number>; }
export interface TMoney { id: string; number: string; date: string; type: 'PAYMENT' | 'REFUND'; mode: string; amount: number; invoice: string; patient: string; note?: string; }
export interface TExpense { id: string; number: string; date: string; categoryId: string; payee: string; description?: string; billNo?: string; amount: number; gstAmount: number; interstate: boolean; tdsAmount: number; payMode: string; reference?: string; }
export interface TBook { vouchers: TallyVoucher[]; groups: Map<string, string>; }

const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildBook(ledgers: TallyLedger[], cats: ExpenseCategory[], invoices: TInvoice[], money: TMoney[], expenses: TExpense[]): TBook {
  const led = new Map(ledgers.map(l => [l.key, l]));
  const groups = new Map<string, string>();
  const name = (k: string) => { const l = led.get(k)!; if (!groups.has(l.ledgerName)) groups.set(l.ledgerName, l.tallyGroup); return l.ledgerName; };
  const isCash = (k: string) => CASH_BANK.includes(led.get(k)!.tallyGroup);
  const out: TallyVoucher[] = [];
  const add = (source: TallyVoucher['source'], type: TallyVoucher['type'], number: string, date: string, party: string, narration: string, id: string, entries: TallyEntry[]) => {
    const m = new Map<string, number>();
    entries.forEach(e => m.set(e.ledger, r2((m.get(e.ledger) ?? 0) + r2(e.amount))));
    const list = [...m].filter(([, a]) => Math.abs(a) >= 0.005).map(([ledger, amount]) => ({ ledger, amount }));
    if (list.length >= 2) out.push({ source, type, number, date, party, narration, remoteId: `hospitos-${id}`, entries: list });
  };
  for (const i of invoices) {
    const e: TallyEntry[] = [{ ledger: name('PATIENTS'), amount: i.total }];
    Object.entries(i.income).forEach(([cat, amt]) => e.push({ ledger: name('SALES_' + cat), amount: -amt }));
    e.push({ ledger: name('OUTPUT_CGST'), amount: -i.cgst }, { ledger: name('OUTPUT_SGST'), amount: -i.sgst }, { ledger: name('OUTPUT_IGST'), amount: -i.igst });
    const sum = r2(e.reduce((t, x) => t + r2(x.amount), 0));
    if (sum) e.push({ ledger: name('ROUND_OFF'), amount: -sum });
    add('INVOICE', 'Sales', i.number, i.date, name('PATIENTS'), `${i.patient}, invoice ${i.number}`, i.id, e);
  }
  for (const p of money) {
    const k = 'MODE_' + p.mode, cash = isCash(k);
    if (p.type === 'PAYMENT') add('RECEIPT', cash ? 'Receipt' : 'Journal', p.number, p.date, name('PATIENTS'), `Received from ${p.patient} against ${p.invoice} by ${p.mode.replace('_', ' ').toLowerCase()}${p.note ? ', ref ' + p.note : ''}`, p.id,
      [{ ledger: name(k), amount: p.amount }, { ledger: name('PATIENTS'), amount: -p.amount }]);
    else add('REFUND', cash ? 'Payment' : 'Journal', p.number, p.date, name('PATIENTS'), `Refund to ${p.patient} against ${p.invoice}${p.note ? ': ' + p.note : ''}`, p.id,
      [{ ledger: name('PATIENTS'), amount: p.amount }, { ledger: name(k), amount: -p.amount }]);
  }
  const catMap = new Map(cats.map(c => [c.id, c]));
  for (const x of expenses) {
    const c = catMap.get(x.categoryId); if (!c) continue;
    if (!groups.has(c.tallyLedger)) groups.set(c.tallyLedger, c.tallyGroup);
    const e: TallyEntry[] = [{ ledger: c.tallyLedger, amount: x.amount }];
    if (x.gstAmount > 0) {
      if (x.interstate) e.push({ ledger: name('INPUT_IGST'), amount: x.gstAmount });
      else { const h = r2(x.gstAmount / 2); e.push({ ledger: name('INPUT_CGST'), amount: h }, { ledger: name('INPUT_SGST'), amount: r2(x.gstAmount - h) }); }
    }
    if (x.tdsAmount > 0) e.push({ ledger: name('TDS_PAYABLE'), amount: -x.tdsAmount });
    const k = x.payMode === 'UNPAID' ? 'EXPENSES_PAYABLE' : 'MODE_' + x.payMode;
    e.push({ ledger: name(k), amount: -r2(x.amount + x.gstAmount - x.tdsAmount) });
    const narr = `${c.name}: ${x.payee}${x.description ? ', ' + x.description : ''}${x.billNo ? ', bill ' + x.billNo : ''}${x.reference ? ', ref ' + x.reference : ''}${x.payMode === 'UNPAID' ? ' (not yet paid)' : ''}`;
    add('EXPENSE', isCash(k) ? 'Payment' : 'Journal', x.number, x.date, name(k), narr, x.id, e);
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return { vouchers: out, groups };
}

const x = (s: string) => (s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[\r\n]/g, ' ')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const open = (report: string, company: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Exported from HospitOS. Import in TallyPrime: Gateway of Tally > Import > ${report === 'Vouchers' ? 'Transactions' : 'Masters'} -->\n`
  + `<ENVELOPE>\n <HEADER>\n  <TALLYREQUEST>Import Data</TALLYREQUEST>\n </HEADER>\n <BODY>\n  <IMPORTDATA>\n   <REQUESTDESC>\n    <REPORTNAME>${report}</REPORTNAME>\n`
  + (company.trim() ? `    <STATICVARIABLES><SVCURRENTCOMPANY>${x(company.trim())}</SVCURRENTCOMPANY></STATICVARIABLES>\n` : '') + `   </REQUESTDESC>\n   <REQUESTDATA>\n`;
const close = `   </REQUESTDATA>\n  </IMPORTDATA>\n </BODY>\n</ENVELOPE>\n`;
const amt = (n: number) => n.toFixed(2);

export function writeBook(b: TBook, format: TallyFormat, company: string): string {
  if (format === 'csv') {
    const c = (s: string) => { let v = s ?? ''; if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    const rows = ['Date,Voucher type,Voucher number,Ledger,Tally group,Debit,Credit,Narration,Source'];
    for (const v of b.vouchers) for (const e of v.entries)
      rows.push([v.date, v.type, c(v.number), c(e.ledger), c(b.groups.get(e.ledger) ?? ''), e.amount > 0 ? amt(e.amount) : '', e.amount > 0 ? '' : amt(-e.amount), c(v.narration), v.source].join(','));
    return '﻿' + rows.join('\r\n') + '\r\n';
  }
  if (format === 'masters') {
    let s = open('All Masters', company);
    b.groups.forEach((group, name) => {
      const u = name.toUpperCase(), head = u.includes('CGST') ? 'Central Tax' : u.includes('SGST') ? 'State Tax' : u.includes('IGST') ? 'Integrated Tax' : '';
      s += `   <TALLYMESSAGE xmlns:UDF="TallyUDF">\n    <LEDGER NAME="${x(name)}" ACTION="Create">\n     <NAME.LIST><NAME>${x(name)}</NAME></NAME.LIST>\n     <PARENT>${x(group)}</PARENT>\n`
        + `     <ISBILLWISEON>No</ISBILLWISEON>\n     <AFFECTSSTOCK>No</AFFECTSSTOCK>\n` + (group === 'Duties & Taxes' && head ? `     <TAXTYPE>GST</TAXTYPE>\n     <GSTDUTYHEAD>${head}</GSTDUTYHEAD>\n` : '')
        + `    </LEDGER>\n   </TALLYMESSAGE>\n`;
    });
    return s + close;
  }
  let s = open('Vouchers', company);
  for (const v of b.vouchers) {
    s += `   <TALLYMESSAGE xmlns:UDF="TallyUDF">\n    <VOUCHER REMOTEID="${x(v.remoteId)}" VCHTYPE="${v.type}" ACTION="Create" OBJVIEW="Accounting Voucher View">\n`
      + `     <DATE>${v.date.replace(/-/g, '')}</DATE>\n     <VOUCHERTYPENAME>${v.type}</VOUCHERTYPENAME>\n     <VOUCHERNUMBER>${x(v.number)}</VOUCHERNUMBER>\n`
      + `     <REFERENCE>${x(v.number)}</REFERENCE>\n     <PARTYLEDGERNAME>${x(v.party)}</PARTYLEDGERNAME>\n     <NARRATION>${x(v.narration)}</NARRATION>\n`
      + `     <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>\n`;
    for (const e of v.entries)
      s += `     <ALLLEDGERENTRIES.LIST>\n      <LEDGERNAME>${x(e.ledger)}</LEDGERNAME>\n      <ISDEEMEDPOSITIVE>${e.amount > 0 ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>\n`
        + `      <ISPARTYLEDGER>${e.ledger === v.party ? 'Yes' : 'No'}</ISPARTYLEDGER>\n      <AMOUNT>${amt(-e.amount)}</AMOUNT>\n     </ALLLEDGERENTRIES.LIST>\n`;
    s += `    </VOUCHER>\n   </TALLYMESSAGE>\n`;
  }
  return s + close;
}

/** Offers a file as a download. */
export function download(blob: Blob, name: string) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch { /* blocked in some previews */ }
}
