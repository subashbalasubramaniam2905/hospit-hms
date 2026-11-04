import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Patient } from '../models';
import { API_URL } from './api-config';

export type PatientInput = Omit<Patient, 'id' | 'registered' | 'documents' | 'branchId'> & { branchId?: string; version?: number };
export interface DuplicateHit { patient: Patient; score: number; reasons: string[]; }

/** Patient master index on the HospitOS server. */
@Injectable({ providedIn: 'root' })
export class PatientsApi {
  private http = inject(HttpClient);
  private base = `${API_URL}/api/patients`;

  search(q = '', limit = 500) { return firstValueFrom(this.http.get<Patient[]>(this.base, { params: new HttpParams().set('q', q).set('limit', limit) })); }
  get(id: string) { return firstValueFrom(this.http.get<Patient>(`${this.base}/${encodeURIComponent(id)}`)); }
  create(p: PatientInput) { return firstValueFrom(this.http.post<Patient>(this.base, p)); }
  update(id: string, p: PatientInput) { return firstValueFrom(this.http.put<Patient>(`${this.base}/${encodeURIComponent(id)}`, p)); }
  duplicates(name: string, mobile: string, dob?: string) {
    let params = new HttpParams().set('name', name).set('mobile', mobile);
    if (dob) params = params.set('dob', dob);
    return firstValueFrom(this.http.get<DuplicateHit[]>(`${this.base}/duplicates`, { params }));
  }
}

/** Builds the update body from a full patient record, so edits never drop fields. */
export function toInput(p: Patient): PatientInput {
  const { id: _id, registered: _r, documents: _d, ...rest } = p;
  return rest;
}
