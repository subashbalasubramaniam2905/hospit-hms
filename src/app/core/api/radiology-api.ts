import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ImagingOrder } from '../models';
import { API_URL } from './api-config';

type Modality = ImagingOrder['modality'];

/** An imaging study as the server returns it. date, slot and room are empty until the study is scheduled. */
export interface ServerImagingOrder {
  id: string; branchId: string; patientId: string; patientName: string; doctorId?: string; doctorName?: string; studyId?: string;
  modality: Modality; study: string; contrast: boolean; price: number; durationMin: number; status: ImagingOrder['status'];
  priority: ImagingOrder['priority']; date?: string; slot?: string; room?: string; orderedAt: string; technician?: string;
  startedAt?: string; acquiredAt?: string; findings?: string; impression?: string; radiologist?: string; reportedAt?: string;
  verifiedBy?: string; verifiedAt?: string; contrastOverride?: string; cancelReason?: string; billed: boolean; invoiceId?: string;
  invoiceNumber?: string; comments?: string; version: number;
}

/** The Angular ImagingOrder shape plus what live screens need. Unscheduled studies carry their order date and an empty slot. */
export interface LiveImagingOrder extends ImagingOrder {
  branchId: string; patientName: string; doctorName?: string; scheduled: boolean; contrast: boolean; durationMin: number;
  verifiedBy?: string; invoiceNumber?: string; cancelReason?: string; contrastOverride?: string; version: number;
}

export interface ImagingStudy { id: string; code: string; name: string; modality: Modality; price: number; durationMin: number; contrast: boolean; }
export interface ImagingRoom { branchId: string; code: string; modality: Modality; name: string; }
export interface RoomBooking { orderId: string; room: string; slot: string; durationMin: number; patientName: string; study: string; status: string; }
export interface NewImagingOrder {
  patientId: string; doctorId?: string; studyId?: string; modality?: Modality; study?: string; priority?: ImagingOrder['priority'];
  date?: string; slot?: string; room?: string; bill?: boolean; comments?: string; contrastOverride?: string;
}

const istDate = (iso: string) => new Date(new Date(iso).getTime() + 330 * 6e4).toISOString().slice(0, 10);

export function toImaging(o: ServerImagingOrder): LiveImagingOrder {
  return {
    id: o.id, branchId: o.branchId, patientId: o.patientId, patientName: o.patientName, doctorId: o.doctorId ?? '', doctorName: o.doctorName,
    modality: o.modality, study: o.study, date: o.date ?? istDate(o.orderedAt), slot: o.slot ?? '', room: o.room ?? '', scheduled: !!o.date,
    status: o.status, technician: o.technician, radiologist: o.radiologist, findings: o.findings, impression: o.impression, billed: o.billed,
    price: o.price, priority: o.priority, contrast: o.contrast, durationMin: o.durationMin, verifiedBy: o.verifiedBy,
    invoiceNumber: o.invoiceNumber, cancelReason: o.cancelReason, contrastOverride: o.contrastOverride, version: o.version,
  };
}

/** Radiology orders, scheduling, scanning and reports on the HospitOS server. */
@Injectable({ providedIn: 'root' })
export class RadiologyApi {
  private http = inject(HttpClient);
  private base = `${API_URL}/api/radiology`;
  private o(id: string) { return `${this.base}/orders/${encodeURIComponent(id)}`; }
  private one(r: Promise<ServerImagingOrder>) { return r.then(toImaging); }

  studies() { return firstValueFrom(this.http.get<ImagingStudy[]>(`${this.base}/studies`)); }
  rooms(branchId?: string) {
    const p = branchId ? new HttpParams().set('branchId', branchId) : undefined;
    return firstValueFrom(this.http.get<ImagingRoom[]>(`${this.base}/rooms`, { params: p }));
  }
  bookings(branchId: string, date: string) {
    return firstValueFrom(this.http.get<RoomBooking[]>(`${this.base}/schedule`, { params: new HttpParams().set('branchId', branchId).set('date', date) }));
  }
  async orders(params: { status?: string; patientId?: string; from?: string; limit?: number } = {}) {
    let p = new HttpParams().set('limit', params.limit ?? 500);
    if (params.status) p = p.set('status', params.status);
    if (params.patientId) p = p.set('patientId', params.patientId);
    if (params.from) p = p.set('from', params.from);
    return (await firstValueFrom(this.http.get<ServerImagingOrder[]>(`${this.base}/orders`, { params: p }))).map(toImaging);
  }
  order(id: string) { return this.one(firstValueFrom(this.http.get<ServerImagingOrder>(this.o(id)))); }
  create(o: NewImagingOrder) { return this.one(firstValueFrom(this.http.post<ServerImagingOrder>(`${this.base}/orders`, o))); }
  schedule(o: LiveImagingOrder, date: string, slot: string, room?: string) {
    return this.one(firstValueFrom(this.http.put<ServerImagingOrder>(`${this.o(o.id)}/schedule`, { date, slot, room: room || undefined, version: o.version })));
  }
  start(id: string, technician?: string) { return this.one(firstValueFrom(this.http.post<ServerImagingOrder>(`${this.o(id)}/start`, { technician }))); }
  acquire(id: string) { return this.one(firstValueFrom(this.http.post<ServerImagingOrder>(`${this.o(id)}/acquire`, {}))); }
  saveReport(o: LiveImagingOrder, submit: boolean) {
    return this.one(firstValueFrom(this.http.put<ServerImagingOrder>(`${this.o(o.id)}/report`, { findings: o.findings, impression: o.impression, version: o.version, submit })));
  }
  reopen(id: string) { return this.one(firstValueFrom(this.http.post<ServerImagingOrder>(`${this.o(id)}/reopen`, {}))); }
  verify(id: string) { return this.one(firstValueFrom(this.http.post<ServerImagingOrder>(`${this.o(id)}/verify`, {}))); }
  cancel(id: string, reason: string) { return this.one(firstValueFrom(this.http.post<ServerImagingOrder>(`${this.o(id)}/cancel`, { reason }))); }
}
