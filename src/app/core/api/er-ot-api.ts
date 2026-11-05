import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ERCase, Surgery, TriageLevel } from '../models';
import { API_URL } from './api-config';
import { DirectoryDoctor } from './lab-api';

/** An ER case as the server returns it: the Angular shape plus names, timeline and the disposition. */
export interface LiveERCase extends ERCase { branchId: string; doctorName?: string; suggestedTriage: TriageLevel; arrivedAt: string; timeline: { at: string; by: string; event: string }[]; admissionId?: string; dispositionNote?: string; version: number; }
export interface ErBay { name: string; kind: 'Resus' | 'Bay' | 'Minor'; caseId?: string; }
export interface NewErCase { branchId: string; patientId?: string; age?: number; gender: string; mode: ERCase['mode']; triage: TriageLevel; complaint: string; bay?: string; doctorId?: string; vitals: { bp: string; hr?: number; spo2?: number; gcs?: number; temp?: number }; }
export interface ErUpdate { triage?: TriageLevel; doctorId?: string; bay?: string; vitals?: NewErCase['vitals']; }

/** A surgery booking as the server returns it, with names and allergies so the screen needs no patient lookup. */
export interface LiveSurgery extends Surgery { branchId: string; patientName: string; patientAllergies: string[]; surgeonName: string; cancelReason?: string; admissionId?: string; version: number; }
export interface NewSurgery { branchId: string; patientId: string; procedure: string; surgeonId: string; room: string; date: string; start: string; durationMin: number; anaesthesia: string; anaesthetist: string; }

/** Emergency board and operation theatre schedule on the HospitOS server. */
@Injectable({ providedIn: 'root' })
export class ErOtApi {
  private http = inject(HttpClient);
  private er = `${API_URL}/api/er`;
  private ot = `${API_URL}/api/ot`;
  private c(id: string) { return `${this.er}/cases/${encodeURIComponent(id)}`; }
  private s(id: string) { return `${this.ot}/surgeries/${encodeURIComponent(id)}`; }
  private b(branchId: string) { return new HttpParams().set('branchId', branchId); }

  doctors() { return firstValueFrom(this.http.get<DirectoryDoctor[]>(`${API_URL}/api/doctors`)); }

  // ---------- emergency ----------
  bays(branchId: string) { return firstValueFrom(this.http.get<ErBay[]>(`${this.er}/bays`, { params: this.b(branchId) })); }
  /** Open cases in the branch plus those closed today. */
  board(branchId: string) { return firstValueFrom(this.http.get<LiveERCase[]>(`${this.er}/cases`, { params: this.b(branchId) })); }
  register(c: NewErCase) { return firstValueFrom(this.http.post<LiveERCase>(`${this.er}/cases`, c)); }
  update(id: string, u: ErUpdate) { return firstValueFrom(this.http.patch<LiveERCase>(this.c(id), u)); }
  order(id: string, name: string) { return firstValueFrom(this.http.post<LiveERCase>(`${this.c(id)}/orders`, { name })); }
  link(id: string, patientId: string) { return firstValueFrom(this.http.post<LiveERCase>(`${this.c(id)}/link`, { patientId })); }
  status(id: string, status: ERCase['status'], note?: string) { return firstValueFrom(this.http.post<LiveERCase>(`${this.c(id)}/status`, { status, note })); }
  /** Marks the case admitted once the inpatient admission exists. */
  admitted(id: string, admissionId?: string) { return firstValueFrom(this.http.post<LiveERCase>(`${this.c(id)}/admitted`, { admissionId })); }

  // ---------- operation theatre ----------
  rooms(branchId: string) { return firstValueFrom(this.http.get<string[]>(`${this.ot}/rooms`, { params: this.b(branchId) })); }
  surgeries(branchId: string, date: string) { return firstValueFrom(this.http.get<LiveSurgery[]>(`${this.ot}/surgeries`, { params: this.b(branchId).set('date', date) })); }
  book(s: NewSurgery) { return firstValueFrom(this.http.post<LiveSurgery>(`${this.ot}/surgeries`, s)); }
  check(id: string, item: string, done: boolean) { return firstValueFrom(this.http.post<LiveSurgery>(`${this.s(id)}/checklist`, { item, done })); }
  /** from is the status the screen shows, so a stale screen cannot skip a stage. */
  advance(id: string, from: Surgery['status']) { return firstValueFrom(this.http.post<LiveSurgery>(`${this.s(id)}/advance`, { from })); }
  cancel(id: string, reason?: string) { return firstValueFrom(this.http.post<LiveSurgery>(`${this.s(id)}/cancel`, { reason })); }
  notes(id: string, postOpNotes: string) { return firstValueFrom(this.http.put<LiveSurgery>(`${this.s(id)}/notes`, { postOpNotes })); }
}
