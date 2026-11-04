import { Injectable, inject, signal } from '@angular/core';
import { LabOrder } from '../models';
import { StoreService } from '../services/store.service';
import { ToastService } from '../services/toast.service';
import { apiMessage } from './auth.service';
import { LIVE } from './api-config';
import { LabApi, LiveLabOrder } from './lab-api';
import { PharmacyApi } from './pharmacy-api';

/**
 * Live mode: loads pharmacy stock and lab orders from the server into the in-memory store, so the existing
 * screens render server data. In demo mode it does nothing and the fictional data stays.
 */
@Injectable({ providedIn: 'root' })
export class LiveSync {
  private store = inject(StoreService);
  private pharmacy = inject(PharmacyApi);
  private lab = inject(LabApi);
  private toast = inject(ToastService);
  /** True once each data set has been loaded from the server at least once. */
  readonly pharmacyReady = signal(!LIVE);
  readonly labReady = signal(!LIVE);
  private pharmacyBranch = '';

  constructor() {
    // Never show fictional stock or lab orders next to real data.
    if (LIVE) { this.store.db.medicines = []; this.store.db.labOrders = []; }
  }

  /** Formulary with the stock of one branch. */
  async loadPharmacy(branchId: string) {
    if (!LIVE) return;
    this.pharmacyBranch = branchId;
    const meds = await this.pharmacy.medicines(branchId);
    if (this.pharmacyBranch !== branchId) return; // the user switched branch while loading
    this.store.db.medicines = meds;
    this.pharmacyReady.set(true);
    this.store.changed();
  }

  async loadLab() {
    if (!LIVE) return;
    const [tests, orders] = await Promise.all([this.store.db.labTests.length && this.labReady() ? null : this.lab.tests(), this.lab.orders()]);
    if (tests) this.store.db.labTests = tests;
    this.store.db.labOrders = orders;
    this.labReady.set(true);
    this.store.changed();
  }

  /** Live mode: runs a lab action on the server and stores the order it returns. Errors are shown as a toast. */
  async labAction(call: () => Promise<LiveLabOrder>, ok: (o: LiveLabOrder) => string): Promise<LiveLabOrder | null> {
    try { const o = await call(); this.putOrder(o); this.toast.ok(ok(o)); return o; }
    catch (e) { this.toast.err(apiMessage(e, 'Could not update the lab order')); await this.loadLab().catch(() => undefined); return null; }
  }

  /** Puts an order the server returned into the store, replacing the old copy. */
  putOrder(o: LiveLabOrder): LabOrder {
    const i = this.store.db.labOrders.findIndex(x => x.id === o.id);
    if (i >= 0) this.store.db.labOrders[i] = o; else this.store.db.labOrders.unshift(o);
    this.store.changed();
    return o;
  }
}
