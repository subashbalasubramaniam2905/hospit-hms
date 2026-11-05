import {
  AfterViewInit, Component, ContentChildren, Directive, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, QueryList,
  TemplateRef, ViewChild, effect, inject, signal
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { ThemeService } from '../core/services/theme.service';
import { InitialsPipe } from './pipes';

Chart.register(...registerables);

/* ---------- Status badge ---------- */
const TONES: Record<string, string> = {
  // green
  Completed: 'g', Paid: 'g', Available: 'g', Active: 'g', Connected: 'g', Verified: 'g', Delivered: 'ok', Dispensed: 'g', Approved: 'g', Settled: 'ok', Given: 'g', Resolved: 'g', 'On duty': 'g', Received: 'g', Issued: 'g', Booked: 'g', Success: 'g', Read: 'g', Sent: 'b', 'In use': 'g', Normal: 'g', Discharged: 'n', Green: 'ok',
  // blue
  Configured: 'b', Confirmed: 'b', Scheduled: 'b', Submitted: 'b', Ordered: 'b', 'In OPD': 'b', Reserved: 'b', Planned: 'b', 'Sent to pharmacy': 'b', 'Result ready': 'b', Reported: 'b', Requested: 'b', Due: 'b', Admitted: 'b', 'Pre-op': 'b', Observation: 'b', Queued: 'n',
  // amber
  Waiting: 'a', Arrived: 'a', Pending: 'a', 'Partially paid': 'a', 'Under review': 'a', 'Awaiting sample': 'a', 'Sample collected': 'a', Processing: 'a', 'Awaiting report': 'a', Cleaning: 'a', 'Running late': 'a', 'Discharge planned': 'a', Acknowledged: 'a', 'Partially dispensed': 'a', Signed: 'v', Draft: 'n', Medium: 'a', Sensitive: 'a', 'In progress': 'a', 'Under maintenance': 'a', Yellow: 'a', 'Not sent': 'n', Invited: 'a', Recovery: 'v', 'Follow-up due': 'b',
  // red/pink
  Cancelled: 'n', 'No-show': 'r', Unpaid: 'r', Rejected: 'r', Error: 'r', Failed: 'r', Critical: 'r', High: 'p', Overdue: 'r', 'On leave': 'p', Occupied: 'p', Maintenance: 'n', Open: 'r', Flagged: 'r', Locked: 'r', Suspended: 'r', Red: 'r', Orange: 'p', Missed: 'r', Held: 'a', 'Off duty': 'n', Disabled: 'n', 'Not configured': 'n', Low: 'n', Refunded: 'v', Urgent: 'p', STAT: 'r', Routine: 'n', 'In consultation': 'v', 'Under treatment': 'v', Referred: 'n', 'In OT': 'v', Retired: 'n',
};
export const toneOf = (s: string) => TONES[s] ?? 'n';

@Component({
  selector: 'cf-status', standalone: true,
  template: `<span class="st {{ tone || toneOf(s) }}">@if (dot) {<i class="d"></i>}{{ label || s }}</span>`,
  styles: [`.d{width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block}`]
})
export class StatusComponent { @Input() s = ''; @Input() label?: string; @Input() tone?: string; @Input() dot = false; toneOf = toneOf; }

/* ---------- Avatar ---------- */
@Component({ selector: 'cf-avatar', standalone: true, imports: [InitialsPipe], template: `<span class="av {{ size }}" [style.background]="bg" [style.color]="fg">{{ name | initials }}</span>` })
export class AvatarComponent {
  @Input() name = ''; @Input() size: '' | 'lg' | 'xl' = '';
  private palette = [['var(--pri-soft)', 'var(--pri)'], ['var(--blue-soft)', 'var(--blue)'], ['var(--pink-soft)', 'var(--pink)'], ['var(--amber-soft)', 'color-mix(in srgb,var(--amber) 60%,var(--fg))'], ['var(--violet-soft)', 'var(--violet)']];
  get bg() { return this.palette[this.h() % 5][0]; } get fg() { return this.palette[this.h() % 5][1]; }
  private h() { let x = 0; for (const c of this.name) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; }
}

/* ---------- Page header ---------- */
@Component({
  selector: 'cf-page-head', standalone: true, imports: [LucideAngularModule],
  template: `
  <div class="ph">
    <div class="t">
      <div class="crumbs">
        <h1>{{ title }}</h1>
        @for (c of crumbs; track c) { <lucide-icon name="chevron-right" [size]="14"></lucide-icon><span>{{ c }}</span> }
      </div>
      @if (sub) { <p class="muted">{{ sub }}</p> }
    </div>
    <div class="acts"><ng-content></ng-content></div>
  </div>`,
  styles: [`.ph{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap}.t{display:flex;flex-direction:column;gap:4px;min-width:0}
  .crumbs{display:flex;align-items:center;gap:8px;color:var(--mut);font-size:13px;flex-wrap:wrap} h1{font-size:22px;font-weight:800;color:var(--fg)}
  .acts{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center} p{font-size:13.5px;max-width:80ch}`]
})
export class PageHeadComponent { @Input() title = ''; @Input() crumbs: string[] = []; @Input() sub?: string; }

/* ---------- Stat / KPI card (Direction D) ---------- */
@Component({
  selector: 'cf-stat', standalone: true, imports: [LucideAngularModule],
  template: `
  <div class="kpi" [class.clickable]="clickable">
    <div class="h"><span>{{ label }}</span>@if (trend) {<span class="trend" [style.background]="soft" [style.color]="color">{{ trend }}</span>}</div>
    <div class="v">
      <b [style.color]="color">{{ value }}@if (of) {<small>/{{ of }}</small>}</b>
      @if (icon) {<span class="sq" [style.background]="color"><lucide-icon [name]="icon" [size]="18"></lucide-icon></span>}
    </div>
    @if (sub) {<div class="sub">{{ sub }}</div>}
    <div class="stripe" [style.background]="color"></div>
  </div>`,
  styles: [`:host{display:block;min-width:0}.kpi{background:var(--card);border-radius:var(--r);border:1px solid var(--line);padding:16px 18px 0;display:flex;flex-direction:column;gap:8px;overflow:hidden;height:100%}
  .kpi.clickable{cursor:pointer}.kpi.clickable:hover{border-color:var(--pri)}
  .h{display:flex;justify-content:space-between;align-items:center;font-weight:600;gap:8px}.trend{font-size:11px;font-weight:700;padding:2px 7px;border-radius:99px;white-space:nowrap}
  .v{display:flex;align-items:flex-end;justify-content:space-between;gap:8px}.v b{font-size:27px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.01em;line-height:1.1}
  .v b small{font-size:15px;color:var(--mut);font-weight:600}.sq{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;color:#fff;flex:none}
  .sub{font-size:12px;color:var(--mut);margin-top:-2px}.stripe{height:4px;margin:6px -18px 0}`]
})
export class StatComponent {
  @Input() label = ''; @Input() value: string | number = ''; @Input() of?: string | number; @Input() trend?: string; @Input() icon?: string; @Input() sub?: string; @Input() clickable = false;
  @Input() tone: 'pri' | 'pink' | 'amber' | 'blue' | 'green' | 'red' | 'violet' = 'pri';
  get color() { return this.tone === 'amber' ? 'color-mix(in srgb,var(--amber) 85%,var(--fg))' : `var(--${this.tone})`; }
  get soft() { return this.tone === 'pri' ? 'var(--pri-soft)' : `var(--${this.tone}-soft)`; }
}

/* ---------- Empty / loading / error states ---------- */
@Component({
  selector: 'cf-empty', standalone: true, imports: [LucideAngularModule],
  template: `<div class="e"><span class="ic"><lucide-icon [name]="icon" [size]="26"></lucide-icon></span><b>{{ title }}</b>@if (text) {<p class="muted">{{ text }}</p>}<ng-content></ng-content></div>`,
  styles: [`.e{display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;padding:36px 16px}.ic{width:56px;height:56px;border-radius:16px;background:var(--pri-soft);color:var(--pri);display:grid;place-items:center}p{max-width:46ch;font-size:13px}`]
})
export class EmptyComponent { @Input() icon = 'search'; @Input() title = 'Nothing here yet'; @Input() text?: string; }

@Component({
  selector: 'cf-skeleton', standalone: true,
  template: `@for (r of rowsArr; track $index) {<div class="sk" [style.width.%]="90 - ($index % 3) * 15"></div>}`,
  styles: [`:host{display:flex;flex-direction:column;gap:12px;padding:8px 0}.sk{height:14px;border-radius:7px;background:linear-gradient(90deg,var(--ground),color-mix(in srgb,var(--line) 70%,var(--ground)),var(--ground));background-size:200% 100%;animation:sh 1.2s infinite}@keyframes sh{to{background-position:-200% 0}}`]
})
export class SkeletonComponent { @Input() set rows(n: number) { this.rowsArr = Array.from({ length: n }); } rowsArr = Array.from({ length: 5 }); }

@Component({
  selector: 'cf-error', standalone: true, imports: [LucideAngularModule],
  template: `<div class="alert-box crit"><lucide-icon name="circle-alert" [size]="16"></lucide-icon><div><b>{{ title }}</b><div>{{ text }}</div></div><button class="btn sm ghost" style="margin-left:auto" (click)="retry.emit()">Try again</button></div>`
})
export class ErrorStateComponent { @Input() title = 'Could not load'; @Input() text = ''; @Output() retry = new EventEmitter<void>(); }

/* ---------- Drawer ---------- */
@Component({
  selector: 'cf-drawer', standalone: true, imports: [LucideAngularModule],
  template: `
  @if (open) {
  <div class="scrim" (click)="closed.emit()"></div>
  <aside class="drawer" [style.width]="width" role="dialog" [attr.aria-label]="title">
    <header><div><h3>{{ title }}</h3>@if (sub) {<p class="muted small">{{ sub }}</p>}</div><button class="iconbtn" (click)="closed.emit()" aria-label="Close"><lucide-icon name="x" [size]="18"></lucide-icon></button></header>
    <div class="body"><ng-content></ng-content></div>
    <footer><ng-content select="[foot]"></ng-content></footer>
  </aside>}`,
  styles: [`.scrim{position:fixed;inset:0;background:rgba(10,20,18,.42);z-index:60;animation:f .15s}
  .drawer{position:fixed;top:0;right:0;bottom:0;max-width:100%;background:var(--card);z-index:61;display:flex;flex-direction:column;box-shadow:-20px 0 40px -20px rgba(0,0,0,.3);animation:s .2s ease-out;padding-top:env(safe-area-inset-top,0px)}
  header{display:flex;align-items:flex-start;gap:12px;padding:20px 22px 12px}header h3{font-size:18px;font-weight:800}header .iconbtn{margin-left:auto}
  .body{flex:1;overflow-y:auto;padding:4px 22px 20px;display:flex;flex-direction:column;gap:14px}
  footer{padding:14px 22px calc(14px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line);display:flex;gap:8px;flex-wrap:wrap}footer:empty{display:none}
  @keyframes s{from{transform:translateX(30px);opacity:.5}}@keyframes f{from{opacity:0}}`]
})
export class DrawerComponent { @Input() open = false; @Input() title = ''; @Input() sub?: string; @Input() width = 'min(460px,100%)'; @Output() closed = new EventEmitter<void>(); }

/* ---------- Modal ---------- */
@Component({
  selector: 'cf-modal', standalone: true, imports: [LucideAngularModule],
  template: `
  @if (open) {
  <div class="scrim" (click)="closed.emit()">
    <div class="modal" [style.width]="width" (click)="$event.stopPropagation()" role="dialog" [attr.aria-label]="title">
      <header><h3>{{ title }}</h3><button class="iconbtn" (click)="closed.emit()" aria-label="Close"><lucide-icon name="x" [size]="18"></lucide-icon></button></header>
      <div class="body"><ng-content></ng-content></div>
      <footer><ng-content select="[foot]"></ng-content></footer>
    </div>
  </div>}`,
  styles: [`.scrim{position:fixed;inset:0;background:rgba(10,20,18,.45);z-index:70;display:grid;place-items:center;padding:16px;animation:f .15s}
  .modal{max-width:100%;max-height:calc(100vh - 32px);background:var(--card);border-radius:18px;display:flex;flex-direction:column;box-shadow:var(--shadow);animation:p .18s ease-out}
  header{display:flex;align-items:center;gap:12px;padding:18px 22px 8px}header h3{font-size:18px;font-weight:800}header .iconbtn{margin-left:auto}
  .body{overflow-y:auto;padding:8px 22px 18px;display:flex;flex-direction:column;gap:14px}
  footer{padding:12px 22px 18px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--line)}footer:empty{display:none}
  @keyframes p{from{transform:scale(.97);opacity:.6}}@keyframes f{from{opacity:0}}`]
})
export class ModalComponent { @Input() open = false; @Input() title = ''; @Input() width = 'min(620px,100%)'; @Output() closed = new EventEmitter<void>(); }

/* ---------- Chart.js wrapper (re-themes on light/dark) ---------- */
@Component({ selector: 'cf-chart', standalone: true, template: `<div class="box" [style.height.px]="height"><canvas #c></canvas></div>`, styles: [`.box{position:relative;width:100%}`] })
export class ChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() type: 'bar' | 'line' | 'doughnut' | 'pie' | 'radar' = 'bar';
  @Input() labels: string[] = [];
  @Input() datasets: ChartConfiguration['data']['datasets'] = [];
  @Input() options: Record<string, unknown> = {};
  @Input() height = 230;
  @Input() centerText?: [string, string];
  @Input() legend = false;
  @ViewChild('c') canvas!: ElementRef<HTMLCanvasElement>;
  private chart?: Chart;
  private theme = inject(ThemeService);
  constructor() { effect(() => { this.theme.dark(); queueMicrotask(() => this.render()); }); }
  ngAfterViewInit() { this.render(); }
  ngOnChanges() { if (this.canvas) this.render(); }
  ngOnDestroy() { this.chart?.destroy(); }
  static css(v: string) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  private render() {
    if (!this.canvas) return;
    const css = ChartComponent.css; this.chart?.destroy();
    Chart.defaults.font.family = css('--font'); Chart.defaults.color = css('--mut');
    const grid = css('--line'); const round = this.type === 'doughnut' || this.type === 'pie';
    const center = this.centerText;
    const ds = this.datasets.map(d => ({ ...d, backgroundColor: this.resolve(d.backgroundColor), borderColor: this.resolve(d.borderColor), pointBackgroundColor: this.resolve((d as { pointBackgroundColor?: unknown }).pointBackgroundColor), pointBorderColor: this.resolve((d as { pointBorderColor?: unknown }).pointBorderColor) })) as ChartConfiguration['data']['datasets'];
    if (round) ds.forEach(d => Object.assign(d, { borderColor: css('--card'), borderWidth: 3 }));
    const base: Record<string, unknown> = round
      ? { maintainAspectRatio: false, cutout: this.type === 'doughnut' ? '70%' : 0, plugins: { legend: { display: this.legend, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3 } } } }
      : { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: this.legend, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3 } } }, scales: { x: { grid: { display: false }, border: { color: grid } }, y: { grid: { color: grid }, border: { display: false }, beginAtZero: true } } };
    const merged = this.deepMerge(base, this.options);
    this.chart = new Chart(this.canvas.nativeElement, {
      type: this.type, data: { labels: this.labels, datasets: ds }, options: merged as never,
      plugins: center ? [{ id: 'center', afterDraw(ch) { const { ctx, chartArea: a } = ch; const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2; ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = css('--mut'); ctx.font = `500 12px ${css('--font')}`; ctx.fillText(center[0], x, y - 12); ctx.fillStyle = css('--fg'); ctx.font = `800 26px ${css('--font')}`; ctx.fillText(center[1], x, y + 16); ctx.restore(); } }] : []
    });
  }
  private resolve(v: unknown): unknown {
    if (typeof v === 'string' && v.startsWith('--')) return ChartComponent.css(v);
    if (Array.isArray(v)) return v.map(x => this.resolve(x));
    return v;
  }
  private deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...a };
    for (const k of Object.keys(b)) { const bv = b[k], av = a[k]; out[k] = bv && typeof bv === 'object' && !Array.isArray(bv) && av && typeof av === 'object' ? this.deepMerge(av as Record<string, unknown>, bv as Record<string, unknown>) : bv; }
    return out;
  }
}

