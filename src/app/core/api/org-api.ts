import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Asset, InAppNote, InventoryItem, LeaveRequest, NotificationMsg, PurchaseOrder, Requisition, StaffMember, StockMove, Supplier } from '../models';
import { API_URL } from './api-config';
import { stamp } from './admin-api';

// ---- Server shapes (see server/README.md, "API (staff, stores and notifications)") ----
export interface SStaff { id: string; branchId: string; name: string; role: string; category: StaffMember['category']; deptId: string; phone: string; email: string; shift: StaffMember['shift']; status: StaffMember['status']; joined: string; salary: number; doctorId?: string; attendancePct?: number; version: number; }
export interface SLeave { id: string; staffId: string; staffName: string; from: string; to: string; type: LeaveRequest['type']; reason: string; status: LeaveRequest['status']; decidedBy?: string; }
export interface SRoster { week: string; rows: { staffId: string; shifts: string[] }[]; }
export interface SMark { staffId: string; status: 'Present' | 'Absent' | 'Half day' | 'Leave'; }
export interface SPayLine { staffId: string; name: string; role: string; gross: number; pf: number; pt: number; lop: number; absentDays: number; net: number; }
export interface SPayroll { month: string; branchId: string; lines: SPayLine[]; gross: number; net: number; run?: { id: number; month: string; staff: number; net: number; runBy: string; runAt: string }; }
export interface SItem { id: string; branchId: string; name: string; category: InventoryItem['category']; unit: string; stock: number; reorder: number; location: string; cost: number; expiry?: string; supplierId?: string; }
export interface SMove { id: number; itemId: string; itemName: string; at: string; kind: StockMove['kind']; qty: number; ref: string; byName: string; note?: string; }
export interface SAsset { id: string; branchId: string; name: string; category: string; tag: string; location: string; status: Asset['status']; purchased?: string; value: number; nextService?: string; }
export interface SReq { id: string; branchId: string; dept: string; items: { itemId: string; name: string; qty: number }[]; status: Requisition['status']; requestedBy: string; createdAt: string; }
export interface SPo { id: string; branchId: string; supplierId: string; supplierName: string; kind: PurchaseOrder['kind']; status: PurchaseOrder['status']; items: { itemId: string; name: string; qty: number; cost: number; received?: number; batch?: string; expiry?: string }[]; total: number; requestedBy: string; approvedBy?: string; expected?: string; createdAt: string; version: number; }
export interface SMessage { id: number; at: string; branchId?: string; channel: NotificationMsg['channel']; type: NotificationMsg['type']; patientId?: string; toText: string; message: string; status: NotificationMsg['status']; error?: string; sentBy: string; }
export interface SInbox { id: number; at: string; title: string; body: string; link?: string; icon: string; tone: InAppNote['tone']; read: boolean; }

const day = (iso?: string) => stamp(iso).slice(0, 10);

export const fromServerStaff = (s: SStaff): StaffMember & { version: number; recorded: boolean } => ({
  id: s.id, name: s.name, role: s.role, category: s.category, deptId: s.deptId, phone: s.phone, email: s.email, shift: s.shift, status: s.status,
  joined: s.joined, salary: Number(s.salary), attendance: s.attendancePct ?? 100, doctorId: s.doctorId, version: s.version, recorded: s.attendancePct != null,
});
export const fromServerLeave = (l: SLeave): LeaveRequest => ({ id: l.id, staffId: l.staffId, from: l.from, to: l.to, type: l.type, reason: l.reason, status: l.status });
export const fromServerItem = (i: SItem): InventoryItem => ({ id: i.id, name: i.name, category: i.category, unit: i.unit, stock: i.stock, reorder: i.reorder, location: i.location, cost: Number(i.cost), expiry: i.expiry, supplierId: i.supplierId ?? '' });
export const fromServerMove = (m: SMove): StockMove => ({ id: 'IM' + m.id, date: stamp(m.at), itemId: m.itemId, name: m.itemName, kind: m.kind, qty: m.qty, ref: m.ref, by: m.byName, note: m.note });
export const fromServerAsset = (a: SAsset): Asset => ({ id: a.id, name: a.name, category: a.category, tag: a.tag, location: a.location, status: a.status, purchased: a.purchased ?? '', value: Number(a.value), nextService: a.nextService ?? '' });
export const fromServerReq = (r: SReq): Requisition => ({ id: r.id, date: day(r.createdAt), dept: r.dept, items: r.items, status: r.status, requestedBy: r.requestedBy });
export const fromServerPo = (p: SPo): PurchaseOrder & { version: number; supplierName: string } => ({
  id: p.id, supplierId: p.supplierId, supplierName: p.supplierName, date: day(p.createdAt), kind: p.kind, status: p.status, requestedBy: p.requestedBy, expected: p.expected, version: p.version,
  items: p.items.map(i => ({ itemId: i.itemId, name: i.name, qty: i.qty, cost: Number(i.cost), received: i.received ?? undefined })),
});
export const fromServerMessage = (m: SMessage): NotificationMsg & { error?: string } => ({ id: 'NT' + m.id, time: stamp(m.at), channel: m.channel, type: m.type, to: m.toText, patientId: m.patientId, message: m.message, status: m.status, error: m.error });
export const fromServerInbox = (n: SInbox): InAppNote & { serverId: number } => ({ id: 'IN' + n.id, serverId: n.id, time: stamp(n.at), title: n.title, body: n.body, read: n.read, link: n.link, icon: n.icon, tone: n.tone });

