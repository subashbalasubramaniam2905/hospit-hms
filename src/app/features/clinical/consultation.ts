import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED } from '../../shared';
import { RxEditorComponent } from '../../shared/rx-editor';
import { StoreService } from '../../core/services/store.service';
import { ExportService } from '../../core/services/export.service';
import { ToastService } from '../../core/services/toast.service';
import { SessionService } from '../../core/services/session.service';
import { AiMockService, AiSuggestion } from '../../core/services/ai-mock.service';
import { Consultation, Prescription } from '../../core/models';
import { ICD10, TEMPLATES, safetyCheck } from '../../core/data/clinical';

@Component({
  standalone: true, imports: [SHARED, RxEditorComponent],
  styles: [`
    .ws { display:grid; grid-template-columns:240px minmax(0,1fr) 320px; gap:16px; align-items:start }
    .rail { position:sticky; top:84px; max-height:calc(100vh - 100px); overflow:auto; padding:14px }
    .rail .li { cursor:pointer; border-radius:10px; padding:8px; border-bottom:0; gap:10px }
    .rail .li:hover { background:var(--ground) } .rail .li.on { background:var(--pri-soft) }
    .rail .tok { font-weight:800; font-size:12px; color:var(--mut) }
    .pbar { position:sticky; top:68px; z-index:15; background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:12px 16px; display:flex; gap:14px; align-items:center; flex-wrap:wrap; box-shadow:0 6px 18px rgba(0,0,0,.04) }
    .pbar h1 { font-size:17px; font-weight:800 } .pbar .m { color:var(--mut); font-size:12.5px }
    .pbar .acts { margin-left:auto; display:flex; gap:8px; align-items:center }
    .saved { font-size:12px; color:var(--mut) }
    .sec { scroll-margin-top:150px }
    .vit { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px }
    .vit .field .inp.flag { border-color:var(--red); background:var(--red-soft) } .vit .field .inp.warnf { border-color:var(--amber); background:var(--amber-soft) }
    .bmi { display:flex; flex-direction:column; align-items:flex-start; gap:4px; padding:10px 12px; border-radius:10px; background:var(--ground) }
    .dxs { position:relative } .dxs .drop { position:absolute; z-index:20; left:0; right:0; top:calc(100% + 4px); background:var(--card); border:1px solid var(--line); border-radius:12px; box-shadow:0 12px 30px rgba(0,0,0,.12); max-height:260px; overflow:auto }
    .dxs .drop button { display:flex; width:100%; gap:10px; padding:9px 12px; border:0; border-bottom:1px solid var(--line); background:none; text-align:left; color:var(--fg) } .dxs .drop button:hover { background:var(--ground) }
    .dxs .drop code { font-weight:700; color:var(--pri); min-width:60px }
    .ai { position:sticky; top:84px; max-height:calc(100vh - 100px); overflow:auto; display:flex; flex-direction:column; gap:12px }
    .sug { background:var(--card); border:1px solid color-mix(in srgb,var(--ai) 25%,var(--line)); border-radius:12px; padding:10px 12px; display:flex; flex-direction:column; gap:6px }
    .sug .k { font-size:11px; font-weight:700; color:var(--ai); text-transform:uppercase; letter-spacing:.04em }
    .sug b { font-size:13.5px } .sug p { font-size:12.5px; color:var(--mut) }
    .jump { display:flex; gap:6px; flex-wrap:wrap }
    .tests { display:flex; flex-wrap:wrap; gap:6px }
    @media (max-width:1280px){ .ws { grid-template-columns:minmax(0,1fr) 300px } .rail { display:none } }
    @media (max-width:960px){ .ws { grid-template-columns:minmax(0,1fr) } .ai { position:static; max-height:none } .vit { grid-template-columns:repeat(2,minmax(0,1fr)) } .pbar { position:static } }
  `],
  template: `
  @if (!patient()) {
    <div class="page">
      <cf-page-head title="Consultation" [crumbs]="['Clinical', 'Worklist']" sub="Choose a patient from today's list to open the consultation workspace."></cf-page-head>
      <div class="card">
        <cf-table [rows]="worklist()" [cols]="wlCols" [clickable]="true" (rowClick)="open($event.patientId)" emptyTitle="No patients waiting" emptyText="Checked-in patients appear here.">
          <ng-template cfCell="patient" let-r><div class="pname"><cf-avatar [name]="store.pname(r.patientId)"></cf-avatar><div>{{ store.pname(r.patientId) }}<small>{{ r.patientId }}</small></div></div></ng-template>
          <ng-template cfCell="state" let-r><cf-status [s]="r.state"></cf-status></ng-template>
          <ng-template cfCell="go" let-r><button class="btn sm">Open</button></ng-template>
        </cf-table>
      </div>
    </div>
  } @else {
  @let p = patient()!; @let c = cons()!;
  <div class="page">
    <div class="pbar" role="region" aria-label="Patient context">
      <cf-avatar [name]="p.name" size="lg"></cf-avatar>
      <div>
        <div class="row" style="gap:8px"><h1>{{ p.name }}</h1>@if (token()) {<span class="st b">Token {{ token() }}</span>}<cf-status [s]="c.status === 'Completed' ? 'Completed' : 'In consultation'"></cf-status></div>
        <div class="m">{{ p.dob | age }} y · {{ p.gender }} · {{ p.id }} · Blood {{ p.blood }} · BMI {{ bmi() || '—' }} · {{ p.insurance ? store.provider(p.insurance.providerId)?.name : 'Self pay' }}</div>
        <div class="chips" style="margin-top:6px">
          @for (a of p.allergies; track a) { <span class="st r"><lucide-icon name="triangle-alert" [size]="12"></lucide-icon>{{ a }} allergy</span> } @empty { <span class="st n">No known allergies</span> }
          @for (x of p.conditions; track x) { <span class="st b">{{ x }}</span> }
        </div>
      </div>
      <div class="acts">
        <span class="saved">@if (savedAt()) { Draft saved {{ savedAt() }} } @else { Not saved yet }</span>
        @if (c.status !== 'Completed') {
          <button class="btn ghost sm" (click)="save(true)"><lucide-icon name="file-check" [size]="15"></lucide-icon>Save draft</button>
          <button class="btn sm" (click)="review.set(true)"><lucide-icon name="badge-check" [size]="15"></lucide-icon>Review and sign</button>
        } @else {
          <button class="btn ghost sm" (click)="print()"><lucide-icon name="printer" [size]="15"></lucide-icon>Print summary</button>
          <button class="btn sm" (click)="nextPatient()"><lucide-icon name="arrow-right" [size]="15"></lucide-icon>Next patient</button>
        }
      </div>
    </div>

    <div class="ws">
      <aside class="card rail" aria-label="Today's patients">
        <div class="small muted bold" style="margin:0 0 8px 4px">Today · {{ worklist().length }} patients</div>
        <div class="list">
          @for (r of worklist(); track r.patientId) {
            <div class="li" [class.on]="r.patientId === p.id" (click)="open(r.patientId)" (keydown.enter)="open(r.patientId)" tabindex="0" role="button">
              <cf-avatar [name]="store.pname(r.patientId)"></cf-avatar>
              <div class="grow"><b>{{ store.pname(r.patientId) }}</b><span><span class="tok">{{ r.token || r.time }}</span> · {{ r.state }}</span></div>
            </div>
          }
        </div>
      </aside>

      <div class="stack" (input)="dirty()" (change)="dirty()">
        @if (c.status === 'Completed') { <div class="alert-box ok"><lucide-icon name="circle-check" [size]="16"></lucide-icon><div><b>Consultation signed by {{ store.dname(c.doctorId) }}</b><div>The record is read-only. Prescriptions went to the pharmacy and tests to the lab.</div></div></div> }
        <div class="card" style="padding:12px 16px">
          <div class="toolbar">
            <div class="field" style="min-width:220px"><label>Template</label>
              <select class="inp" [ngModel]="c.template" (ngModelChange)="applyTemplate($event)" [disabled]="ro()">@for (t of templates; track t.name) {<option>{{ t.name }}</option>}</select></div>
            <span class="spacer"></span>
            <div class="jump">@for (s of sections; track s.id) {<button class="chip" (click)="jump(s.id)">{{ s.label }}</button>}</div>
          </div>
        </div>

        <section class="card sec" id="sec-vitals">
          <div class="card-h"><h3>Vitals</h3><span class="r muted small">Recorded by triage · editable</span></div>
          <div class="vit">
            <div class="field"><label>BP (mmHg)</label><input class="inp" [class.flag]="bpHigh()" [(ngModel)]="c.vitals.bp" [disabled]="ro()" placeholder="120/80"></div>
            <div class="field"><label>Pulse (bpm)</label><input class="inp" type="number" [class.warnf]="(c.vitals.hr ?? 0) > 100" [(ngModel)]="c.vitals.hr" [disabled]="ro()"></div>
            <div class="field"><label>Temp (°F)</label><input class="inp" type="number" step="0.1" [class.warnf]="(c.vitals.temp ?? 0) >= 100.4" [(ngModel)]="c.vitals.temp" [disabled]="ro()"></div>
            <div class="field"><label>SpO₂ (%)</label><input class="inp" type="number" [class.flag]="(c.vitals.spo2 ?? 100) < 94" [(ngModel)]="c.vitals.spo2" [disabled]="ro()"></div>
            <div class="field"><label>Resp. rate</label><input class="inp" type="number" [(ngModel)]="c.vitals.rr" [disabled]="ro()"></div>
            <div class="field"><label>Height (cm)</label><input class="inp" type="number" [(ngModel)]="c.vitals.height" [disabled]="ro()"></div>
            <div class="field"><label>Weight (kg)</label><input class="inp" type="number" [(ngModel)]="c.vitals.weight" [disabled]="ro()"></div>
            <div class="bmi"><div><div class="small muted">BMI</div><b style="font-size:18px">{{ bmi() || '—' }}</b></div>@if (bmiLabel()) {<span class="st" [class.ok]="bmiLabel() === 'Normal'" [class.a]="bmiLabel() !== 'Normal'">{{ bmiLabel() }}</span>}</div>
          </div>
          @if (bpHigh()) { <div class="alert-box warn" style="margin-top:10px"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon>BP {{ c.vitals.bp }} is above 140/90. Consider a repeat reading.</div> }
        </section>

        <section class="card sec" id="sec-history">
          <div class="card-h"><h3>Subjective</h3></div>
          <div class="stack">
            <div class="field"><label>Chief complaint</label><input class="inp" [(ngModel)]="c.cc" [disabled]="ro()" placeholder="e.g. Fever for 3 days"></div>
            <div class="field"><div class="row"><label class="lbl">History of present illness</label><span class="spacer"></span>@if (!ro()) {<cf-voice label="Dictate" [text]="dictation()" (chunk)="c.hpi = c.hpi + $event" (done)="dirty(); toast.info('Dictation added to the note (simulated speech-to-text)')"></cf-voice>}</div>
              <textarea class="inp" rows="4" [(ngModel)]="c.hpi" [disabled]="ro()"></textarea></div>
            <div class="form-grid">
              <div class="field"><label>Past medical history</label><textarea class="inp" [(ngModel)]="c.pmh" [disabled]="ro()"></textarea></div>
              <div class="field"><label>Current medicines</label><textarea class="inp" [(ngModel)]="c.meds" [disabled]="ro()"></textarea></div>
              <div class="field"><label>Family history</label><input class="inp" [(ngModel)]="c.fh" [disabled]="ro()"></div>
              <div class="field"><label>Social history</label><input class="inp" [(ngModel)]="c.sh" [disabled]="ro()" placeholder="Smoking, alcohol, diet, activity"></div>
            </div>
          </div>
        </section>

        <section class="card sec" id="sec-exam">
          <div class="card-h"><h3>Objective · examination</h3></div>
          <textarea class="inp" rows="4" [(ngModel)]="c.exam" [disabled]="ro()"></textarea>
        </section>

        <section class="card sec" id="sec-dx">
          <div class="card-h"><h3>Assessment · diagnosis</h3><span class="r muted small">ICD-10 search</span></div>
          @if (!ro()) {
          <div class="dxs">
            <label class="search boxed"><lucide-icon name="search" [size]="16"></lucide-icon><input [ngModel]="dxq()" (ngModelChange)="dxq.set($event)" placeholder="Search diagnosis or ICD-10 code (e.g. diabetes, J06)" aria-label="Search ICD-10"></label>
            @if (dxq().length > 1) { <div class="drop">@for (d of dxResults(); track d.code) {<button (click)="addDx(d.code)"><code>{{ d.code }}</code>{{ d.label }}</button>} @empty {<div style="padding:12px" class="muted small">No ICD-10 match in the demo list.</div>}</div> }
          </div> }
          <div class="chips" style="margin-top:10px">
            @for (d of c.dx; track d.code; let i = $index) { <span class="st b" style="padding:5px 10px">{{ d.code }} · {{ d.label }} @if (!ro()) {<button class="linkbtn" (click)="c.dx.splice(i, 1); dirty()" aria-label="Remove diagnosis"><lucide-icon name="x" [size]="12"></lucide-icon></button>}</span> }
            @if (!c.dx.length) { <span class="muted small">No diagnosis added yet.</span> }
          </div>
          <div class="field" style="margin-top:12px"><label>Assessment</label><textarea class="inp" [(ngModel)]="c.assessment" [disabled]="ro()"></textarea></div>
        </section>

        <section class="card sec" id="sec-orders">
          <div class="card-h"><h3>Orders</h3>@if (pendingLabs().length) {<span class="r st a">{{ pendingLabs().length }} earlier orders in progress</span>}</div>
          <div class="small muted bold" style="margin-bottom:6px">Lab tests</div>
          <div class="tests">@for (t of store.db.labTests; track t.id) { <button class="chip" [class.on]="tests().includes(t.id)" (click)="toggleTest(t.id)" [disabled]="ro()" [matTooltip]="t.name + ' · ' + (t.price | inr)">{{ t.code }}</button> }</div>
          @if (tests().length) { <p class="small" style="margin-top:8px">{{ store.names(tests()) }} · <b>{{ testTotal() | inr }}</b></p>
            <div class="row" style="margin-top:6px"><span class="small muted">Priority</span>@for (pr of ['Routine', 'Urgent', 'STAT']; track pr) {<button class="chip" [class.on]="priority() === pr" (click)="priority.set(pr)" [disabled]="ro()">{{ pr }}</button>}</div> }
          <div class="small muted bold" style="margin:14px 0 6px">Imaging</div>
          <div class="form-grid three">
            <div class="field"><select class="inp" [(ngModel)]="img.modality" [disabled]="ro()" aria-label="Modality"><option value="">No imaging</option><option>X-ray</option><option>Ultrasound</option><option>CT</option><option>MRI</option></select></div>
            <div class="field" style="grid-column:span 2"><input class="inp" [(ngModel)]="img.study" [disabled]="ro() || !img.modality" placeholder="Study, e.g. Chest PA view"></div>
          </div>
          @if (img.modality && p.allergies.includes('Iodinated contrast') && img.modality === 'CT') { <div class="alert-box crit" style="margin-top:8px"><lucide-icon name="shield-alert" [size]="16"></lucide-icon>Contrast allergy on record. Request a non-contrast study or premedication protocol. <span class="demo-tag">Demo alert</span></div> }
        </section>

        <section class="card sec" id="sec-rx">
          <div class="card-h"><h3>Prescription</h3><span class="r muted small">{{ rx().items.length }} medicines</span></div>
          <cf-rx-editor [items]="rx().items" [patient]="p" [labs]="patientLabs()" [readonly]="ro()" (changed)="dirty()"></cf-rx-editor>
        </section>

        <section class="card sec" id="sec-plan">
          <div class="card-h"><h3>Plan and follow-up</h3></div>
          <div class="stack">
            <div class="field"><label>Plan and advice</label><textarea class="inp" rows="3" [(ngModel)]="c.plan" [disabled]="ro()"></textarea></div>
            <div class="form-grid">
              <div class="field"><label>Follow-up</label><div class="chips">@for (f of fuOptions; track f.label) {<button class="chip" [class.on]="c.followUpDate === store.day(f.days)" (click)="setFu(f.days, f.label)" [disabled]="ro()">{{ f.label }}</button>}</div></div>
              <div class="field"><label>Follow-up date</label><input class="inp" type="date" [(ngModel)]="c.followUpDate" [disabled]="ro()"></div>
            </div>
            <div class="field"><label>Private notes (not printed)</label><input class="inp" [(ngModel)]="c.notes" [disabled]="ro()"></div>
          </div>
        </section>
      </div>

      <aside class="ai" aria-label="AI suggestions">
        <div class="ai-card">
          <div class="ai-h"><lucide-icon name="sparkles" [size]="16"></lucide-icon>AI assist<span class="spacer"></span><span class="ai-badge">Suggestions only</span></div>
          <p class="small" style="line-height:1.5">{{ summary() }}</p>
          <p class="hint" style="margin-top:8px">Generated from this demo record by simple rules. Review before use. AI never diagnoses or prescribes.</p>
        </div>
        @if (!ro()) {
        <div class="row"><b class="small">Suggestions for this visit</b><span class="spacer"></span><button class="btn ghost sm" (click)="refreshAi()"><lucide-icon name="refresh-cw" [size]="14"></lucide-icon>Refresh</button></div>
        @for (s of suggestions(); track s.id) {
          <div class="sug">
            <span class="k">{{ s.kind }} · {{ s.confidence }} confidence</span><b>{{ s.title }}</b><p>{{ s.body }}</p>
            <div class="row">@if (s.apply) {<button class="btn soft-btn sm" (click)="accept(s)"><lucide-icon name="check" [size]="14"></lucide-icon>Accept into note</button>}<button class="btn ghost sm" (click)="dismiss(s)">Dismiss</button></div>
          </div>
        } @empty { <p class="muted small">Type a chief complaint or history to get suggestions.</p> }
        }
        <div class="card" style="padding:14px">
          <div class="card-h" style="margin-bottom:6px"><h3>Recent results</h3></div>
          <div class="list">@for (r of recentResults(); track $index) {
            <div class="li"><div class="grow"><b>{{ r.name }}</b><span>{{ r.date | d }}</span></div><b [style.color]="r.flag ? 'var(--red)' : ''">{{ r.value }} {{ r.unit }}</b></div>
          } @empty { <p class="muted small">No verified results.</p> }</div>
        </div>
        <div class="card" style="padding:14px">
          <div class="card-h" style="margin-bottom:6px"><h3>Previous visits</h3><a class="r small" [routerLink]="['/clinical-notes', p.id]">Compare notes</a></div>
          <div class="list">@for (v of prevVisits(); track v.id) {
            <div class="li"><div class="grow"><b>{{ v.date | d:true }}</b><span>{{ v.dx[0]?.label || v.cc }}</span></div></div>
          } @empty { <p class="muted small">First visit.</p> }</div>
        </div>
      </aside>
    </div>
  </div>

  <cf-modal [open]="review()" title="Review and sign consultation" width="min(680px,100%)" (closed)="review.set(false)">
    <div class="stack">
      <div class="kv">
        <div><small>Diagnoses</small><b>{{ c.dx.length ? dxText() : 'None added' }}</b></div>
        <div><small>Medicines</small><b>{{ rx().items.length }} {{ rx().items.length === 1 ? 'item' : 'items' }}</b></div>
        <div><small>Lab tests</small><b>{{ tests().length ? store.codes(tests()) : 'None' }}</b></div>
        <div><small>Follow-up</small><b>{{ c.followUpDate ? (c.followUpDate | d:true) : 'Not set' }}</b></div>
      </div>
      @if (!c.dx.length) { <div class="alert-box warn"><lucide-icon name="triangle-alert" [size]="16"></lucide-icon>Add at least one diagnosis before signing.</div> }
      @if (critAlerts().length) {
        <div class="alert-box crit"><lucide-icon name="shield-alert" [size]="16"></lucide-icon><div><b>{{ critAlerts().length }} critical demo alert(s) on this prescription</b><div>{{ critTitles() }}</div></div></div>
        <div class="field"><label>Reason for overriding <span class="req">*</span></label><input class="inp" [(ngModel)]="override" placeholder="e.g. Tolerated previously, patient counselled"></div>
      }
      <mat-checkbox [(ngModel)]="confirmAi">I have reviewed all content, including any AI suggestions I accepted.</mat-checkbox>
      <p class="hint">Signing sends the prescription to the pharmacy, orders the selected tests, moves the patient on in the queue and books the follow-up reminder. All simulated.</p>
    </div>
    <div foot><button class="btn ghost" (click)="review.set(false)">Keep editing</button><button class="btn" [disabled]="!canSign()" (click)="sign()"><lucide-icon name="badge-check" [size]="16"></lucide-icon>Sign and complete</button></div>
  </cf-modal>
  }`
})
export class ConsultationPage {
  printer = inject(ExportService);
  store = inject(StoreService); toast = inject(ToastService); session = inject(SessionService); ai = inject(AiMockService); router = inject(Router);
  patientId = input<string>('');
  templates = TEMPLATES;
  sections = [{ id: 'vitals', label: 'Vitals' }, { id: 'history', label: 'Subjective' }, { id: 'exam', label: 'Exam' }, { id: 'dx', label: 'Diagnosis' }, { id: 'orders', label: 'Orders' }, { id: 'rx', label: 'Rx' }, { id: 'plan', label: 'Plan' }];
  fuOptions = [{ label: '1 week', days: 7 }, { label: '2 weeks', days: 14 }, { label: '1 month', days: 30 }, { label: '3 months', days: 90 }];
  wlCols = [{ key: 'token', label: 'Token' }, { key: 'patient', label: 'Patient', value: (r: { patientId: string }) => this.store.pname(r.patientId) }, { key: 'time', label: 'Time' }, { key: 'doctor', label: 'Doctor' }, { key: 'state', label: 'Status' }, { key: 'go', label: '', sortable: false }];

