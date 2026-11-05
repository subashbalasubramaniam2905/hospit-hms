import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Admission, Bed, BedStatus, ClinicalNote, IOEntry, MarEntry, Ward } from '../models';
import { API_URL } from './api-config';

export type DepositMode = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'ONLINE';
export interface LiveWard extends Ward { branchId: string; active: boolean; }
export interface LiveBed extends Bed { branchId: string; active: boolean; }
export interface IpdDeposit { id: string; kind: 'DEPOSIT' | 'REFUND' | 'ADJUSTED'; receiptNo: string; amount: number; mode: string; reference?: string; by: string; at: string; }
export interface IpdCharge { id: string; tariffCode?: string; description: string; category: string; qty: number; rate: number; by: string; at: string; }
/** An admission as the server returns it: the Angular shape plus names, money and the final invoice. */
export interface LiveAdmission extends Admission {
  branchId: string; patientName: string; doctorName: string; bedLabel: string; wardId: string; wardName: string;
  dischargeChecklist: string[]; dischargedBy?: string; depositBalance: number; deposits: IpdDeposit[]; charges: IpdCharge[];
  erCaseId?: string; claimId?: string; invoiceId?: string; invoiceNumber?: string; version: number;
}
export interface AdmitInput {
  patientId: string; doctorId: string; bedId: string; type: Admission['type']; reason: string; diagnosis?: string; expectedDischarge: string;
  advance: number; advanceMode: DepositMode; advanceReference?: string; consent: boolean; preauth: boolean; erCaseId?: string;
}
export interface AdmitResult { admission: LiveAdmission; claimNumber?: string; warning?: string; }
export interface BillLine { description: string; category: string; tariffCode?: string; qty: number; rate: number; amount: number; }
export interface BillPreview { admissionId: string; days: number; lines: BillLine[]; subtotal: number; deposits: number; depositBalance: number; estimatedDue: number; invoiceId?: string; invoiceNumber?: string; }
export interface DirectoryDoctor { id: string; branchId: string; deptId: string; name: string; }

/** Wards, beds, admissions, the ward record and discharge on the HospitOS server. */
@Injectable({ providedIn: 'root' })
export class IpdApi {
  private http = inject(HttpClient);
  private base = `${API_URL}/api/ipd`;
  private a(id: string) { return `${this.base}/admissions/${encodeURIComponent(id)}`; }
  private post<T>(url: string, body: unknown = {}) { return firstValueFrom(this.http.post<T>(url, body)); }

  wards(branchId: string) { return firstValueFrom(this.http.get<LiveWard[]>(`${this.base}/wards`, { params: { branchId } })); }
  beds(branchId: string) { return firstValueFrom(this.http.get<LiveBed[]>(`${this.base}/beds`, { params: { branchId } })); }
  setBedStatus(bedId: string, status: BedStatus) { return this.post<LiveBed>(`${this.base}/beds/${encodeURIComponent(bedId)}/status`, { status }); }

  admissions(params: { branchId?: string; status?: 'current' | 'discharged' | 'all'; patientId?: string } = {}) {
    let p = new HttpParams().set('status', params.status ?? 'current');
    if (params.branchId) p = p.set('branchId', params.branchId);
    if (params.patientId) p = p.set('patientId', params.patientId);
    return firstValueFrom(this.http.get<LiveAdmission[]>(`${this.base}/admissions`, { params: p }));
  }
  admission(id: string) { return firstValueFrom(this.http.get<LiveAdmission>(this.a(id))); }
  admit(input: AdmitInput) { return this.post<AdmitResult>(`${this.base}/admissions`, input); }
  transfer(id: string, bedId: string) { return this.post<LiveAdmission>(`${this.a(id)}/transfer`, { bedId }); }
  planDischarge(id: string) { return this.post<LiveAdmission>(`${this.a(id)}/plan-discharge`); }
  discharge(id: string, summary: string, checklist: string[]) { return this.post<LiveAdmission>(`${this.a(id)}/discharge`, { summary, checklist }); }

  note(id: string, type: ClinicalNote['type'], text: string) { return this.post<LiveAdmission>(`${this.a(id)}/notes`, { type, text }); }
  carePlan(id: string, text: string) { return this.post<LiveAdmission>(`${this.a(id)}/care-plan`, { text }); }
  addMar(id: string, m: { med: string; dose: string; route: string; time: string }) { return this.post<LiveAdmission>(`${this.a(id)}/mar`, m); }
  dose(id: string, marId: string, status: MarEntry['status'], note?: string) { return this.post<LiveAdmission>(`${this.a(id)}/mar/${marId}`, { status, note }); }
  obs(id: string, o: { bp: string; hr: number; temp: number; spo2: number; rr: number; pain: number }) { return this.post<LiveAdmission>(`${this.a(id)}/obs`, o); }
  io(id: string, e: { kind: IOEntry['kind']; type: string; ml: number }) { return this.post<LiveAdmission>(`${this.a(id)}/io`, e); }

  bill(id: string) { return firstValueFrom(this.http.get<BillPreview>(`${this.a(id)}/bill`)); }
  deposit(id: string, amount: number, mode: DepositMode, reference?: string) { return this.post<LiveAdmission>(`${this.a(id)}/deposits`, { amount, mode, reference }); }
  refundDeposit(id: string, mode: DepositMode, reference?: string) { return this.post<LiveAdmission>(`${this.a(id)}/refund-deposit`, { mode, reference }); }
  charge(id: string, c: { tariffCode?: string; description?: string; category?: string; qty: number; rate?: number }) { return this.post<LiveAdmission>(`${this.a(id)}/charges`, c); }
  cancelCharge(id: string, chargeId: string) { return firstValueFrom(this.http.delete<LiveAdmission>(`${this.a(id)}/charges/${chargeId}`)); }

  doctors() { return firstValueFrom(this.http.get<DirectoryDoctor[]>(`${API_URL}/api/doctors`)); }
  /** Tells the emergency module the ER case became this admission. Its endpoint may not exist yet, so callers ignore failures. */
  erAdmitted(erCaseId: string, admissionId: string) { return this.post<unknown>(`${API_URL}/api/er/cases/${encodeURIComponent(erCaseId)}/admitted`, { admissionId }); }
}
