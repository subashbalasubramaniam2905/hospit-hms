import { Injectable, inject, signal } from '@angular/core';
import { LabOrder } from '../models';
import { StoreService } from '../services/store.service';
import { ToastService } from '../services/toast.service';
import { apiMessage } from './auth.service';
import { LIVE } from './api-config';
import { LabApi, LiveLabOrder } from './lab-api';
import { PharmacyApi } from './pharmacy-api';
import { IpdApi, LiveAdmission } from './ipd-api';

/**
 * Live mode: loads pharmacy stock and lab orders from the server into the in-memory store, so the existing
 * screens render server data. In demo mode it does nothing and the fictional data stays.
 */
@Injectable({ providedIn: 'root' })
export class LiveSync {
  private store = inject(StoreService);
  private pharmacy = inject(PharmacyApi);
  private lab = inject(LabApi);
  private ipd = inject(IpdApi);
  private toast = inject(ToastService);
  /** True once each data set has been loaded from the server at least once. */
  readonly pharmacyReady = signal(!LIVE);
  readonly labReady = signal(!LIVE);
  readonly ipdReady = signal(!LIVE);
  private pharmacyBranch = '';
  private ipdBranch = '';

  constructor() {
    // Never show fictional lab orders next to real ones. The demo formulary uses the same ids as the server's,
    // so it stays as reference data until the branch stock has loaded.
    if (LIVE) this.store.db.labOrders = [];
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

  // ---------- inpatients ----------

  /** Wards, beds and current admissions of one branch. */
  async loadIpd(branchId: string) {
    if (!LIVE) return;
    this.ipdBranch = branchId;
    const [wards, beds, admissions] = await Promise.all([this.ipd.wards(branchId), this.ipd.beds(branchId), this.ipd.admissions({ branchId })]);
    if (this.ipdBranch !== branchId) return; // the user switched branch while loading
    this.store.db.wards = wards;
    this.store.db.beds = beds;
    // Keep discharged admissions that were opened one by one; replace the current ones.
    this.store.db.admissions = [...admissions, ...this.store.db.admissions.filter(a => a.status === 'Discharged' && !admissions.some(x => x.id === a.id))];
    admissions.forEach(a => this.names(a));
    this.ipdReady.set(true);
    this.store.changed();
  }

  async reloadBeds() {
    if (!LIVE || !this.ipdBranch) return;
    const b = this.ipdBranch, beds = await this.ipd.beds(b);
    if (this.ipdBranch === b) { this.store.db.beds = beds; this.store.changed(); }
  }

  /** Puts an admission the server returned into the store, replacing the old copy. */
  putAdmission(a: LiveAdmission): LiveAdmission {
    const list = this.store.db.admissions, i = list.findIndex(x => x.id === a.id);
    if (i >= 0) list[i] = a; else list.unshift(a);
    this.names(a);
    this.store.changed();
    return a;
  }

  /** Live mode: runs an inpatient action on the server and stores the admission it returns. Errors are shown as a toast. */
  async ipdAction(call: () => Promise<LiveAdmission>, ok: ((a: LiveAdmission) => string) | null, beds = false): Promise<LiveAdmission | null> {
    try {
      const a = this.putAdmission(await call());
      if (beds) await this.reloadBeds().catch(() => undefined);
      if (ok) this.toast.ok(ok(a));
      return a;
    } catch (e) { this.toast.err(apiMessage(e, 'Could not update the admission')); return null; }
  }

  private names(a: LiveAdmission) {
    if (a.patientName) this.store.extraNames.set(a.patientId, a.patientName);
    if (a.doctorName) this.store.extraDoctorNames.set(a.doctorId, a.doctorName);
  }
}
