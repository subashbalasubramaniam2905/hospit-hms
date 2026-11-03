import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ExportService } from '../../core/services/export.service';
import { Invoice, PayMode, Prescription } from '../../core/models';
import { safetyCheck } from '../../core/data/clinical';

interface Line { medId: string; name: string; generic: string; strength: string; sig: string; want: number; qty: number; sub?: string; }

@Component({
  standalone: true, imports: [SHARED],
  styles: [`
    .lay { display:grid; grid-template-columns:320px minmax(0,1fr); gap:16px; align-items:start }
    .q .li { cursor:pointer; border-radius:10px; padding:10px; border-bottom:0 } .q .li:hover { background:var(--ground) } .q .li.on { background:var(--pri-soft) }
    table.t td { vertical-align:top }
    .plan { font-size:12px; color:var(--mut) }
    .lbl { border:1px dashed var(--line); border-radius:10px; padding:10px 12px; font-size:12.5px; background:#fff; color:#17211f }
    .labels { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:10px }
    @media (max-width:960px){ .lay { grid-template-columns:minmax(0,1fr) } }
  `],
  template: `
  <div class="page">
    <cf-page-head title="Dispensing" [crumbs]="['Pharmacy', 'Dispense']" sub="Prescriptions arrive here when a doctor signs them. Batches are picked first-expiry-first-out."></cf-page-head>
    <div class="lay">
      <div class="card q">
        <div class="card-h"><h3>Waiting</h3><span class="r st a">{{ queue().length }}</span></div>
        <div class="list">@for (r of queue(); track r.id) {
          <div class="li" [class.on]="sel()?.id === r.id" (click)="pick(r)" (keydown.enter)="pick(r)" tabindex="0" role="button">
            <cf-avatar [name]="store.pname(r.patientId)"></cf-avatar><div class="grow"><b>{{ store.pname(r.patientId) }}</b><span>{{ r.id }} · {{ r.items.length }} items · {{ store.dname(r.doctorId) }}</span></div><cf-status [s]="r.status === 'Partially dispensed' ? 'Partially dispensed' : 'Waiting'"></cf-status>
          </div>
        } @empty { <cf-empty icon="pill" title="Queue is clear" text="New prescriptions will appear here."></cf-empty> }</div>
        <div class="section-title" style="margin-top:10px">Dispensed today</div>
        <div class="list">@for (r of doneToday(); track r.id) { <div class="li"><div class="grow"><b>{{ store.pname(r.patientId) }}</b><span>{{ r.id }}</span></div><cf-status [s]="r.status"></cf-status></div> } @empty { <p class="muted small">None yet.</p> }</div>
      </div>

      @if (sel(); as r) {
      <div class="stack">
        <div class="card">
          <div class="row"><cf-avatar [name]="store.pname(r.patientId)" size="lg"></cf-avatar><div style="flex:1"><h3 style="font-size:17px">{{ store.pname(r.patientId) }}</h3><div class="muted small">{{ r.patientId }} · Rx {{ r.id }} · {{ store.dname(r.doctorId) }} · {{ r.date | d:true }}</div></div>
            @for (a of store.patient(r.patientId)?.allergies; track a) {<span class="st r">{{ a }} allergy</span>}</div>
          @if (r.notes) { <div class="soft small" style="margin-top:10px">{{ r.notes }}</div> }
          @for (a of alerts(); track a.title) { <div class="alert-box" [class.crit]="a.level === 'crit'" [class.warn]="a.level !== 'crit'" style="margin-top:10px"><lucide-icon name="shield-alert" [size]="16"></lucide-icon><div style="flex:1"><b>{{ a.title }}</b><div>{{ a.detail }}</div></div><span class="demo-tag">Demo alert</span></div> }
        </div>
        <div class="card">
          <div class="tbl"><table class="t">
            <thead><tr><th>Medicine</th><th>Directions</th><th class="num">Prescribed</th><th>Dispense</th><th>Batches (FEFO)</th><th class="num">Amount</th></tr></thead>
            <tbody>@for (l of lines(); track l.medId; let i = $index) {
              <tr>
                <td><b>{{ l.name }} {{ l.strength }}</b><div class="small muted">{{ l.generic }}</div>@if (l.sub) {<span class="st v">Substituted</span>}</td>
                <td class="small">{{ l.sig }}</td><td class="num">{{ l.want }}</td>
                <td><input class="inp" type="number" min="0" style="width:84px" [(ngModel)]="l.qty" (ngModelChange)="bump()"></td>
                <td class="plan">@for (p of plan(l); track p.batch) {<div>{{ p.batch }} × {{ p.take }} · exp {{ p.expiry | d }}</div>}
                  @if (short(l) > 0) { <div style="color:var(--red);font-weight:600">Short by {{ short(l) }}</div>
                    @if (alt(l); as a) { <button class="linkbtn small" (click)="substitute(l, a.id)">Use {{ a.brand }} ({{ store.stock(a) }} in stock)</button> } }</td>
                <td class="num">{{ amount(l) | inr }}</td>
              </tr>
            }</tbody>
            <tfoot><tr><td colspan="5" class="num"><b>Total incl. 12% GST</b></td><td class="num"><b>{{ total() | inr }}</b></td></tr></tfoot>
          </table></div>
          <div class="row" style="margin-top:14px">
            <span class="small muted">Payment</span>@for (m of modes; track m) {<button class="chip" [class.on]="mode() === m" (click)="mode.set(m)">{{ m }}</button>}
            <span class="spacer"></span>
            <mat-checkbox [(ngModel)]="counselled">Patient counselled on dose and timing</mat-checkbox>
            <button class="btn" [disabled]="!counselled || !total()" (click)="dispense(r)"><lucide-icon name="hand-coins" [size]="16"></lucide-icon>Dispense and bill {{ total() | inr }}</button>
          </div>
        </div>
      </div>
      } @else { <div class="card"><cf-empty icon="pill" title="Pick a prescription" text="Choose one from the waiting list to start dispensing."></cf-empty></div> }
    </div>
  </div>

  <cf-modal [open]="!!receipt()" title="Dispensed" width="min(720px,100%)" (closed)="receipt.set(null)">
    @if (receipt(); as inv) {
      <div class="alert-box ok"><lucide-icon name="circle-check" [size]="16"></lucide-icon>{{ inv.id }} paid by {{ inv.payments[0]?.mode }} · {{ store.invoiceTotals(inv).total | inr }}. Stock updated.</div>
      <div class="section-title">Medicine labels</div>
      <div class="labels">@for (l of lastLines; track l.medId) { @if (l.qty) {
        <div class="lbl doc" style="padding:10px 12px;gap:4px"><b>{{ l.name }} {{ l.strength }}</b><div>{{ l.sig }}</div><div style="color:#6f7d79">{{ store.pname(inv.patientId) }} · Qty {{ l.qty }}</div><div style="color:#b45309;font-size:10.5px;font-weight:700">DEMO LABEL</div></div> } }</div>
    }
    <div foot><button class="btn ghost" (click)="printer.printDoc()"><lucide-icon name="printer" [size]="16"></lucide-icon>Print labels</button>@if (receipt(); as inv) {<a class="btn ghost" [routerLink]="['/billing/invoice', inv.id]">View invoice</a>}<button class="btn" (click)="receipt.set(null)">Next prescription</button></div>
  </cf-modal>`
})
export class DispensePage {
  store = inject(StoreService); toast = inject(ToastService); printer = inject(ExportService);
  modes: PayMode[] = ['Cash', 'UPI', 'Card', 'Insurance'];
  sel = signal<Prescription | null>(null); lines = signal<Line[]>([]); mode = signal<PayMode>('UPI'); rev = signal(0); receipt = signal<Invoice | null>(null);
  counselled = false; lastLines: Line[] = [];