  cons = signal<Consultation | null>(null); rx = signal<Prescription>(this.store.newRx('', ''));
  tests = signal<string[]>([]); priority = signal('Routine'); img = { modality: '', study: '' };
  dxq = signal(''); review = signal(false); savedAt = signal(''); aiRev = signal(0); dismissed = signal<string[]>([]);
  override = ''; confirmAi = false; private t: ReturnType<typeof setTimeout> | null = null;

  myDoctor = computed(() => this.session.roleId() === 'doctor' ? 'D01' : '');
  patient = computed(() => this.store.patient(this.patientId()));
  ro = computed(() => this.cons()?.status === 'Completed');

  constructor() {
    effect(() => {
      const p = this.patient(); if (!p) { this.cons.set(null); return; }
      untracked(() => {
        const appt = this.store.db.appointments.find(a => a.patientId === p.id && a.date === this.store.today());
        const docId = this.myDoctor() || appt?.doctorId || p.primaryDoctorId;
        const c = this.store.draftFor(p.id, docId, appt?.id); this.cons.set(c);
        const rx = this.store.db.prescriptions.find(r => r.consultationId === c.id) ?? Object.assign(this.store.newRx(p.id, docId), { consultationId: c.id });
        this.rx.set(rx); this.tests.set([]); this.img = { modality: '', study: '' }; this.dismissed.set([]); this.savedAt.set(''); this.override = ''; this.confirmAi = false;
        if (!c.hpi && !c.exam) { const t = TEMPLATES.find(x => x.name === c.template); if (t) { c.hpi = t.hpi; c.exam = t.exam; c.cc = c.cc || t.cc; } }
        const q = this.store.db.queue.find(x => x.patientId === p.id && x.step < 3); if (q && c.status === 'Draft') this.store.moveQueue(q.token, 3);
      });
    });
  }

