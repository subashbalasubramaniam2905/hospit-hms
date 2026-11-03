import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { LabOrder, LabParam } from '../../core/models';

@Component({
  standalone: true, imports: [SHARED],
  styles: [`
    .lay { display:grid; grid-template-columns:300px minmax(0,1fr); gap:16px; align-items:start }
    .wl .li { cursor:pointer; border-radius:10px; padding:10px; border-bottom:0 } .wl .li:hover { background:var(--ground) } .wl .li.on { background:var(--pri-soft) }
    table.t td { vertical-align:middle } .inp.v { width:110px; text-align:right; font-weight:700 }
    .inp.H { border-color:var(--amber); background:var(--amber-soft) } .inp.L { border-color:var(--blue); background:var(--blue-soft) } .inp.C { border-color:var(--red); background:var(--red-soft); color:var(--red) }
    @media (max-width:960px){ .lay { grid-template-columns:minmax(0,1fr) } }
  `],
  template: `
  <div class="page">
    <cf-page-head title="Result entry" [crumbs]="['Laboratory', 'Results']" sub="Enter values, review flags and verify. Critical values alert the doctor automatically."></cf-page-head>
    <div class="lay">
      <div class="card wl">
        <div class="seg" style="margin-bottom:8px"><button [class.on]="tab() === 'todo'" (click)="tab.set('todo')">To enter · {{ todo().length }}</button><button [class.on]="tab() === 'verify'" (click)="tab.set('verify')">To verify · {{ verify().length }}</button></div>
        <div class="list">@for (o of (tab() === 'todo' ? todo() : verify()); track o.id) {
          <div class="li" [class.on]="o.id === id()" (click)="open(o)" (keydown.enter)="open(o)" tabindex="0" role="button">
            <div class="grow"><b>{{ store.pname(o.patientId) }}</b><span>{{ o.id }} · {{ store.codes(o.testIds) }}</span></div>
            @if (store.criticals(o).length) {<span class="st r">Critical</span>} @else {<cf-status [s]="o.priority"></cf-status>}
          </div>
        } @empty { <p class="muted small">Nothing here.</p> }</div>
      </div>

      @if (order(); as o) {
      <div class="stack">
        <div class="card">
          <div class="row"><cf-avatar [name]="store.pname(o.patientId)" size="lg"></cf-avatar>
            <div style="flex:1"><h3 style="font-size:17px">{{ store.pname(o.patientId) }}</h3><div class="small muted">{{ o.id }} · Sample {{ o.sampleId || '—' }} · {{ store.dname(o.doctorId) }} · {{ store.patient(o.patientId)?.dob | age }} y {{ store.patient(o.patientId)?.gender }}</div></div>
            <cf-status [s]="o.status"></cf-status></div>
        </div>
        @for (tid of o.testIds; track tid) { @let t = store.test(tid);
          @if (t) {
          <div class="card">
            <div class="card-h"><h3>{{ t.name }}</h3><span class="r muted small">{{ t.sample }} · {{ t.category }}</span></div>
            <div class="tbl"><table class="t">
              <thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Reference</th><th>Flag</th><th>Previous</th></tr></thead>
              <tbody>@for (p of t.params; track p.name) {
                <tr><td><b>{{ p.name }}</b></td>
                  <td><input class="inp v {{ flag(o, tid, p) }}" type="number" step="any" [ngModel]="o.results[tid]?.[p.name]" (ngModelChange)="set(o, tid, p.name, $event)" [disabled]="locked()" [attr.aria-label]="p.name"></td>
                  <td class="muted">{{ p.unit }}</td><td class="muted">{{ p.low }}–{{ p.high }}</td>
                  <td>@switch (flag(o, tid, p)) { @case ('C') {<span class="st r">Critical</span>} @case ('H') {<span class="st a">High</span>} @case ('L') {<span class="st b">Low</span>} @case ('N') {<span class="st ok">Normal</span>} }</td>
                  <td class="muted small">{{ prev(o, tid, p.name) }}</td></tr>
              }</tbody>
            </table></div>
          </div> }
        }
        <div class="card stack-s">
          <div class="field"><label>Comments</label><textarea class="inp" [(ngModel)]="o.comments" [disabled]="locked()" placeholder="Technical comments, sample quality"></textarea></div>
          @if (crits().length) { <div class="alert-box crit"><lucide-icon name="siren" [size]="16"></lucide-icon><div><b>{{ crits().length }} critical value(s)</b><div>{{ critText() }}. Verifying will alert {{ store.dname(o.doctorId) }} immediately.</div></div></div> }
          <div class="row">
            @if (o.status === 'Processing' || o.status === 'Sample collected') { <button class="btn ghost" (click)="autofill(o)"><lucide-icon name="zap" [size]="16"></lucide-icon>Import from analyser (simulated)</button><span class="spacer"></span><button class="btn" [disabled]="!complete()" (click)="save(o)">Save results</button> }
            @if (o.status === 'Result ready') { <button class="btn ghost" (click)="reopen(o)">Edit values</button><span class="spacer"></span><button class="btn" (click)="verifyIt(o)"><lucide-icon name="badge-check" [size]="16"></lucide-icon>Verify as pathologist</button> }
            @if (o.status === 'Verified' || o.status === 'Delivered') { <span class="muted small">Verified by {{ o.verifiedBy }}</span><span class="spacer"></span><a class="btn" [routerLink]="['/lab/report', o.id]"><lucide-icon name="file-text" [size]="16"></lucide-icon>Open report</a> }
          </div>
        </div>
      </div>
      } @else { <div class="card"><cf-empty icon="clipboard-check" title="Choose an order" text="Pick an order from the worklist to enter results."></cf-empty></div> }
    </div>
  </div>`
})
export class ResultsPage {
  store = inject(StoreService); toast = inject(ToastService); router = inject(Router);
  id = input<string>(''); tab = signal<'todo' | 'verify'>('todo'); rev = signal(0);
  todo = computed(() => { this.store.rev(); return this.store.db.labOrders.filter(o => o.status === 'Processing' || o.status === 'Sample collected'); });
  verify = computed(() => { this.store.rev(); return this.store.db.labOrders.filter(o => o.status === 'Result ready'); });
  order = computed(() => { this.store.rev(); const id = this.id() || this.todo()[0]?.id || this.verify()[0]?.id; return this.store.db.labOrders.find(o => o.id === id); });
  locked = computed(() => { this.rev(); const s = this.order()?.status; return s === 'Result ready' || s === 'Verified' || s === 'Delivered'; });
  crits = computed(() => { this.rev(); const o = this.order(); return o ? this.store.criticals(o) : []; });
  critText = computed(() => this.crits().map(c => `${c.param} ${c.value} ${c.unit}`).join(', '));
  complete = computed(() => { this.rev(); const o = this.order(); if (!o) return false; return o.testIds.every(t => (this.store.test(t)?.params || []).every(p => o.results[t]?.[p.name] != null)); });

