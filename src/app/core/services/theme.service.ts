import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly dark = signal(false);
  constructor() {
    let pref: string | null = null;
    try { pref = localStorage.getItem('hospit-hms:theme'); } catch { /* ignore */ }
    this.apply(pref ? pref === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  }
  toggle() { this.apply(!this.dark()); try { localStorage.setItem('hospit-hms:theme', this.dark() ? 'dark' : 'light'); } catch { /* ignore */ } }
  private apply(d: boolean) { this.dark.set(d); document.documentElement.classList.toggle('dark', d); }
}
