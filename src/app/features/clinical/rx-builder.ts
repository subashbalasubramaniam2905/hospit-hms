import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SHARED } from '../../shared';
import { RxEditorComponent } from '../../shared/rx-editor';
import { RxDocComponent } from '../../shared/rx-doc';
import { StoreService } from '../../core/services/store.service';
import { ExportService } from '../../core/services/export.service';
import { ToastService } from '../../core/services/toast.service';
import { SessionService } from '../../core/services/session.service';
import { Prescription } from '../../core/models';
import { ICD10, safetyCheck } from '../../core/data/clinical';

@Component({
  standalone: true, imports: [SHARED, RxEditorComponent, RxDocComponent],
  styles: [`.prev { position:sticky; top:84px } .pick button { display:flex; gap:10px; width:100%; padding:9px 12px; border:0; border-bottom:1px solid var(--line); background:none; text-align:left; color:var(--fg) } .pick button:hover { background:var(--ground) } .pick { border:1px solid var(--line); border-radius:12px; overflow:hidden; margin-top:6px }`],
  template: `
  <div class="page">
    <cf-page-head title="Prescription builder" [crumbs]="['Prescriptions', rx().status === 'Draft' ? 'Draft' : rx().status]" sub="Search the formulary, check demo safety alerts and preview the printout.">
      <a class="btn ghost" routerLink="/prescriptions">Cancel</a>
    </cf-page-head>
    <div class="grid">
      <div class="c7 stack">
        <div class="card stack">
          <div class="form-grid">
            <div class="field"><label>Patient <span class="req">*</span></label>
              @if (patient(); as p) { <div class="soft row"><cf-avatar [name]="p.name"></cf-avatar><div style="flex:1"><b>{{ p.name }}</b><div class="small muted">{{ p.id }} · {{ p.dob | age }} y</div></div><button class="btn ghost sm" (click)="setPatient('')">Change</button></div>
                @if (p.allergies.length) { <div class="alert-box crit"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon>Allergies: {{ p.allergies.join(', ') }}</div> } }
              @else { <label class="search boxed"><lucide-icon name="search" [size]="16"></lucide-icon><input [ngModel]="pq()" (ngModelChange)="pq.set($event)" placeholder="Name, UHID or mobile" aria-label="Find patient"></label>
                @if (pq().length > 1) { <div class="pick">@for (p of matches(); track p.id) {<button (click)="setPatient(p.id)"><cf-avatar [name]="p.name"></cf-avatar><div><b>{{ p.name }}</b><div class="small muted">{{ p.id }}</div></div></button>}</div> } }
            </div>
            <div class="field"><label>Prescribing doctor</label><select class="inp" [ngModel]="rx().doctorId" (ngModelChange)="rx().doctorId = $event; bump()">@for (d of store.db.doctors; track d.id) {<option [value]="d.id">{{ d.name }}</option>}</select></div>
            <div class="field span2"><label>Diagnosis</label><input class="inp" list="icd" [ngModel]="rx().diagnosis" (ngModelChange)="rx().diagnosis = $event; bump()" placeholder="Type or pick an ICD-10 diagnosis">
              <datalist id="icd">@for (d of icd; track d.code) {<option [value]="d.label">{{ d.code }}</option>}</datalist></div>
          </div>
        </div>
        <div class="card"><div class="card-h"><h3>Medicines</h3></div>
          <cf-rx-editor [items]="rx().items" [patient]="patient()" [labs]="labs()" (changed)="bump()"></cf-rx-editor></div>
        <div class="card"><div class="field"><label>Advice for the patient</label><textarea class="inp" [ngModel]="rx().notes" (ngModelChange)="rx().notes = $event; bump()" placeholder="Diet, activity, warning signs to return for"></textarea></div></div>
        @if (crit().length) { <div class="card"><div class="field"><label>Reason for overriding {{ crit().length }} critical demo alert(s) <span class="req">*</span></label><input class="inp" [(ngModel)]="override"></div></div> }
        <div class="row">
          <button class="btn ghost" (click)="saveDraft()"><lucide-icon name="file-check" [size]="16"></lucide-icon>Save draft</button>
          <button class="btn ghost" (click)="print()"><lucide-icon name="printer" [size]="16"></lucide-icon>Print / PDF</button>
          <span class="spacer"></span>
          <button class="btn" [disabled]="!canSign()" (click)="sign()"><lucide-icon name="badge-check" [size]="16"></lucide-icon>Sign and send to pharmacy</button>
        </div>
      </div>
      <div class="c5"><div class="prev stack-s"><div class="row"><b>Live preview</b><span class="spacer"></span><span class="demo-tag">Not a valid prescription</span></div><cf-rx-doc [rx]="preview()"></cf-rx-doc></div></div>
    </div>
  </div>`
})
export class RxBuilderPage {
  printer = inject(ExportService);
  store = inject(StoreService); toast = inject(ToastService); router = inject(Router); session = inject(SessionService);
  icd = ICD10; pq = signal(''); rev = signal(0); override = '';
  rx = signal<Prescription>(this.store.newRx('', this.session.roleId() === 'doctor' ? 'D01' : 'D01'));
  constructor() {
    const q = inject(ActivatedRoute).snapshot.queryParamMap;
    const existing = this.store.db.prescriptions.find(r => r.id === q.get('rx'));
    if (existing) this.rx.set(existing); else if (q.get('patient')) this.setPatient(q.get('patient')!);
  }
  patient = computed(() => { this.rev(); return this.store.patient(this.rx().patientId); });
  labs = computed(() => this.store.db.labOrders.filter(o => o.patientId === this.rx().patientId));
  matches = computed(() => { const q = this.pq().toLowerCase(); return this.store.db.patients.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || p.mobile.replace(/\D/g, '').includes(q.replace(/\D/g, '') || '#')).slice(0, 6); });
  preview = computed(() => { this.rev(); return { ...this.rx(), items: [...this.rx().items] }; });
  crit = computed(() => { this.rev(); return safetyCheck(this.patient(), this.rx().items, this.labs()).filter(a => a.level === 'crit'); });
  canSign() { return !!this.patient() && this.rx().items.length > 0 && (!this.crit().length || this.override.trim().length > 4); }
  bump() { this.rev.update(v => v + 1); }
  setPatient(id: string) { this.rx().patientId = id; const p = this.store.patient(id); if (p && !this.rx().diagnosis) this.rx().diagnosis = p.conditions[0] || ''; this.pq.set(''); this.bump(); }
  saveDraft() { if (!this.patient()) { this.toast.err('Choose a patient first'); return; } this.store.saveRx(this.rx(), 'Draft'); this.toast.ok('Prescription saved as draft'); }
  sign() {
    const rx = this.rx(); if (this.override.trim()) { rx.notes = [rx.notes, `Override: ${this.override}`].filter(Boolean).join(' · '); this.store.log('Override', 'Safety alert', this.crit().map(a => a.title).join('; '), 'Flagged'); }
    this.store.saveRx(rx, 'Sent to pharmacy');
    this.store.notify('In-app', 'Prescription', rx.patientId, `Your prescription ${rx.id} has been sent to the HospitOS pharmacy.`);
    this.store.inboxPush('New prescription for dispensing', `${this.store.pname(rx.patientId)} · ${rx.items.length} items`, 'pill', 'v', '/pharmacy/dispense');
    this.toast.ok(`Signed and sent to the pharmacy queue (${rx.items.length} items)`); this.router.navigate(['/prescriptions']);
  }
  print() { this.printer.printDoc(); }
}
