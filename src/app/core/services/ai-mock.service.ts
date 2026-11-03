import { Injectable, inject } from '@angular/core';
import { StoreService } from './store.service';
import { Consultation, Patient } from '../models';
import { ICD10 } from '../data/clinical';

export interface AiSuggestion { id: string; kind: 'Summary' | 'Differential' | 'Test' | 'Note' | 'Follow-up' | 'Coding'; title: string; body: string; confidence: 'Low' | 'Medium'; apply?: { field: keyof Consultation | 'dx' | 'tests'; value: string }; }

/**
 * Mock "AI" for the prototype. It uses simple keyword rules over fictional data.
 * Nothing here is a model, and every output must be reviewed and approved by a clinician.
 */
@Injectable({ providedIn: 'root' })
export class AiMockService {
  private store = inject(StoreService);

  summary(p: Patient): string {
    const visits = this.store.db.consultations.filter(c => c.patientId === p.id && c.status === 'Completed').sort((a, b) => b.date.localeCompare(a.date));
    const labs = this.store.db.labOrders.filter(o => o.patientId === p.id && ['Verified', 'Delivered'].includes(o.status));
    const hba = labs.map(o => o.results['L04']?.['HbA1c']).filter(v => v != null) as number[];
    const parts = [`${this.store.age(p.dob)}-year-old ${p.gender.toLowerCase()}`];
    if (p.conditions.length) parts.push(`with ${p.conditions.join(' and ').toLowerCase()}`);
    let s = parts.join(' ') + '.';
    if (p.allergies.length) s += ` Allergy recorded: ${p.allergies.join(', ')}.`;
    if (visits[0]) s += ` Last seen ${visits[0].date} by ${this.store.dname(visits[0].doctorId)} (${visits[0].dx.map(d => d.label).join(', ') || visits[0].cc}).`;
    if (hba.length > 1) s += ` HbA1c moved from ${hba[hba.length - 1]}% to ${hba[0]}%${hba[0] > hba[hba.length - 1] ? ', which is rising' : ''}.`;
    if (p.medications) s += ` Current medicines: ${p.medications}.`;
    return s;
  }

  suggestions(p: Patient, c: Consultation): AiSuggestion[] {
    const text = `${c.cc} ${c.hpi} ${c.exam}`.toLowerCase(); const out: AiSuggestion[] = [];
    const add = (s: Omit<AiSuggestion, 'id'>) => out.push({ ...s, id: s.kind + out.length });
    const dx = (code: string) => ICD10.find(d => d.code === code)!;
    if (/fever|chills|temperature/.test(text)) {
      add({ kind: 'Differential', title: 'Consider viral fever, dengue, typhoid', body: 'Fever in this season and region commonly has these causes. Rule out based on exam and tests.', confidence: 'Low', apply: { field: 'dx', value: 'R50.9' } });
      add({ kind: 'Test', title: 'CBC, dengue NS1 and Widal', body: 'Common first-line tests for acute fever.', confidence: 'Medium', apply: { field: 'tests', value: 'L01,L16,L17' } });
    }
    if (/cough|throat|cold|sneez/.test(text)) add({ kind: 'Differential', title: dx('J06.9').label, body: 'Symptoms fit an upper respiratory infection. Antibiotics are usually not needed.', confidence: 'Medium', apply: { field: 'dx', value: 'J06.9' } });
    if (/chest pain|breathless|palpitation/.test(text)) add({ kind: 'Test', title: 'Troponin I and ECG', body: 'Chest symptoms with cardiac risk factors. Consider an urgent ECG.', confidence: 'Medium', apply: { field: 'tests', value: 'L14' } });
    if (p.conditions.includes('Type 2 diabetes')) {
      const hba = this.store.db.labOrders.filter(o => o.patientId === p.id).map(o => o.results['L04']?.['HbA1c']).find(v => v != null);
      if (hba && hba >= 7) add({ kind: 'Differential', title: `${dx('E11.65').label}`, body: `Latest HbA1c ${hba}% is above the 7% target.`, confidence: 'Medium', apply: { field: 'dx', value: 'E11.65' } });
      add({ kind: 'Test', title: 'HbA1c, fasting glucose, kidney profile', body: 'Routine diabetes monitoring if not done in the last 3 months.', confidence: 'Medium', apply: { field: 'tests', value: 'L04,L02,L08' } });
      add({ kind: 'Follow-up', title: 'Review in 3 months', body: 'Typical interval for diabetes review with repeat HbA1c.', confidence: 'Medium', apply: { field: 'followUp', value: 'Review in 3 months with HbA1c report.' } });
    }
    if (p.conditions.includes('Hypertension') && /^1[4-9]\d|^2\d\d/.test(c.vitals.bp)) add({ kind: 'Differential', title: 'BP above target today', body: `Recorded ${c.vitals.bp}. Confirm with a repeat reading and review home BP.`, confidence: 'Medium', apply: { field: 'dx', value: 'I10' } });
    if (/pain|ache/.test(text) && /back/.test(text)) add({ kind: 'Differential', title: dx('M54.5').label, body: 'Mechanical back pain is most common. Look for red flags.', confidence: 'Low', apply: { field: 'dx', value: 'M54.5' } });
    if (c.cc || c.hpi) add({ kind: 'Note', title: 'Draft assessment', body: this.draftAssessment(p, c), confidence: 'Low', apply: { field: 'assessment', value: this.draftAssessment(p, c) } });
    if (c.dx.length) add({ kind: 'Coding', title: `Billing code check`, body: `Diagnosis codes ${c.dx.map(d => d.code).join(', ')} are present for the visit. Consultation can be billed under OPD.`, confidence: 'Medium' });
    return out;
  }

