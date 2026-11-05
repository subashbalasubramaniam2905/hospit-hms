import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuditLog, HospitalConfig, Integration, LoginEvent, RoleId, UserAccount, Workflow, WorkflowStep } from '../models';
import { API_URL } from './api-config';

// ---- Server shapes (see server/README.md, "API (administration)") ----
export interface SUser { id: string; email: string; name: string; role: RoleId; branches: string[]; status: 'Active' | 'Suspended'; mustChangePw: boolean; lastLogin?: string; createdAt: string; }
export interface SAudit { id: number; at: string; userName: string; role: string; branchId?: string; action: string; entity: string; entityId?: string; detail: string; ip?: string; risk: AuditLog['risk']; flaggedBy?: string; flagNote?: string; }
export interface SLogin { id: number; at: string; userName: string; role: string; email: string; ip?: string; result: LoginEvent['result']; }
export interface SConfig { registration: string; workingHours: HospitalConfig['workingHours']; apptRules: HospitalConfig['apptRules']; queueRules: HospitalConfig['queueRules']; notifyRules: HospitalConfig['notifyRules']; version: number; updatedBy?: string; updatedAt?: string; }
export interface SAccess { role: RoleId; path: string; level: 'Full' | 'View' | 'None'; updatedBy: string; updatedAt: string; }
export interface SDepartment { id: string; branchId: string; name: string; icon: string; floor: string; active: boolean; }
export interface SWorkflow { id: string; name: string; enabled: boolean; steps: WorkflowStep[]; runs: number; lastRun?: string; version: number; }
export interface SIntegration { id: string; name: string; category: string; description: string; enabled: boolean; status: 'Configured' | 'Not configured' | 'Disabled'; fields: { key: string; label: string; secret: boolean; value?: string; set: boolean }[]; lastTest?: string; lastResult?: string; version: number; }

/** Clinic-time stamp "YYYY-MM-DD HH:mm" for an instant from the server. */
export function stamp(iso?: string | null): string {
  if (!iso) return '';
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).reduce((a, x) => ({ ...a, [x.type]: x.value }), {} as Record<string, string>);
  return `${p['year']}-${p['month']}-${p['day']} ${p['hour']}:${p['minute']}`;
}

/** A readable temporary password: 12 characters with letters and digits, never ambiguous ones. */
export function tempPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', digits = '23456789', all = letters + digits;
  const r = new Uint32Array(12); crypto.getRandomValues(r);
  const out = [...r].map((n, i) => (i === 0 ? letters : i === 1 ? digits : all)[n % (i === 0 ? letters.length : i === 1 ? digits.length : all.length)]);
  return out.join('');
}

export const fromServerUser = (u: SUser): UserAccount => ({
  id: u.id, name: u.name, email: u.email, roleId: u.role, branches: u.branches, depts: [],
  status: u.status === 'Suspended' ? 'Suspended' : u.mustChangePw && !u.lastLogin ? 'Invited' : 'Active', lastLogin: stamp(u.lastLogin), mfa: false,
});

export const fromServerAudit = (a: SAudit, branchName: (id?: string) => string): AuditLog & { flaggedBy?: string; flagNote?: string; serverId: number } => ({
  id: 'AU' + a.id, serverId: a.id, time: stamp(a.at), user: a.userName, role: a.role, action: a.action, entity: a.entity + (a.entityId ? ' · ' + a.entityId : ''),
  detail: a.detail, ip: a.ip || '', branch: branchName(a.branchId), risk: a.risk, flaggedBy: a.flaggedBy, flagNote: a.flagNote,
});

export const fromServerLogin = (l: SLogin): LoginEvent => ({ id: 'LG' + l.id, time: stamp(l.at), user: `${l.userName} · ${l.email}`, role: l.role, ip: l.ip || '', device: 'Not recorded', result: l.result });

export const fromServerWorkflow = (w: SWorkflow): Workflow & { version: number } => ({ id: w.id, name: w.name, enabled: w.enabled, runs: w.runs, lastRun: stamp(w.lastRun) || undefined, steps: w.steps.map(s => ({ ...s, detail: s.detail ?? '' })), version: w.version });

