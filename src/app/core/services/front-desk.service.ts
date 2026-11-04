import { Injectable, inject, signal } from '@angular/core';
import { LIVE } from '../api/api-config';
import { ApiAppointment, ApiQueueEntry, AppointmentsApi, BookInput, PatientHit, SlotInfo } from '../api/appointments-api';
import { Appointment, ApptStatus, JOURNEY, QueueEntry } from '../models';
import { StoreService } from './store.service';

export interface DaySlots { dayBlock?: string; slotMinutes: number; slots: SlotInfo[] }
export interface Booked { appointment: Appointment; extra: number; skipped: string[] }

const pad = (n: number) => String(n).padStart(2, '0');
const callOrder = (a: QueueEntry, b: QueueEntry) => (+b.emergency - +a.emergency) || (+b.priority - +a.priority) || (b.since - a.since);

/**
 * Appointments and the OPD queue for the front-desk screens.
 * With an API configured every call goes to the server and the answers are kept in the store's lists, so the
 * screens render the same way. Without one (the demo) it uses the in-browser store exactly as before.
 */
@Injectable({ providedIn: 'root' })
export class FrontDeskService {
  private store = inject(StoreService);
  private api = inject(AppointmentsApi);
  readonly live = LIVE;
  readonly ready = signal(!LIVE);
  /** The store data the server's doctors were loaded into. Sign-out replaces it, so the next user reloads. */
  private refFor: unknown = null;

  private bump() { this.store.rev.update(v => v + 1); }

  // ---------------------------------------------------------------- loading

  /** Doctors and departments from the server, once per session. */
  async loadDirectory() {
    if (!this.live || this.refFor === this.store.db) return;
    const [doctors, departments] = await Promise.all([this.api.doctors(), this.api.departments()]);
    this.store.db.doctors = doctors.map(d => ({ ...d, fee: Number(d.fee) }));
    this.store.db.departments = departments;
    this.refFor = this.store.db;
    this.bump();
  }

  /** Replaces the store's appointments between two dates with the server's. */
  async loadAppointments(from: string, to: string) {
    if (!this.live) return;
    await this.loadDirectory();
    const rows = await this.api.list(from, to);
    const keep = this.store.db.appointments.filter(a => a.date < from || a.date > to);
    this.store.db.appointments = [...keep, ...rows.map(a => this.remember(a))].sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
    this.ready.set(true);
    this.bump();
  }

  async loadQueue() {
    if (!this.live) return;
    await this.loadDirectory();
    const rows = await this.api.queue();
    this.store.db.queue = rows.map(q => this.rememberQ(q));
    this.ready.set(true);
    this.bump();
  }

  /** A patient's upcoming visits, so the booking screen can warn about duplicates. */
  async loadUpcomingFor(patientId: string) {
    if (!this.live) return;
    const today = this.store.today();
    const rows = await this.api.list(today, this.store.day(120), { patientId });
    rows.forEach(a => this.upsert(a));
    this.bump();
  }

  private remember(a: ApiAppointment): Appointment {
    if (a.patientName) this.store.extraNames.set(a.patientId, a.patientName);
    const { patientName: _n, ...appt } = a;
    return appt;
  }

  private rememberQ(q: ApiQueueEntry): QueueEntry {
    if (q.patientName) this.store.extraNames.set(q.patientId, q.patientName);
    const { patientName: _n, ...entry } = q;
    return entry;
  }

  private upsert(a: ApiAppointment): Appointment {
    const appt = this.remember(a);
    const i = this.store.db.appointments.findIndex(x => x.id === appt.id);
    if (i >= 0) this.store.db.appointments[i] = appt; else this.store.db.appointments.push(appt);
    this.store.db.appointments.sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
    return appt;
  }

  private upsertQ(q: ApiQueueEntry): QueueEntry {
    const e = this.rememberQ(q);
    const i = this.store.db.queue.findIndex(x => x.id === e.id);
    if (i >= 0) this.store.db.queue[i] = e; else this.store.db.queue.push(e);
    return e;
  }

  // ---------------------------------------------------------------- slots and patients

  /** The doctor's slots for a day. Booked, passed, break and leave slots come back with a reason. */
  async slots(doctorId: string, date: string, duration: number): Promise<DaySlots> {
    if (this.live) {
      const d = await this.api.slots(doctorId, date, duration);
      return { dayBlock: d.dayBlock ?? undefined, slotMinutes: d.slotMinutes, slots: d.slots.map(s => ({ ...s, reason: s.reason ?? undefined })) };
    }
    const d = this.store.doctor(doctorId);
    if (!d) return { slotMinutes: 15, slots: [] };
    const first = this.store.checkSlot(d.id, date, d.start, d.slotMin);
    const dayBlock = !first.ok && (first.reason?.includes('does not consult') || first.reason?.includes('on leave')) ? first.reason : undefined;
    const slots: SlotInfo[] = [];
    if (!dayBlock) {
      const [h0] = d.start.split(':').map(Number); const [h1] = d.end.split(':').map(Number);
      for (let h = h0; h < h1; h++) for (let m = 0; m < 60; m += d.slotMin) {
        const t = `${pad(h)}:${pad(m)}`; const r = this.store.checkSlot(d.id, date, t, duration); slots.push({ time: t, ok: r.ok, reason: r.reason });
      }
    }
    return { dayBlock, slotMinutes: d.slotMin, slots };
  }

