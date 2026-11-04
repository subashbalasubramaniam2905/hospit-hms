import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED } from '../../shared';
import { RxDocComponent } from '../../shared/rx-doc';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ExportService } from '../../core/services/export.service';
import { SessionService } from '../../core/services/session.service';
import { Prescription } from '../../core/models';

import { ClinicalApi, toLines, toPrescription } from '../../core/api/clinical-api';
import { apiMessage } from '../../core/api/auth.service';
@Component({
  standalone: true, imports: [SHARED, RxDocComponent],
  template: `
  <div class="page">
    <cf-page-head title="Prescriptions" [crumbs]="['Clinical', 'All prescriptions']" sub="Signed prescriptions go to the pharmacy queue automatically.">
      <button class="btn ghost" (click)="exportCsv()"><lucide-icon name="download" [size]="16"></lucide-icon>Export CSV</button>
      @if (session.is(['doctor', 'admin', 'super-admin'])) { <a class="btn" routerLink="/prescriptions/new"><lucide-icon name="plus" [size]="16"></lucide-icon>New prescription</a> }
    </cf-page-head>
    <div class="grid">
      <cf-stat class="c3" label="Written today" [value]="today().length" icon="file-pen-line" tone="pri"></cf-stat>
      <cf-stat class="c3" label="Waiting at pharmacy" [value]="count('Sent to pharmacy')" icon="pill" tone="amber" [clickable]="true" (click)="status.set('Sent to pharmacy')"></cf-stat>
      <cf-stat class="c3" label="Dispensed" [value]="count('Dispensed')" icon="circle-check" tone="green"></cf-stat>
      <cf-stat class="c3" label="Drafts" [value]="count('Draft')" icon="square-pen" tone="violet" [clickable]="true" (click)="status.set('Draft')"></cf-stat>
    </div>
    <div class="card">
      <div class="toolbar" style="margin-bottom:12px">
        <label class="search boxed" style="flex:1;max-width:340px"><lucide-icon name="search" [size]="16"></lucide-icon><input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Patient, Rx number or medicine" aria-label="Search prescriptions"></label>
        <div class="chips">@for (s of statuses; track s) {<button class="chip" [class.on]="status() === s" (click)="status.set(s)">{{ s }}</button>}</div>
        <select class="inp" style="width:auto" [ngModel]="doc()" (ngModelChange)="doc.set($event)" aria-label="Doctor"><option value="">All doctors</option>@for (d of store.db.doctors; track d.id) {<option [value]="d.id">{{ d.name }}</option>}</select>
      </div>
      <cf-table [rows]="rows()" [cols]="cols" [clickable]="true" (rowClick)="sel.set($event)" emptyTitle="No prescriptions match">
        <ng-template cfCell="patient" let-r><div class="pname"><cf-avatar [name]="store.pname(r.patientId)"></cf-avatar><div>{{ store.pname(r.patientId) }}<small>{{ r.id }}</small></div></div></ng-template>
        <ng-template cfCell="date" let-r>{{ r.date | d:true }}</ng-template>
        <ng-template cfCell="items" let-r><span class="small">{{ meds(r) }}</span></ng-template>
        <ng-template cfCell="status" let-r><cf-status [s]="r.status"></cf-status></ng-template>
      </cf-table>
    </div>
  </div>
  <cf-drawer [open]="!!sel()" [title]="sel()?.id || ''" [sub]="sel() ? store.pname(sel()!.patientId) : ''" width="min(720px,100%)" (closed)="sel.set(null)">
    @if (sel(); as r) { <cf-rx-doc [rx]="r"></cf-rx-doc> }
    <div foot>
      @if (sel(); as r) {
        <button class="btn ghost" (click)="print()"><lucide-icon name="printer" [size]="16"></lucide-icon>Print / save PDF</button>
        <button class="btn ghost" (click)="share(r)"><lucide-icon name="send" [size]="16"></lucide-icon>Send to patient</button>
        @if (session.is(['doctor', 'admin', 'super-admin'])) { <button class="btn ghost" (click)="repeat(r)"><lucide-icon name="repeat" [size]="16"></lucide-icon>Repeat prescription</button> }
        @if (r.status === 'Draft') { <a class="btn" routerLink="/prescriptions/new" [queryParams]="{ rx: r.id }">Continue editing</a> }
        @if (r.status === 'Sent to pharmacy' && session.is(['pharmacist', 'admin', 'super-admin'])) { <a class="btn" routerLink="/pharmacy/dispense" [queryParams]="{ rx: r.id }">Dispense</a> }
      }
    </div>
  </cf-drawer>`
})
export class PrescriptionsPage {
  printer = inject(ExportService);
  private api = inject(ClinicalApi);
  store = inject(StoreService); toast = inject(ToastService); exp = inject(ExportService); session = inject(SessionService); router = inject(Router);
  statuses = ['All', 'Draft', 'Signed', 'Sent to pharmacy', 'Partially dispensed', 'Dispensed'];
  q = signal(''); status = signal('All'); doc = signal(this.session.roleId() === 'doctor' && !this.session.live ? 'D01' : ''); sel = signal<Prescription | null>(null);
  cols = [
    { key: 'patient', label: 'Patient', value: (r: Prescription) => this.store.pname(r.patientId) }, { key: 'date', label: 'Date' },
    { key: 'doctor', label: 'Doctor', value: (r: Prescription) => this.store.dname(r.doctorId) }, { key: 'diagnosis', label: 'Diagnosis' },
    { key: 'items', label: 'Medicines', value: (r: Prescription) => r.items.length }, { key: 'status', label: 'Status' },
  ];
  all = computed(() => { this.store.rev(); return this.store.db.prescriptions; });
  today = computed(() => this.all().filter(r => r.date === this.store.today()));
  rows = computed(() => { const q = this.q().toLowerCase(); return this.all().filter(r => (this.status() === 'All' || r.status === this.status()) && (!this.doc() || r.doctorId === this.doc()) && (!q || r.id.toLowerCase().includes(q) || this.store.pname(r.patientId).toLowerCase().includes(q) || r.items.some(i => (i.name + i.generic).toLowerCase().includes(q)))).sort((a, b) => b.date.localeCompare(a.date)); });
  constructor() {
    // Live mode: prescriptions come from the server.
    if (this.session.live) this.api.listPrescriptions({ limit: 300 })
      .then(list => list.forEach(r => this.store.upsertPrescription(toPrescription(r))))
      .catch(e => this.toast.err(apiMessage(e, 'Could not load prescriptions')));
  }
  count(s: string) { return this.all().filter(r => r.status === s).length; }
  meds(r: Prescription) { return r.items.slice(0, 3).map(i => i.name).join(', ') + (r.items.length > 3 ? ` +${r.items.length - 3}` : ''); }
  print() { this.printer.printDoc(); }
  share(r: Prescription) { this.store.notify('WhatsApp', 'Prescription', r.patientId, `Your prescription ${r.id} is ready to view in the patient portal.`); this.toast.ok('Prescription link sent on WhatsApp (simulated)'); }
  repeat(r: Prescription) {
    if (this.session.live) {
      this.api.createPrescription({ patientId: r.patientId, diagnosis: r.diagnosis, notes: r.notes, items: toLines(r.items) })
        .then(n => { this.store.upsertPrescription(toPrescription(n)); this.sel.set(null); this.router.navigate(['/prescriptions/new'], { queryParams: { rx: n.id } }); this.toast.info('Repeat prescription created as a draft. Review before signing.'); })
        .catch(e => this.toast.err(apiMessage(e, 'Could not create the repeat prescription')));
      return;
    }
    const n = this.store.newRx(r.patientId, r.doctorId, r.diagnosis); n.items = r.items.map(i => ({ ...i })); this.store.saveRx(n, 'Draft'); this.sel.set(null); this.router.navigate(['/prescriptions/new'], { queryParams: { rx: n.id } }); this.toast.info('Repeat prescription created as a draft. Review before signing.'); }
  exportCsv() { this.exp.csv('prescriptions', this.rows().map(r => ({ Rx: r.id, Date: r.date, Patient: this.store.pname(r.patientId), Doctor: this.store.dname(r.doctorId), Diagnosis: r.diagnosis, Medicines: r.items.map(i => `${i.name} ${i.strength} ${i.frequency} ${i.duration}`).join('; '), Status: r.status }))); }
}
