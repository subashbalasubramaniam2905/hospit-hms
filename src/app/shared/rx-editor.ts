import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { MatTooltipModule } from '@angular/material/tooltip';
import { StoreService } from '../core/services/store.service';
import { LabOrder, Medicine, Patient, RxItem } from '../core/models';
import { DURATIONS, FOOD, FREQUENCIES, SafetyAlert, safetyCheck } from '../core/data/clinical';

/** Editable medicine list with demo safety screening. Mutates the given items array. */
@Component({
  selector: 'cf-rx-editor', standalone: true, imports: [FormsModule, LucideAngularModule, MatTooltipModule],
  styles: [`
    .add { position:relative }
    .drop { position:absolute; z-index:20; left:0; right:0; top:calc(100% + 4px); background:var(--card); border:1px solid var(--line); border-radius:12px; box-shadow:0 12px 30px rgba(0,0,0,.12); max-height:280px; overflow:auto }
    .drop button { width:100%; display:flex; gap:10px; align-items:center; padding:9px 12px; border:0; background:none; text-align:left; border-bottom:1px solid var(--line); color:var(--fg) }
    .drop button:hover, .drop button.hl { background:var(--ground) }
    .drop small { color:var(--mut); display:block; font-size:12px }
    .line { border:1px solid var(--line); border-radius:12px; padding:10px 12px; display:grid; grid-template-columns:repeat(auto-fit,minmax(118px,1fr)); gap:8px; align-items:end }
    .line .nm { grid-column:1/-1; display:flex; align-items:center; gap:10px } .line .nm > div { flex:1 } .line .q { max-width:100% }
    .line.bad { border-color:var(--red); background:color-mix(in srgb,var(--red-soft) 50%,var(--card)) }
    .line .nm b { display:block } .line .nm small { color:var(--mut); font-size:12px }
    .line label { font-size:11.5px; color:var(--mut); font-weight:600; display:block; margin-bottom:3px }
    .line .inp { padding:7px 9px; font-size:13px }
    .lines { display:flex; flex-direction:column; gap:8px }
  `],
  template: `
  <div class="stack-s">
    <div class="add">
      <label class="search boxed"><lucide-icon name="pill" [size]="16"></lucide-icon>
        <input [(ngModel)]="q" (keydown.enter)="pickFirst()" placeholder="Add medicine: type generic or brand name (e.g. metformin, Telma)" aria-label="Search medicines" [disabled]="readonly"></label>
      @if (q.length > 1) {
        <div class="drop">
          @for (m of results(); track m.id; let i = $index) {
            <button [class.hl]="i === 0" (click)="add(m)"><lucide-icon name="pill" [size]="15"></lucide-icon><div style="flex:1"><b>{{ m.generic }} {{ m.strength }}</b><small>{{ m.brand }} · {{ m.form }} · {{ m.category }}</small></div>
              <span class="st" [class.ok]="store.stock(m) > m.reorder" [class.a]="store.stock(m) <= m.reorder && store.stock(m) > 0" [class.r]="!store.stock(m)">{{ store.stock(m) ? store.stock(m) + ' in stock' : 'Out of stock' }}</span></button>
          } @empty { <div style="padding:12px" class="muted small">No medicine matches "{{ q }}" in the formulary.</div> }
        </div>
      }
    </div>

    @if (alerts().length) {
      <div class="stack-s" role="alert">
        @for (a of alerts(); track a.title) {
          <div class="alert-box" [class.crit]="a.level === 'crit'" [class.warn]="a.level === 'warn'" [class.info]="a.level === 'info'">
            <lucide-icon [name]="a.level === 'crit' ? 'shield-alert' : 'triangle-alert'" [size]="16"></lucide-icon>
            <div style="flex:1"><b>{{ a.kind }}: {{ a.title }}</b><div>{{ a.detail }}</div></div><span class="demo-tag">Demo alert</span>
          </div>
        }
        <p class="hint">Demo alerts, not validated clinical decision support. The prescribing doctor remains responsible for every medicine.</p>
      </div>
    }

    <div class="lines">
      @for (it of items; track $index; let i = $index) {
        <div class="line" [class.bad]="isBad(it)">
          <div class="nm"><div><b>{{ it.name }} {{ it.strength }}</b><small>{{ it.generic }} · {{ it.route }}</small></div>
            @if (store.med(it.medId); as m) { @if (store.stock(m) < it.qty) { <span class="st r">Only {{ store.stock(m) }} in stock</span> } }
            @if (!readonly) { <button class="iconbtn" (click)="remove(i)" aria-label="Remove" matTooltip="Remove"><lucide-icon name="trash-2" [size]="15"></lucide-icon></button> }</div>
          <div><label>Dose</label><input class="inp" [(ngModel)]="it.dose" (ngModelChange)="emit()" [disabled]="readonly"></div>
          <div><label>Frequency</label><select class="inp" [(ngModel)]="it.frequency" (ngModelChange)="recalc(it)" [disabled]="readonly">@for (f of freqs; track f) {<option>{{ f }}</option>}</select></div>
          <div><label>Duration</label><select class="inp" [(ngModel)]="it.duration" (ngModelChange)="recalc(it)" [disabled]="readonly">@for (d of durs; track d) {<option>{{ d }}</option>}</select></div>
          <div><label>Timing</label><select class="inp" [(ngModel)]="it.food" (ngModelChange)="emit()" [disabled]="readonly">@for (f of food; track f) {<option>{{ f }}</option>}</select></div>
          <div><label>Qty</label><input class="inp" type="number" min="1" [(ngModel)]="it.qty" (ngModelChange)="emit()" [disabled]="readonly"></div>
          <div style="grid-column:1/-1"><input class="inp" [(ngModel)]="it.instructions" (ngModelChange)="emit()" placeholder="Instructions for the patient (optional)" [disabled]="readonly"></div>
        </div>
      } @empty {
        <div class="soft muted small" style="text-align:center;padding:18px">No medicines yet. Search above to add one.</div>
      }
    </div>
  </div>`
})
export class RxEditorComponent {
  store = inject(StoreService);
  @Input() items: RxItem[] = [];
  @Input() patient?: Patient;
  @Input() labs: LabOrder[] = [];
  @Input() readonly = false;
  @Output() changed = new EventEmitter<SafetyAlert[]>();
  q = ''; freqs = FREQUENCIES; durs = DURATIONS; food = FOOD;

