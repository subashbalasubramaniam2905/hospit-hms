import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { SHARED } from '../../shared';
import { StoreService } from '../../core/services/store.service';
import { AiMockService } from '../../core/services/ai-mock.service';
import { SessionService } from '../../core/services/session.service';
import { LIVE } from '../../core/api/api-config';
import { AiApi, InsightsApi, SDashboard, scopeBranch } from '../../core/api/insights-api';

interface Msg { from: 'me' | 'ai'; text: string; link?: string; label?: string; time: string; badge?: string; }

@Component({
  standalone: true, imports: [SHARED],
  styles: [`.lay { display:grid; grid-template-columns:minmax(0,1fr) 300px; gap:16px; align-items:start } @media (max-width:1000px) { .lay { grid-template-columns:minmax(0,1fr) } }
  .chat { display:flex; flex-direction:column; height:calc(100vh - 260px); min-height:440px; padding:0 } .log { flex:1; overflow-y:auto; padding:18px; display:flex; flex-direction:column; gap:12px }
  .b { max-width:78%; padding:12px 14px; border-radius:14px; line-height:1.5 } .b.me { align-self:flex-end; background:var(--pri); color:#fff; border-bottom-right-radius:4px }
  .b.ai { align-self:flex-start; background:var(--ground); border-bottom-left-radius:4px } .b .t { font-size:11px; opacity:.7; margin-top:4px }
  .compose { border-top:1px solid var(--line); padding:12px; display:flex; gap:8px } .compose input { flex:1 }
  .sug { display:flex; flex-wrap:wrap; gap:8px; padding:0 18px 12px } .typing { align-self:flex-start; color:var(--mut); font-size:13px }`],
  template: `
  <div class="page">
    <cf-page-head title="AI assistant" [crumbs]="['Home', 'Operations']" [sub]="isLive ? (model() ? 'Ask about today’s operations. Answers come from Claude, using only today’s counts and amounts for your branches.' : 'Ask about today’s operations. No AI key is set on the server, so fixed rules answer from today’s figures.') : 'Ask about today’s operations. Answers come from the demo data using fixed rules, not a live model.'"></cf-page-head>
    @if (isLive) {
      <div class="alert-box ai"><lucide-icon name="sparkles" [size]="16"></lucide-icon><div><b>Operational figures only.</b> The assistant sees today's counts and amounts, never patient names or notes. It does not give diagnoses or treatment advice. Check important numbers on the linked screen.</div></div>
    } @else {
      <div class="alert-box ai"><lucide-icon name="sparkles" [size]="16"></lucide-icon><div><b>Demo insights only.</b> This assistant answers operational questions from mock data. It does not give diagnoses or treatment advice, and nothing it says is validated for clinical use.</div></div>
    }
    <div class="lay">
      <div class="card chat">
        <div class="log" #log>
          @for (m of msgs(); track $index) {
            <div class="b {{ m.from }}">@if (m.from === 'ai') {<span class="ai-badge">{{ m.badge || 'Demo insight' }}</span>}<div>{{ m.text }}</div>@if (m.link) {<a class="linkbtn" [routerLink]="m.link" style="margin-top:6px;display:inline-block">{{ m.label }} →</a>}<div class="t">{{ m.time }}</div></div>
          }
          @if (typing()) {<div class="typing">Assistant is checking the data…</div>}
        </div>
        @if (msgs().length < 3) {<div class="sug">@for (s of starters; track s) {<button class="chip" (click)="ask(s)">{{ s }}</button>}</div>}
        <form class="compose" (submit)="$event.preventDefault(); ask(q)">
          <input class="inp" [(ngModel)]="q" name="q" placeholder="Ask about beds, queue, collections, stock, lab, claims…" aria-label="Ask the assistant" autocomplete="off">
          <cf-voice text="How many beds are free right now?" label="Speak" (done)="ask($event)"></cf-voice>
          <button class="btn" type="submit" [disabled]="!q.trim()"><lucide-icon name="send" [size]="16"></lucide-icon></button>
        </form>
      </div>
      <div class="stack">
        <div class="card"><div class="card-h"><h3>Today at a glance</h3></div>
          <div class="list">@for (k of glance(); track k.label) {<a class="li" [routerLink]="k.link"><lucide-icon [name]="k.icon" [size]="16"></lucide-icon><div class="grow"><b>{{ k.value }}</b><span>{{ k.label }}</span></div><lucide-icon name="chevron-right" [size]="14"></lucide-icon></a>}</div>
        </div>
        <div class="card"><div class="card-h"><h3>What it can't do</h3></div>
          <ul class="small muted" style="padding-left:18px;display:flex;flex-direction:column;gap:6px"><li>Diagnose or recommend treatment</li><li>Change any record on its own</li><li>{{ isLive ? 'See patient records, beds or rosters' : 'See data outside this prototype' }}</li></ul>
          <button class="btn ghost sm" style="margin-top:10px" (click)="clear()">Clear conversation</button>
        </div>
      </div>
    </div>
  </div>`
})
export class AssistantPage {
  store = inject(StoreService); ai = inject(AiMockService); session = inject(SessionService);
  readonly isLive = LIVE; private aiApi = inject(AiApi); private insights = inject(InsightsApi);
  /** Live mode: the model name when the server has an AI key, null when it answers with rules. */
  model = signal<string | null>(null); live = signal<SDashboard | null>(null);
  constructor() {
    if (!LIVE) return;
    this.aiApi.status().then(s => this.model.set(s.live ? s.model ?? 'Claude' : null)).catch(() => undefined);
    this.insights.dashboard(scopeBranch(this.session)).then(d => this.live.set(d)).catch(() => undefined);
  }
  @ViewChild('log') logEl?: ElementRef<HTMLDivElement>;
  q = ''; typing = signal(false);
  starters = [LIVE ? 'How many appointments are still to come?' : 'How many beds are free?', 'Where are patients waiting longest?', "What are today's collections?", 'Which medicines are low on stock?', 'How many lab orders are pending?', 'Claims waiting on insurers?'];
  msgs = signal<Msg[]>([{ from: 'ai', text: `Hello ${this.session.role()?.userName.split(' ')[0] || ''}. ${LIVE ? 'I can summarise today\'s queue, appointments, collections, stock, lab work, claims and follow-ups.' : 'I can summarise beds, queues, collections, stock, lab turnaround, no-shows and insurance claims from the demo data.'}`, time: this.now() }]);
  glance = computed(() => { const L = this.live();
    if (L) return [
      { label: 'In the OPD queue', value: L.queueByStep.slice(0, 6).reduce((a, b) => a + b, 0), icon: 'activity', link: '/queue' },
      { label: 'Appointments still to come', value: L.toCome, icon: 'calendar', link: '/appointments' },
      { label: 'Open alerts', value: L.openAlerts, icon: 'bell-ring', link: '/alerts' },
      { label: 'Lab orders in progress', value: L.labPending, icon: 'flask-conical', link: '/lab/orders' },
    ];
    this.store.rev(); const s = this.store.db;
    return [
      { label: 'Beds free', value: s.beds.filter(b => b.status === 'Available').length + ' of ' + s.beds.length, icon: 'bed-double', link: '/ipd/beds' },
      { label: 'In the OPD queue', value: s.queue.filter(x => x.step < 6).length, icon: 'activity', link: '/queue' },
      { label: 'Open alerts', value: s.alerts.filter(a => a.status === 'Open').length, icon: 'bell-ring', link: '/alerts' },
      { label: 'Lab orders in progress', value: s.labOrders.filter(o => !['Verified', 'Delivered'].includes(o.status)).length, icon: 'flask-conical', link: '/lab/orders' },
    ]; });
  now() { return new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
  ask(text: string) {
    const t = text.trim(); if (!t || this.typing()) return; this.q = '';
    this.msgs.update(m => [...m, { from: 'me', text: t, time: this.now() }]); this.typing.set(true); this.scroll();
    if (LIVE) {
      const history = this.msgs().slice(1, -1).map(m => ({ from: m.from, text: m.text }));
      this.aiApi.ask(t, history, scopeBranch(this.session))
        .then(r => this.msgs.update(m => [...m, { from: 'ai', text: r.answer, link: r.link, label: r.label, time: this.now(), badge: r.source === 'claude' ? 'AI · Claude' : 'Rule-based' }]))
        .catch(() => this.msgs.update(m => [...m, { from: 'ai', text: 'I could not reach the server just now. Try again in a moment.', time: this.now(), badge: 'Error' }]))
        .finally(() => { this.typing.set(false); this.scroll(); });
      return;
    }
    setTimeout(() => { const r = this.ai.ops(t); this.msgs.update(m => [...m, { from: 'ai', text: r.answer, link: r.link, label: r.label, time: this.now() }]); this.typing.set(false); this.store.log('Viewed', 'AI assistant', `Asked: ${t.slice(0, 60)}`); this.scroll(); }, 650);
  }
  clear() { this.msgs.set(this.msgs().slice(0, 1)); }
  private scroll() { setTimeout(() => { const e = this.logEl?.nativeElement; if (e) e.scrollTop = e.scrollHeight; }, 30); }
}
