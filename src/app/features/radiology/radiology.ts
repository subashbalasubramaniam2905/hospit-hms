import { Component, computed, inject, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ImagingOrder, ImgStatus } from '../../core/models';

const FLOW: ImgStatus[] = ['Scheduled', 'In progress', 'Awaiting report', 'Reported', 'Verified'];
const REPORT_TPL: Record<string, { findings: string; impression: string }> = {
  'X-ray': { findings: 'Lung fields are clear. Cardiac silhouette is within normal limits. Costophrenic angles are sharp. No bony abnormality.', impression: 'No acute cardiopulmonary abnormality.' },
  Ultrasound: { findings: 'Liver is normal in size with mildly increased echotexture. Gall bladder, pancreas and spleen are normal. Both kidneys are normal in size with preserved corticomedullary differentiation.', impression: 'Grade I fatty liver. Otherwise normal study.' },
  CT: { findings: 'No intracranial haemorrhage, mass effect or midline shift. Ventricles and sulci are normal for age.', impression: 'No acute intracranial abnormality.' },
  MRI: { findings: 'Disc desiccation at L4-L5 with a posterior disc bulge indenting the thecal sac. Mild narrowing of the left neural foramen.', impression: 'L4-L5 disc bulge with mild left foraminal narrowing.' },
};