  open(o: LabOrder) { this.router.navigate(['/lab/results', o.id]); }
  set(o: LabOrder, tid: string, name: string, v: number | string) { o.results[tid] = o.results[tid] || {}; o.results[tid][name] = v === '' || v == null ? null : +v; this.rev.update(x => x + 1); }
  flag(o: LabOrder, tid: string, p: LabParam) { const v = o.results[tid]?.[p.name]; if (v == null) return ''; if ((p.critHigh != null && v >= p.critHigh) || (p.critLow != null && v <= p.critLow)) return 'C'; return v > p.high ? 'H' : v < p.low ? 'L' : 'N'; }
  prev(o: LabOrder, tid: string, name: string) { const x = this.store.db.labOrders.filter(y => y.id !== o.id && y.patientId === o.patientId && y.results[tid]?.[name] != null).sort((a, b) => b.date.localeCompare(a.date))[0]; return x ? `${x.results[tid][name]} (${x.date.slice(5)})` : '—'; }
  autofill(o: LabOrder) {
    o.testIds.forEach(tid => { const t = this.store.test(tid); if (!t) return; o.results[tid] = o.results[tid] || {}; t.params.forEach(p => { if (o.results[tid][p.name] == null) { const span = p.high - p.low; o.results[tid][p.name] = +(p.low + span * (0.2 + Math.random() * 0.75)).toFixed(span < 10 ? 1 : 0); } }); });
    this.rev.update(x => x + 1); this.toast.info('Values imported from the analyser interface (simulated). Check before saving.');
  }
  save(o: LabOrder) { this.store.saveResults(o); this.rev.update(x => x + 1); this.toast.ok('Results saved. Waiting for pathologist verification.'); this.tab.set('verify'); }
  reopen(o: LabOrder) { this.store.setLabStatus(o, 'Processing'); this.rev.update(x => x + 1); }
  verifyIt(o: LabOrder) {
    const c = this.store.verifyLab(o, 'Dr. Meghana Rao (Pathologist)'); this.rev.update(x => x + 1);
    if (c.length) this.toast.warn(`Verified. Critical alert sent to ${this.store.dname(o.doctorId)} for ${c.map(x => x.param).join(', ')}.`); else this.toast.ok('Verified. Report is ready to deliver.');
  }
}