/* ---------- Data table with sort + pagination ---------- */
export interface Col { key: string; label: string; sortable?: boolean; align?: 'right'; width?: string; value?: (row: any) => unknown; }
@Directive({ selector: '[cfCell]', standalone: true })
export class CellDirective { @Input('cfCell') key = ''; tpl = inject(TemplateRef); }

@Component({
  selector: 'cf-table', standalone: true, imports: [NgTemplateOutlet, LucideAngularModule, EmptyComponent],
  template: `
  <div class="tbl">
    <table class="t">
      <thead><tr>@for (c of cols; track c.key) {
        <th [class.sortable]="c.sortable !== false" [style.width]="c.width" [class.num]="c.align==='right'" (click)="c.sortable !== false && sortBy(c.key)" [attr.aria-sort]="sortKey()===c.key ? (dir()===1?'ascending':'descending') : null">
          {{ c.label }}@if (sortKey()===c.key) {<lucide-icon [name]="dir()===1 ? 'chevron-up' : 'chevron-down'" [size]="12"></lucide-icon>}
        </th>}</tr></thead>
      <tbody>
        @for (r of paged(); track $index) {
          <tr [class.click]="clickable" (click)="clickable && rowClick.emit(r)">
            @for (c of cols; track c.key) {
              <td [class.num]="c.align==='right'">
                @if (tplFor(c.key); as t) { <ng-container *ngTemplateOutlet="t; context: { $implicit: r }"></ng-container> } @else { {{ val(r, c) }} }
              </td>
            }
          </tr>
        }
      </tbody>
    </table>
    @if (!rows.length) { <cf-empty [icon]="emptyIcon" [title]="emptyTitle" [text]="emptyText"></cf-empty> }
  </div>
  @if (rows.length > pageSize) {
  <div class="pager">
    <span class="muted small">Showing {{ start() + 1 }}–{{ end() }} of {{ rows.length }}</span>
    <div class="chips">
      <button class="chip" [disabled]="page()===0" (click)="page.set(page()-1)" aria-label="Previous page"><lucide-icon name="chevron-left" [size]="14"></lucide-icon></button>
      @for (p of pages(); track p) { <button class="chip" [class.on]="p===page()" (click)="page.set(p)">{{ p + 1 }}</button> }
      <button class="chip" [disabled]="end()>=rows.length" (click)="page.set(page()+1)" aria-label="Next page"><lucide-icon name="chevron-right" [size]="14"></lucide-icon></button>
    </div>
  </div>}`,
  styles: [`.pager{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap}.chip{min-width:32px;display:inline-grid;place-items:center}th lucide-icon{vertical-align:-2px;margin-left:3px}`]
})
export class TableComponent implements OnChanges {
  @Input() rows: any[] = [];
  @Input() cols: Col[] = [];
  @Input() pageSize = 10;
  @Input() clickable = false;
  @Input() emptyTitle = 'No records match';
  @Input() emptyText = 'Try clearing the search or filters.';
  @Input() emptyIcon = 'search';
  @Output() rowClick = new EventEmitter<any>();
  @ContentChildren(CellDirective) cells!: QueryList<CellDirective>;
  sortKey = signal<string | null>(null); dir = signal(1); page = signal(0);
  ngOnChanges() { if (this.start() >= this.rows.length) this.page.set(0); }
  tplFor(k: string) { return this.cells?.find(c => c.key === k)?.tpl ?? null; }
  val(r: any, c: Col) { return c.value ? c.value(r) : r[c.key]; }
  sortBy(k: string) { if (this.sortKey() === k) this.dir.set(-this.dir()); else { this.sortKey.set(k); this.dir.set(1); } this.page.set(0); }
  sorted() {
    const k = this.sortKey(); if (!k) return this.rows;
    const c = this.cols.find(x => x.key === k)!; const d = this.dir();
    return [...this.rows].sort((a, b) => { const x = this.val(a, c) as any, y = this.val(b, c) as any; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true })) * d; });
  }
  start() { return this.page() * this.pageSize; }
  end() { return Math.min(this.rows.length, this.start() + this.pageSize); }
  paged() { return this.sorted().slice(this.start(), this.end()); }
  pages() { const n = Math.ceil(this.rows.length / this.pageSize); return Array.from({ length: n }, (_, i) => i).filter(i => n <= 7 || Math.abs(i - this.page()) <= 2 || i === 0 || i === n - 1); }
}

