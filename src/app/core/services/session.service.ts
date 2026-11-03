import { Injectable, computed, signal } from '@angular/core';
import { RoleId } from '../models';
import { NAV, ROLES, role } from '../roles';

const KEY = 'hospit-hms:session';

@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly roleId = signal<RoleId | null>(null);
  readonly branchId = signal('BR1');
  readonly role = computed(() => (this.roleId() ? role(this.roleId()!) : null));
  readonly nav = computed(() => {
    const r = this.roleId(); if (!r) return [];
    return NAV.map(g => ({ ...g, items: g.items.filter(i => !i.roles || i.roles.includes(r)) })).filter(g => g.items.length);
  });
  readonly roles = ROLES;

  constructor() {
    try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s?.roleId) { this.roleId.set(s.roleId); this.branchId.set(s.branchId || 'BR1'); } } catch { /* ignore */ }
  }
  signIn(r: RoleId) { this.roleId.set(r); this.persist(); }
  setBranch(b: string) { this.branchId.set(b); this.persist(); }
  signOut() { this.roleId.set(null); try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
  can(path: string) {
    const r = this.roleId(); if (!r) return false;
    for (const g of NAV) for (const i of g.items) if (path.startsWith(i.path)) return !i.roles || i.roles.includes(r);
    return true;
  }
  /** True when the current role is one of the given roles. */
  is(roles: RoleId[]) { const r = this.roleId(); return !!r && roles.includes(r); }
  private persist() { try { const r = this.role(); localStorage.setItem(KEY, JSON.stringify({ roleId: this.roleId(), branchId: this.branchId(), userName: r?.userName })); } catch { /* ignore */ } }
}