  worklist = computed(() => {
    this.store.rev(); const doc = this.myDoctor(); const today = this.store.today();
    const qs = this.store.db.queue.filter(q => q.step >= 2 && q.step <= 3 && (!doc || q.doctorId === doc));
    const ap = this.store.db.appointments.filter(a => a.date === today && (!doc || a.doctorId === doc) && !['Cancelled', 'No-show'].includes(a.status));
    const seen = new Set<string>(); const out: { patientId: string; token?: string; time: string; doctor: string; state: string }[] = [];
    qs.sort((a, b) => b.step - a.step || b.since - a.since).forEach(q => { seen.add(q.patientId); out.push({ patientId: q.patientId, token: q.token, time: q.arrivedAt, doctor: this.store.dname(q.doctorId), state: q.step === 3 ? 'In consultation' : 'Waiting' }); });
    ap.forEach(a => { if (!seen.has(a.patientId)) { seen.add(a.patientId); out.push({ patientId: a.patientId, token: a.token, time: a.time, doctor: this.store.dname(a.doctorId), state: a.status }); } });
    return out;
  });
  token = computed(() => { this.store.rev(); return this.store.db.queue.find(q => q.patientId === this.patientId())?.token; });
  bmi = computed(() => { this.aiRev(); const v = this.cons()?.vitals; if (!v?.height || !v.weight) return ''; return (v.weight / ((v.height / 100) ** 2)).toFixed(1); });
  bmiLabel = computed(() => { const b = +this.bmi(); if (!b) return ''; return b < 18.5 ? 'Underweight' : b < 23 ? 'Normal' : b < 25 ? 'Overweight' : 'Obese'; });
  bpHigh = computed(() => { this.aiRev(); const [s, d] = (this.cons()?.vitals.bp || '').split('/').map(Number); return s >= 140 || d >= 90; });
  dictation = computed(() => { const p = this.patient(); return p?.conditions.includes('Type 2 diabetes') ? ' Fasting sugars around 150 to 170 at home over the last month. Missed evening metformin a few times. Mild tingling in both feet at night. No hypoglycaemia episodes.' : ' Fever for three days, highest 101. Mild body ache and sore throat. No breathlessness, no rash.'; });
  dxResults = computed(() => { const q = this.dxq().toLowerCase(); return ICD10.filter(d => d.code.toLowerCase().startsWith(q) || d.label.toLowerCase().includes(q)).slice(0, 8); });
  patientLabs = computed(() => { this.store.rev(); return this.store.db.labOrders.filter(o => o.patientId === this.patientId()).sort((a, b) => b.date.localeCompare(a.date)); });
  pendingLabs = computed(() => this.patientLabs().filter(o => !['Verified', 'Delivered'].includes(o.status)));
  testTotal = computed(() => this.tests().reduce((t, id) => t + (this.store.test(id)?.price || 0), 0));
  recentResults = computed(() => {
    const out: { name: string; value: number; unit: string; date: string; flag: boolean }[] = [];
    for (const o of this.patientLabs()) for (const tid of Object.keys(o.results)) { const t = this.store.test(tid); if (!t) continue; for (const prm of t.params) { const v = o.results[tid][prm.name]; if (v != null && out.length < 6) out.push({ name: prm.name, value: v, unit: prm.unit, date: o.date, flag: v < prm.low || v > prm.high }); } }
    return out;
  });
  prevVisits = computed(() => { this.store.rev(); return this.store.db.consultations.filter(c => c.patientId === this.patientId() && c.status === 'Completed' && c.id !== this.cons()?.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4); });
  summary = computed(() => { const p = this.patient(); return p ? this.ai.summary(p) : ''; });
  suggestions = computed(() => { this.aiRev(); const p = this.patient(), c = this.cons(); if (!p || !c) return []; const d = this.dismissed(); return this.ai.suggestions(p, c).filter(s => !d.includes(s.title)); });
  critAlerts = computed(() => { this.aiRev(); return safetyCheck(this.patient(), this.rx().items, this.patientLabs()).filter(a => a.level === 'crit'); });
  critTitles = computed(() => this.critAlerts().map(a => a.title).join('; '));
  dxText = computed(() => { this.aiRev(); return (this.cons()?.dx || []).map(d => `${d.code} ${d.label}`).join(', '); });
  canSign() { const c = this.cons(); return !!c && c.dx.length > 0 && this.confirmAi && (!this.critAlerts().length || this.override.trim().length > 4); }