@Component({
  standalone: true, imports: [SHARED],
  styles: [`
    .board { display:grid; grid-template-columns:repeat(5,minmax(170px,1fr)); gap:12px; overflow-x:auto }
    .col { background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:10px; display:flex; flex-direction:column; gap:8px; min-height:300px }
    .col h4 { font-size:13px; display:flex; justify-content:space-between; padding:2px 4px 6px; border-bottom:1px solid var(--line) }
    .ic { background:var(--ground); border-radius:10px; padding:10px; text-align:left; border:1px solid transparent; display:flex; flex-direction:column; gap:4px; color:var(--fg) }
    .ic:hover { border-color:var(--line) } .ic b { font-size:13px } .ic small { color:var(--mut); font-size:12px }
    .viewer { background:#0b0f0e; border-radius:12px; aspect-ratio:4/3; position:relative; overflow:hidden; display:grid; place-items:center }
    .viewer .img { width:70%; height:80%; border-radius:50% 50% 45% 45%; background:radial-gradient(ellipse at 35% 45%, #5a6a66 0 18%, transparent 30%), radial-gradient(ellipse at 65% 45%, #5a6a66 0 18%, transparent 30%), radial-gradient(ellipse at 50% 55%, #26302d 0 55%, #0b0f0e 70%); filter:blur(.4px) }
    .viewer .ov { position:absolute; color:#9fb5ae; font:11px/1.4 monospace; padding:8px 10px } .viewer .tl { top:0; left:0 } .viewer .br { bottom:0; right:0; text-align:right }
    .tools { display:flex; gap:6px; flex-wrap:wrap }
  `],
  template: `
  <div class="page">
    <cf-page-head title="Radiology" [crumbs]="['Diagnostics', 'Imaging worklist']" sub="Schedule scans, track acquisition and report studies.">
      <div class="seg">@for (m of mods; track m) {<button [class.on]="mod() === m" (click)="mod.set(m)">{{ m }}</button>}</div>
    </cf-page-head>
    <div class="alert-box info"><lucide-icon name="plug" [size]="16"></lucide-icon><div>PACS and DICOM modality worklist are <b>simulated</b>. Configure the real connection under <a routerLink="/admin/integrations">Integrations</a> in a later phase.</div></div>
    <div class="board">
      @for (s of flow; track s) {
        <div class="col"><h4>{{ s }}<span class="muted">{{ lane(s).length }}</span></h4>
          @for (o of lane(s); track o.id) {
            <button class="ic" (click)="open(o)"><div class="row" style="gap:6px"><span class="st b" style="padding:1px 7px">{{ o.modality }}</span>@if (o.priority === 'Urgent') {<span class="st p" style="padding:1px 7px">Urgent</span>}</div>
              <b>{{ store.pname(o.patientId) }}</b><small>{{ o.study }}</small><small>{{ o.date | d }} · {{ o.slot | time12 }} · {{ o.room }}</small></button>
          } @empty { <p class="muted small" style="text-align:center;padding:14px 0">Empty</p> }
        </div>
      }
    </div>
  </div>
  <cf-drawer [open]="!!sel()" [title]="sel()?.study || ''" [sub]="sel() ? store.pname(sel()!.patientId) + ' · ' + sel()!.id : ''" width="min(640px,100%)" (closed)="sel.set(null)">
    @if (sel(); as o) {
      <div class="stepper">@for (s of flow; track s; let i = $index) {<span class="s" [class.done]="i < idx(o)" [class.cur]="i === idx(o)">{{ s }}</span>}</div>
      @if (store.patient(o.patientId)?.allergies?.includes('Iodinated contrast')) { <div class="alert-box crit"><lucide-icon name="shield-alert" [size]="16"></lucide-icon>Contrast allergy on record. Use non-contrast protocol. <span class="demo-tag">Demo alert</span></div> }
      <div class="kv"><div><small>Modality</small><b>{{ o.modality }}</b></div><div><small>Room</small><b>{{ o.room }}</b></div><div><small>Referred by</small><b>{{ store.dname(o.doctorId) }}</b></div><div><small>Charge</small><b>{{ o.price | inr }}</b></div></div>
      @if (o.status === 'Scheduled' || o.status === 'Ordered') {
        <div class="form-grid"><div class="field"><label>Date</label><input class="inp" type="date" [(ngModel)]="o.date"></div><div class="field"><label>Slot</label><input class="inp" type="time" [(ngModel)]="o.slot"></div></div>
      }
      @if (idx(o) >= 1) {
        <div class="viewer" aria-label="Simulated image viewer"><div class="img" [style.filter]="'brightness(' + wl() + ') contrast(' + (1 + (wl() - 1) / 2) + ')'" [style.transform]="'scale(' + zoom() + ')'"></div>
          <div class="ov tl">{{ store.pname(o.patientId) }}<br>{{ o.patientId }}<br>{{ o.modality }} · {{ o.study }}</div><div class="ov br">SIMULATED IMAGE<br>Not a real study<br>Zoom {{ zoom() }}×</div></div>
        <div class="tools"><button class="btn ghost sm" (click)="wl.set(wl() + .15)">Brighter</button><button class="btn ghost sm" (click)="wl.set(wl() - .15)">Darker</button><button class="btn ghost sm" (click)="zoom.set(zoom() + .25)">Zoom in</button><button class="btn ghost sm" (click)="zoom.set(1); wl.set(1)">Reset</button></div>
      }
      @if (idx(o) >= 2) {
        <div class="field"><div class="row"><label class="lbl">Findings</label><span class="spacer"></span>@if (idx(o) < 4) {<button class="linkbtn small" (click)="tpl(o)">Insert normal template</button>}</div><textarea class="inp" rows="4" [(ngModel)]="o.findings" [disabled]="idx(o) >= 4"></textarea></div>
        <div class="field"><label>Impression</label><textarea class="inp" [(ngModel)]="o.impression" [disabled]="idx(o) >= 4"></textarea></div>
      }
      @if (o.radiologist) { <p class="small muted">Reported by {{ o.radiologist }}</p> }
    }
    <div foot>@if (sel(); as o) {
      @switch (o.status) {
        @case ('Scheduled') { <button class="btn ghost" (click)="save(o)">Save schedule</button><button class="btn" (click)="move(o, 'In progress', { technician: 'Ravi (radiographer)' })">Start scan</button> }
        @case ('Ordered') { <button class="btn" (click)="move(o, 'Scheduled')">Schedule</button> }
        @case ('In progress') { <button class="btn" (click)="move(o, 'Awaiting report')">Images acquired · send to PACS</button> }
        @case ('Awaiting report') { <button class="btn" [disabled]="!o.findings || !o.impression" (click)="move(o, 'Reported', { radiologist: 'Dr. Farah Khan (Radiologist)' })">Submit report</button> }
        @case ('Reported') { <button class="btn" (click)="move(o, 'Verified')"><lucide-icon name="badge-check" [size]="16"></lucide-icon>Verify and release</button> }
        @case ('Verified') { <span class="muted small">Released to {{ store.dname(o.doctorId) }} and the patient portal.</span> }
      }
    }</div>
  </cf-drawer>`
})
export class RadiologyPage {
  store = inject(StoreService); toast = inject(ToastService);
  flow = FLOW; mods = ['All', 'X-ray', 'Ultrasound', 'CT', 'MRI']; mod = signal('All'); sel = signal<ImagingOrder | null>(null); wl = signal(1); zoom = signal(1);
  private all = computed(() => { this.store.rev(); return this.store.db.imaging.filter(o => this.mod() === 'All' || o.modality === this.mod()); });
  lane(s: ImgStatus) { return this.all().filter(o => o.status === s || (s === 'Scheduled' && o.status === 'Ordered')); }
  idx(o: ImagingOrder) { return Math.max(0, FLOW.indexOf(o.status)); }
  open(o: ImagingOrder) { this.sel.set(o); this.wl.set(1); this.zoom.set(1); }
  tpl(o: ImagingOrder) { const t = REPORT_TPL[o.modality]; o.findings = t.findings; o.impression = t.impression; }
  save(o: ImagingOrder) { this.store.changed(); this.toast.ok(`Rescheduled to ${o.date} ${o.slot}. Patient notified (simulated).`); }
  move(o: ImagingOrder, s: ImgStatus, patch: Partial<ImagingOrder> = {}) {
    this.store.setImaging(o, s, patch); this.store.log('Updated', 'Imaging', `${o.id} → ${s}`);
    const msg: Record<string, string> = { 'In progress': 'Scan started', 'Awaiting report': 'Images stored in PACS (simulated). Added to the reporting list.', Reported: 'Report submitted for verification', Verified: 'Report verified and released' };
    this.toast.ok(msg[s] || `Moved to ${s}`);
  }
}
