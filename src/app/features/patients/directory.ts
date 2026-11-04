import { Component, computed, effect, inject, signal } from '@angular/core';
import { LIVE } from '../../core/api/api-config';
import { ActivatedRoute, Router } from '@angular/router';
import { SHARED, Col, ageOf } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ExportService } from '../../core/services/export.service';
import { Patient } from '../../core/models';

@Component({
  standalone: true, imports: [SHARED],
  template: `
  <div class="page">
    <cf-page-head title="Patients" [crumbs]="['Patient directory']" [sub]="store.db.patients.length + ' registered patients across all branches'">
      <button class="btn ghost" (click)="exportCsv()"><lucide-icon name="download" [size]="16"></lucide-icon>Export CSV</button>
      <a class="btn" routerLink="/patients/new"><lucide-icon name="user-plus" [size]="16"></lucide-icon>Register patient</a>
    </cf-page-head>
    <div class="card">
      <div class="toolbar">
        <label class="search boxed" style="flex:1;min-width:220px;max-width:380px"><lucide-icon name="search" [size]="16"></lucide-icon>
          <input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Name, UHID or mobile number" aria-label="Search patients">
          <cf-voice text="Narayan" label="Voice" (chunk)="q.set(q() + $event)" (click)="q.set('')"></cf-voice></label>
        <div class="chips" role="group" aria-label="Gender">@for (g of ['All', 'Female', 'Male']; track g) { <button class="chip" [class.on]="gender() === g" (click)="gender.set(g)">{{ g }}</button> }</div>
        <select class="inp" style="width:auto" [ngModel]="age()" (ngModelChange)="age.set($event)" aria-label="Age group"><option value="">Any age</option><option value="0-17">Under 18</option><option value="18-40">18–40</option><option value="41-60">41–60</option><option value="61-120">Over 60</option></select>
        <select class="inp" style="width:auto" [ngModel]="dept()" (ngModelChange)="dept.set($event)" aria-label="Department"><option value="">All departments</option>@for (d of store.db.departments; track d.id) { <option [value]="d.id">{{ d.name }}</option> }</select>
        <select class="inp" style="width:auto" [ngModel]="doc()" (ngModelChange)="doc.set($event)" aria-label="Doctor"><option value="">All doctors</option>@for (d of store.db.doctors; track d.id) { <option [value]="d.id">{{ d.name }}</option> }</select>
        <select class="inp" style="width:auto" [ngModel]="reg()" (ngModelChange)="reg.set($event)" aria-label="Registered"><option value="">Registered any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="365">Last 12 months</option></select>
        @if (active()) { <button class="linkbtn small" (click)="clear()">Clear filters</button> }
      </div>
      @if (loading() || !store.patientsReady()) { <cf-skeleton [rows]="8"></cf-skeleton> } @else {
      <cf-table [rows]="rows()" [cols]="cols" [clickable]="true" (rowClick)="open($event)" [pageSize]="10" emptyTitle="No patients match" emptyText="Check the spelling, try the mobile number, or register a new patient.">
        <ng-template cfCell="name" let-p><div class="pname"><cf-avatar [name]="p.name"></cf-avatar><div>{{ p.name }}<small>{{ p.id }}</small></div></div></ng-template>
        <ng-template cfCell="age" let-p>{{ p.dob | age }} y · {{ p.gender[0] }}</ng-template>
        <ng-template cfCell="conditions" let-p><div class="chips">@for (c of p.conditions.slice(0, 2); track c) { <span class="st b">{{ c }}</span> } @if (p.allergies.length) { <span class="st r">Allergy</span> }</div></ng-template>
        <ng-template cfCell="insurance" let-p>@if (p.insurance) { <span class="st g">{{ store.provider(p.insurance.providerId)?.name?.replace(' (demo)', '') }}</span> } @else { <span class="muted small">Self pay</span> }</ng-template>
        <ng-template cfCell="mobile" let-p><span class="nowrap">{{ p.mobile }}</span></ng-template>
        <ng-template cfCell="registered" let-p><span class="nowrap">{{ p.registered | d:true }}</span></ng-template>
        <ng-template cfCell="actions" let-p>
          <button class="iconbtn" [matMenuTriggerFor]="m" (click)="$event.stopPropagation()" aria-label="Actions"><lucide-icon name="ellipsis-vertical" [size]="16"></lucide-icon></button>
          <mat-menu #m="matMenu">
            <button mat-menu-item [routerLink]="['/patients', p.id]">Open record</button>
            <button mat-menu-item routerLink="/appointments/new" [queryParams]="{ patient: p.id }">Book appointment</button>
            <button mat-menu-item [routerLink]="['/consultation', p.id]">Start consultation</button>
            <button mat-menu-item routerLink="/billing/new" [queryParams]="{ patient: p.id }">Create invoice</button>
          </mat-menu>
        </ng-template>
      </cf-table>}
    </div>
  </div>`
})
export class PatientDirectoryPage {
  store = inject(StoreService); router = inject(Router); exp = inject(ExportService);
  q = signal(''); gender = signal('All'); age = signal(''); dept = signal(''); doc = signal(''); reg = signal(''); loading = signal(true);
  cols: Col[] = [
    { key: 'name', label: 'Patient' }, { key: 'age', label: 'Age', value: (p: Patient) => ageOf(p.dob) }, { key: 'mobile', label: 'Mobile', sortable: false },
    { key: 'blood', label: 'Blood' }, { key: 'doctor', label: 'Primary doctor', value: (p: Patient) => this.store.dname(p.primaryDoctorId) },
    { key: 'conditions', label: 'Conditions', sortable: false }, { key: 'insurance', label: 'Insurance', value: (p: Patient) => p.insurance ? 1 : 0 },
    { key: 'registered', label: 'Registered' }, { key: 'actions', label: '', sortable: false },
  ];
  constructor() {
    const q = inject(ActivatedRoute).snapshot.queryParamMap.get('q'); if (q) this.q.set(q);
    setTimeout(() => this.loading.set(false), 350);
    // Live mode: only recent patients are preloaded, so also ask the server for anything typed in the search box.
    if (LIVE) {
      let t: ReturnType<typeof setTimeout> | undefined;
      effect(() => { const q = this.q(); clearTimeout(t); t = setTimeout(() => this.store.searchPatients(q).catch(() => { /* local results still shown */ }), 300); });
    }
  }
  active = computed(() => !!(this.q() || this.gender() !== 'All' || this.age() || this.dept() || this.doc() || this.reg()));
  rows = computed(() => {
    this.store.rev(); const q = this.q().trim().toLowerCase(); const dig = q.replace(/\D/g, '');
    const [a0, a1] = this.age() ? this.age().split('-').map(Number) : [0, 999];
    const since = this.reg() ? this.store.day(-+this.reg()) : '';
    return this.store.db.patients.filter(p => {
      if (q && !(p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || (dig.length >= 3 && p.mobile.replace(/\D/g, '').includes(dig)))) return false;
      if (this.gender() !== 'All' && p.gender !== this.gender()) return false;
      const ag = ageOf(p.dob); if (ag < a0 || ag > a1) return false;
      const d = this.store.doctor(p.primaryDoctorId);
      if (this.dept() && d?.deptId !== this.dept()) return false;
      if (this.doc() && p.primaryDoctorId !== this.doc()) return false;
      if (since && p.registered < since) return false;
      return true;
    });
  });
  clear() { this.q.set(''); this.gender.set('All'); this.age.set(''); this.dept.set(''); this.doc.set(''); this.reg.set(''); }
  open(p: Patient) { this.router.navigate(['/patients', p.id]); }
  exportCsv() { this.exp.csv('patients', this.rows().map(p => ({ UHID: p.id, Name: p.name, Age: ageOf(p.dob), Gender: p.gender, Mobile: p.mobile, Blood: p.blood, Doctor: this.store.dname(p.primaryDoctorId), Conditions: p.conditions.join('; '), Registered: p.registered }))); }
}