  open(id: string) { this.router.navigate(['/consultation', id]); }
  jump(id: string) { document.getElementById('sec-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  dirty() { this.aiRev.update(v => v + 1); if (this.ro()) return; if (this.t) clearTimeout(this.t); this.t = setTimeout(() => this.save(false), 1200); }
  save(explicit: boolean) {
    const c = this.cons(); if (!c || this.ro()) return;
    const rx = this.rx(); rx.diagnosis = c.dx.map(d => d.label).join(', ');
    if (rx.items.length && !this.store.db.prescriptions.includes(rx)) this.store.db.prescriptions.unshift(rx);
    if (explicit) { this.store.saveDraft(c); this.toast.ok('Draft saved. You can come back to it any time today.'); } else this.store.changed();
    this.savedAt.set(this.store.nowTime());
  }
  applyTemplate(name: string) {
    const c = this.cons()!; const t = TEMPLATES.find(x => x.name === name); if (!t) return;
    c.template = name; c.hpi = t.hpi; c.exam = t.exam; if (t.cc) c.cc = t.cc; if (t.plan) c.plan = t.plan; this.tests.set([...t.tests]); this.dirty();
    this.toast.info(`${name} template applied`);
  }
  addDx(code: string) { const c = this.cons()!; const d = ICD10.find(x => x.code === code)!; if (!c.dx.some(x => x.code === code)) c.dx.push({ ...d }); this.dxq.set(''); this.dirty(); }
  toggleTest(id: string) { this.tests.update(t => t.includes(id) ? t.filter(x => x !== id) : [...t, id]); this.dirty(); }
  setFu(days: number, label: string) { const c = this.cons()!; c.followUpDate = this.store.day(days); c.followUp = `Review in ${label}`; this.dirty(); }
  refreshAi() { this.dismissed.set([]); this.aiRev.update(v => v + 1); this.toast.info('Suggestions refreshed from the current note (demo rules)'); }
  dismiss(s: AiSuggestion) { this.dismissed.update(d => [...d, s.title]); }
  accept(s: AiSuggestion) {
    const c = this.cons()!; const a = s.apply!;
    if (a.field === 'dx') this.addDx(a.value);
    else if (a.field === 'tests') this.tests.update(t => [...new Set([...t, ...a.value.split(',')])]);
    else (c as unknown as Record<string, string>)[a.field] = a.value;
    this.store.log('Accepted', 'AI suggestion', `${s.kind}: ${s.title} (${this.store.pname(c.patientId)})`, 'Sensitive');
    this.dismiss(s); this.dirty(); this.toast.ok('Suggestion added. Edit it as needed. It is now your note.');
  }
  sign() {
    const c = this.cons()!, p = this.patient()!; const rx = this.rx(); rx.diagnosis = c.dx.map(d => d.label).join(', ');
    if (this.override.trim()) { rx.notes = `Override: ${this.override}`; this.store.log('Override', 'Safety alert', `${this.critTitles()} · ${this.override}`, 'Flagged'); }
    if (this.tests().length) this.store.orderLab(p.id, c.doctorId, this.tests(), this.priority() as 'Routine');
    if (this.img.modality && this.img.study) this.store.orderImaging({ patientId: p.id, doctorId: c.doctorId, modality: this.img.modality as 'X-ray', study: this.img.study, date: this.store.today(), slot: this.store.nowTime(), room: this.img.modality === 'X-ray' ? 'XR-1' : this.img.modality === 'Ultrasound' ? 'US-1' : this.img.modality + '-1', price: ({ 'X-ray': 450, Ultrasound: 1200, CT: 3800, MRI: 7500 } as Record<string, number>)[this.img.modality], priority: 'Routine' });
    if (this.store.db.prescriptions.includes(rx) && !rx.items.length) this.store.db.prescriptions.splice(this.store.db.prescriptions.indexOf(rx), 1);
    this.store.completeConsultation(c, rx.items.length ? rx : undefined);
    this.review.set(false); this.cons.set({ ...c }); this.cons.set(c);
    const bits = [rx.items.length ? 'prescription sent to pharmacy' : '', this.tests().length ? `${this.tests().length} tests ordered` : '', c.followUpDate ? 'follow-up reminder scheduled' : ''].filter(Boolean).join(', ');
    this.toast.ok(`Consultation signed${bits ? ': ' + bits : ''}`);
  }
  nextPatient() { const n = this.worklist().find(r => r.patientId !== this.patientId() && r.state !== 'Completed'); if (n) this.open(n.patientId); else { this.toast.info('No more patients waiting'); this.router.navigate(['/consultation']); } }
  print() { this.printer.print(); }
}
