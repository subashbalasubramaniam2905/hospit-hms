import { Injectable, inject } from '@angular/core';
import { StoreService } from './store.service';
import { ToastService } from './toast.service';

@Injectable({ providedIn: 'root' })
export class ExportService {
  private store = inject(StoreService);
  private toast = inject(ToastService);
  /** Builds a CSV and offers it as a download. In locked-down previews the download may be blocked, so a toast confirms the simulated export. */
  csv(name: string, rows: Record<string, unknown>[]) {
    const text = this.store.csv(rows);
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url; a.download = `${name}-${this.store.today()}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { /* download blocked */ }
    this.store.log('Exported', name, `Exported ${rows.length} rows to CSV`, 'Sensitive'); this.store.changed();
    this.toast.ok(`Exported ${rows.length} rows to ${name}.csv (simulated)`);
  }
  /** Prints only the on-screen .doc element (prescription, invoice, report). */
  printDoc() { document.documentElement.classList.add('print-doc'); setTimeout(() => { try { window.print(); } catch { /* blocked */ } document.documentElement.classList.remove('print-doc'); }, 50); }
  print() { try { window.print(); } catch { /* blocked */ } this.toast.info('Print dialog requested. In hosted previews printing may be disabled.'); }
}
