import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { Bed, BedStatus } from '../../core/models';
import { SessionService } from '../../core/services/session.service';
import { LiveSync } from '../../core/api/live-sync';
import { IpdApi } from '../../core/api/ipd-api';
import { apiMessage } from '../../core/api/auth.service';

@Component({
  standalone: true, imports: [SHARED],
  styles: [`
    .ward { display:flex; flex-direction:column; gap:10px }
    .beds { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px }
    .bed { border:1px solid var(--line); border-radius:12px; padding:10px 12px; text-align:left; display:flex; flex-direction:column; gap:4px; min-height:92px; background:var(--card); border-left:5px solid var(--c); color:var(--fg) }
    .bed:hover { box-shadow:0 4px 14px rgba(0,0,0,.06) } .bed b { font-size:14px } .bed small { color:var(--mut); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
    .bed.Available { --c:var(--green) } .bed.Occupied { --c:var(--pink) } .bed.Reserved { --c:var(--blue) } .bed.Cleaning { --c:var(--amber) } .bed.Maintenance { --c:var(--mut); opacity:.75 }
  `],
  template: `
  <div class="page">
    <cf-page-head title="Bed map" [crumbs]="['IPD', 'Beds']" sub="Live bed status by ward. Click a bed to admit, transfer or update housekeeping.">
      <a class="btn" routerLink="/ipd/admit"><lucide-icon name="plus" [size]="16"></lucide-icon>Admit patient</a>
    </cf-page-head>
    <div class="card" style="padding:12px 16px"><div class="toolbar">
      <div class="chips">@for (s of filters; track s) {<button class="chip" [class.on]="f() === s" (click)="f.set(s)">{{ s }} · {{ count(s) }}</button>}</div>
      <span class="spacer"></span>
      <span class="legend"><span><i style="background:var(--green)"></i>Available</span><span><i style="background:var(--pink)"></i>Occupied</span><span><i style="background:var(--blue)"></i>Reserved</span><span><i style="background:var(--amber)"></i>Cleaning</span><span><i style="background:var(--mut)"></i>Maintenance</span></span>
    </div></div>
    @for (w of wards(); track w.id) {
      <section class="card ward">
        <div class="card-h" style="margin:0"><h3>{{ w.name }}</h3><span class="muted small">{{ w.type }} · {{ w.floor }} · {{ w.rate | inr }}/day</span></div>
        <div class="beds">
          @for (b of bedsIn(w.id); track b.id) {
            <button class="bed {{ b.status }}" (click)="sel.set(b)" [attr.aria-label]="b.label + ' ' + b.status">
              <b>{{ b.label }}</b>
              @if (b.status === 'Occupied') { @let a = adm(b); <small>{{ store.pname(a?.patientId) }}</small><small>{{ a?.diagnosis }}</small> }
              @else { <small>{{ b.status }}</small> }
            </button>
          } @empty { <p class="muted small">No beds match this filter.</p> }
        </div>
      </section>
    }
  </div>
  <cf-drawer [open]="!!sel()" [title]="sel()?.label || ''" [sub]="sel() ? store.ward(sel()!.wardId)?.name + ' · ' + sel()!.status : ''" (closed)="sel.set(null); tr.set(false)">
    @if (sel(); as b) {
      @if (b.status === 'Occupied') { @let a = adm(b);
        @if (a) {
          <div class="soft row"><cf-avatar [name]="store.pname(a.patientId)"></cf-avatar><div style="flex:1"><b>{{ store.pname(a.patientId) }}</b><div class="small muted">{{ a.id }} · since {{ a.admittedOn | d }}</div></div></div>
          <div class="kv"><div><small>Diagnosis</small><b>{{ a.diagnosis }}</b></div><div><small>Consultant</small><b>{{ store.dname(a.doctorId) }}</b></div><div><small>Expected discharge</small><b>{{ a.expectedDischarge | d:true }}</b></div></div>
          @if (tr()) {
            <div class="field"><label>Move to</label><select class="inp" [(ngModel)]="target"><option value="">Choose a free bed</option>@for (x of freeBeds(); track x.id) {<option [value]="x.id">{{ x.label }} · {{ store.ward(x.wardId)?.name }}</option>}</select></div>
            <div class="row"><button class="btn sm" [disabled]="!target" (click)="transfer(a.id)">Confirm transfer</button><button class="btn ghost sm" (click)="tr.set(false)">Cancel</button></div>
          }
        }
      } @else {
        <p class="muted">This bed is <b>{{ b.status.toLowerCase() }}</b>.</p>
        <div class="field"><label>Set status</label><div class="chips">@for (s of statuses; track s) {<button class="chip" [class.on]="b.status === s" (click)="setStatus(b, s)">{{ s }}</button>}</div></div>
      }
    }
    <div foot>@if (sel(); as b) {
      @if (b.status === 'Occupied') { <button class="btn ghost" (click)="tr.set(true)">Transfer bed</button>@if (adm(b); as a) {<a class="btn" [routerLink]="['/ipd/admission', a.id]">Open admission</a>} }
      @if (b.status === 'Available' || b.status === 'Reserved') { <a class="btn" routerLink="/ipd/admit" [queryParams]="{ bed: b.id }">Admit to this bed</a> }
    }</div>
  </cf-drawer>`
})
export class BedsPage {
  store = inject(StoreService); toast = inject(ToastService); router = inject(Router);
  private session = inject(SessionService); private sync = inject(LiveSync); private api = inject(IpdApi); live = this.session.live;
  constructor() {
    if (this.live) effect(() => { const b = this.session.branchId(); untracked(() => this.sync.loadIpd(b).catch(() => this.toast.err('Could not load beds from the server'))); });
  }
  wards = computed(() => { this.store.rev(); return this.store.db.wards; });
  filters = ['All', 'Available', 'Occupied', 'Reserved', 'Cleaning', 'Maintenance']; statuses: BedStatus[] = ['Available', 'Reserved', 'Cleaning', 'Maintenance'];
  f = signal('All'); sel = signal<Bed | null>(null); tr = signal(false); target = '';
  private beds = computed(() => { this.store.rev(); return this.store.db.beds; });
  bedsIn(w: string) { return this.beds().filter(b => b.wardId === w && (this.f() === 'All' || b.status === this.f())); }
  count(s: string) { return s === 'All' ? this.beds().length : this.beds().filter(b => b.status === s).length; }
  adm(b: Bed) { return this.store.db.admissions.find(a => a.id === b.admissionId); }
  freeBeds = computed(() => this.beds().filter(b => b.status === 'Available'));
  async setStatus(b: Bed, s: BedStatus) {
    if (this.live) {
      try { const nb = await this.api.setBedStatus(b.id, s); await this.sync.reloadBeds(); this.sel.set(this.store.bed(nb.id) ?? null); this.toast.ok(`${nb.label} marked ${s.toLowerCase()}`); }
      catch (e) { this.toast.err(apiMessage(e, 'Could not change the bed')); }
      return;
    }
    this.store.setBed(b, s); this.store.log('Updated', 'Bed', `${b.label} → ${s}`); this.toast.ok(`${b.label} marked ${s.toLowerCase()}`); }
  async transfer(admId: string) {
    if (this.live) {
      const a = await this.sync.ipdAction(() => this.api.transfer(admId, this.target), x => `Moved to ${x.bedLabel}. Old bed sent for cleaning.`, true);
      if (a) { this.sel.set(this.store.bed(a.bedId) ?? null); this.tr.set(false); this.target = ''; }
      return;
    }
    const a = this.store.db.admissions.find(x => x.id === admId)!; const nb = this.store.bed(this.target)!; this.store.transferBed(a, this.target); this.toast.ok(`Moved to ${nb.label}. Old bed sent for cleaning.`); this.sel.set(nb); this.tr.set(false); this.target = ''; }
}
