import { Component, computed, inject, input } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ExportService } from '../../core/services/export.service';
import { LabParam } from '../../core/models';

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.wrap { max-width:860px } .H { color:#b45309; font-weight:700 } .L { color:#1d4ed8; font-weight:700 } .C { color:#b42318; font-weight:800 } .sec { font-weight:800; color:#1b6457; margin-top:6px }`],
  template: `
  @if (o(); as o) { @let p = store.patient(o.patientId);
  <div class="page">
    <cf-page-head title="Lab report" [crumbs]="['Laboratory', o.id]" [sub]="o.status === 'Delivered' ? 'Delivered to the patient' : o.status === 'Verified' ? 'Verified, not yet delivered' : 'Preview. Results are not verified yet.'">
      <a class="btn ghost" routerLink="/lab/orders">All orders</a>
      <button class="btn ghost" (click)="printer.printDoc()"><lucide-icon name="printer" [size]="16"></lucide-icon>Print / PDF</button>
      @if (o.status === 'Verified') { <button class="btn" (click)="deliver()"><lucide-icon name="send" [size]="16"></lucide-icon>Deliver to patient</button> }
    </cf-page-head>
    @if (o.status !== 'Verified' && o.status !== 'Delivered') { <div class="alert-box warn"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon>Unverified results. Do not share this report.</div> }
    <div class="wrap">
      <div class="doc">
        <header>
          <div><div class="brand">{{ store.db.config.name }}</div><div style="color:#6f7d79;font-size:12px">Department of Laboratory Medicine · NABL-style layout (demo)<br>{{ store.db.config.address }}</div></div>
          <div style="text-align:right;font-size:12px"><b>Report {{ o.id }}</b><br>Sample {{ o.sampleId }}<br>Collected {{ o.date | d:true }} {{ o.collectedAt }}</div>
        </header>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;font-size:12.5px">
          <div>Patient: <b>{{ p?.name }}</b></div><div>UHID: <b>{{ p?.id }}</b></div>
          <div>Age / sex: {{ p?.dob | age }} y / {{ p?.gender }}</div><div>Referred by: {{ store.dname(o.doctorId) }}</div>
        </div>
        @for (tid of o.testIds; track tid) { @let t = store.test(tid);
          @if (t) {
          <div class="sec">{{ t.name }} <span style="font-weight:500;color:#6f7d79;font-size:12px">({{ t.sample }})</span></div>
          <table><thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Biological reference</th></tr></thead><tbody>
            @for (prm of t.params; track prm.name) { <tr><td>{{ prm.name }}</td><td [class]="flag(tid, prm)">{{ o.results[tid]?.[prm.name] ?? '—' }} {{ flagLabel(tid, prm) }}</td><td>{{ prm.unit }}</td><td>{{ prm.low }} – {{ prm.high }}</td></tr> }
          </tbody></table> }
        }
        @if (o.comments) { <div><b>Comments:</b> {{ o.comments }}</div> }
        @if (crit().length) { <div style="color:#b42318;font-weight:700">Critical values were phoned to the referring doctor (simulated).</div> }
        <div style="display:flex;justify-content:space-between;margin-top:14px;font-size:12px"><div>Technician: Lab tech (demo)</div><div style="text-align:right">@if (o.verifiedBy) {<b>{{ o.verifiedBy }}</b><br>Electronically verified} @else {Pending verification}</div></div>
        <div class="foot"><b style="color:#b45309">PROTOTYPE REPORT · FICTIONAL DATA · NOT FOR CLINICAL USE</b><br>H = above range, L = below range, C = critical. Reference ranges are illustrative.</div>
      </div>
    </div>
  </div>
  } @else { <cf-empty icon="file-text" title="Report not found"></cf-empty> }`
})
export class LabReportPage {
  store = inject(StoreService); toast = inject(ToastService); printer = inject(ExportService);
  id = input<string>('');
  o = computed(() => { this.store.rev(); return this.store.db.labOrders.find(x => x.id === this.id()); });
  crit = computed(() => { const o = this.o(); return o ? this.store.criticals(o) : []; });
  flag(tid: string, p: LabParam) { const v = this.o()?.results[tid]?.[p.name]; if (v == null) return ''; if ((p.critHigh != null && v >= p.critHigh) || (p.critLow != null && v <= p.critLow)) return 'C'; return v > p.high ? 'H' : v < p.low ? 'L' : ''; }
  flagLabel(tid: string, p: LabParam) { const f = this.flag(tid, p); return f ? `(${f})` : ''; }
  deliver() { this.store.deliverLab(this.o()!); this.toast.ok('Report sent on WhatsApp and published to the patient portal (simulated)'); }
}