/** HTTP client for /api/staff, /api/inventory, /api/procurement and /api/notifications. */
@Injectable({ providedIn: 'root' })
export class OrgApi {
  private http = inject(HttpClient);
  private get<T>(path: string, params: Record<string, string | number | undefined> = {}) {
    let hp = new HttpParams(); for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') hp = hp.set(k, String(v));
    return firstValueFrom(this.http.get<T>(`${API_URL}${path}`, { params: hp }));
  }
  private put<T>(path: string, body: unknown) { return firstValueFrom(this.http.put<T>(`${API_URL}${path}`, body)); }
  private post<T>(path: string, body: unknown = {}) { return firstValueFrom(this.http.post<T>(`${API_URL}${path}`, body)); }

  // staff
  staff(branch?: string) { return this.get<SStaff[]>('/api/staff', { branch }); }
  addStaff(b: { name: string; role: string; category: string; deptId: string; phone: string; shift: string; salary: number; branchId: string }) { return this.post<SStaff>('/api/staff', b); }
  leave() { return this.get<SLeave[]>('/api/staff/leave'); }
  requestLeave(b: { staffId: string; from: string; to: string; type: string; reason: string }) { return this.post<SLeave>('/api/staff/leave', b); }
  decideLeave(id: string, status: 'Approved' | 'Rejected') { return this.post<SLeave>(`/api/staff/leave/${id}/decide`, { status }); }
  roster(branch?: string, week?: string) { return this.get<SRoster>('/api/staff/roster', { branch, week }); }
  publishRoster(b: { week: string; branchId: string; rows: { staffId: string; shifts: string[] }[] }) { return this.put<SRoster>('/api/staff/roster', b); }
  attendance(date?: string) { return this.get<SMark[]>('/api/staff/attendance', { date }); }
  markAttendance(date: string, entries: SMark[]) { return this.put<SMark[]>('/api/staff/attendance', { date, entries }); }
  payroll(branch: string, month?: string) { return this.get<SPayroll>('/api/staff/payroll', { branch, month }); }
  runPayroll(branchId: string, month: string) { return this.post<SPayroll>('/api/staff/payroll', { branchId, month }); }

  // stores
  items(branch?: string) { return this.get<SItem[]>('/api/inventory/items', { branch }); }
  addItem(b: { name: string; category: string; unit: string; reorder: number; location: string; cost: number; supplierId?: string; branchId: string; openingStock: number }) { return this.post<SItem>('/api/inventory/items', b); }
  addAsset(b: { name: string; category: string; tag: string; location: string; value: number; purchased?: string; nextService?: string; branchId: string }) { return this.post<SAsset>('/api/inventory/assets', b); }
  issue(id: string, qty: number, dept: string) { return this.post<SItem>(`/api/inventory/items/${id}/issue`, { qty, dept }); }
  count(id: string, count: number) { return this.post<SItem>(`/api/inventory/items/${id}/count`, { count }); }
  moves(branch?: string) { return this.get<SMove[]>('/api/inventory/moves', { branch, limit: 300 }); }
  assets(branch?: string) { return this.get<SAsset[]>('/api/inventory/assets', { branch }); }
  assetStatus(id: string, status: string) { return this.post<SAsset>(`/api/inventory/assets/${id}/status`, { status }); }
  assetServiced(id: string) { return this.post<SAsset>(`/api/inventory/assets/${id}/service`, {}); }

  // procurement
  suppliers() { return this.get<Supplier[]>('/api/procurement/suppliers'); }
  requisitions() { return this.get<SReq[]>('/api/procurement/requisitions'); }
  decideReq(id: string, status: 'Approved' | 'Rejected') { return this.post<SReq>(`/api/procurement/requisitions/${id}/decide`, { status }); }
  issueReq(id: string) { return this.post<SReq>(`/api/procurement/requisitions/${id}/issue`); }
  orders() { return this.get<SPo[]>('/api/procurement/orders'); }
  createOrder(b: { kind: string; supplierId: string; branchId: string; items: { itemId: string; qty: number; cost: number }[] }) { return this.post<SPo>('/api/procurement/orders', b); }
  orderStatus(id: string, status: string, version: number) { return this.post<SPo>(`/api/procurement/orders/${id}/status`, { status, version }); }
  receive(id: string, version: number, lines: { itemId: string; received: number; batch?: string; expiry?: string }[]) { return this.post<SPo>(`/api/procurement/orders/${id}/receive`, { version, lines }); }

  // notifications
  messages() { return this.get<SMessage[]>('/api/notifications/messages'); }
  send(b: { channel: string; type: string; patientIds: string[]; message: string; branchId: string }) { return this.post<{ queued: number; skipped: string[]; messages: SMessage[]; sending?: boolean }>('/api/notifications/messages', b); }
  inbox() { return this.get<SInbox[]>('/api/notifications/inbox'); }
  read(id: number) { return this.post<void>(`/api/notifications/inbox/${id}/read`); }
  readAll() { return this.post<void>('/api/notifications/inbox/read-all'); }
}
