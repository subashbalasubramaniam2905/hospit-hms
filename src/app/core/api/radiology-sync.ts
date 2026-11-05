import { Injectable, inject, signal } from '@angular/core';
import { StoreService } from '../services/store.service';
import { ToastService } from '../services/toast.service';
import { apiMessage } from './auth.service';
import { LIVE } from './api-config';
import { ImagingStudy, LiveImagingOrder, RadiologyApi } from './radiology-api';

/**
 * Live mode: loads imaging orders from the server into the in-memory store, so the radiology worklist, dashboard
 * and patient profile render server data. In demo mode it does nothing and the fictional studies stay.
 */
@Injectable({ providedIn: 'root' })
export class RadiologySync {
  private store = inject(StoreService);
  private api = inject(RadiologyApi);
  private toast = inject(ToastService);
  readonly ready = signal(!LIVE);
  readonly studies = signal<ImagingStudy[]>([]);

  /** The worklist: every open study plus the last 30 days of finished and cancelled ones. */
  async load() {
    if (!LIVE) return;
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const [studies, open, recent] = await Promise.all([
      this.studies().length ? null : this.api.studies(),
      this.api.orders({ status: 'Ordered,Scheduled,In progress,Awaiting report,Reported' }),
      this.api.orders({ status: 'Verified,Cancelled', from: since }),
    ]);
    if (studies) this.studies.set(studies);
    const ids = new Set([...open, ...recent].map(o => o.id));
    [...open, ...recent].forEach(o => this.store.extraNames.set(o.patientId, o.patientName));
    // Keep other patients' studies loaded by the profile screen; replace everything the worklist covers.
    this.store.db.imaging = [...open, ...recent, ...this.store.db.imaging.filter(o => !ids.has(o.id) && !['Ordered', 'Scheduled', 'In progress', 'Awaiting report', 'Reported'].includes(o.status))];
    this.ready.set(true);
    this.store.changed();
  }

  /** One patient's studies, for the profile screen. */
  async loadPatient(patientId: string) {
    if (!LIVE) return;
    const list = await this.api.orders({ patientId, limit: 100 });
    list.forEach(o => this.put(o, false));
    this.store.changed();
  }

  /** Runs a radiology action on the server and stores the order it returns. Errors are shown as a toast. */
  async action(call: () => Promise<LiveImagingOrder>, ok: (o: LiveImagingOrder) => string): Promise<LiveImagingOrder | null> {
    try { const o = await call(); this.put(o); this.toast.ok(ok(o)); return o; }
    catch (e) { this.toast.err(apiMessage(e, 'Could not update the imaging order')); await this.load().catch(() => undefined); return null; }
  }

  /** Puts an order the server returned into the store, replacing the old copy. */
  put(o: LiveImagingOrder, notify = true) {
    this.store.extraNames.set(o.patientId, o.patientName);
    const i = this.store.db.imaging.findIndex(x => x.id === o.id);
    if (i >= 0) this.store.db.imaging[i] = o; else this.store.db.imaging.unshift(o);
    if (notify) this.store.changed();
    return o;
  }
}
