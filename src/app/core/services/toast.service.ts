import { Injectable, signal } from '@angular/core';

export interface Toast { id: number; text: string; tone: 'ok' | 'warn' | 'err' | 'info'; action?: { label: string; run: () => void }; }

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly items = signal<Toast[]>([]);
  private n = 0;
  show(text: string, tone: Toast['tone'] = 'ok', action?: Toast['action'], ms = 3600) {
    const t: Toast = { id: ++this.n, text, tone, action };
    this.items.update(l => [...l.slice(-3), t]);
    setTimeout(() => this.dismiss(t.id), ms);
  }
  ok(t: string, action?: Toast['action']) { this.show(t, 'ok', action); }
  warn(t: string) { this.show(t, 'warn'); }
  err(t: string) { this.show(t, 'err'); }
  info(t: string) { this.show(t, 'info'); }
  dismiss(id: number) { this.items.update(l => l.filter(x => x.id !== id)); }
}
