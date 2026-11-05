import { Injectable, inject } from '@angular/core';
import { LIVE } from '../api/api-config';
import { OrgApi, fromServerInbox } from '../api/org-api';
import { InAppNote } from '../models';
import { StoreService } from './store.service';

/** The staff inbox behind the bell and the Notifications page. Live mode reads and marks notes on the server. */
@Injectable({ providedIn: 'root' })
export class InboxService {
  private store = inject(StoreService);
  private api = inject(OrgApi);
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Live mode: loads now and every two minutes after. */
  start() {
    if (!LIVE || this.timer) return;
    this.store.db.inbox = [];
    this.load().catch(() => undefined);
    this.timer = setInterval(() => this.load().catch(() => undefined), 120000);
  }
  async load() {
    if (!LIVE) return;
    this.store.db.inbox = (await this.api.inbox()).map(fromServerInbox); this.store.changed();
  }
  async read(n: InAppNote) {
    const x = this.store.db.inbox.find(i => i.id === n.id) as (InAppNote & { serverId?: number }) | undefined;
    if (!x || x.read) return;
    x.read = true; this.store.changed();
    if (LIVE && x.serverId != null) await this.api.read(x.serverId).catch(() => { x.read = false; this.store.changed(); });
  }
  async readAll() {
    this.store.db.inbox.forEach(n => n.read = true); this.store.changed();
    if (LIVE) await this.api.readAll().catch(() => this.load());
  }
}
