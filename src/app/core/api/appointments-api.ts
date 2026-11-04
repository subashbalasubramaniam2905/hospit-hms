import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Appointment, ApptStatus, Department, Doctor, QueueEntry } from '../models';
import { API_URL } from './api-config';

/** What the server returns for an appointment: the Angular model plus the patient's name. */
export type ApiAppointment = Appointment & { patientName?: string };
export type ApiQueueEntry = QueueEntry & { id: number; patientName?: string };
export interface SlotInfo { time: string; ok: boolean; reason?: string }
export interface SlotDay { doctorId: string; date: string; slotMinutes: number; start: string; end: string; dayBlock?: string; slots: SlotInfo[] }
export interface BookInput { patientId: string; doctorId: string; date: string; time: string; duration: number; type: string; notes?: string; recurring?: string }
export interface BookResult { appointment: ApiAppointment; repeats: ApiAppointment[]; skipped: string[] }
export interface WalkInResult { appointment: ApiAppointment; queue: ApiQueueEntry }
export interface PatientHit { id: string; name: string; mobile: string; dob: string; gender: string; allergies?: string[]; primaryDoctorId?: string }

/** The reason the server gave (RFC 7807 detail), for showing in a toast. */
export function apiMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0) return 'Cannot reach the HospitOS server. Check your connection.';
    return e.error?.detail || e.error?.message || fallback;
  }
  return fallback;
}

/** Calls to /api/appointments, /api/queue and the directory endpoints the front desk needs. */
@Injectable({ providedIn: 'root' })
export class AppointmentsApi {
  private http = inject(HttpClient);
  private base = API_URL + '/api';

  private get<T>(path: string, params: Record<string, string | number | undefined> = {}) {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p = p.set(k, String(v));
    return firstValueFrom(this.http.get<T>(this.base + path, { params: p }));
  }
  private post<T>(path: string, body: unknown = {}) { return firstValueFrom(this.http.post<T>(this.base + path, body)); }

  doctors() { return this.get<Doctor[]>('/doctors'); }
  departments() { return this.get<Department[]>('/departments'); }
  searchPatients(q: string) { return this.get<PatientHit[]>('/patients', { q }); }

  list(from: string, to: string, filter: { doctorId?: string; patientId?: string; status?: string } = {}) {
    return this.get<ApiAppointment[]>('/appointments', { from, to, ...filter });
  }
  slots(doctorId: string, date: string, duration?: number) { return this.get<SlotDay>('/appointments/slots', { doctorId, date, duration }); }
  book(b: BookInput) { return this.post<BookResult>('/appointments', b); }
  walkIn(patientId: string, doctorId: string, priority = false, emergency = false) { return this.post<WalkInResult>('/appointments/walk-in', { patientId, doctorId, priority, emergency }); }
  setStatus(id: string, status: ApptStatus) { return this.post<ApiAppointment>(`/appointments/${encodeURIComponent(id)}/status`, { status }); }
  reschedule(id: string, date: string, time: string) { return this.post<ApiAppointment>(`/appointments/${encodeURIComponent(id)}/reschedule`, { date, time }); }
  reminder(id: string) { return this.post<ApiAppointment>(`/appointments/${encodeURIComponent(id)}/reminder`); }

  queue(date?: string) { return this.get<ApiQueueEntry[]>('/queue', { date }); }
  move(id: number, step?: number) { return this.post<ApiQueueEntry>(`/queue/${id}/move`, step === undefined ? {} : { step }); }
  patchQueue(id: number, patch: { priority?: boolean; emergency?: boolean; doctorId?: string }) {
    return firstValueFrom(this.http.patch<ApiQueueEntry>(`${this.base}/queue/${id}`, patch));
  }
  left(id: number) { return this.post<void>(`/queue/${id}/left`); }
  /** The entry called, or null when nobody is waiting at triage. */
  callNext(filter: { deptId?: string; doctorId?: string } = {}) { return this.post<ApiQueueEntry | null>('/queue/call-next', filter); }
}
