import { Component, computed, inject, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { SessionService } from '../../core/services/session.service';
import { ImagingOrder, ImgStatus } from '../../core/models';
import { DirectoryDoctor, LabApi } from '../../core/api/lab-api';
import { ImagingRoom, ImagingStudy, LiveImagingOrder, RadiologyApi, RoomBooking } from '../../core/api/radiology-api';
import { RadiologySync } from '../../core/api/radiology-sync';

const FLOW: ImgStatus[] = ['Scheduled', 'In progress', 'Awaiting report', 'Reported', 'Verified'];
const REPORT_TPL: Record<string, { findings: string; impression: string }> = {
  'X-ray': { findings: 'Lung fields are clear. Cardiac silhouette is within normal limits. Costophrenic angles are sharp. No bony abnormality.', impression: 'No acute cardiopulmonary abnormality.' },
  Ultrasound: { findings: 'Liver is normal in size with mildly increased echotexture. Gall bladder, pancreas and spleen are normal. Both kidneys are normal in size with preserved corticomedullary differentiation.', impression: 'Grade I fatty liver. Otherwise normal study.' },
  CT: { findings: 'No intracranial haemorrhage, mass effect or midline shift. Ventricles and sulci are normal for age.', impression: 'No acute intracranial abnormality.' },
  MRI: { findings: 'Disc desiccation at L4-L5 with a posterior disc bulge indenting the thecal sac. Mild narrowing of the left neural foramen.', impression: 'L4-L5 disc bulge with mild left foraminal narrowing.' },
};
/** Demo-mode catalogue, the same studies and prices as the server's sample tariff. */
const DEMO_STUDIES: ImagingStudy[] = ([
  ['R01', 'X-ray chest PA view', 'X-ray', 450, false], ['R02', 'X-ray knee AP/lateral', 'X-ray', 700, false], ['R03', 'X-ray lumbosacral spine AP/lateral', 'X-ray', 700, false],
  ['R06', 'Ultrasound abdomen and pelvis', 'Ultrasound', 1500, false], ['R07', 'Obstetric ultrasound (anomaly scan)', 'Ultrasound', 2200, false], ['R08', 'Ultrasound thyroid', 'Ultrasound', 1400, false],
  ['R11', 'CT brain plain', 'CT', 3500, false], ['R12', 'HRCT chest', 'CT', 5200, false], ['R13', 'CT abdomen with contrast', 'CT', 7500, true],
  ['R15', 'MRI lumbar spine', 'MRI', 7500, false], ['R16', 'MRI brain plain', 'MRI', 7000, false], ['R17', 'MRI brain with contrast', 'MRI', 9000, true],
] as const).map(([id, name, modality, price, contrast]) => ({ id, code: id, name, modality, price, durationMin: 20, contrast }));
const DEMO_ROOMS: Record<string, string> = { 'X-ray': 'XR-1', Ultrasound: 'US-1', CT: 'CT-1', MRI: 'MR-1' };

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
    .pick { border:1px solid var(--line); border-radius:12px; overflow:hidden; margin-top:6px } .pick button { display:flex; gap:10px; width:100%; padding:8px 12px; border:0; border-bottom:1px solid var(--line); background:none; text-align:left; color:var(--fg) }
    .booked { display:flex; flex-wrap:wrap; gap:6px } .booked span { font-size:12px; background:var(--ground); border-radius:8px; padding:3px 8px }
  `],
  template: `
  <div class="page">
    <cf-page-head title="Radiology" [crumbs]="['Diagnostics', 'Imaging worklist']" sub="Schedule scans, track acquisition and report studies.">
      <div class="seg">@for (m of mods; track m) {<button [class.on]="mod() === m" (click)="mod.set(m)">{{ m }}</button>}</div>
      <button class="btn" (click)="openNew()"><lucide-icon name="plus" [size]="16"></lucide-icon>New imaging order</button>
    </cf-page-head>
    <div class="alert-box info"><lucide-icon name="plug" [size]="16"></lucide-icon><div>PACS and DICOM modality worklist are <b>simulated</b>. Configure the real connection under <a routerLink="/admin/integrations">Integrations</a> in a later phase.</div></div>
    @if (live && !sync.ready()) { <p class="muted small">Loading the imaging worklist…</p> }
    <div class="board">
      @for (s of flow; track s) {
        <div class="col"><h4>{{ s }}<span class="muted">{{ lane(s).length }}</span></h4>
          @for (o of lane(s); track o.id) {
            <button class="ic" (click)="open(o)"><div class="row" style="gap:6px"><span class="st b" style="padding:1px 7px">{{ o.modality }}</span>@if (o.priority === 'Urgent') {<span class="st p" style="padding:1px 7px">Urgent</span>}@if (o.status === 'Ordered') {<span class="st a" style="padding:1px 7px">Not scheduled</span>}</div>
              <b>{{ store.pname(o.patientId) }}</b><small>{{ o.study }}</small>
              @if (o.slot) {<small>{{ o.date | d }} · {{ o.slot | time12 }} · {{ o.room }}</small>} @else {<small>Ordered {{ o.date | d }}</small>}</button>
          } @empty { <p class="muted small" style="text-align:center;padding:14px 0">Empty</p> }
        </div>
      }
    </div>
  </div>

  <cf-drawer [open]="!!sel()" [title]="sel()?.study || ''" [sub]="sel() ? store.pname(sel()!.patientId) + ' · ' + sel()!.id : ''" width="min(640px,100%)" (closed)="sel.set(null)">
    @if (sel(); as o) {
      <div class="stepper">@for (s of flow; track s; let i = $index) {<span class="s" [class.done]="i < idx(o)" [class.cur]="i === idx(o)">{{ s }}</span>}</div>
      @if (allergic(o.patientId)) { <div class="alert-box crit"><lucide-icon name="shield-alert" [size]="16"></lucide-icon>Contrast allergy on record. Use non-contrast protocol.@if (lv(o)?.contrastOverride) { Override: {{ lv(o)!.contrastOverride }}} @if (!live) {<span class="demo-tag">Demo alert</span>}</div> }
      <div class="kv"><div><small>Modality</small><b>{{ o.modality }}</b></div><div><small>Room</small><b>{{ o.room || '—' }}</b></div><div><small>Referred by</small><b>{{ doctorName(o) }}</b></div><div><small>Charge</small><b>{{ o.price | inr }}</b>@if (lv(o)?.invoiceNumber) {<small>{{ lv(o)!.invoiceNumber }}</small>}</div></div>
      @if (o.status === 'Scheduled' || o.status === 'Ordered') {
        <div class="form-grid three">
          <div class="field"><label>Date</label><input class="inp" type="date" [min]="store.today()" [ngModel]="sd()" (ngModelChange)="sd.set($event); loadBookings()"></div>
          <div class="field"><label>Slot</label><input class="inp" type="time" [(ngModel)]="ss"></div>
          <div class="field"><label>Room</label><select class="inp" [(ngModel)]="sr"><option value="">First free room</option>@for (r of roomsFor(o.modality); track r.code) {<option [value]="r.code">{{ r.code }} · {{ r.name }}</option>}</select></div>
        </div>
        @if (live) { <div class="field"><label class="lbl">Already booked on {{ sd() | d }}</label><div class="booked">@for (b of bookingsFor(o); track b.orderId) {<span>{{ b.room }} · {{ b.slot | time12 }} · {{ b.durationMin }} min</span>} @empty {<span class="muted">Nothing booked yet</span>}</div></div> }
        <div class="field"><div class="row"><label class="lbl">Cancel this study</label></div><div class="row" style="gap:8px"><input class="inp" [(ngModel)]="cancelReason" placeholder="Reason, e.g. patient declined"><button class="btn ghost sm" [disabled]="!cancelReason.trim()" (click)="cancel(o)">Cancel study</button></div></div>
      }
      @if (o.status === 'Scheduled') { <div class="field"><label>Technician</label><input class="inp" [(ngModel)]="tech" placeholder="Name of the radiographer or sonographer"></div> }
      @if (idx(o) >= 1) {
        <div class="viewer" aria-label="Simulated image viewer"><div class="img" [style.filter]="'brightness(' + wl() + ') contrast(' + (1 + (wl() - 1) / 2) + ')'" [style.transform]="'scale(' + zoom() + ')'"></div>
          <div class="ov tl">{{ store.pname(o.patientId) }}<br>{{ o.patientId }}<br>{{ o.modality }} · {{ o.study }}</div><div class="ov br">SIMULATED IMAGE<br>Not a real study<br>Zoom {{ zoom() }}×</div></div>
        <div class="tools"><button class="btn ghost sm" (click)="wl.set(wl() + .15)">Brighter</button><button class="btn ghost sm" (click)="wl.set(wl() - .15)">Darker</button><button class="btn ghost sm" (click)="zoom.set(zoom() + .25)">Zoom in</button><button class="btn ghost sm" (click)="zoom.set(1); wl.set(1)">Reset</button></div>
        @if (o.technician) { <p class="small muted">Scanned by {{ o.technician }}</p> }
      }
      @if (idx(o) >= 2) {
        <div class="field"><div class="row"><label class="lbl">Findings</label><span class="spacer"></span>@if (o.status === 'Awaiting report') {<button class="linkbtn small" (click)="tpl(o)">Insert normal template</button>}</div><textarea class="inp" rows="4" [(ngModel)]="o.findings" [disabled]="o.status !== 'Awaiting report' && (live || idx(o) >= 4)"></textarea></div>
        <div class="field"><label>Impression</label><textarea class="inp" [(ngModel)]="o.impression" [disabled]="o.status !== 'Awaiting report' && (live || idx(o) >= 4)"></textarea></div>
      }
      @if (o.radiologist) { <p class="small muted">Reported by {{ o.radiologist }}@if (lv(o)?.verifiedBy) { · verified by {{ lv(o)!.verifiedBy }}}</p> }
    }
    <div foot>@if (sel(); as o) {
      @switch (o.status) {
        @case ('Scheduled') { <button class="btn ghost" [disabled]="busy()" (click)="save(o)">Save schedule</button><button class="btn" [disabled]="busy()" (click)="start(o)">Start scan</button> }
        @case ('Ordered') { <button class="btn" [disabled]="busy() || !sd() || !ss" (click)="save(o)">Schedule</button> }
        @case ('In progress') { <button class="btn" [disabled]="busy()" (click)="move(o, 'Awaiting report')">Images acquired · send to PACS</button> }
        @case ('Awaiting report') { @if (live) {<button class="btn ghost" [disabled]="busy()" (click)="draft(o)">Save draft</button>}<button class="btn" [disabled]="busy() || !o.findings || !o.impression" (click)="move(o, 'Reported', { radiologist: 'Dr. Farah Khan (Radiologist)' })">Submit report</button> }
        @case ('Reported') { @if (live) {<button class="btn ghost" [disabled]="busy()" (click)="reopen(o)">Reopen report</button>}<button class="btn" [disabled]="busy()" (click)="move(o, 'Verified')"><lucide-icon name="badge-check" [size]="16"></lucide-icon>Verify and release</button> }
        @case ('Verified') { <span class="muted small">Released to {{ doctorName(o) }}@if (!live) { and the patient portal}.</span> }
      }
    }</div>
  </cf-drawer>

  <cf-drawer [open]="newOpen()" title="New imaging order" (closed)="newOpen.set(false)">
    <div class="stack">
      <div class="field"><label>Patient</label>
        @if (store.patient(np()); as p) { <div class="soft row"><b style="flex:1">{{ p.name }} · {{ p.id }}</b><button class="btn ghost sm" (click)="np.set('')">Change</button></div> }
        @else { <input class="inp" [ngModel]="pq()" (ngModelChange)="pq.set($event)" placeholder="Search patient by name or UHID">
          @if (pq().length > 1) {<div class="pick">@for (p of matches(); track p.id) {<button (click)="np.set(p.id); pq.set('')">{{ p.name }} · {{ p.id }}</button>} @empty {<p class="muted small" style="padding:8px 12px">No match among loaded patients.</p>}</div>} }</div>
      <div class="field"><label>Referring doctor</label><select class="inp" [(ngModel)]="nd"><option value="">None (walk-in)</option>@for (d of doctors(); track d.id) {<option [value]="d.id">{{ d.name }}</option>}</select></div>
      <div class="field"><label>Study</label><select class="inp" [ngModel]="ns()" (ngModelChange)="ns.set($event)"><option value="">Choose a study</option>@for (s of studies(); track s.id) {<option [value]="s.id">{{ s.modality }} · {{ s.name }} · {{ s.price | inr }}</option>}</select></div>
      <div class="field"><label>Priority</label><div class="chips">@for (p of ['Routine', 'Urgent']; track p) {<button class="chip" [class.on]="npr === p" (click)="npr = p">{{ p }}</button>}</div></div>
      <div class="form-grid"><div class="field"><label>Date (optional)</label><input class="inp" type="date" [min]="store.today()" [(ngModel)]="ndate"></div><div class="field"><label>Slot</label><input class="inp" type="time" [(ngModel)]="nslot"></div></div>
      @if (study(); as s) {
        @if (s.contrast && allergic(np())) { <div class="alert-box crit"><lucide-icon name="shield-alert" [size]="16"></lucide-icon><div>Contrast allergy on record. Choose a non-contrast study, or give a reason to go ahead.<input class="inp" style="margin-top:6px" [(ngModel)]="nover" placeholder="Reason, e.g. premedication protocol"></div></div> }
        <div class="soft small">{{ s.name }}<br><b>{{ s.price | inr }}</b> will be added to an OPD invoice.@if (!ndate || !nslot) { The study goes to the worklist to be scheduled.}</div>
      }
    </div>
    <div foot><button class="btn ghost" (click)="newOpen.set(false)">Cancel</button><button class="btn" [disabled]="busy() || !np() || !ns() || (!!ndate !== !!nslot) || (!!study()?.contrast && allergic(np()) && !nover.trim())" (click)="create()">Place order</button></div>
  </cf-drawer>`
})
export class RadiologyPage {
  store = inject(StoreService); toast = inject(ToastService); session = inject(SessionService);
  sync = inject(RadiologySync); private api = inject(RadiologyApi); private lab = inject(LabApi); live = this.session.live;
  flow = FLOW; mods = ['All', 'X-ray', 'Ultrasound', 'CT', 'MRI']; mod = signal('All'); sel = signal<ImagingOrder | null>(null); wl = signal(1); zoom = signal(1);
  busy = signal(false);
  // schedule form for the open study
  sd = signal(''); ss = ''; sr = ''; tech = ''; cancelReason = '';
  rooms = signal<ImagingRoom[]>([]); bookings = signal<RoomBooking[]>([]);
  // new order form
  newOpen = signal(false); np = signal(''); pq = signal(''); ns = signal(''); nd = ''; npr = 'Routine'; ndate = ''; nslot = ''; nover = '';
  liveDoctors = signal<DirectoryDoctor[]>([]);
  doctors = computed(() => this.live ? this.liveDoctors() : this.store.db.doctors);
  studies = computed(() => this.live ? this.sync.studies() : DEMO_STUDIES);
  study = computed(() => this.studies().find(s => s.id === this.ns()));
  matches = computed(() => { const q = this.pq().toLowerCase(); this.store.rev(); return this.store.db.patients.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)).slice(0, 6); });

  constructor() {
    if (this.live) {
      this.sync.load().catch(() => this.toast.err('Could not load the imaging worklist from the server'));
      this.api.rooms(this.session.branchId()).then(r => this.rooms.set(r)).catch(() => undefined);
      this.lab.doctors().then(d => this.liveDoctors.set(d)).catch(() => undefined);
    }
  }

  private all = computed(() => { this.store.rev(); return this.store.db.imaging.filter(o => this.mod() === 'All' || o.modality === this.mod()); });
  lane(s: ImgStatus) { return this.all().filter(o => o.status === s || (s === 'Scheduled' && o.status === 'Ordered')); }
  idx(o: ImagingOrder) { return Math.max(0, FLOW.indexOf(o.status)); }
  lv(o: ImagingOrder) { return this.live ? o as LiveImagingOrder : null; }
  doctorName(o: ImagingOrder) { return this.lv(o)?.doctorName ?? (o.doctorId ? this.store.dname(o.doctorId) : 'Walk-in'); }
  allergic(patientId: string) { return !!this.store.patient(patientId)?.allergies?.some(a => /contrast|gadolinium/i.test(a)); }
  roomsFor(modality: string): { code: string; name: string }[] {
    return this.live ? this.rooms().filter(r => r.modality === modality) : [{ code: DEMO_ROOMS[modality], name: modality + ' room' }];
  }
  bookingsFor(o: ImagingOrder) { const codes = this.roomsFor(o.modality).map(r => r.code); return this.bookings().filter(b => codes.includes(b.room) && b.orderId !== o.id); }

  open(o: ImagingOrder) {
    this.sel.set(o); this.wl.set(1); this.zoom.set(1);
    this.sd.set(o.slot ? o.date : this.store.today()); this.ss = o.slot || ''; this.sr = o.room || ''; this.tech = ''; this.cancelReason = '';
    if (this.live && (o.status === 'Ordered' || o.status === 'Scheduled')) {
      const branch = (o as LiveImagingOrder).branchId;
      if (!this.rooms().some(r => r.branchId === branch)) this.api.rooms(branch).then(r => this.rooms.set(r)).catch(() => undefined);
      this.loadBookings();
    }
  }
  loadBookings() {
    const o = this.lv(this.sel()!); if (!o || !this.sd()) return;
    this.api.bookings(o.branchId, this.sd()).then(b => this.bookings.set(b)).catch(() => this.bookings.set([]));
  }
  tpl(o: ImagingOrder) { const t = REPORT_TPL[o.modality]; o.findings = t.findings; o.impression = t.impression; }

  private async run(call: () => Promise<LiveImagingOrder>, ok: (o: LiveImagingOrder) => string) {
    this.busy.set(true);
    try { const o = await this.sync.action(call, ok); if (o) this.sel.set(o.status === 'Cancelled' ? null : o); return o; }
    finally { this.busy.set(false); }
  }

  save(o: ImagingOrder) {
    if (!this.sd() || !this.ss) { this.toast.err('Choose a date and a slot'); return; }
    if (this.live) { this.run(() => this.api.schedule(o as LiveImagingOrder, this.sd(), this.ss, this.sr), x => `Booked ${x.room} on ${x.date} at ${x.slot}`).then(() => this.loadBookings()); return; }
    const wasOrdered = o.status === 'Ordered';
    o.date = this.sd(); o.slot = this.ss; o.room = this.sr || o.room || DEMO_ROOMS[o.modality];
    if (wasOrdered) this.store.setImaging(o, 'Scheduled'); else this.store.changed();
    this.toast.ok(`${wasOrdered ? 'Scheduled' : 'Rescheduled'} for ${o.date} ${o.slot}. Patient notified (simulated).`);
  }
  start(o: ImagingOrder) {
    if (this.live) { this.run(() => this.api.start(o.id, this.tech.trim() || undefined), () => 'Scan started'); return; }
    this.move(o, 'In progress', { technician: this.tech.trim() || 'Ravi (radiographer)' });
  }
  draft(o: ImagingOrder) { this.run(() => this.api.saveReport(o as LiveImagingOrder, false), () => 'Draft report saved'); }
  reopen(o: ImagingOrder) { this.run(() => this.api.reopen(o.id), () => 'Report reopened for editing'); }
  cancel(o: ImagingOrder) {
    const reason = this.cancelReason.trim(); if (!reason) return;
    if (this.live) { this.run(() => this.api.cancel(o.id, reason), x => `${x.id} cancelled`); return; }
    this.store.setImaging(o, 'Cancelled'); this.store.log('Cancelled', 'Imaging', `${o.id}: ${reason}`); this.sel.set(null); this.toast.ok(`${o.id} cancelled`);
  }
  move(o: ImagingOrder, s: ImgStatus, patch: Partial<ImagingOrder> = {}) {
    const msg: Record<string, string> = { 'In progress': 'Scan started', 'Awaiting report': 'Images stored in PACS (simulated). Added to the reporting list.', Reported: 'Report submitted for verification', Verified: 'Report verified and released' };
    if (this.live) {
      const lo = o as LiveImagingOrder;
      const call = s === 'Awaiting report' ? () => this.api.acquire(o.id) : s === 'Reported' ? () => this.api.saveReport(lo, true) : () => this.api.verify(o.id);
      this.run(call, () => msg[s]);
      return;
    }
    this.store.setImaging(o, s, patch); this.store.log('Updated', 'Imaging', `${o.id} → ${s}`);
    this.toast.ok(msg[s] || `Moved to ${s}`);
  }

  openNew() {
    this.np.set(''); this.pq.set(''); this.ns.set(''); this.nd = ''; this.npr = 'Routine'; this.ndate = ''; this.nslot = ''; this.nover = '';
    if (this.live && !this.sync.studies().length) this.api.studies().then(s => this.sync.studies.set(s)).catch(() => this.toast.err('Could not load the imaging tariff'));
    this.newOpen.set(true);
  }
  async create() {
    const s = this.study(); if (!s) return;
    if (this.live) {
      this.busy.set(true);
      try {
        const o = await this.sync.action(() => this.api.create({ patientId: this.np(), doctorId: this.nd || undefined, studyId: s.id, priority: this.npr as ImagingOrder['priority'],
          date: this.ndate || undefined, slot: this.nslot || undefined, contrastOverride: this.nover.trim() || undefined }),
          x => `${x.id} placed for ${x.patientName}${x.slot ? `, booked ${x.room} at ${x.slot}` : ''}. Invoice ${x.invoiceNumber ?? ''} created.`);
        if (o) this.newOpen.set(false);
      } finally { this.busy.set(false); }
      return;
    }
    const o = this.store.orderImaging({ patientId: this.np(), doctorId: this.nd, modality: s.modality, study: s.name, date: this.ndate || this.store.today(), slot: this.nslot,
      room: this.nslot ? DEMO_ROOMS[s.modality] : '', price: s.price, priority: this.npr as ImagingOrder['priority'] });
    if (!this.nslot) this.store.setImaging(o, 'Ordered');
    this.toast.ok(`${o.id} placed for ${this.store.pname(o.patientId)}. Invoice created.`); this.newOpen.set(false);
  }
}
