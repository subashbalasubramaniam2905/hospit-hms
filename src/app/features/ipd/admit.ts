import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { Admission } from '../../core/models';

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.bp { display:grid; grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); gap:8px } .bp button { border:1px solid var(--line); border-radius:10px; padding:8px; background:var(--card); font-weight:700; font-size:13px; color:var(--fg) } .bp button.on { background:var(--pri); border-color:var(--pri); color:#fff } .bp button small { display:block; font-weight:500; font-size:11px; opacity:.8 }
    .drop { border:1px solid var(--line); border-radius:12px; overflow:hidden; margin-top:6px } .drop button { display:flex; gap:10px; width:100%; padding:8px 12px; border:0; border-bottom:1px solid var(--line); background:none; text-align:left; color:var(--fg) } .sticky { position:sticky; top:84px }`],
  template: `
  <div class="page">
    <cf-page-head title="Admit patient" [crumbs]="['IPD', 'New admission']" sub="Allocate a bed, collect the advance and start the inpatient record."><a class="btn ghost" routerLink="/ipd">Cancel</a></cf-page-head>
    <div class="grid">
      <div class="c8 stack">
        <div class="card stack">
          <h3 style="font-size:15.5px">Patient and clinical details</h3>
          <div class="field"><label>Patient <span class="req">*</span></label>
            @if (patient(); as p) { <div class="soft row"><cf-avatar [name]="p.name"></cf-avatar><div style="flex:1"><b>{{ p.name }}</b><div class="small muted">{{ p.id }} · {{ p.dob | age }} y {{ p.gender }} · {{ p.insurance ? store.provider(p.insurance.providerId)?.name : 'Self pay' }}</div></div>@if (store.admissionFor(p.id)) {<span class="st r">Already admitted</span>}<button class="btn ghost sm" (click)="pid.set('')">Change</button></div> }
            @else { <input class="inp" [ngModel]="pq()" (ngModelChange)="pq.set($event)" placeholder="Search by name, UHID or mobile"> @if (pq().length > 1) {<div class="drop">@for (p of matches(); track p.id) {<button (click)="pick(p.id)">{{ p.name }} · {{ p.id }}</button>}</div>} }
            @if (tried() && !pid()) { <span class="errmsg">Choose a patient.</span> }</div>
          <div class="form-grid">
            <div class="field"><label>Admission type</label><select class="inp" [(ngModel)]="type"><option>Planned</option><option>Emergency</option><option>Day care</option><option>Maternity</option></select></div>
            <div class="field"><label>Consultant <span class="req">*</span></label><select class="inp" [(ngModel)]="doctorId">@for (d of store.db.doctors; track d.id) {<option [value]="d.id">{{ d.name }} · {{ store.dept(d.deptId)?.name }}</option>}</select></div>
            <div class="field span2"><label>Reason for admission <span class="req">*</span></label><input class="inp" [class.err]="tried() && !reason" [(ngModel)]="reason" placeholder="e.g. Community-acquired pneumonia needing IV antibiotics"></div>
            <div class="field"><label>Provisional diagnosis</label><input class="inp" [(ngModel)]="diagnosis"></div>
            <div class="field"><label>Expected discharge</label><input class="inp" type="date" [min]="store.today()" [(ngModel)]="expected"></div>
          </div>
        </div>
        <div class="card stack">
          <div class="row"><h3 style="font-size:15.5px">Bed</h3><span class="spacer"></span><select class="inp" style="width:auto" [ngModel]="ward()" (ngModelChange)="ward.set($event); bedId.set('')" aria-label="Ward">@for (w of store.db.wards; track w.id) {<option [value]="w.id">{{ w.name }} · {{ w.rate | inr }}/day</option>}</select></div>
          <div class="bp">@for (b of beds(); track b.id) {<button [class.on]="bedId() === b.id" (click)="bedId.set(b.id)">{{ b.label }}<small>{{ b.status }}</small></button>} @empty { <p class="muted small">No free beds in this ward. Try another ward.</p> }</div>
          @if (tried() && !bedId()) { <span class="errmsg">Choose a bed.</span> }
        </div>
      </div>
      <div class="c4"><div class="card sticky stack">
        <h3 style="font-size:15.5px">Advance and consent</h3>
        <div class="kv"><div><small>Bed</small><b>{{ store.bed(bedId())?.label || '—' }}</b></div><div><small>Estimate ({{ days() }} days)</small><b>{{ estimate() | inr }}</b></div></div>
        <div class="field"><label>Advance collected</label><input class="inp" type="number" [(ngModel)]="advance"><span class="hint">Suggested {{ estimate() * 0.3 | inr }} (30% of estimate)</span></div>
        @if (patient()?.insurance) { <mat-slide-toggle [(ngModel)]="preauth">Raise cashless pre-authorisation</mat-slide-toggle> }
        <mat-checkbox [(ngModel)]="consent">General consent for admission signed</mat-checkbox>
        @if (tried() && !consent) { <span class="errmsg">Consent is required.</span> }
        <button class="btn" (click)="admit()"><lucide-icon name="bed" [size]="16"></lucide-icon>Admit</button>
      </div></div>
    </div>
  </div>`
})
export class AdmitPage {
  store = inject(StoreService); toast = inject(ToastService); router = inject(Router);
  pid = signal(''); pq = signal(''); ward = signal('W1'); bedId = signal(''); tried = signal(false);
  type: Admission['type'] = 'Planned'; doctorId = 'D01'; reason = ''; diagnosis = ''; expected = this.store.day(3); advance = 10000; preauth = false; consent = false;
  constructor() {
    const q = inject(ActivatedRoute).snapshot.queryParamMap;
    if (q.get('patient')) this.pick(q.get('patient')!);
    const b = this.store.bed(q.get('bed') || ''); if (b) { this.ward.set(b.wardId); this.bedId.set(b.id); }
    if (q.get('type')) this.type = q.get('type') as Admission['type'];
  }
  patient = computed(() => this.store.patient(this.pid()));
  matches = computed(() => { const q = this.pq().toLowerCase(); return this.store.db.patients.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)).slice(0, 6); });
  beds = computed(() => { this.store.rev(); return this.store.db.beds.filter(b => b.wardId === this.ward() && (b.status === 'Available' || b.status === 'Reserved')); });
  days = computed(() => Math.max(1, Math.round((new Date(this.expected).getTime() - new Date(this.store.today()).getTime()) / 864e5)));
  estimate = computed(() => { const w = this.store.ward(this.ward()); return this.days() * ((w?.rate || 1800) + 1400); });
  pick(id: string) { this.pid.set(id); this.pq.set(''); const p = this.store.patient(id); if (p) { this.doctorId = p.primaryDoctorId; this.preauth = !!p.insurance; } }
  admit() {
    this.tried.set(true);
    if (!this.pid() || !this.reason.trim() || !this.bedId() || !this.consent) { this.toast.err('Fill in the highlighted fields'); return; }
    if (this.store.admissionFor(this.pid())) { this.toast.err('This patient is already admitted'); return; }
    const d = this.store.doctor(this.doctorId)!; const p = this.patient()!;
    const a = this.store.admit({ patientId: p.id, doctorId: d.id, deptId: d.deptId, bedId: this.bedId(), admittedOn: this.store.nowStamp(), reason: this.reason, diagnosis: this.diagnosis || this.reason, type: this.type, expectedDischarge: this.expected, advance: +this.advance || 0 });
    if (this.preauth && p.insurance) this.store.db.claims.unshift({ id: 'CLM-' + (3200 + this.store.db.claims.length), patientId: p.id, admissionId: a.id, providerId: p.insurance.providerId, policyNo: p.insurance.policyNo, claimed: this.estimate(), approved: 0, copay: 10, status: 'Draft', type: 'Pre-authorisation', created: this.store.today(), docs: ['Pre-auth form', 'ID proof'], history: [{ date: this.store.today(), status: 'Draft', note: 'Created at admission' }] });
    this.store.changed(); this.toast.ok(`${p.name} admitted to ${this.store.bed(this.bedId())?.label}${this.preauth ? '. Pre-auth draft created.' : ''}`);
    this.router.navigate(['/ipd/admission', a.id]);
  }
}
