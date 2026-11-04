import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { SessionService } from '../../core/services/session.service';
import { NAV, ROLES } from '../../core/roles';
import { RoleId, UserAccount } from '../../core/models';

type Level = 'Full' | 'View' | 'None';

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.mx th { white-space:nowrap; font-size:11.5px } .mx th.rl { writing-mode:vertical-rl; transform:rotate(180deg); height:120px; vertical-align:bottom; padding:8px 4px }
  .mx td.c { text-align:center; padding:4px } .lv { width:34px; height:26px; border-radius:7px; border:0; font-size:11px; font-weight:800; cursor:pointer }
  .lv.Full { background:var(--pri); color:#fff } .lv.View { background:var(--blue-soft); color:var(--blue) } .lv.None { background:var(--ground); color:var(--mut) }
  .grp td { background:var(--ground); font-weight:700; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--mut) }`],
  template: `
  <div class="page">
    <cf-page-head title="Users & roles" [crumbs]="['Organisation', 'Access control']" sub="Who can sign in, which branches they see and what each role can open.">
      <button class="btn" (click)="openInvite()"><lucide-icon name="user-plus" [size]="16"></lucide-icon>Invite user</button>
    </cf-page-head>
    <div class="grid">
      <cf-stat class="c3" label="Active users" [value]="count('Active')" icon="users" tone="pri"></cf-stat>
      <cf-stat class="c3" label="Invited" [value]="count('Invited')" icon="mail" tone="amber"></cf-stat>
      <cf-stat class="c3" label="Suspended" [value]="count('Suspended')" icon="user-x" tone="red"></cf-stat>
      <cf-stat class="c3" label="MFA enabled" [value]="mfaPct() + '%'" icon="shield-check" tone="green" sub="Target 100% for clinical roles"></cf-stat>
    </div>
    <div class="tabs"><button [class.on]="tab() === 'users'" (click)="tab.set('users')">Users</button><button [class.on]="tab() === 'matrix'" (click)="tab.set('matrix')">Permission matrix</button><button [class.on]="tab() === 'roles'" (click)="tab.set('roles')">Roles</button></div>

    @if (tab() === 'users') {
      <div class="card">
        <div class="toolbar" style="margin-bottom:12px"><label class="search boxed" style="flex:1;max-width:300px"><lucide-icon name="search" [size]="16"></lucide-icon><input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Name or email" aria-label="Search users"></label>
          <select class="inp" style="width:auto" [ngModel]="roleF()" (ngModelChange)="roleF.set($event)" aria-label="Role"><option value="">All roles</option>@for (r of roles; track r.id) {<option [value]="r.id">{{ r.name }}</option>}</select></div>
        <cf-table [rows]="users()" [cols]="cols" [clickable]="true" (rowClick)="edit($event)">
          <ng-template cfCell="name" let-u><div class="pname"><cf-avatar [name]="u.name"></cf-avatar><div><b>{{ u.name }}</b><div class="muted small">{{ u.email }}</div></div></div></ng-template>
          <ng-template cfCell="roleId" let-u>{{ roleName(u.roleId) }}</ng-template>
          <ng-template cfCell="branches" let-u>{{ branchNames(u.branches) }}</ng-template>
          <ng-template cfCell="mfa" let-u>@if (u.mfa) {<cf-status s="On" tone="g"></cf-status>} @else {<cf-status s="Off" tone="a"></cf-status>}</ng-template>
          <ng-template cfCell="status" let-u><cf-status [s]="u.status"></cf-status></ng-template>
          <ng-template cfCell="lastLogin" let-u>{{ u.lastLogin || 'Never' }}</ng-template>
        </cf-table>
      </div>
    } @else if (tab() === 'matrix') {
      <div class="card">
        <div class="card-h"><h3>Screen access by role</h3><span class="r muted small">Click a cell to cycle Full → View → None</span></div>
        <div class="alert-box info" style="margin-bottom:12px"><lucide-icon name="info" [size]="16"></lucide-icon><div>Changes apply to the sidebar the next time someone switches to that role. They are kept for this browser session only; a production system would enforce them on the server.</div></div>
        <div class="tbl"><table class="t mx"><thead><tr><th>Screen</th>@for (r of matrixRoles; track r.id) {<th class="rl">{{ r.name }}</th>}</tr></thead><tbody>
          @for (g of nav; track g.label) {
            <tr class="grp"><td [attr.colspan]="matrixRoles.length + 1">{{ g.label }}</td></tr>
            @for (i of g.items; track i.path) {<tr><td class="nowrap"><lucide-icon [name]="i.icon" [size]="14"></lucide-icon> {{ i.label }}</td>
              @for (r of matrixRoles; track r.id) {@let l = level(i.path, r.id);<td class="c"><button class="lv {{ l }}" (click)="cycle(i.path, r.id)" [attr.aria-label]="i.label + ' for ' + r.name + ': ' + l" [disabled]="r.id === 'super-admin'">{{ l === 'Full' ? 'F' : l === 'View' ? 'V' : '–' }}</button></td>}
            </tr>}
          }
        </tbody></table></div>
      </div>
    } @else {
      <div class="grid">
        @for (r of roles; track r.id) {
          <div class="card c4 stack-s"><div class="row"><span class="av">{{ r.initials }}</span><div class="grow"><b>{{ r.name }}</b><span>{{ usersIn(r.id) }} users</span></div></div><p class="muted small">{{ r.description }}</p><div class="muted small">{{ screens(r.id) }} screens</div></div>
        }
      </div>
    }
  </div>

  <cf-drawer [open]="!!sel()" [title]="sel()?.name || 'Invite user'" [sub]="sel()?.id ? sel()!.email : 'They will receive an email invite (simulated)'" (closed)="sel.set(null)">
    @if (sel(); as u) {
      <div class="field"><label>Name</label><input class="inp" [(ngModel)]="u.name"></div>
      <div class="field"><label>Email</label><input class="inp" type="email" [(ngModel)]="u.email"></div>
      <div class="field"><label>Role</label><select class="inp" [(ngModel)]="u.roleId">@for (r of roles; track r.id) {<option [value]="r.id">{{ r.name }}</option>}</select></div>
      <div class="field"><label>Branches</label><div class="chips">@for (b of store.db.branches; track b.id) {<button class="chip" [class.on]="u.branches.includes(b.id)" (click)="toggleBranch(u, b.id)">{{ b.name }}</button>}</div></div>
      <mat-slide-toggle [checked]="u.mfa" (change)="u.mfa = !u.mfa">Require two-factor sign-in</mat-slide-toggle>
      @if (u.id) {
        <div class="kv"><div><small>Status</small><b><cf-status [s]="u.status"></cf-status></b></div><div><small>Last login</small><b>{{ u.lastLogin || 'Never' }}</b></div></div>
        <div class="row"><button class="btn ghost sm" (click)="reset(u)"><lucide-icon name="key-round" [size]="14"></lucide-icon>Send password reset</button>
          @if (u.status === 'Suspended') {<button class="btn ghost sm" (click)="setStatus(u, 'Active')">Reactivate</button>} @else {<button class="btn ghost sm danger" (click)="setStatus(u, 'Suspended')">Suspend</button>}
          <button class="btn ghost sm" (click)="impersonate(u)">Preview as this role</button></div>
      }
    }
    @if (sel(); as u) {<div foot><button class="btn ghost" (click)="sel.set(null)">Cancel</button><button class="btn" [disabled]="!u.name.trim() || !u.email.includes('@')" (click)="save(u)">{{ u.id ? 'Save changes' : 'Send invite' }}</button></div>}
  </cf-drawer>`
})
export class UsersPage {
  store = inject(StoreService); toast = inject(ToastService); session = inject(SessionService); router = inject(Router);
  roles = ROLES; nav = NAV; matrixRoles = ROLES.filter(r => r.id !== 'patient');
  tab = signal<'users' | 'matrix' | 'roles'>('users'); q = signal(''); roleF = signal(''); sel = signal<UserAccount | null>(null);
  private views = signal<Record<string, boolean>>({ 'billing:/patients': true, 'lab-tech:/patients': true, 'pharmacist:/patients': true, 'radiologist:/patients': true, 'nurse:/consultation': true, 'billing:/ipd': true, 'receptionist:/ipd': true });
  private bump = signal(0);
  cols = [{ key: 'name', label: 'User' }, { key: 'roleId', label: 'Role' }, { key: 'branches', label: 'Branches', sortable: false }, { key: 'mfa', label: 'MFA' }, { key: 'status', label: 'Status' }, { key: 'lastLogin', label: 'Last login' }];
  all = computed(() => { this.store.rev(); return this.store.db.users; });
  users = computed(() => { const q = this.q().toLowerCase(); return this.all().filter(u => (!this.roleF() || u.roleId === this.roleF()) && (!q || (u.name + u.email).toLowerCase().includes(q))); });
  count(s: UserAccount['status']) { return this.all().filter(u => u.status === s).length; }
  mfaPct() { const a = this.all(); return Math.round(a.filter(u => u.mfa).length / Math.max(1, a.length) * 100); }
  roleName(id: RoleId) { return ROLES.find(r => r.id === id)?.name || id; }
  branchNames(ids: string[]) { return ids.map(id => this.store.db.branches.find(b => b.id === id)?.name.replace('HospitOS ', '') || id).join(', '); }
  usersIn(id: RoleId) { return this.all().filter(u => u.roleId === id).length; }
  screens(id: RoleId) { this.bump(); return NAV.flatMap(g => g.items).filter(i => !i.roles || i.roles.includes(id)).length; }
  level(path: string, r: RoleId): Level {
    this.bump(); const i = NAV.flatMap(g => g.items).find(x => x.path === path)!;
    if (i.roles && !i.roles.includes(r)) return 'None';
    if (r === 'super-admin' || r === 'admin') return 'Full';
    return this.views()[r + ':' + path] ? 'View' : 'Full';
  }
  cycle(path: string, r: RoleId) {
    const i = NAV.flatMap(g => g.items).find(x => x.path === path)!; const cur = this.level(path, r); const key = r + ':' + path;
    if (!i.roles) i.roles = ROLES.map(x => x.id);
    if (cur === 'Full') this.views.update(v => ({ ...v, [key]: true }));
    else if (cur === 'View') { i.roles = i.roles.filter(x => x !== r); this.views.update(v => { const n = { ...v }; delete n[key]; return n; }); }
    else i.roles = [...i.roles, r];
    this.bump.update(n => n + 1);
    const next = this.level(path, r);
    this.store.log('Changed', 'Role permission', `${this.roleName(r)} → ${i.label}: ${next}`, 'Sensitive'); this.store.changed();
    this.toast.ok(`${this.roleName(r)} now has ${next.toLowerCase()} access to ${i.label}`);
  }
  edit(u: UserAccount) { this.sel.set(u); }
  openInvite() { this.sel.set({ id: '', name: '', email: '', roleId: 'receptionist', branches: ['BR1'], depts: [], status: 'Invited', lastLogin: '', mfa: true }); }
  toggleBranch(u: UserAccount, b: string) { u.branches = u.branches.includes(b) ? u.branches.filter(x => x !== b) : [...u.branches, b]; }
  save(u: UserAccount) {
    if (!u.id) { u.id = this.store.uid('U'); this.store.db.users.push(u); this.store.log('Created', 'User', `Invited ${u.email} as ${this.roleName(u.roleId)}`, 'Sensitive'); this.toast.ok(`Invite sent to ${u.email} (simulated)`); }
    else { this.store.log('Changed', 'User', `${u.name}: role ${this.roleName(u.roleId)}, branches ${u.branches.join(', ')}`, 'Sensitive'); this.toast.ok('User saved'); }
    this.store.changed(); this.sel.set(null);
  }
  setStatus(u: UserAccount, s: UserAccount['status']) { u.status = s; this.store.log('Changed', 'User', `${u.name} ${s.toLowerCase()}`, 'Flagged'); this.store.changed(); this.toast.ok(`${u.name} ${s === 'Active' ? 'reactivated' : 'suspended'}`); }
  reset(u: UserAccount) { this.store.log('Sent', 'Password reset', u.email, 'Sensitive'); this.store.changed(); this.toast.ok(`Reset link sent to ${u.email} (simulated)`); }
  impersonate(u: UserAccount) { this.store.log('Viewed', 'Role preview', `Previewed as ${this.roleName(u.roleId)}`, 'Sensitive'); this.session.signIn(u.roleId); this.toast.info(`Now viewing as ${this.roleName(u.roleId)}. Use the role switcher to return.`); this.sel.set(null); this.router.navigate(['/dashboard']); }
}
