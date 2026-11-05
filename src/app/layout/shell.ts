import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter } from 'rxjs';
import { AccessService } from '../core/services/access.service';
import { InboxService } from '../core/services/inbox.service';
import { SessionService } from '../core/services/session.service';
import { ThemeService } from '../core/services/theme.service';
import { StoreService } from '../core/services/store.service';
import { ToastService } from '../core/services/toast.service';
import { InAppNote, RoleId } from '../core/models';
import { AvatarComponent, LogoComponent } from '../shared';

@Component({
  selector: 'app-shell', standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, LucideAngularModule, MatMenuModule, MatTooltipModule, AvatarComponent, LogoComponent],
  templateUrl: './shell.html', styleUrl: './shell.scss'
})
export class ShellComponent {
  session = inject(SessionService); theme = inject(ThemeService); store = inject(StoreService); toast = inject(ToastService); router = inject(Router); access = inject(AccessService); inbox = inject(InboxService);
  sideOpen = signal(false);
  q = signal(''); searchOpen = signal(false); listening = signal(false);
  noteOpen = signal(false);
  collapsed = signal<Record<string, boolean>>({});
  unread = computed(() => { this.store.rev(); return this.store.db.inbox.filter(n => !n.read).length; });
  openAlerts = computed(() => { this.store.rev(); return this.store.db.alerts.filter(a => a.status === 'Open').length; });
  branch = computed(() => this.store.db.branches.find(b => b.id === this.session.branchId()));

  results = computed(() => {
    this.store.rev(); const q = this.q().trim().toLowerCase(); if (q.length < 2) return null;
    const digits = q.replace(/\D/g, '');
    const pts = this.store.db.patients.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || (digits.length > 3 && p.mobile.replace(/\D/g, '').includes(digits))).slice(0, 5);
    const inv = this.store.db.invoices.filter(i => i.id.toLowerCase().includes(q)).slice(0, 3);
    const pages = this.session.nav().flatMap(g => g.items).filter(i => i.label.toLowerCase().includes(q)).slice(0, 4);
    return { pts, inv, pages };
  });

  constructor() {
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => { this.sideOpen.set(false); this.searchOpen.set(false); this.noteOpen.set(false); document.querySelector('.content')?.scrollTo?.(0, 0); window.scrollTo(0, 0); });
    setInterval(() => this.store.tickQueue(), 60000);
    if (this.session.live) {
      this.store.syncPatients().catch(() => this.toast.err('Could not load patients from the server'));
      this.access.load().catch(() => undefined); // the built-in screen access applies until the hospital's rules load
      this.inbox.start();
    }
  }

  @HostListener('document:keydown', ['$event']) key(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); (document.getElementById('gsearch') as HTMLInputElement)?.focus(); this.searchOpen.set(true); }
    if (e.key === 'Escape') { this.searchOpen.set(false); this.noteOpen.set(false); }
  }

  toggleGroup(l: string) { this.collapsed.update(c => ({ ...c, [l]: !c[l] })); }
  go(path: string, q?: Record<string, string>) { this.q.set(''); this.searchOpen.set(false); this.router.navigate([path], { queryParams: q }); }
  submitSearch() { const v = this.q().trim(); if (!v) return; this.go('/patients', { q: v }); }
  voiceSearch() {
    if (this.listening()) return; this.listening.set(true); this.q.set(''); this.searchOpen.set(true);
    const text = 'Lakshmi'; let i = 0;
    const t = setInterval(() => { this.q.set(text.slice(0, ++i)); if (i >= text.length) { clearInterval(t); this.listening.set(false); this.toast.info('Voice search heard "Lakshmi" (simulated)'); } }, 90);
  }
  switchRole(r: RoleId) {
    this.session.signIn(r);
    if (r === 'patient') { this.router.navigate(['/portal']); return; }
    this.router.navigate(['/dashboard']); this.toast.ok(`Now viewing as ${this.session.role()!.name} (demo role)`);
  }
  openNote(n: InAppNote) { this.inbox.read(n); if (n.link) this.go(n.link); }
  markAllRead() { this.inbox.readAll(); }
  signOut() { this.session.signOut(); this.router.navigate(['/login']); }
  branches = computed(() => { const a = this.session.allowedBranches(); return this.store.db.branches.filter(b => !a || a.includes(b.id)); });
  resetDemo() { this.store.reset(); this.toast.ok('Demo data reset to the original fictional records'); this.router.navigate(['/dashboard']); }
  quick(path: string, q?: Record<string, string>) { this.go(path, q); }
}
