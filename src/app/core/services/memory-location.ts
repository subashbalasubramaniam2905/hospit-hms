import { Injectable } from '@angular/core';
import { LocationChangeListener, LocationStrategy } from '@angular/common';

/** Keeps the route in memory instead of the address bar. Used when the prototype runs inside an embedded frame
 *  (for example a hosted preview) where the URL cannot be changed. Back/forward still work inside the app. */
@Injectable()
export class MemoryLocationStrategy extends LocationStrategy {
  private stack: string[] = ['/'];
  private i = 0;
  private listeners: LocationChangeListener[] = [];
  path(): string { return this.stack[this.i]; }
  prepareExternalUrl(internal: string): string { return internal; }
  getState(): unknown { return null; }
  pushState(_s: unknown, _t: string, url: string, query: string): void { this.stack = this.stack.slice(0, this.i + 1); this.stack.push(url + (query ? '?' + query : '')); this.i++; }
  replaceState(_s: unknown, _t: string, url: string, query: string): void { this.stack[this.i] = url + (query ? '?' + query : ''); }
  forward(): void { if (this.i < this.stack.length - 1) { this.i++; this.emit(); } }
  back(): void { if (this.i > 0) { this.i--; this.emit(); } }
  override historyGo(n = 0): void { this.i = Math.max(0, Math.min(this.stack.length - 1, this.i + n)); this.emit(); }
  onPopState(fn: LocationChangeListener): void { this.listeners.push(fn); }
  getBaseHref(): string { return ''; }
  private emit() { const ev = { type: 'popstate', state: null } as unknown as PopStateEvent; this.listeners.forEach(l => l(ev as never)); }
}
