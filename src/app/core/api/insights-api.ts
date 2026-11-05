import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_URL } from './api-config';

// ---- Server shapes (see server/README.md, "API (insights, portal, kiosk, AI)") ----
export interface SDashboard {
  date: string; appointments: number; completed: number; toCome: number; checkedIn: number; cancelledOrNoShow: number;
  waiting: number; consulting: number; queueByStep: number[]; longWaits: number; newRegistrations: number;
  collectedToday: number; outstanding: number; outstandingCount: number; pharmacySalesToday: number;
  labAwaitingSample: number; labProcessing: number; labToVerify: number; labPending: number; labCritical: number;
  rxToDispense: number; lowStock: number; nearExpiry: number; claimsInReview: number; claimDrafts: number;
  unbilledConsultations: number; unbilledLab: number; followUpsDue: number; followUpsOverdue: number;
  doctorsTotal: number; doctorsAvailable: number; runningLateDepts: string[]; openAlerts: number; criticalAlerts: number;
  hourly: { hour: number; count: number }[]; revenue12m: { month: string; billed: number; collected: number }[];
  departments: { deptId: string; name: string; visits: number; completed: number; revenue: number; avgWaitMin?: number }[];
  doctors: { doctorId: string; name: string; deptId: string; status: string; booked: number; left: number }[];
  upcoming: { id: string; patientId: string; patientName: string; doctorId: string; time: string; status: string; token?: string; type: string }[];
  me?: { doctorId: string; patientsToday: number; completed: number; waiting: number; resultsToReview: number; followUpsDue: number; nextPatientId?: string; nextPatientName?: string };
  /** Inpatient beds and emergency, from the IPD and ER modules. */
  wards: { beds: number; occupied: number; available: number; icuBeds: number; icuOccupied: number; admittedToday: number; dischargePlanned: number; erActive: number; erRed: number };
}
export interface SReport { id: string; from: string; to: string; rows: Record<string, string | number>[]; labels: string[]; data: number[]; chart: 'bar' | 'line' | 'doughnut'; note?: string; }
export interface SBranchStats { id: string; name: string; city: string; revenueMonth: number; collectedMonth: number; visitsMonth: number; doctors: number; doctorsAvailable: number; beds: number; occupancy: number; utilisation: Record<string, number>; patients: number; outstanding: number; }
export interface SAlert { id: number; branchId: string; category: string; priority: 'Critical' | 'High' | 'Medium' | 'Low'; title: string; detail: string; dept: string; link?: string; status: 'Open' | 'Acknowledged' | 'Resolved'; assignee: string; resolution?: string; time: string; }
export interface SFollowUp { id: string; patientId: string; patientName: string; mobile: string; doctorId: string; doctorName: string; reason: string; due: string; status: 'Due' | 'Overdue' | 'Booked' | 'Completed'; reminder: 'Not sent' | 'Sent'; lastReminderAt?: string; branchId: string; }
export interface SLeak { key: string; kind: string; branchId: string; patientId: string; patientName: string; date: string; detail: string; amount: number; ref: string; }
export interface SSafetyRow { key: string; prescriptionId: string; alertCode: string; level: 'Critical' | 'Warning' | 'Info'; kind: string; title: string; detail: string; medicines: string[]; patientId: string; patientName: string; doctorId: string; doctorName: string; status: string; date: string; overrideReason?: string; }
export interface SSafety { alerts: SSafetyRow[]; checked: number; patientsWithAllergies: number; reviewed: { prescriptionId: string; alertCode: string; outcome: string; note: string; at: string }[]; }
export interface SAnswer { answer: string; link?: string; label?: string; source: 'claude' | 'rules'; model?: string; }

/** Dashboard figures, reports, alerts, follow-ups, leakage and safety from /api/insights. */
@Injectable({ providedIn: 'root' })
export class InsightsApi {
  private http = inject(HttpClient);
  private url = `${API_URL}/api/insights`;
  private p(o: Record<string, string | number | undefined | null>) { let p = new HttpParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p = p.set(k, v); return p; }

