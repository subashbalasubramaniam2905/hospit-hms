import { Injectable, inject, signal } from '@angular/core';
import { LIVE } from '../api/api-config';
import { AdminApi } from '../api/admin-api';
import { RoleId } from '../models';
import { NAV, ROLES } from '../roles';

export type Level = 'Full' | 'View' | 'None';

/**
 * Screen access by role, shown in the permission matrix and used to build the sidebar. Demo mode keeps changes for the
 * browser session. Live mode loads the hospital's overrides from the server and saves each change there, so every
 * signed-in user's sidebar follows them.
 */
@Injectable({ providedIn: 'root' })
export class AccessService {
  private api = inject(AdminApi);
  /** Bumped on every change so the sidebar and matrix recompute. */
  readonly rev = signal(0);
  private views: Record<string, boolean> = LIVE ? {} : { 'billing:/patients': true, 'lab-tech:/patients': true, 'pharmacist:/patients': true, 'radiologist:/patients': true, 'nurse:/consultation': true, 'billing:/ipd': true, 'receptionist:/ipd': true };
  private loaded = false;

  private item(path: string) { return NAV.flatMap(g => g.items).find(x => x.path === path); }

  level(path: string, r: RoleId): Level {
    this.rev();
    const i = this.item(path); if (!i) return 'None';
    if (i.roles && !i.roles.includes(r)) return 'None';
    if (r === 'super-admin') return 'Full';
    return this.views[r + ':' + path] ? 'View' : 'Full';
  }

  next(cur: Level): Level { return cur === 'Full' ? 'View' : cur === 'View' ? 'None' : 'Full'; }

  /** Applies a level to the in-memory navigation. */
  apply(path: string, r: RoleId, level: Level) {
    const i = this.item(path); if (!i || r === 'super-admin') return;
    if (!i.roles) i.roles = ROLES.map(x => x.id);
    const key = r + ':' + path;
    if (level === 'None') { i.roles = i.roles.filter(x => x !== r); delete this.views[key]; }
    else { if (!i.roles.includes(r)) i.roles = [...i.roles, r]; if (level === 'View') this.views[key] = true; else delete this.views[key]; }
    this.rev.update(n => n + 1);
  }

  /** Live mode: saves the change on the server first, then applies it. */
  async set(path: string, r: RoleId, level: Level) {
    if (LIVE) await this.api.setAccess(r, path, level);
    this.apply(path, r, level);
  }

  /** Live mode: loads the hospital's overrides once per sign-in. */
  async load(force = false) {
    if (!LIVE || (this.loaded && !force)) return;
    const list = await this.api.access();
    list.forEach(a => this.apply(a.path, a.role, a.level));
    this.loaded = true;
  }
}
