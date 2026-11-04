import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Batch, Medicine, PayMode, Prescription, StockMove } from '../models';
import { API_URL } from './api-config';

/** A medicine as the server returns it: the Angular shape plus branch stock and batch ids. */
export interface LiveMedicine extends Medicine { gstPct: number; active: boolean; version: number; branchId: string; stock: number; batches: (Batch & { id: string })[]; }
export interface FefoPick { batchId: string; batch: string; expiry: string; take: number; }
export interface DispenseLine { medicineId: string; qty: number; substitutedFor?: string; }
export interface DispenseResult {
  id: string; prescriptionId: string; patientId: string; status: Prescription['status']; partial: boolean; payMode: string; total: number;
  invoiceId: string; invoiceNumber: string; lowStock: { medicineId: string; name: string; stock: number; reorder: number }[];
  lines: { medicineId: string; name: string; qty: number; requested: number; amount: number; batches: FefoPick[] }[];
}
export interface LiveStockMove { id: string; at: string; branchId: string; itemId: string; name: string; batch: string; kind: StockMove['kind']; qty: number; ref: string; by: string; note?: string; }

/** Pharmacy stock and dispensing on the HospitOS server. Stock reads are for one branch. */
@Injectable({ providedIn: 'root' })
export class PharmacyApi {
  private http = inject(HttpClient);
  private base = `${API_URL}/api/pharmacy`;

  medicines(branchId: string) { return firstValueFrom(this.http.get<LiveMedicine[]>(`${this.base}/medicines`, { params: { branchId } })); }
  medicine(id: string, branchId: string) { return firstValueFrom(this.http.get<LiveMedicine>(`${this.base}/medicines/${encodeURIComponent(id)}`, { params: { branchId } })); }
  adjust(batchId: string, delta: number, note: string, returnToSupplier = false) {
    return firstValueFrom(this.http.post<LiveMedicine>(`${this.base}/stock/adjust`, { batchId, delta, note, returnToSupplier }));
  }
  transfer(medicineId: string, fromBranchId: string, toBranchId: string, qty: number) {
    return firstValueFrom(this.http.post<LiveMedicine>(`${this.base}/stock/transfer`, { medicineId, fromBranchId, toBranchId, qty }));
  }
  moves(branchId: string, limit = 300) {
    return firstValueFrom(this.http.get<LiveStockMove[]>(`${this.base}/stock/moves`, { params: new HttpParams().set('branchId', branchId).set('limit', limit) }));
  }
  dispense(prescriptionId: string, payMode: PayMode, counselled: boolean, lines: DispenseLine[]) {
    return firstValueFrom(this.http.post<DispenseResult>(`${this.base}/dispense`, { prescriptionId, payMode, counselled, lines }));
  }
  dispensesToday(branchId: string) { return firstValueFrom(this.http.get<DispenseSummary[]>(`${this.base}/dispenses`, { params: { branchId } })); }
  remaining(prescriptionId: string) { return firstValueFrom(this.http.get<Record<string, number>>(`${this.base}/prescriptions/${prescriptionId}/remaining`)); }
  /** Prescriptions belong to the clinical module; the pharmacy reads the ones waiting for it. */
  prescriptions(status: Prescription['status']) {
    return firstValueFrom(this.http.get<Prescription[]>(`${API_URL}/api/clinical/prescriptions`, { params: { status } }));
  }
}

export interface DispenseSummary { id: string; prescriptionId: string; patientId: string; patientName: string; partial: boolean; payMode: string; total: number; invoiceNumber: string; at: string; by: string; }