  results() { const q = this.q.toLowerCase(); return this.store.db.medicines.filter(m => (m.generic + ' ' + m.brand).toLowerCase().includes(q)).slice(0, 8); }
  alerts() { return safetyCheck(this.patient, this.items, this.labs); }
  isBad(it: RxItem) { return this.alerts().some(a => a.level === 'crit' && a.meds.includes(it.name)); }
  pickFirst() { const r = this.results(); if (r[0]) this.add(r[0]); }
  add(m: Medicine) {
    const inj = m.form === 'Injection' || m.form === 'IV fluid', topical = ['Cream', 'Ointment'].includes(m.form), inh = m.form === 'Inhaler';
    const it: RxItem = { medId: m.id, name: m.brand, generic: m.generic, strength: m.strength, dose: inj ? '1 vial' : topical ? 'Thin layer' : inh ? '2 puffs' : m.form === 'Syrup' ? '5 ml' : '1 tablet',
      route: m.route, frequency: topical ? 'Twice daily (1-0-1)' : 'Once daily (1-0-0)', duration: '5 days', qty: 5, food: topical || inj ? 'Not applicable' : 'After food', instructions: '', refills: 0 };
    this.items.push(it); this.recalc(it); this.q = '';
  }
  remove(i: number) { this.items.splice(i, 1); this.emit(); }
  recalc(it: RxItem) {
    const perDay: Record<string, number> = { 'Once daily (1-0-0)': 1, 'At night (0-0-1)': 1, 'Twice daily (1-0-1)': 2, 'Three times daily (1-1-1)': 3, 'Four times daily': 4, 'Every 6 hours': 4, 'As needed (SOS)': 1, 'Weekly': 1 / 7, 'Stat (once)': 0 };
    const days: Record<string, number> = { '1 day': 1, '3 days': 3, '5 days': 5, '7 days': 7, '10 days': 10, '14 days': 14, '1 month': 30, '3 months': 90, 'Until review': 30, 'Continue': 30 };
    if (/tablet|capsule/i.test(it.dose) || /^\d/.test(it.dose)) it.qty = Math.max(1, Math.ceil((perDay[it.frequency] ?? 1) * (days[it.duration] ?? 5)) || 1);
    this.emit();
  }
  emit() { this.changed.emit(this.alerts()); }
}