  constructor() {
    const q = inject(ActivatedRoute).snapshot.queryParamMap;
    const r = this.store.db.prescriptions.find(x => x.id === q.get('rx')) ?? this.queue().find(x => x.patientId === q.get('patient')) ?? this.queue()[0];
    if (r) this.pick(r);
  }
  queue = computed(() => { this.store.rev(); return this.store.db.prescriptions.filter(r => r.status === 'Sent to pharmacy' || r.status === 'Partially dispensed'); });
  doneToday = computed(() => { this.store.rev(); return this.store.db.prescriptions.filter(r => r.status === 'Dispensed' && r.date === this.store.today()).slice(0, 5); });
  alerts = computed(() => { this.rev(); const r = this.sel(); return r ? safetyCheck(this.store.patient(r.patientId), r.items, this.store.db.labOrders.filter(o => o.patientId === r.patientId)) : []; });
  total = computed(() => { this.rev(); return this.lines().reduce((t, l) => t + this.amount(l), 0); });

  pick(r: Prescription) {
    this.sel.set(r); this.counselled = false;
    this.lines.set(r.items.map(i => ({ medId: i.medId, name: i.name, generic: i.generic, strength: i.strength, sig: `${i.dose}, ${i.frequency}, ${i.duration}, ${i.food}`, want: i.qty, qty: Math.min(i.qty, this.avail(i.medId)) })));
    this.bump();
  }
  avail(id: string) { const m = this.store.med(id); return m ? this.store.fefo(id, 99999).reduce((t, p) => t + p.take, 0) : 0; }
  plan(l: Line) { return this.store.fefo(l.medId, l.qty || 0); }
  short(l: Line) { return l.want - this.avail(l.medId) > 0 ? l.want - this.avail(l.medId) : 0; }
  alt(l: Line) { const m = this.store.med(l.medId); return this.store.db.medicines.find(x => x.id !== l.medId && x.generic === m?.generic && x.strength === m?.strength && this.store.stock(x) > 0) ?? this.store.db.medicines.find(x => x.id !== l.medId && x.generic === m?.generic && this.store.stock(x) >= l.want); }
  amount(l: Line) { const m = this.store.med(l.medId); return m ? Math.round((l.qty || 0) * m.price * 1.12) : 0; }
  substitute(l: Line, id: string) { const m = this.store.med(id)!; l.sub = l.medId; l.medId = id; l.name = m.brand; l.strength = m.strength; l.qty = Math.min(l.want, this.avail(id)); this.bump(); this.toast.info(`Substituted with ${m.brand}. Same generic, logged for the doctor.`); }
  bump() { this.rev.update(v => v + 1); }
  dispense(r: Prescription) {
    this.lastLines = this.lines().map(l => ({ ...l }));
    const inv = this.store.dispense(r, this.lines().map(l => ({ medId: l.medId, qty: +l.qty || 0 })), this.mode());
    this.receipt.set(inv); this.toast.ok(`${r.id} ${r.status === 'Dispensed' ? 'dispensed' : 'partly dispensed'} for ${this.store.pname(r.patientId)}`);
    const next = this.queue()[0]; if (next) this.pick(next); else { this.sel.set(null); this.lines.set([]); }
  }
}
