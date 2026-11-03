import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { ToastService } from './core/services/toast.service';
import { ThemeService } from './core/services/theme.service';

@Component({
  selector: 'app-root', standalone: true, imports: [RouterOutlet, LucideAngularModule],
  template: `
  <router-outlet></router-outlet>
  <div class="toasts" aria-live="polite">
    @for (t of toast.items(); track t.id) {
      <div class="toast {{ t.tone }}">
        <lucide-icon [name]="t.tone === 'ok' ? 'circle-check' : t.tone === 'warn' ? 'triangle-alert' : t.tone === 'err' ? 'circle-x' : 'info'" [size]="17"></lucide-icon>
        <span>{{ t.text }}</span>
        @if (t.action) { <button (click)="t.action.run(); toast.dismiss(t.id)">{{ t.action.label }}</button> }
        <button class="x" (click)="toast.dismiss(t.id)" aria-label="Dismiss"><lucide-icon name="x" [size]="14"></lucide-icon></button>
      </div>
    }
  </div>`,
  styles: [`.toasts{position:fixed;right:max(20px,env(safe-area-inset-right,0px));bottom:calc(20px + env(safe-area-inset-bottom,0px));z-index:100;display:flex;flex-direction:column;gap:8px;max-width:min(420px,calc(100vw - 32px))}
  .toast{background:var(--fg);color:var(--card);padding:11px 12px 11px 14px;border-radius:12px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.2);display:flex;gap:10px;align-items:center;animation:t .22s ease-out;font-size:13.5px}
  .toast.ok lucide-icon:first-child{color:var(--pri-soft)}.toast.warn lucide-icon:first-child{color:var(--amber)}.toast.err lucide-icon:first-child{color:var(--red)}
  .toast button{border:0;background:color-mix(in srgb,var(--card) 18%,transparent);color:var(--card);border-radius:8px;padding:4px 10px;font-weight:700;font-size:12.5px;white-space:nowrap}
  .toast .x{background:none;padding:2px;margin-left:auto;opacity:.7}@keyframes t{from{transform:translateY(8px);opacity:.3}}`]
})
export class App { toast = inject(ToastService); private theme = inject(ThemeService); }