export const fromServerIntegration = (i: SIntegration): Integration & { version: number; lastResult?: string } => ({
  id: i.id, name: i.name, category: i.category, description: i.description, enabled: i.enabled, status: i.status, lastSync: stamp(i.lastTest) || undefined, lastResult: i.lastResult, version: i.version,
  fields: i.fields.map(f => ({ key: f.key, label: f.label, secret: f.secret, value: f.secret ? '' : f.value ?? '', set: f.set })),
});

/** HTTP client for users, audit and /api/admin. */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  private http = inject(HttpClient);
  private get<T>(path: string, params?: HttpParams) { return firstValueFrom(this.http.get<T>(`${API_URL}${path}`, { params })); }
  private put<T>(path: string, body: unknown) { return firstValueFrom(this.http.put<T>(`${API_URL}${path}`, body)); }
  private post<T>(path: string, body: unknown = {}) { return firstValueFrom(this.http.post<T>(`${API_URL}${path}`, body)); }

  users() { return this.get<SUser[]>('/api/users'); }
  createUser(b: { email: string; name: string; role: RoleId; branches: string[]; temporaryPassword: string }) { return this.post<SUser>('/api/users', b); }
  updateUser(id: string, b: { name: string; role: RoleId; branches: string[]; status: 'Active' | 'Suspended' }) { return this.put<SUser>(`/api/users/${id}`, b); }
  resetPassword(id: string, temporaryPassword: string) { return this.post<void>(`/api/users/${id}/reset-password`, { temporaryPassword }); }

  audit(limit = 1000) { return this.get<SAudit[]>('/api/audit', new HttpParams().set('limit', limit)); }
  logins(limit = 300) { return this.get<SLogin[]>('/api/audit/logins', new HttpParams().set('limit', limit)); }
  flag(id: number, note: string) { return this.post<SAudit>(`/api/audit/${id}/flag`, { note }); }
  exported(what: string, rows: number) { return this.post<void>('/api/audit/exported', { what, rows }); }
  verify() { return this.get<{ intact: boolean; entries: number; firstBrokenId?: number }>('/api/audit/verify'); }

  config() { return this.get<SConfig>('/api/admin/config'); }
  saveConfig(c: SConfig) { return this.put<SConfig>('/api/admin/config', c); }
  access() { return this.get<SAccess[]>('/api/admin/role-access'); }
  setAccess(role: RoleId, path: string, level: SAccess['level']) { return this.put<SAccess>('/api/admin/role-access', { role, path, level }); }
  departments() { return this.get<SDepartment[]>('/api/admin/departments'); }
  createDepartment(b: { branchId: string; name: string; icon?: string; floor?: string }) { return this.post<SDepartment>('/api/admin/departments', b); }
  updateDepartment(id: string, b: { branchId: string; name: string; icon?: string; floor?: string; active?: boolean }) { return this.put<SDepartment>(`/api/admin/departments/${id}`, b); }

  workflows() { return this.get<SWorkflow[]>('/api/admin/workflows'); }
  createWorkflow(b: { name: string; enabled: boolean; steps: WorkflowStep[] }) { return this.post<SWorkflow>('/api/admin/workflows', b); }
  updateWorkflow(id: string, b: { name: string; enabled: boolean; steps: WorkflowStep[]; version: number }) { return this.put<SWorkflow>(`/api/admin/workflows/${id}`, b); }
  testWorkflow(id: string) { return this.post<{ workflow: SWorkflow; log: string[] }>(`/api/admin/workflows/${id}/test`); }

  integrations() { return this.get<SIntegration[]>('/api/admin/integrations'); }
  saveIntegration(id: string, b: { enabled: boolean; values: Record<string, string>; version: number }) { return this.put<SIntegration>(`/api/admin/integrations/${id}`, b); }
  testIntegration(id: string) { return this.post<{ ok: boolean; log: string[]; integration: SIntegration }>(`/api/admin/integrations/${id}/test`); }
}
