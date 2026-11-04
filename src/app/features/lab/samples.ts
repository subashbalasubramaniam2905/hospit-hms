import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ExportService } from '../../core/services/export.service';
import { LabOrder } from '../../core/models';
import { SessionService } from '../../core/services/session.service';
import { LabApi, LiveLabOrder } from '../../core/api/lab-api';
import { LiveSync } from '../../core/api/live-sync';


@Component({
  standalone: true, imports: [SHARED],
  styles: [`
    .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:14px }
    .sc { display:flex; flex-direction:column; gap:10px } .sc.hl { box-shadow:0 0 0 2px var(--pri) }
    .tube { display:flex; gap:6px; flex-wrap:wrap } .tube span { font-size:11.5px; font-weight:700; border-radius:6px; padding:2px 8px }
    .barcode { background:#fff; color:#111; border-radius:8px; padding:10px; display:flex; flex-direction:column; align-items:center; gap:4px; border:1px solid var(--line) }
    .barcode svg { width:100%; height:46px } .barcode small { font-family:monospace; font-size:12px; letter-spacing:.12em }
  `],
  template: `
  <div class="page">
    <cf-page-head title="Sample collection" [crumbs]="['Laboratory', 'Phlebotomy']" sub="Collect, label and send samples to the lab. Barcodes are simulated.">
      <label class="search boxed" style="width:260px"><lucide-icon name="scan-line" [size]="16"></lucide-icon><input [ngModel]="scan()" (ngModelChange)="scan.set($event)" (keydown.enter)="doScan()" placeholder="Scan or type sample ID" aria-label="Scan sample"></label>
      <button class="btn ghost" (click)="simScan()"><lucide-icon name="barcode" [size]="16"></lucide-icon>Simulate scan</button>
    </cf-page-head>
    <div class="seg"><button [class.on]="tab() === 'collect'" (click)="tab.set('collect')">To collect · {{ toCollect().length }}</button><button [class.on]="tab() === 'receive'" (click)="tab.set('receive')">To receive in lab · {{ toReceive().length }}</button></div>
    <div class="cards">
      @for (o of (tab() === 'collect' ? toCollect() : toReceive()); track o.id) {
        <div class="card sc" [class.hl]="o.id === focus()">
          <div class="row"><cf-avatar [name]="store.pname(o.patientId)"></cf-avatar><div style="flex:1"><b>{{ store.pname(o.patientId) }}</b><div class="small muted">{{ o.id }} · {{ o.time | time12 }}</div></div><cf-status [s]="o.priority"></cf-status></div>
          <div class="small">{{ store.names(o.testIds) }}</div>
          <div class="tube">@for (s of samples(o); track s) {<span [style.background]="tubeColor(s)" [style.color]="'#fff'">{{ s }}</span>}</div>
          @if (o.sampleId) {
            <div class="barcode"><svg viewBox="0 0 200 46" preserveAspectRatio="none" aria-hidden="true">@for (b of bars(o.sampleId); track $index) {<rect [attr.x]="b.x" y="0" [attr.width]="b.w" height="46" fill="#111"></rect>}</svg><small>{{ o.sampleId }}</small></div>
            <div class="small muted">Collected {{ o.collectedAt | time12 }} by {{ o.collectedBy }}</div>
            <div class="row"><button class="btn sm" (click)="receive(o)"><lucide-icon name="check" [size]="14"></lucide-icon>Receive in lab</button><button class="btn ghost sm" (click)="reject(o)">Reject sample</button><button class="btn ghost sm" (click)="printer.print()"><lucide-icon name="printer" [size]="14"></lucide-icon>Label</button></div>
          } @else {
            <div class="row"><button class="btn sm" (click)="collect(o)"><lucide-icon name="syringe" [size]="14"></lucide-icon>Collect and label</button>@if (fasting(o)) {<span class="st a">Fasting sample</span>}</div>
          }
        </div>
      } @empty { <div class="card" style="grid-column:1/-1"><cf-empty icon="test-tube" title="Nothing waiting" text="New lab orders appear here automatically."></cf-empty></div> }
    </div>
  </div>`
})
export class SamplesPage {
  store = inject(StoreService); toast = inject(ToastService); printer = inject(ExportService);
  session = inject(SessionService); private api = inject(LabApi); private sync = inject(LiveSync); live = this.session.live;
  constructor() { if (this.live) this.sync.loadLab().catch(() => this.toast.err('Could not load lab orders from the server')); }
  tab = signal<'collect' | 'receive'>('collect'); scan = signal(''); focus = signal(inject(ActivatedRoute).snapshot.queryParamMap.get('order') || '');
  toCollect = computed(() => { this.store.rev(); return this.store.db.labOrders.filter(o => o.status === 'Awaiting sample' || o.status === 'Ordered').sort((a, b) => this.rank(b) - this.rank(a)); });
  toReceive = computed(() => { this.store.rev(); return this.store.db.labOrders.filter(o => o.status === 'Sample collected'); });
  private rank(o: LabOrder) { return o.priority === 'STAT' ? 3 : o.priority === 'Urgent' ? 2 : 1; }
  samples(o: LabOrder) { return [...new Set(o.testIds.map(t => this.store.test(t)?.sample || 'Serum'))]; }
  fasting(o: LabOrder) { return o.testIds.some(t => t === 'L02' || t === 'L05'); }
  tubeColor(s: string) { return /EDTA/.test(s) ? '#7c3aed' : /Urine/.test(s) ? '#b45309' : /Citrate/.test(s) ? '#2563eb' : /Fluoride/.test(s) ? '#64748b' : /Stool/.test(s) ? '#78350f' : '#dc2626'; }
  bars(id: string) { const out: { x: number; w: number }[] = []; let x = 4; for (const ch of id + id) { const c = ch.charCodeAt(0); const w = (c % 3) + 1; if (x + w > 196) break; out.push({ x, w }); x += w + ((c >> 2) % 3) + 1; } return out; }
  collect(o: LabOrder) { if (this.live) { this.sync.labAction(() => this.api.collect(o.id), x => `Sample ${x.sampleId} collected and labelled`); return; } const id = this.store.collectSample(o); this.toast.ok(`Sample ${id} collected and labelled`); }
  receive(o: LabOrder) { if (this.live) { this.sync.labAction(() => this.api.receive(o.id), x => `${x.sampleId} received. Processing started.`); return; } this.store.setLabStatus(o, 'Processing'); this.store.log('Received', 'Lab sample', `${o.sampleId} accepted in lab`); this.toast.ok(`${o.sampleId} received. Processing started.`); }
  reject(o: LabOrder) { if (this.live) { this.sync.labAction(() => this.api.reject(o.id, 'Haemolysed'), () => 'Sample rejected as haemolysed. Moved back to collection.').then(() => this.tab.set('collect')); return; } o.status = 'Awaiting sample'; o.sampleId = undefined; o.comments = 'Sample rejected: haemolysed. Recollect.'; this.store.log('Rejected', 'Lab sample', `${o.id} haemolysed`, 'Sensitive'); this.store.changed(); this.toast.warn('Sample rejected as haemolysed. Moved back to collection.'); this.tab.set('collect'); }
  doScan() {
    const v = this.scan().trim().toUpperCase(); if (!v) return;
    const o = this.store.db.labOrders.find(x => x.sampleId === v || x.id === v);
    if (!o) { this.toast.err(`No sample or order matches ${v}`); return; }
    this.focus.set(o.id); this.tab.set(o.sampleId && o.status === 'Sample collected' ? 'receive' : 'collect'); this.toast.info(`Found ${o.id} for ${this.store.pname(o.patientId)}`); this.scan.set('');
  }
  simScan() { const o = this.toReceive()[0] ?? this.toCollect()[0]; if (!o) { this.toast.info('Nothing to scan'); return; } this.scan.set(o.sampleId || o.id); this.doScan(); }
}
