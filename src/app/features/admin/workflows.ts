import { Component, computed, inject, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { Workflow, WorkflowStep } from '../../core/models';

const PALETTE: Record<WorkflowStep['kind'], { label: string; detail: string }[]> = {
  trigger: [{ label: 'Appointment is booked', detail: 'Any department' }, { label: 'Patient checks in', detail: 'Kiosk or desk' }, { label: 'Lab result is verified', detail: 'Any test' }, { label: 'Invoice is overdue', detail: 'After 3 days' }, { label: 'Patient is discharged', detail: 'IPD' }, { label: 'Stock falls below reorder', detail: 'Pharmacy' }],
  condition: [{ label: 'If patient is over 60', detail: '' }, { label: 'If department is Cardiology', detail: '' }, { label: 'If not acknowledged in 15 min', detail: '' }, { label: 'If amount is over ₹10,000', detail: '' }, { label: 'If insurance is cashless', detail: '' }],
  action: [{ label: 'Send WhatsApp message', detail: 'Template' }, { label: 'Send SMS', detail: 'DLT template' }, { label: 'Notify staff in-app', detail: 'Role or person' }, { label: 'Raise alert', detail: 'Alerts centre' }, { label: 'Create follow-up task', detail: 'Due in 7 days' }, { label: 'Create purchase request', detail: 'Default supplier' }],
};

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.lay { display:grid; grid-template-columns:260px minmax(0,1fr) 260px; gap:16px; align-items:start } @media (max-width:1100px) { .lay { grid-template-columns:minmax(0,1fr) } }
  .wf { display:flex; gap:10px; align-items:center; width:100%; padding:10px 12px; border:0; border-radius:10px; background:none; text-align:left; color:var(--fg) } .wf.on { background:var(--pri-soft) }
  .canvas { background:radial-gradient(circle, var(--line) 1px, transparent 1px) 0 0/18px 18px; border-radius:var(--r); padding:24px; display:flex; flex-direction:column; align-items:center; gap:0; min-height:420px }
  .node { width:min(420px,100%); background:var(--card); border:1.5px solid var(--line); border-radius:14px; padding:12px 14px; display:flex; gap:12px; align-items:center; transition:box-shadow .2s, border-color .2s }
  .node.trigger { border-color:var(--pri) } .node.condition { border-color:var(--amber); border-style:dashed } .node.action { border-color:var(--blue) }
  .node.run { box-shadow:0 0 0 4px color-mix(in srgb,var(--green) 35%,transparent); border-color:var(--green) }
  .node .k { font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:.06em } .node input { border:0; background:none; font:inherit; font-weight:700; width:100%; color:var(--fg); padding:0 } .node input.d { font-weight:400; color:var(--mut); font-size:12.5px }
  .wire { width:2px; height:26px; background:var(--line) } .pal button { display:block; width:100%; text-align:left; padding:8px 10px; border-radius:8px; border:1px dashed var(--line); background:var(--card); margin-bottom:6px; font-size:13px; color:var(--fg) } .pal button:hover { border-color:var(--pri) }`],
  template: `
  <div class="page">
    <cf-page-head title="Workflow builder" [crumbs]="['Organisation', 'Automation']" sub="Automate routine follow-through: when something happens, check a condition, then act. Runs are simulated.">
      <button class="btn ghost" (click)="add()"><lucide-icon name="plus" [size]="16"></lucide-icon>New workflow</button>
    </cf-page-head>
    <div class="lay">
      <div class="card" style="padding:10px">
        @for (w of list(); track w.id) {<button class="wf" [class.on]="cur()?.id === w.id" (click)="selId.set(w.id)"><lucide-icon name="workflow" [size]="16"></lucide-icon><div class="grow"><b>{{ w.name }}</b><span>{{ w.runs }} runs @if (!w.enabled) {· off}</span></div></button>}
      </div>
      @if (cur(); as w) {
        <div class="card stack">
          <div class="row"><input class="inp" style="font-weight:800;font-size:16px;max-width:360px" [(ngModel)]="w.name" aria-label="Workflow name" (change)="store.changed()"><span class="spacer"></span>
            <mat-slide-toggle [checked]="w.enabled" (change)="toggle(w)">{{ w.enabled ? 'On' : 'Off' }}</mat-slide-toggle>
            <button class="btn ghost sm" [disabled]="running() >= 0" (click)="test(w)"><lucide-icon name="play" [size]="14"></lucide-icon>Test run</button>
            <button class="btn sm" (click)="save(w)"><lucide-icon name="save" [size]="14"></lucide-icon>Save</button></div>
          <div class="canvas">
            @for (s of w.steps; track $index; let i = $index, last = $last) {
              <div class="node {{ s.kind }}" [class.run]="running() === i">
                <lucide-icon [name]="s.kind === 'trigger' ? 'zap' : s.kind === 'condition' ? 'git-branch' : 'send'" [size]="18"></lucide-icon>
                <div class="grow"><div class="k" [style.color]="s.kind === 'trigger' ? 'var(--pri)' : s.kind === 'condition' ? 'var(--amber)' : 'var(--blue)'">{{ s.kind === 'trigger' ? 'When' : s.kind === 'condition' ? 'Only if' : 'Then' }}</div>
                  <input [(ngModel)]="s.label" [attr.aria-label]="'Step ' + (i + 1)"><input class="d" [(ngModel)]="s.detail" placeholder="Details" [attr.aria-label]="'Step ' + (i + 1) + ' details'"></div>
                <div class="row" style="gap:2px"><button class="iconbtn" [disabled]="i < 2" (click)="move(w, i, -1)" aria-label="Move up"><lucide-icon name="chevron-up" [size]="14"></lucide-icon></button><button class="iconbtn" [disabled]="i === 0 || last" (click)="move(w, i, 1)" aria-label="Move down"><lucide-icon name="chevron-down" [size]="14"></lucide-icon></button>
                  <button class="iconbtn" [disabled]="i === 0" (click)="remove(w, i)" aria-label="Remove step"><lucide-icon name="trash-2" [size]="14"></lucide-icon></button></div>
              </div>
              @if (!last) {<div class="wire"></div>}
            }
          </div>
          <div class="muted small">Last run {{ w.lastRun || 'never' }} · Steps run top to bottom. A failed condition stops the run.</div>
        </div>
        <div class="card pal">
          <div class="card-h"><h3>Add a step</h3></div>
          @if (!w.steps.length) {<div class="muted small" style="margin-bottom:6px">Start with a trigger</div>@for (p of palette.trigger; track p.label) {<button (click)="push(w, 'trigger', p)">⚡ {{ p.label }}</button>}}
          @else {
            <div class="muted small" style="margin:4px 0">Conditions</div>@for (p of palette.condition; track p.label) {<button (click)="push(w, 'condition', p)">{{ p.label }}</button>}
            <div class="muted small" style="margin:10px 0 4px">Actions</div>@for (p of palette.action; track p.label) {<button (click)="push(w, 'action', p)">{{ p.label }}</button>}
          }
        </div>
      }
    </div>
  </div>`
})
export class WorkflowsPage {
  store = inject(StoreService); toast = inject(ToastService);
  palette = PALETTE; selId = signal('WF1'); running = signal(-1);
  list = computed(() => { this.store.rev(); return this.store.db.workflows; });
  cur = computed(() => this.list().find(w => w.id === this.selId()) || this.list()[0]);
  push(w: Workflow, kind: WorkflowStep['kind'], p: { label: string; detail: string }) { w.steps.push({ kind, label: p.label, detail: p.detail }); this.store.changed(); }
  move(w: Workflow, i: number, d: number) { const [s] = w.steps.splice(i, 1); w.steps.splice(i + d, 0, s); this.store.changed(); }
  remove(w: Workflow, i: number) { w.steps.splice(i, 1); this.store.changed(); }
  toggle(w: Workflow) {
    if (!w.enabled && !w.steps.some(s => s.kind === 'action')) { this.toast.err('Add at least one action before turning this on'); return; }
    w.enabled = !w.enabled; this.store.log('Changed', 'Workflow', `${w.name} ${w.enabled ? 'enabled' : 'disabled'}`); this.store.changed(); this.toast.ok(`${w.name} is ${w.enabled ? 'on' : 'off'}`);
  }
  save(w: Workflow) { if (w.steps[0]?.kind !== 'trigger') { this.toast.err('The first step must be a trigger'); return; } this.store.log('Changed', 'Workflow', `${w.name} saved (${w.steps.length} steps)`); this.store.changed(); this.toast.ok('Workflow saved'); }
  test(w: Workflow) {
    if (!w.steps.length) { this.toast.err('Add a trigger first'); return; }
    let i = 0; this.running.set(0);
    const t = setInterval(() => { i++; if (i >= w.steps.length) { clearInterval(t); this.running.set(-1); w.runs++; w.lastRun = this.store.nowStamp(); this.store.changed(); this.toast.ok(`Test run finished: ${w.steps.filter(s => s.kind === 'action').length} actions simulated, nothing sent`); } else this.running.set(i); }, 600);
  }
  add() { const w: Workflow = { id: this.store.uid('WF'), name: 'New workflow', enabled: false, runs: 0, steps: [] }; this.store.db.workflows.push(w); this.store.changed(); this.selId.set(w.id); }
}
