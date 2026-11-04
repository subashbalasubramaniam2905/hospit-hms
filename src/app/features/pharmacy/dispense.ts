import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { ExportService } from '../../core/services/export.service';
import { Invoice, PayMode, Prescription } from '../../core/models';
import { safetyCheck } from '../../core/data/clinical';
import { SessionService } from '../../core/services/session.service';
import { PharmacyApi, DispenseSummary } from '../../core/api/pharmacy-api';
import { LiveSync } from '../../core/api/live-sync';
import { apiMessage } from '../../core/api/auth.service';

interface Receipt { invoiceId: string; number: string; mode: string; total: number; patientId: string; }
interface Line { orig: string; medId: string; name: string; generic: string; strength: string; sig: string; want: number; qty: number; sub?: string; }

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
            <cf-avatar [name]="store.pname(r.patientId)"></cf-avatar><div class="grow"><b>{{ store.pname(r.patientId) }}</b><span>{{ ref(r) }} · {{ r.items.length }} items · {{ store.dname(r.doctorId) }}</span></div><cf-status [s]="r.status === 'Partially dispensed' ? 'Partially dispensed' : 'Waiting'"></cf-status>
          </div>
        } @empty { <cf-empty icon="pill" title="Queue is clear" text="New prescriptions will appear here."></cf-empty> }</div>
        <div class="section-title" style="margin-top:10px">Dispensed today</div>
        <div class="list">@for (r of doneToday(); track r.id) { <div class="li"><div class="grow"><b>{{ r.name || store.pname(r.patientId) }}</b><span>{{ r.ref }}</span></div><cf-status [s]="r.status"></cf-status></div> } @empty { <p class="muted small">None yet.</p> }</div>
      </div>

      @if (sel(); as r) {
      <div class="stack">
        <div class="card">
          <div class="row"><cf-avatar [name]="store.pname(r.patientId)" size="lg"></cf-avatar><div style="flex:1"><h3 style="font-size:17px">{{ store.pname(r.patientId) }}</h3><div class="muted small">{{ r.patientId }} · {{ ref(r) }} · {{ store.dname(r.doctorId) }} · {{ r.date | d:true }}</div></div>
            @for (a of store.patient(r.patientId)?.allergies; track a) {<span class="st r">{{ a }} allergy</span>}</div>
          @if (r.notes) { <div class="soft small" style="margin-top:10px">{{ r.notes }}</div> }
          @for (a of alerts(); track a.title) { <div class="alert-box" [class.crit]="a.level === 'crit'" [class.warn]="a.level !== 'crit'" style="margin-top:10px"><lucide-icon name="shield-alert" [size]="16"></lucide-icon><div style="flex:1"><b>{{ a.title }}</b><div>{{ a.detail }}</div></div>@if (!live) {<span class="demo-tag">Demo alert</span>}</div> }
        </div>
        <div class="card">
          <div class="tbl"><table class="t">
            <thead><tr><th>Medicine</th><th>Directions</th><th class="num">Prescribed</th><th>Dispense</th><th>Batches (FEFO)</th><th class="num">Amount</th></tr></thead>
            <tbody>@for (l of lines(); track l.orig; let i = $index) {
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
            <button class="btn" [disabled]="!counselled || !total() || busy()" (click)="dispense(r)"><lucide-icon name="hand-coins" [size]="16"></lucide-icon>Dispense and bill {{ total() | inr }}</button>
          </div>
        </div>
      </div>
      } @else { <div class="card"><cf-empty icon="pill" title="Pick a prescription" text="Choose one from the waiting list to start dispensing."></cf-empty></div> }
    </div>
  </div>

  <cf-modal [open]="!!receipt()" title="Dispensed" width="min(720px,100%)" (closed)="receipt.set(null)">
    @if (receipt(); as inv) {
      <div class="alert-box ok"><lucide-icon name="circle-check" [size]="16"></lucide-icon>{{ inv.number }} paid by {{ inv.mode }} · {{ inv.total | inr }}. Stock updated.</div>
      <div class="section-title">Medicine labels</div>
      <div class="labels">@for (l of lastLines; track l.medId) { @if (l.qty) {
        <div class="lbl doc" style="padding:10px 12px;gap:4px"><b>{{ l.name }} {{ l.strength }}</b><div>{{ l.sig }}</div><div style="color:#6f7d79">{{ store.pname(inv.patientId) }} · Qty {{ l.qty }}</div>@if (!live) {<div style="color:#b45309;font-size:10.5px;font-weight:700">DEMO LABEL</div>}</div> } }</div>
    }
    <div foot><button class="btn ghost" (click)="printer.printDoc()"><lucide-icon name="printer" [size]="16"></lucide-icon>Print labels</button>@if (receipt(); as inv) {<a class="btn ghost" [routerLink]="['/billing/invoice', inv.invoiceId]">View invoice</a>}<button class="btn" (click)="receipt.set(null)">Next prescription</button></div>
  </cf-modal>`
})
export class DispensePage {
  store = inject(StoreService); toast = inject(ToastService); printer = inject(ExportService); session = inject(SessionService);
  private api = inject(PharmacyApi); private sync = inject(LiveSync);
  live = this.session.live;
  modes: PayMode[] = ['Cash', 'UPI', 'Card', 'Insurance'];
  sel = signal<Prescription | null>(null); lines = signal<Line[]>([]); mode = signal<PayMode>('UPI'); rev = signal(0); receipt = signal<Receipt | null>(null);
  busy = signal(false); liveQueue = signal<Prescription[]>([]); liveDone = signal<DispenseSummary[]>([]);
  counselled = false; lastLines: Line[] = [];
  private q = inject(ActivatedRoute).snapshot.queryParamMap;

  constructor() {
    if (this.live) {
      // Reload the queue and this branch's stock whenever the branch changes.
      effect(() => { const b = this.session.branchId(); untracked(() => this.reload(b, true)); });
      return;
    }
    const r = this.store.db.prescriptions.find(x => x.id === this.q.get('rx')) ?? this.queue().find(x => x.patientId === this.q.get('patient')) ?? this.queue()[0];
    if (r) this.pick(r);
  }
  /** Live mode: prescriptions waiting in this branch, today's dispenses and current stock. */
  async reload(branch = this.session.branchId(), first = false) {
    try {
      const [sent, partial, done] = await Promise.all([this.api.prescriptions('Sent to pharmacy'), this.api.prescriptions('Partially dispensed'),
        this.api.dispensesToday(branch), this.sync.loadPharmacy(branch)]);
      this.liveQueue.set([...sent, ...partial].filter(r => (r as Prescription & { branchId?: string }).branchId === branch));
      this.liveDone.set(done);
      const keep = this.liveQueue().find(x => x.id === this.sel()?.id);
      const r = first ? (this.liveQueue().find(x => x.id === this.q.get('rx')) ?? this.liveQueue().find(x => x.patientId === this.q.get('patient'))) : keep;
      const next = r ?? this.liveQueue()[0];
      if (next) this.pick(next); else { this.sel.set(null); this.lines.set([]); }
    } catch (e) { this.toast.err(apiMessage(e, 'Could not load the pharmacy queue')); }
  }
  queue = computed(() => { this.store.rev(); return this.live ? this.liveQueue() : this.store.db.prescriptions.filter(r => r.status === 'Sent to pharmacy' || r.status === 'Partially dispensed'); });
  doneToday = computed(() => {
    this.store.rev();
    if (this.live) return this.liveDone().slice(0, 5).map(d => ({ id: d.id, patientId: d.patientId, name: d.patientName, ref: d.invoiceNumber, status: d.partial ? 'Partially dispensed' : 'Dispensed' }));
    return this.store.db.prescriptions.filter(r => r.status === 'Dispensed' && r.date === this.store.today()).slice(0, 5).map(r => ({ id: r.id, patientId: r.patientId, name: '', ref: r.id, status: r.status as string }));
  });
  alerts = computed(() => { this.rev(); const r = this.sel(); return r ? safetyCheck(this.store.patient(r.patientId), r.items, this.store.db.labOrders.filter(o => o.patientId === r.patientId)) : []; });
  total = computed(() => { this.rev(); return this.lines().reduce((t, l) => t + this.amount(l), 0); });

  pick(r: Prescription) {
    this.sel.set(r); this.counselled = false;
    this.lines.set(r.items.map(i => ({ orig: i.medId, medId: i.medId, name: i.name, generic: i.generic, strength: i.strength, sig: `${i.dose}, ${i.frequency}, ${i.duration}, ${i.food}`, want: i.qty, qty: Math.min(i.qty, this.avail(i.medId)) })));
    this.bump();
    // Live mode: after a partial dispense only the balance is still to be handed out.
    if (this.live && r.status === 'Partially dispensed') this.api.remaining(r.id).then(left => {
      if (this.sel()?.id !== r.id) return;
      this.lines.update(ls => ls.map(l => ({ ...l, want: left[l.orig] ?? l.want, qty: Math.min(left[l.orig] ?? l.want, this.avail(l.medId)) }))); this.bump();
    }).catch(() => { /* keep the prescribed quantities; the server still enforces the balance */ });
  }
  avail(id: string) { const m = this.store.med(id); return m ? this.store.fefo(id, 99999).reduce((t, p) => t + p.take, 0) : 0; }
  plan(l: Line) { return this.store.fefo(l.medId, l.qty || 0); }
  short(l: Line) { return l.want - this.avail(l.medId) > 0 ? l.want - this.avail(l.medId) : 0; }
  alt(l: Line) { const m = this.store.med(l.medId); return this.store.db.medicines.find(x => x.id !== l.medId && x.generic === m?.generic && x.strength === m?.strength && this.store.stock(x) > 0) ?? this.store.db.medicines.find(x => x.id !== l.medId && x.generic === m?.generic && this.store.stock(x) >= l.want); }
  amount(l: Line) { const m = this.store.med(l.medId); return m ? Math.round((l.qty || 0) * m.price * 1.12) : 0; }
  substitute(l: Line, id: string) { const m = this.store.med(id)!; l.sub = l.orig; l.medId = id; l.name = m.brand; l.strength = m.strength; l.qty = Math.min(l.want, this.avail(id)); this.bump(); this.toast.info(`Substituted with ${m.brand}. Same generic, logged for the doctor.`); }
  /** Server prescription ids are UUIDs; show the short reference also used on stock movements. */
  ref(r: Prescription) { return this.live ? 'RX-' + r.id.slice(0, 8).toUpperCase() : r.id; }
  bump() { this.rev.update(v => v + 1); }
  async dispense(r: Prescription) {
    this.lastLines = this.lines().map(l => ({ ...l }));
    if (this.live) {
      this.busy.set(true);
      try {
        const res = await this.api.dispense(r.id, this.mode(), this.counselled,
          this.lines().map(l => ({ medicineId: l.medId, qty: +l.qty || 0, substitutedFor: l.sub })));
        this.receipt.set({ invoiceId: res.invoiceId, number: res.invoiceNumber, mode: res.payMode, total: res.total, patientId: res.patientId });
        this.toast.ok(`${res.partial ? 'Partly dispensed' : 'Dispensed'} for ${this.store.pname(r.patientId)}`);
        res.lowStock.forEach(m => this.toast.warn(`${m.name} is below its reorder level (${m.stock} left)`));
        this.sel.set(null);
        await this.reload();
      } catch (e) { this.toast.err(apiMessage(e, 'Could not dispense this prescription')); await this.reload(); }
      finally { this.busy.set(false); }
      return;
    }
    const inv = this.store.dispense(r, this.lines().map(l => ({ medId: l.medId, qty: +l.qty || 0 })), this.mode());
    this.receipt.set({ invoiceId: inv.id, number: inv.id, mode: inv.payments[0]?.mode ?? this.mode(), total: this.store.invoiceTotals(inv).total, patientId: inv.patientId });
    this.toast.ok(`${r.id} ${r.status === 'Dispensed' ? 'dispensed' : 'partly dispensed'} for ${this.store.pname(r.patientId)}`);
    const next = this.queue()[0]; if (next) this.pick(next); else { this.sel.set(null); this.lines.set([]); }
  }
}