  dashboard(branch?: string) { return firstValueFrom(this.http.get<SDashboard>(`${this.url}/dashboard`, { params: this.p({ branch }) })); }
  report(id: string, days: number, deptId?: string, branch?: string) { return firstValueFrom(this.http.get<SReport>(`${this.url}/reports/${id}`, { params: this.p({ days, deptId, branch }) })); }
  branches() { return firstValueFrom(this.http.get<SBranchStats[]>(`${this.url}/branches`)); }
  alerts(branch?: string) { return firstValueFrom(this.http.get<SAlert[]>(`${this.url}/alerts`, { params: this.p({ branch }) })); }
  alertStatus(id: number, status: SAlert['status'], note?: string) { return firstValueFrom(this.http.post<SAlert>(`${this.url}/alerts/${id}/status`, { status, note })); }
  assign(id: number, assignee: string) { return firstValueFrom(this.http.post<SAlert>(`${this.url}/alerts/${id}/assign`, { assignee })); }
  ackLow(branch?: string) { return firstValueFrom(this.http.post<{ acknowledged: number }>(`${this.url}/alerts/acknowledge-low`, {}, { params: this.p({ branch }) })); }
  followUps(branch?: string, doctorId?: string) { return firstValueFrom(this.http.get<SFollowUp[]>(`${this.url}/followups`, { params: this.p({ branch, doctorId }) })); }
  remind(ids: string[]) { return firstValueFrom(this.http.post<{ reminded: number }>(`${this.url}/followups/remind`, { ids })); }
  leakage(branch?: string) { return firstValueFrom(this.http.get<SLeak[]>(`${this.url}/leakage`, { params: this.p({ branch }) })); }
  review(key: string, action: 'Waived' | 'Approved', reason: string) { return firstValueFrom(this.http.post<void>(`${this.url}/leakage/review`, { key, action, reason })); }
  safety(branch?: string) { return firstValueFrom(this.http.get<SSafety>(`${this.url}/safety`, { params: this.p({ branch }) })); }
  safetyReview(prescriptionId: string, alertCode: string, outcome: string, note: string) { return firstValueFrom(this.http.post<void>(`${this.url}/safety/review`, { prescriptionId, alertCode, outcome, note })); }
}

/** The operations assistant on /api/ai. The Claude API key stays on the server. */
@Injectable({ providedIn: 'root' })
export class AiApi {
  private http = inject(HttpClient);
  status() { return firstValueFrom(this.http.get<{ live: boolean; model?: string }>(`${API_URL}/api/ai/status`)); }
  ask(question: string, history: { from: string; text: string }[], branch?: string) {
    return firstValueFrom(this.http.post<SAnswer>(`${API_URL}/api/ai/ask`, { question, history, branch }));
  }
}

// ---------------------------------------------------------------- patient portal

export interface PProfile { id: string; name: string; dob: string; gender: string; blood: string; allergies: string[]; conditions: string[]; branchId: string; branchName: string; primaryDoctorId?: string; primaryDoctorName?: string; insurer?: string; followUpDue?: string; followUpReason?: string; }
export interface PDoctor { id: string; name: string; deptId: string; deptName: string; branchId: string; branchName: string; fee: number; slotMin: number; qualification: string; }
export interface PAppointment { id: string; date: string; time: string; doctorId: string; doctorName: string; deptName: string; type: string; status: string; token?: string; room?: string; }
export interface PRecords {
  visits: { id: string; date: string; doctorName: string; diagnoses: string[]; plan: string; followUp: string }[];
  prescriptions: { id: string; date: string; doctorName: string; status: string; diagnosis: string; notes: string; items: { name: string; strength: string; dose: string; frequency: string; duration: string; food: string; instructions: string }[] }[];
  labs: { id: string; date: string; tests: string; status: string; ready: boolean; results: { test: string; param: string; value?: number; unit?: string; low?: number; high?: number; flag: string }[] }[];
}
export interface PBill { id: string; number: string; date: string; kind: string; total: number; paid: number; due: number; status: string; }

const PORTAL_KEY = 'hospitos:portal';
const KIOSK_KEY = 'hospitos:kiosk';

function read<T>(store: Storage, key: string): T | null { try { const v = store.getItem(key); return v ? JSON.parse(v) as T : null; } catch { return null; } }

/** Patient portal. Its token is separate from staff sign-in and kept in sessionStorage. */
@Injectable({ providedIn: 'root' })
export class PortalApi {
  private http = inject(HttpClient);
  private url = `${API_URL}/api/portal`;
  readonly signedIn = signal(false);
  private tokenValue: string | null = null;

  constructor() {
    const s = read<{ token: string; expiresAt: string }>(sessionStorage, PORTAL_KEY);
    if (s && new Date(s.expiresAt).getTime() > Date.now()) { this.tokenValue = s.token; this.signedIn.set(true); }
  }
  get token() { return this.tokenValue; }
  signOut() { this.tokenValue = null; this.signedIn.set(false); try { sessionStorage.removeItem(PORTAL_KEY); } catch { /* ignore */ } }

