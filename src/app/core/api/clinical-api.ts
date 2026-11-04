import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SafetyAlert } from '../data/clinical';
import { Consultation, Prescription, RxItem, Vitals } from '../models';
import { API_URL } from './api-config';

/** Shapes returned by /api/clinical. They match the Angular models plus a version for optimistic locking. */
export interface ServerVitals { bp: string; hr: number | null; temp: number | null; rr: number | null; spo2: number | null; height: number | null; weight: number | null; recordedAt?: string; }
export interface ServerConsultation extends Omit<Consultation, 'vitals' | 'billed'> { branchId: string; version: number; vitals: ServerVitals | null; vitalsHistory?: ServerVitals[]; completedAt?: string; }
export interface ServerRxItem extends RxItem { id?: string; }
export interface ServerPrescription extends Omit<Prescription, 'items'> { branchId: string; version: number; items: ServerRxItem[]; overrides?: { code: string; title: string; reason: string }[]; }
export interface ServerAlert { code: string; level: 'Critical' | 'Warning' | 'Info'; kind: 'Allergy' | 'Interaction' | 'Duplicate'; title: string; detail: string; medicines: string[]; }
export interface ConsultationDetail { consultation: ServerConsultation; prescription?: ServerPrescription | null; alerts: ServerAlert[]; }

export type RxLine = Omit<ServerRxItem, 'id'>;
export interface ConsultationUpdate extends Partial<Omit<Consultation, 'id' | 'vitals' | 'status' | 'billed' | 'prescriptionId'>> {
  version: number; vitals?: Vitals; prescription?: { notes?: string; items: RxLine[] };
}

/** Consultations, vitals, diagnoses and prescriptions on the HospitOS server. */
@Injectable({ providedIn: 'root' })
export class ClinicalApi {
  private http = inject(HttpClient);
  private c = `${API_URL}/api/clinical/consultations`;
  private r = `${API_URL}/api/clinical/prescriptions`;

  listConsultations(f: { patientId?: string; doctorId?: string; status?: string; date?: string; limit?: number } = {}) {
    return firstValueFrom(this.http.get<ServerConsultation[]>(this.c, { params: params(f) }));
  }
  /** Opens the patient's draft with this doctor (doctorId can be left out by a doctor linked to a profile). */
  open(patientId: string, doctorId?: string, appointmentId?: string) {
    return firstValueFrom(this.http.post<ConsultationDetail>(this.c, { patientId, doctorId: doctorId || undefined, appointmentId }));
  }
  getConsultation(id: string) { return firstValueFrom(this.http.get<ConsultationDetail>(`${this.c}/${id}`)); }
  update(id: string, body: ConsultationUpdate) { return firstValueFrom(this.http.put<ConsultationDetail>(`${this.c}/${id}`, body)); }
  addVitals(id: string, v: Vitals) { return firstValueFrom(this.http.post<ConsultationDetail>(`${this.c}/${id}/vitals`, v)); }
  complete(id: string, version: number, overrideReason?: string, prescription?: { notes?: string; items: RxLine[] }) {
    return firstValueFrom(this.http.post<ConsultationDetail>(`${this.c}/${id}/complete`, { version, overrideReason: overrideReason || undefined, prescription }));
  }

  listPrescriptions(f: { status?: string; patientId?: string; limit?: number } = {}) {
    return firstValueFrom(this.http.get<ServerPrescription[]>(this.r, { params: params(f) }));
  }
  getPrescription(id: string) { return firstValueFrom(this.http.get<{ prescription: ServerPrescription; alerts: ServerAlert[] }>(`${this.r}/${id}`)); }
  createPrescription(b: { patientId: string; doctorId?: string; consultationId?: string; diagnosis?: string; notes?: string; items: RxLine[] }) {
    return firstValueFrom(this.http.post<ServerPrescription>(this.r, b));
  }
  updatePrescription(id: string, b: { version: number; diagnosis?: string; notes?: string; items: RxLine[] }) {
    return firstValueFrom(this.http.put<ServerPrescription>(`${this.r}/${id}`, b));
  }
  sign(id: string, version: number, sendToPharmacy: boolean, overrideReason?: string) {
    return firstValueFrom(this.http.post<ServerPrescription>(`${this.r}/${id}/sign`, { version, sendToPharmacy, overrideReason: overrideReason || undefined }));
  }
  check(patientId: string, items: RxLine[]) { return firstValueFrom(this.http.post<ServerAlert[]>(`${this.r}/check`, { patientId, items })); }
}

function params(f: Record<string, string | number | undefined>) {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') p = p.set(k, v);
  return p;
}

const EMPTY_VITALS: Vitals = { bp: '', hr: null, temp: null, rr: null, spo2: null, height: null, weight: null };

/** Server consultation → the Angular model the screens already use. */
export function toConsultation(s: ServerConsultation): Consultation & { version: number } {
  const v = s.vitals ? { bp: s.vitals.bp || '', hr: s.vitals.hr, temp: s.vitals.temp, rr: s.vitals.rr, spo2: s.vitals.spo2, height: s.vitals.height, weight: s.vitals.weight } : { ...EMPTY_VITALS };
  return {
    id: s.id, appointmentId: s.appointmentId, patientId: s.patientId, doctorId: s.doctorId, date: s.date, template: s.template ?? '',
    vitals: v, cc: s.cc ?? '', hpi: s.hpi ?? '', pmh: s.pmh ?? '', fh: s.fh ?? '', sh: s.sh ?? '', meds: s.meds ?? '', allergyNote: s.allergyNote ?? '',
    exam: s.exam ?? '', dx: s.dx ?? [], assessment: s.assessment ?? '', plan: s.plan ?? '', notes: s.notes ?? '', followUp: s.followUp ?? '',
    followUpDate: s.followUpDate ?? undefined, status: s.status, billed: false, prescriptionId: s.prescriptionId ?? undefined, version: s.version,
  };
}

export function toPrescription(s: ServerPrescription): Prescription & { version: number } {
  return { ...s, consultationId: s.consultationId ?? undefined, notes: s.notes ?? '', items: s.items.map(i => ({ ...i, medId: i.medId ?? '' })) };
}

/** Server alert → the demo SafetyAlert shape the screens render. */
export function toSafetyAlert(a: ServerAlert): SafetyAlert {
  return { level: a.level === 'Critical' ? 'crit' : a.level === 'Warning' ? 'warn' : 'info', kind: a.kind, title: a.title, detail: a.detail, meds: a.medicines };
}

export function toLines(items: RxItem[]): RxLine[] {
  return items.filter(i => i.name?.trim()).map(i => ({ ...i, medId: i.medId || '' }));
}

/** The safety alerts carried by a 422 response, if any. */
export function blockedAlerts(e: unknown): ServerAlert[] | null {
  const err = e as { status?: number; error?: { alerts?: ServerAlert[] } };
  return err?.status === 422 && Array.isArray(err.error?.alerts) ? err.error!.alerts! : null;
}