/* ---------- Simulated voice input ---------- */
@Component({
  selector: 'cf-voice', standalone: true, imports: [LucideAngularModule],
  template: `<button type="button" class="mic" [class.rec]="rec()" (click)="start()" [attr.aria-label]="rec() ? 'Listening' : label"><lucide-icon [name]="rec() ? 'circle-dot' : 'mic'" [size]="14"></lucide-icon>{{ rec() ? 'Listening…' : label }}</button>`,
  styles: [`.mic{border:1px solid var(--line);background:var(--card);border-radius:99px;padding:3px 10px;font-size:12px;font-weight:600;color:var(--pri);display:inline-flex;gap:5px;align-items:center;white-space:nowrap}
  .mic.rec{background:var(--red-soft);color:var(--red);border-color:transparent;animation:pu 1s infinite}@keyframes pu{50%{opacity:.6}}`]
})
export class VoiceComponent {
  @Input() text = ''; @Input() label = 'Dictate';
  @Output() chunk = new EventEmitter<string>(); @Output() done = new EventEmitter<string>();
  rec = signal(false);
  start() {
    if (this.rec()) return; this.rec.set(true); let i = 0;
    const t = setInterval(() => { const c = this.text.slice(i, i + 4); i += 4; this.chunk.emit(c); if (i >= this.text.length) { clearInterval(t); this.rec.set(false); this.done.emit(this.text); } }, 35);
  }
}