  requestOtp(mobile: string) { return firstValueFrom(this.http.post<{ sent: boolean; devCode?: string }>(`${this.url}/otp`, { mobile })); }
  async verify(mobile: string, code: string) {
    const r = await firstValueFrom(this.http.post<{ token: string; expiresAt: string; profiles: number }>(`${this.url}/verify`, { mobile, code }));
    this.tokenValue = r.token; this.signedIn.set(true);
    try { sessionStorage.setItem(PORTAL_KEY, JSON.stringify({ token: r.token, expiresAt: r.expiresAt })); } catch { /* ignore */ }
    return r;
  }
  me() { return firstValueFrom(this.http.get<PProfile[]>(`${this.url}/me`)); }
  doctors() { return firstValueFrom(this.http.get<PDoctor[]>(`${this.url}/doctors`)); }
  slots(patientId: string, doctorId: string, date: string) { return firstValueFrom(this.http.get<string[]>(`${this.url}/slots`, { params: { patientId, doctorId, date } })); }
  appointments(patientId: string) { return firstValueFrom(this.http.get<PAppointment[]>(`${this.url}/appointments`, { params: { patientId } })); }
  book(patientId: string, doctorId: string, date: string, time: string, teleconsult: boolean) { return firstValueFrom(this.http.post<PAppointment>(`${this.url}/appointments`, { patientId, doctorId, date, time, teleconsult })); }
  cancel(patientId: string, id: string) { return firstValueFrom(this.http.post<void>(`${this.url}/appointments/${encodeURIComponent(id)}/cancel`, {}, { params: { patientId } })); }
  records(patientId: string) { return firstValueFrom(this.http.get<PRecords>(`${this.url}/records`, { params: { patientId } })); }
  bills(patientId: string) { return firstValueFrom(this.http.get<PBill[]>(`${this.url}/bills`, { params: { patientId } })); }
  feedback(patientId: string, rating: number, dept: string, comment: string) { return firstValueFrom(this.http.post<void>(`${this.url}/feedback`, { patientId, rating, dept, comment })); }
}

// ---------------------------------------------------------------- kiosk

export interface KInfo { branchId: string; branchName: string; kioskName: string; departments: { id: string; name: string; waiting: number }[]; serving: { token: string; deptName: string }[]; }
export interface KMatch { patientId: string; displayName: string; gender: string; age: number; today: { id: string; doctorName: string; deptName: string; time: string; room: string; status: string; token?: string }[]; }
export interface KTicket { token: string; patientId: string; displayName: string; doctorName: string; deptName: string; room: string; time: string; ahead: number; }
export interface KDevice { id: string; branchId: string; name: string; active: boolean; paired: boolean; lastSeen?: string; }

/** Lobby kiosk. The device token lives in localStorage on the kiosk after it is paired with a code from an administrator. */
@Injectable({ providedIn: 'root' })
export class KioskApi {
  private http = inject(HttpClient);
  private url = `${API_URL}/api/kiosk`;
  readonly paired = signal(false);
  private tokenValue: string | null = null;

  constructor() {
    const s = read<{ token: string }>(localStorage, KIOSK_KEY);
    if (s?.token) { this.tokenValue = s.token; this.paired.set(true); }
  }
  get token() { return this.tokenValue; }
  unpair() { this.tokenValue = null; this.paired.set(false); try { localStorage.removeItem(KIOSK_KEY); } catch { /* ignore */ } }

  async pair(code: string) {
    const r = await firstValueFrom(this.http.post<{ token: string; branchId: string; branchName: string; name: string }>(`${this.url}/pair`, { code }));
    this.tokenValue = r.token; this.paired.set(true);
    try { localStorage.setItem(KIOSK_KEY, JSON.stringify({ token: r.token })); } catch { /* ignore */ }
    return r;
  }
  info() { return firstValueFrom(this.http.get<KInfo>(`${this.url}/info`)); }
  find(q: { mobile?: string; uhid?: string }) { return firstValueFrom(this.http.post<KMatch[]>(`${this.url}/find`, q)); }
  checkIn(patientId: string, appointmentId: string) { return firstValueFrom(this.http.post<KTicket>(`${this.url}/check-in`, { patientId, appointmentId })); }
  walkIn(patientId: string, deptId: string) { return firstValueFrom(this.http.post<KTicket>(`${this.url}/walk-in`, { patientId, deptId })); }
  register(v: { name: string; mobile: string; dob: string; gender: string; city: string; abha: string; consent: boolean }) { return firstValueFrom(this.http.post<KMatch>(`${this.url}/register`, v)); }

  // Administrators (staff token)
  devices() { return firstValueFrom(this.http.get<KDevice[]>(`${this.url}/devices`)); }
  createDevice(branchId: string, name: string) { return firstValueFrom(this.http.post<{ id: string; code: string; expiresAt: string }>(`${this.url}/devices`, { branchId, name })); }
  newCode(id: string) { return firstValueFrom(this.http.post<{ id: string; code: string; expiresAt: string }>(`${this.url}/devices/${id}/pair-code`, {})); }
  revoke(id: string) { return firstValueFrom(this.http.post<void>(`${this.url}/devices/${id}/revoke`, {})); }
}

/** The branch to ask the server for: the picked branch when the account may see it, otherwise every branch it may see. */
export function scopeBranch(s: { branchId: () => string; allowedBranches: () => string[] | null }): string | undefined {
  const b = s.branchId(), allowed = s.allowedBranches();
  return allowed === null || allowed.includes(b) ? b : undefined;
}
