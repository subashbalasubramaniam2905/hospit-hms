import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LabOrder, LabTest } from '../models';
import { API_URL } from './api-config';

/** A lab order as the server returns it: the Angular shape plus names, flags and the version for edits. */
export interface LiveLabOrder extends LabOrder { branchId: string; patientName: string; doctorName?: string; flags: Record<string, Record<string, 'N' | 'L' | 'H' | 'C'>>; version: number; invoiceNumber?: string; }
export interface LabCritical { testId: string; test: string; param: string; value: number; unit: string; flag: string; }
export interface DirectoryDoctor { id: string; branchId: string; deptId: string; name: string; }

/** Laboratory orders, samples and results on the HospitOS server. */
@Injectable({ providedIn: 'root' })
export class LabApi {
  private http = inject(HttpClient);
  private base = `${API_URL}/api/lab`;
  private o(id: string) { return `${this.base}/orders/${encodeURIComponent(id)}`; }

  tests() { return firstValueFrom(this.http.get<LabTest[]>(`${this.base}/tests`)); }
  orders(params: { status?: string; patientId?: string; limit?: number } = {}) {
    let p = new HttpParams().set('limit', params.limit ?? 500);
    if (params.status) p = p.set('status', params.status);
    if (params.patientId) p = p.set('patientId', params.patientId);
    return firstValueFrom(this.http.get<LiveLabOrder[]>(`${this.base}/orders`, { params: p }));
  }
  order(id: string) { return firstValueFrom(this.http.get<LiveLabOrder>(this.o(id))); }
  scan(code: string) { return firstValueFrom(this.http.get<LiveLabOrder>(`${this.base}/scan/${encodeURIComponent(code)}`)); }
  create(patientId: string, doctorId: string, testIds: string[], priority: LabOrder['priority'], bill = true) {
    return firstValueFrom(this.http.post<LiveLabOrder>(`${this.base}/orders`, { patientId, doctorId, testIds, priority, bill }));
  }
  collect(id: string) { return firstValueFrom(this.http.post<LiveLabOrder>(`${this.o(id)}/collect`, {})); }
  reject(id: string, reason: string) { return firstValueFrom(this.http.post<LiveLabOrder>(`${this.o(id)}/reject`, { reason })); }
  receive(id: string) { return firstValueFrom(this.http.post<LiveLabOrder>(`${this.o(id)}/receive`, {})); }
  saveResults(o: LiveLabOrder, submit: boolean) {
    return firstValueFrom(this.http.put<LiveLabOrder>(`${this.o(o.id)}/results`, { results: o.results, comments: o.comments, version: o.version, submit }));
  }
  reopen(id: string) { return firstValueFrom(this.http.post<LiveLabOrder>(`${this.o(id)}/reopen`, {})); }
  verify(id: string) { return firstValueFrom(this.http.post<{ order: LiveLabOrder; criticals: LabCritical[] }>(`${this.o(id)}/verify`, {})); }
  deliver(id: string) { return firstValueFrom(this.http.post<LiveLabOrder>(`${this.o(id)}/deliver`, {})); }
  doctors() { return firstValueFrom(this.http.get<DirectoryDoctor[]>(`${API_URL}/api/doctors`)); }
}