  draftAssessment(p: Patient, c: Consultation) {
    const cond = p.conditions.length ? ` Known ${p.conditions.join(', ').toLowerCase()}.` : '';
    return `${this.store.age(p.dob)} y ${p.gender.toLowerCase()} presenting with ${c.cc || 'the stated complaints'}.${cond} Vitals: BP ${c.vitals.bp}, pulse ${c.vitals.hr}, SpO2 ${c.vitals.spo2}%.`;
  }

  /** Answers fixed operational questions with numbers from the demo store. */
  ops(q: string): { answer: string; link?: string; label?: string } {
    const s = this.store; const t = q.toLowerCase();
    if (/bed|occupan/.test(t)) { const occ = s.db.beds.filter(b => b.status === 'Occupied').length; return { answer: `${occ} of ${s.db.beds.length} beds are occupied (${Math.round(occ / s.db.beds.length * 100)}%). ${s.db.beds.filter(b => b.status === 'Cleaning').length} are being cleaned and ${s.db.beds.filter(b => b.status === 'Available').length} are free.`, link: '/ipd/beds', label: 'Open bed map' }; }
    if (/wait|queue|delay/.test(t)) { const late = s.db.queue.filter(x => x.step < 6 && x.since > 25); return { answer: `${s.db.queue.filter(x => x.step < 6).length} patients are in the queue. ${late.length} have waited more than 25 minutes, mostly at ${late.length ? ['Registration', 'Billing', 'Triage', 'Consultation', 'Lab / imaging', 'Pharmacy'][late[0].step] : 'no step'}.`, link: '/queue', label: 'Open queue' }; }
    if (/revenue|collection|income/.test(t)) { const today = s.db.invoices.filter(i => i.date === s.today()); const tot = today.reduce((a, i) => a + s.invoiceTotals(i).paid, 0); return { answer: `Collections today are ₹${new Intl.NumberFormat('en-IN').format(Math.round(tot))} across ${today.length} invoices.`, link: '/billing', label: 'Open billing' }; }
    if (/stock|expir|medicine/.test(t)) { const low = s.db.medicines.filter(m => s.stock(m) <= m.reorder); return { answer: `${low.length} medicines are at or below reorder level, including ${low.slice(0, 3).map(m => m.brand).join(', ')}.`, link: '/pharmacy/inventory', label: 'Open pharmacy stock' }; }
    if (/no.?show|cancel/.test(t)) { const ns = s.db.appointments.filter(a => a.status === 'No-show').length; return { answer: `${ns} appointments are marked no-show in the demo data. WhatsApp reminders 24 hours ahead are the usual first fix.`, link: '/appointments', label: 'Open appointments' }; }
    if (/lab|tat|turnaround|report/.test(t)) { const pend = s.db.labOrders.filter(o => !['Verified', 'Delivered'].includes(o.status)).length; return { answer: `${pend} lab orders are still in progress. ${s.db.labOrders.filter(o => o.priority === 'STAT').length} are marked STAT.`, link: '/lab/orders', label: 'Open lab orders' }; }
    if (/claim|insur/.test(t)) { const pend = s.db.claims.filter(c => ['Submitted', 'Under review'].includes(c.status)); return { answer: `${pend.length} insurance claims are waiting on the insurer, worth ₹${new Intl.NumberFormat('en-IN').format(pend.reduce((a, c) => a + c.claimed, 0))}.`, link: '/insurance', label: 'Open claims' }; }
    return { answer: 'In this prototype I can answer questions about beds, queue delays, collections, medicine stock, no-shows, lab turnaround and insurance claims.' };
  }
}
