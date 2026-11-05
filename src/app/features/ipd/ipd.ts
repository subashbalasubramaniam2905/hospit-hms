import { Component, computed, effect, inject, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { Admission } from '../../core/models';
import { SessionService } from '../../core/services/session.service';
import { ToastService } from '../../core/services/toast.service';
import { LiveSync } from '../../core/api/live-sync';

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.wr { display:grid; grid-template-columns:150px 1fr 70px; gap:12px; align-items:center; padding:8px 0; border-bottom:1px solid var(--line); font-size:13.5px } .wr:last-child { border-bottom:0 } .news { font-weight:800; border-radius:8px; padding:2px 8px; font-size:12px }`],
  template: `
  <div class="page">
    <cf-page-head title="Inpatients" [crumbs]="['IPD', 'Overview']" sub="Admissions, occupancy and planned discharges across wards.">
      <a class="btn ghost" routerLink="/ipd/beds"><lucide-icon name="bed-double" [size]="16"></lucide-icon>Bed map</a>
      <a class="btn" routerLink="/ipd/admit"><lucide-icon name="plus" [size]="16"></lucide-icon>Admit patient</a>
    </cf-page-head>
    <div class="grid">
      <cf-stat class="c3" label="Admitted now" [value]="current().length" icon="bed" tone="pri" [sub]="admittedToday() + ' admitted today'"></cf-stat>
      <cf-stat class="c3" label="Bed occupancy" [value]="occ() + '%'" icon="bed-double" tone="blue" [sub]="free() + ' beds free'" [clickable]="true" (click)="router.navigate(['/ipd/beds'])"></cf-stat>
      <cf-stat class="c3" label="Discharges planned" [value]="planned().length" icon="log-out" tone="amber" sub="today and tomorrow"></cf-stat>
      <cf-stat class="c3" label="Patients with NEWS ≥ 5" [value]="sick().length" icon="heart-pulse" tone="red" sub="need closer watch"></cf-stat>
      <div class="card c5"><div class="card-h"><h3>Ward occupancy</h3></div>
        @for (w of wards(); track w.id) { <div class="wr"><span>{{ w.name }}</span><div class="bar"><span [style.width.%]="w.pct" [style.background]="w.pct > 85 ? 'var(--red)' : w.pct > 65 ? 'var(--amber)' : 'var(--pri)'"></span></div><b class="tnum" style="text-align:right">{{ w.occ }}/{{ w.total }}</b></div> }
      </div>
      <div class="card c7"><div class="card-h"><h3>Planned discharges</h3></div>
        <div class="list">@for (a of planned(); track a.id) {
          <div class="li"><cf-avatar [name]="store.pname(a.patientId)"></cf-avatar><div class="grow"><b>{{ store.pname(a.patientId) }}</b><span>{{ store.bed(a.bedId)?.label }} · {{ a.diagnosis }}</span></div><span class="small muted">{{ a.expectedDischarge | d }}</span><cf-status [s]="a.status"></cf-status><a class="btn ghost sm" [routerLink]="['/ipd/admission', a.id]" [queryParams]="{ tab: 'discharge' }">Discharge</a></div>
        } @empty { <p class="muted small">No discharges planned.</p> }</div>
      </div>
      <div class="card c12">
        <div class="card-h"><h3>Current admissions</h3></div>
        <cf-table [rows]="current()" [cols]="cols" [clickable]="true" (rowClick)="router.navigate(['/ipd/admission', $event.id])">
          <ng-template cfCell="patient" let-a><div class="pname"><cf-avatar [name]="store.pname(a.patientId)"></cf-avatar><div>{{ store.pname(a.patientId) }}<small>{{ a.id }}</small></div></div></ng-template>
          <ng-template cfCell="bed" let-a><b>{{ store.bed(a.bedId)?.label }}</b><div class="small muted">{{ store.ward(store.bed(a.bedId)?.wardId)?.name }}</div></ng-template>
          <ng-template cfCell="los" let-a>{{ los(a) }} d</ng-template>
          <ng-template cfCell="news" let-a>@if (news(a) != null) {<span class="news" [style.background]="news(a)! >= 5 ? 'var(--red-soft)' : news(a)! >= 3 ? 'var(--amber-soft)' : 'var(--green-soft)'" [style.color]="news(a)! >= 5 ? 'var(--red)' : news(a)! >= 3 ? 'var(--amber)' : 'var(--green)'">{{ news(a) }}</span>}</ng-template>
          <ng-template cfCell="status" let-a><cf-status [s]="a.status"></cf-status></ng-template>
        </cf-table>
      </div>
    </div>
  </div>`
})
export class IpdPage {
  store = inject(StoreService); router = inject(Router); private session = inject(SessionService); private sync = inject(LiveSync); private toast = inject(ToastService);
  constructor() {
    if (this.session.live) effect(() => { const b = this.session.branchId(); untracked(() => this.sync.loadIpd(b).catch(() => this.toast.err('Could not load inpatients from the server'))); });
  }
  cols = [
    { key: 'patient', label: 'Patient', value: (a: Admission) => this.store.pname(a.patientId) }, { key: 'bed', label: 'Bed', value: (a: Admission) => this.store.bed(a.bedId)?.label },
    { key: 'diagnosis', label: 'Diagnosis' }, { key: 'doctor', label: 'Consultant', value: (a: Admission) => this.store.dname(a.doctorId) }, { key: 'type', label: 'Type' },
    { key: 'los', label: 'Stay', value: (a: Admission) => this.los(a) }, { key: 'news', label: 'NEWS', value: (a: Admission) => this.news(a) ?? -1 }, { key: 'status', label: 'Status' },
  ];
  current = computed(() => { this.store.rev(); return this.store.db.admissions.filter(a => a.status !== 'Discharged'); });
  admittedToday = computed(() => this.current().filter(a => a.admittedOn.startsWith(this.store.today())).length);
  occ = computed(() => { this.store.rev(); const b = this.store.db.beds; return b.length ? Math.round(b.filter(x => x.status === 'Occupied').length / b.length * 100) : 0; });
  free = computed(() => { this.store.rev(); return this.store.db.beds.filter(x => x.status === 'Available').length; });
  planned = computed(() => this.current().filter(a => a.status === 'Discharge planned' || a.expectedDischarge <= this.store.day(1)));
  sick = computed(() => this.current().filter(a => (this.news(a) ?? 0) >= 5));
  wards = computed(() => { this.store.rev(); return this.store.db.wards.map(w => { const beds = this.store.db.beds.filter(b => b.wardId === w.id); const occ = beds.filter(b => b.status === 'Occupied').length; return { ...w, occ, total: beds.length, pct: beds.length ? occ / beds.length * 100 : 0 }; }); });
  los(a: Admission) { return Math.max(1, Math.round((Date.now() - new Date(a.admittedOn.slice(0, 10)).getTime()) / 864e5)); }
  news(a: Admission) { return a.obs.length ? a.obs[a.obs.length - 1].news : null; }
}
