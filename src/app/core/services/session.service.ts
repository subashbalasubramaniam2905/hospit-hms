import { Injectable, computed, inject, signal } from '@angular/core';
import { Role, RoleId } from '../models';
import { NAV, ROLES, role } from '../roles';
import { LIVE } from '../api/api-config';
import { AuthService } from '../api/auth.service';
import { StoreService } from './store.service';
import { AccessService } from './access.service';

const KEY = 'hospit-hms:session';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private auth = inject(AuthService);
  private store = inject(StoreService);
  private access = inject(AccessService);
  /** True when connected to a HospitOS server: real accounts, no demo role switching. */
  readonly live = LIVE;
  readonly roleId = signal<RoleId | null>(null);
  readonly branchId = signal('BR1');
  /** In live mode the signed-in person's own name replaces the demo persona. */
  readonly role = computed<Role | null>(() => {
    const id = this.roleId(); if (!id) return null;
    const base = role(id), acct = this.auth.account();
    if (!this.live || !acct) return base;
    const initials = acct.name.replace(/^Dr\.?\s*/i, '').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return { ...base, userName: acct.name, initials };
  });
  readonly nav = computed(() => {
    const r = this.roleId(); if (!r) return [];
    this.access.rev();
    return NAV.map(g => ({ ...g, items: g.items.filter(i => !i.roles || i.roles.includes(r)) })).filter(g => g.items.length);
  });
  readonly roles = ROLES;
  /** Branches the user may switch between (all in demo mode). */
  readonly allowedBranches = computed(() => {
    const a = this.auth.account();
    return !this.live || !a ? null : a.role === 'super-admin' ? null : a.branches;
  });

  constructor() {
    if (this.live) {
      const a = this.auth.account();
      if (a) { this.roleId.set(a.role); this.branchId.set(this.storedBranch(a.branches) ?? a.branches[0] ?? 'BR1'); }
      return;
    }
    try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s?.roleId) { this.roleId.set(s.roleId); this.branchId.set(s.branchId || 'BR1'); } } catch { /* ignore */ }
  }
  /** Demo mode: pick a persona. Live mode: called after a real sign-in with the account's role. */
  signIn(r: RoleId) {
    if (this.live && this.auth.account()?.role !== r) return;
    this.roleId.set(r);
    if (this.live) { const a = this.auth.account()!; if (!a.branches.includes(this.branchId()) && a.role !== 'super-admin') this.branchId.set(a.branches[0] ?? 'BR1'); }
    this.persist();
  }
  setBranch(b: string) { const allowed = this.allowedBranches(); if (allowed && !allowed.includes(b)) return; this.branchId.set(b); this.persist(); }
  signOut() { this.roleId.set(null); this.auth.clear(); this.store.clearLivePatients(); try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
  can(path: string) {
    const r = this.roleId(); if (!r) return false;
    for (const g of NAV) for (const i of g.items) if (path.startsWith(i.path)) return !i.roles || i.roles.includes(r);
    return true;
  }
  /** True when the current role is one of the given roles. */
  is(roles: RoleId[]) { const r = this.roleId(); return !!r && roles.includes(r); }
  private storedBranch(allowed: string[]) {
    try { const b = JSON.parse(localStorage.getItem(KEY) || 'null')?.branchId; return b && allowed.includes(b) ? b : null; } catch { return null; }
  }
  private persist() { try { const r = this.role(); localStorage.setItem(KEY, JSON.stringify({ roleId: this.live ? null : this.roleId(), branchId: this.branchId(), userName: this.live ? undefined : r?.userName })); } catch { /* ignore */ } }
}