  /** Patients matching a name, UHID or mobile number. */
  async searchPatients(q: string): Promise<PatientHit[]> {
    if (this.live) {
      const hits = await this.api.searchPatients(q);
      hits.forEach(p => this.store.extraNames.set(p.id, p.name));
      return hits.slice(0, 6);
    }
    const lq = q.toLowerCase(); const dg = q.replace(/\D/g, '');
    return this.store.db.patients.filter(p => p.name.toLowerCase().includes(lq) || p.id.toLowerCase().includes(lq) || (dg.length > 3 && p.mobile.replace(/\D/g, '').includes(dg))).slice(0, 6);
  }

  // ---------------------------------------------------------------- appointments

  async book(b: BookInput): Promise<Booked> {
    if (this.live) {
      const r = await this.api.book(b);
      const appointment = this.upsert(r.appointment); r.repeats.forEach(a => this.upsert(a));
      this.bump();
      return { appointment, extra: r.repeats.length, skipped: r.skipped };
    }
    const before = this.store.db.appointments.length;
    const appointment = this.store.book({ ...b, type: b.type as Appointment['type'] });
    return { appointment, extra: this.store.db.appointments.length - before - 1, skipped: [] };
  }

  async walkIn(patientId: string, doctorId: string): Promise<Appointment> {
    if (this.live) {
      const r = await this.api.walkIn(patientId, doctorId);
      const a = this.upsert(r.appointment); this.upsertQ(r.queue); this.bump();
      return a;
    }
    return this.store.walkIn(patientId, doctorId);
  }

  async setStatus(id: string, status: ApptStatus): Promise<Appointment | undefined> {
    if (this.live) {
      const a = this.upsert(await this.api.setStatus(id, status));
      // Check-in, cancel and no-show change the queue on the server too.
      await this.loadQueue();
      return a;
    }
    this.store.setApptStatus(id, status);
    return this.store.db.appointments.find(a => a.id === id);
  }

  async reschedule(id: string, date: string, time: string): Promise<Appointment | undefined> {
    if (this.live) { const a = this.upsert(await this.api.reschedule(id, date, time)); this.bump(); return a; }
    this.store.reschedule(id, date, time);
    return this.store.db.appointments.find(a => a.id === id);
  }

  async reminder(id: string) {
    if (this.live) { this.upsert(await this.api.reminder(id)); this.bump(); return; }
    this.store.sendReminder(id);
  }

  // ---------------------------------------------------------------- queue

  async move(e: QueueEntry, step?: number): Promise<QueueEntry> {
    if (this.live) {
      const q = this.upsertQ(await this.api.move(e.id!, step));
      if (q.appointmentId) await this.refreshAppointment(q.appointmentId);
      this.bump();
      return q;
    }
    this.store.moveQueue(e.token, step);
    return e;
  }

  async setPriority(e: QueueEntry, priority: boolean) {
    if (this.live) { this.upsertQ(await this.api.patchQueue(e.id!, { priority })); this.bump(); return; }
    e.priority = priority; this.store.changed();
  }

  async reassign(e: QueueEntry, doctorId: string) {
    if (this.live) {
      const q = this.upsertQ(await this.api.patchQueue(e.id!, { doctorId }));
      if (q.appointmentId) await this.refreshAppointment(q.appointmentId);
      this.bump(); return;
    }
    e.doctorId = doctorId; e.deptId = this.store.doctor(doctorId)!.deptId;
    const a = this.store.db.appointments.find(x => x.id === e.appointmentId);
    if (a) { a.doctorId = doctorId; a.deptId = e.deptId; a.room = this.store.doctor(doctorId)!.room; }
    this.store.log('Updated', 'Queue', `${e.token} reassigned to ${this.store.dname(doctorId)}`); this.store.changed();
  }

  /** Left without being seen. */
  async left(e: QueueEntry) {
    if (this.live) {
      await this.api.left(e.id!);
      this.store.db.queue = this.store.db.queue.filter(x => x.id !== e.id);
      if (e.appointmentId) await this.refreshAppointment(e.appointmentId);
      this.bump(); return;
    }
    this.store.db.queue = this.store.db.queue.filter(x => x.token !== e.token);
    const a = this.store.db.appointments.find(x => x.id === e.appointmentId); if (a) a.status = 'No-show';
    this.store.log('Updated', 'Queue', `${e.token} left without being seen`); this.store.changed();
  }

  /** Calls the next patient at triage into consultation, or returns null when nobody is waiting. */
  async callNext(filter: { deptId?: string; doctorId?: string } = {}): Promise<QueueEntry | null> {
    if (this.live) {
      const q = await this.api.callNext(filter);
      if (!q) return null;
      const e = this.upsertQ(q);
      if (e.appointmentId) await this.refreshAppointment(e.appointmentId);
      this.bump();
      return e;
    }
    const w = this.store.db.queue.filter(e => e.step === 2 && (!filter.deptId || e.deptId === filter.deptId) && (!filter.doctorId || e.doctorId === filter.doctorId)).sort(callOrder)[0];
    if (!w) return null;
    this.store.moveQueue(w.token, JOURNEY.indexOf('Consultation'));
    return w;
  }

  private async refreshAppointment(id: string) {
    const a = this.store.db.appointments.find(x => x.id === id);
    if (!a) return;
    try {
      const rows = await this.api.list(a.date, a.date, { patientId: a.patientId });
      const fresh = rows.find(r => r.id === id); if (fresh) this.upsert(fresh);
    } catch { /* the queue change already succeeded; the calendar catches up on its next load */ }
  }
}
