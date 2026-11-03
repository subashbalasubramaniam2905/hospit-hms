import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ExportService } from '../../core/services/export.service';
import { ToastService } from '../../core/services/toast.service';
import { Consultation } from '../../core/models';

@Component({
  standalone: true, imports: [SHARED],
  styles: [`
    .lay { display:grid; grid-template-columns:280px minmax(0,1fr); gap:16px; align-items:start }
    .pick .li { cursor:pointer; border-radius:10px; padding:10px; border-bottom:0 } .pick .li:hover { background:var(--ground) } .pick .li.on { background:var(--pri-soft) }
    .cmp { display:grid; grid-template-columns:150px 1fr 1fr; border:1px solid var(--line); border-radius:12px; overflow:hidden }
    .cmp > div { padding:10px 12px; border-bottom:1px solid var(--line); font-size:13.5px; white-space:pre-line; min-width:0 }
    .cmp .h { background:var(--ground); font-weight:700 } .cmp .k { color:var(--mut); font-weight:600; font-size:12.5px; background:color-mix(in srgb,var(--ground) 50%,var(--card)) }
    .cmp .diff { background:color-mix(in srgb,var(--amber-soft) 70%,var(--card)) }
    .up { color:var(--red); font-weight:700 } .down { color:var(--green); font-weight:700 }
    @media (max-width:960px){ .lay { grid-template-columns:minmax(0,1fr) } .cmp { grid-template-columns:110px 1fr 1fr; font-size:12.5px } }
  `],
  template: `
  @if (p(); as p) {
  <div class="page">
    <cf-page-head title="Clinical notes" [crumbs]="['Clinical', p.name]" [sub]="visits().length + ' consultations on record. Pick two to compare.'">
      <a class="btn ghost" [routerLink]="['/patients', p.id]"><lucide-icon name="user-round" [size]="16"></lucide-icon>Patient record</a>
      <button class="btn ghost" (click)="print()"><lucide-icon name="printer" [size]="16"></lucide-icon>Print</button>
      <a class="btn" [routerLink]="['/consultation', p.id]"><lucide-icon name="stethoscope" [size]="16"></lucide-icon>New consultation</a>
    </cf-page-head>
    <div class="lay">
      <div class="card pick">
        <div class="seg" style="margin-bottom:10px"><button [class.on]="mode() === 'view'" (click)="mode.set('view')">Read</button><button [class.on]="mode() === 'compare'" (click)="mode.set('compare')">Compare</button></div>
        <div class="list">@for (v of visits(); track v.id) {
          <div class="li" [class.on]="isSel(v.id)" (click)="pick(v.id)" (keydown.enter)="pick(v.id)" tabindex="0" role="button">
            <div class="grow"><b>{{ v.date | d:true }}</b><span>{{ store.dname(v.doctorId) }} · {{ v.template }}</span><span>{{ v.dx[0]?.label || v.cc }}</span></div>
            @if (mode() === 'compare') { <mat-checkbox [checked]="isSel(v.id)" (click)="$event.preventDefault()" aria-hidden="true"></mat-checkbox> } <cf-status [s]="v.status"></cf-status>
          </div>
        } @empty { <cf-empty icon="notebook-pen" title="No notes yet"></cf-empty> }</div>
      </div>

      @if (mode() === 'view') {
        @if (a(); as c) {
        <article class="card stack">
          <div class="row"><h3 style="font-size:17px">{{ c.date | d:true }} · {{ c.template }}</h3><span class="spacer"></span><cf-status [s]="c.status"></cf-status></div>
          <div class="muted small">{{ store.dname(c.doctorId) }} · {{ store.dept(store.doctor(c.doctorId)?.deptId)?.name }}</div>
          <div class="kv"><div><small>BP</small><b>{{ c.vitals.bp }}</b></div><div><small>Pulse</small><b>{{ c.vitals.hr }}</b></div><div><small>SpO₂</small><b>{{ c.vitals.spo2 }}%</b></div><div><small>Temp</small><b>{{ c.vitals.temp }}°F</b></div><div><small>Weight</small><b>{{ c.vitals.weight }} kg</b></div></div>
          @for (f of fields; track f.k) { @if (val(c, f.k)) { <div><div class="section-title">{{ f.label }}</div><p style="white-space:pre-line">{{ val(c, f.k) }}</p></div> } }
          <div><div class="section-title">Diagnosis</div><div class="chips">@for (d of c.dx; track d.code) {<span class="st b">{{ d.code }} · {{ d.label }}</span>}</div></div>
          @if (c.followUp) { <div class="soft small"><b>Follow-up:</b> {{ c.followUp }} @if (c.followUpDate) {({{ c.followUpDate | d:true }})}</div> }
          <p class="hint">Signed electronically in the prototype. Not a legal medical record.</p>
        </article>
        } @else { <div class="card"><cf-empty icon="notebook-pen" title="Choose a note"></cf-empty></div> }
      } @else {
        @if (a() && b()) {
        <div class="card">
          <div class="cmp">
            <div class="h"></div><div class="h">{{ a()!.date | d:true }}</div><div class="h">{{ b()!.date | d:true }}</div>
            @for (r of vitalRows(); track r.label) {
              <div class="k">{{ r.label }}</div><div>{{ r.a }}</div><div [class.diff]="r.a !== r.b">{{ r.b }} @if (r.trend === 'up') {<span class="up">▲</span>} @if (r.trend === 'down') {<span class="down">▼</span>}</div>
            }
            @for (f of fields; track f.k) {
              <div class="k">{{ f.label }}</div><div>{{ val(a()!, f.k) || '—' }}</div><div [class.diff]="val(a()!, f.k) !== val(b()!, f.k)">{{ val(b()!, f.k) || '—' }}</div>
            }
            <div class="k">Diagnosis</div><div>{{ dx(a()!) }}</div><div [class.diff]="dx(a()!) !== dx(b()!)">{{ dx(b()!) }}</div>
          </div>
          <p class="hint" style="margin-top:8px">Highlighted cells changed between the two visits. Arrows show rises and falls in vitals.</p>
        </div>
        } @else { <div class="card"><cf-empty icon="git-branch" title="Select two notes to compare" text="Tick two consultations from the list."></cf-empty></div> }
      }
    </div>
  </div>
  } @else { <cf-empty icon="user-x" title="Patient not found"></cf-empty> }`
})
export class ClinicalNotesPage {
  printer = inject(ExportService);
  store = inject(StoreService); toast = inject(ToastService);
  patientId = input<string>('');
  mode = signal<'view' | 'compare'>('view'); sel = signal<string[]>([]);
  fields: { k: keyof Consultation; label: string }[] = [{ k: 'cc', label: 'Chief complaint' }, { k: 'hpi', label: 'History of present illness' }, { k: 'exam', label: 'Examination' }, { k: 'assessment', label: 'Assessment' }, { k: 'plan', label: 'Plan' }, { k: 'meds', label: 'Medicines at visit' }];
  p = computed(() => this.store.patient(this.patientId()));
  visits = computed(() => { this.store.rev(); return this.store.db.consultations.filter(c => c.patientId === this.patientId()).sort((a, b) => b.date.localeCompare(a.date)); });
  constructor() { effect(() => { const v = this.visits(); untracked(() => this.sel.set(v.slice(0, 2).map(x => x.id).reverse())); }); }
  a = computed(() => this.visits().find(v => v.id === (this.mode() === 'view' ? this.sel()[this.sel().length - 1] : this.sel()[0])));
  b = computed(() => this.visits().find(v => v.id === this.sel()[1]));
  vitalRows = computed(() => {
    const a = this.a(), b = this.b(); if (!a || !b) return [];
    const rows: { label: string; a: string; b: string; trend?: string }[] = [];
    const num = (l: string, x: number | null, y: number | null, u = '') => rows.push({ label: l, a: `${x ?? '—'}${u}`, b: `${y ?? '—'}${u}`, trend: x != null && y != null ? (y > x ? 'up' : y < x ? 'down' : '') : '' });
    const sa = +a.vitals.bp.split('/')[0], sb = +b.vitals.bp.split('/')[0];
    rows.push({ label: 'Blood pressure', a: a.vitals.bp, b: b.vitals.bp, trend: sb > sa ? 'up' : sb < sa ? 'down' : '' });
    num('Pulse', a.vitals.hr, b.vitals.hr); num('Weight', a.vitals.weight, b.vitals.weight, ' kg'); num('SpO₂', a.vitals.spo2, b.vitals.spo2, '%');
    return rows;
  });
  isSel(id: string) { return this.sel().includes(id); }
  pick(id: string) {
    if (this.mode() === 'view') { this.sel.set([id]); return; }
    this.sel.update(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id].slice(-2));
    const v = this.visits(); this.sel.update(s => [...s].sort((x, y) => (v.find(q => q.id === x)?.date || '').localeCompare(v.find(q => q.id === y)?.date || '')));
  }
  val(c: Consultation, k: keyof Consultation) { return String(c[k] ?? '').trim(); }
  dx(c: Consultation) { return c.dx.map(d => `${d.code} ${d.label}`).join(', ') || '—'; }
  print() { this.printer.print(); }
}
