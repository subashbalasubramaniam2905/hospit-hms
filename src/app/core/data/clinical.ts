/* Demo clinical reference data. NOT validated clinical decision support. Rules exist only to show how alerts would look. */
import { LabOrder, Patient, RxItem } from '../models';

export const ICD10: { code: string; label: string }[] = [
  { code: 'E11.9', label: 'Type 2 diabetes mellitus without complications' }, { code: 'E11.65', label: 'Type 2 diabetes mellitus with hyperglycaemia' },
  { code: 'E11.22', label: 'Type 2 diabetes mellitus with diabetic chronic kidney disease' }, { code: 'E03.9', label: 'Hypothyroidism, unspecified' },
  { code: 'E78.5', label: 'Hyperlipidaemia, unspecified' }, { code: 'E87.5', label: 'Hyperkalaemia' }, { code: 'E55.9', label: 'Vitamin D deficiency, unspecified' },
  { code: 'I10', label: 'Essential (primary) hypertension' }, { code: 'I25.10', label: 'Coronary artery disease of native coronary artery' },
  { code: 'I20.9', label: 'Angina pectoris, unspecified' }, { code: 'I48.91', label: 'Atrial fibrillation, unspecified' }, { code: 'I50.9', label: 'Heart failure, unspecified' },
  { code: 'J06.9', label: 'Acute upper respiratory infection, unspecified' }, { code: 'J02.9', label: 'Acute pharyngitis, unspecified' },
  { code: 'J18.9', label: 'Pneumonia, unspecified organism' }, { code: 'J45.909', label: 'Asthma, unspecified, uncomplicated' }, { code: 'J44.9', label: 'Chronic obstructive pulmonary disease, unspecified' },
  { code: 'A09', label: 'Infectious gastroenteritis and colitis, unspecified' }, { code: 'A90', label: 'Dengue fever (classical)' }, { code: 'A01.0', label: 'Typhoid fever' },
  { code: 'B54', label: 'Unspecified malaria' }, { code: 'R50.9', label: 'Fever, unspecified' }, { code: 'R51', label: 'Headache' }, { code: 'R10.9', label: 'Unspecified abdominal pain' },
  { code: 'R07.9', label: 'Chest pain, unspecified' }, { code: 'R05', label: 'Cough' }, { code: 'R11.2', label: 'Nausea with vomiting, unspecified' },
  { code: 'K21.9', label: 'Gastro-oesophageal reflux disease' }, { code: 'K29.70', label: 'Gastritis, unspecified' }, { code: 'K59.00', label: 'Constipation, unspecified' },
  { code: 'N39.0', label: 'Urinary tract infection, site not specified' }, { code: 'N18.2', label: 'Chronic kidney disease, stage 2 (mild)' },
  { code: 'M54.5', label: 'Low back pain' }, { code: 'M17.11', label: 'Primary osteoarthritis, right knee' }, { code: 'M79.1', label: 'Myalgia' },
  { code: 'G43.909', label: 'Migraine, unspecified' }, { code: 'F41.1', label: 'Generalised anxiety disorder' }, { code: 'L20.9', label: 'Atopic dermatitis, unspecified' },
  { code: 'L70.0', label: 'Acne vulgaris' }, { code: 'E28.2', label: 'Polycystic ovarian syndrome' }, { code: 'O80', label: 'Encounter for full-term uncomplicated delivery' },
  { code: 'Z00.00', label: 'General adult medical examination' }, { code: 'Z23', label: 'Encounter for immunisation' }, { code: 'D50.9', label: 'Iron deficiency anaemia, unspecified' },
];

export interface ConsultTemplate { name: string; cc: string; hpi: string; exam: string; plan: string; tests: string[]; }
export const TEMPLATES: ConsultTemplate[] = [
  { name: 'General medicine', cc: '', hpi: 'Onset:\nDuration:\nAssociated symptoms:', exam: 'General: conscious, oriented, afebrile.\nCVS: S1 S2 heard.\nRS: clear.\nAbdomen: soft, non-tender.', plan: '', tests: [] },
  { name: 'Diabetes care', cc: 'Diabetes review', hpi: 'Home glucose readings:\nHypoglycaemia episodes:\nMedication adherence:\nDiet and activity:', exam: 'Foot exam: pulses, sensation, skin.\nBP and weight recorded.', plan: 'Review medicines. Diet counselling. Repeat HbA1c in 3 months.', tests: ['L04', 'L02'] },
  { name: 'Hypertension review', cc: 'BP review', hpi: 'Home BP readings:\nHeadache, chest pain, breathlessness:\nSalt intake:', exam: 'BP both arms. Pedal oedema. Fundus if indicated.', plan: 'Continue antihypertensives. Low-salt diet. Review in 4 weeks.', tests: ['L08', 'L05'] },
  { name: 'Fever', cc: 'Fever', hpi: 'Fever for __ days, grade:\nChills, rash, joint pain:\nCough, dysuria, loose stools:\nTravel history:', exam: 'Temperature, hydration, rash, lymph nodes, throat, chest, abdomen.', plan: 'Antipyretics. Oral fluids. Review if fever persists beyond 3 days.', tests: ['L01', 'L16', 'L17'] },
  { name: 'Paediatric visit', cc: '', hpi: 'Feeding:\nImmunisation status:\nDevelopment:', exam: 'Weight and height plotted on growth chart.', plan: '', tests: [] },
  { name: 'Cardiology follow-up', cc: 'Cardiac review', hpi: 'Chest pain, exertional breathlessness, palpitations:\nAdherence to antiplatelets and statin:', exam: 'Pulse, BP, JVP, heart sounds, basal crepitations, pedal oedema.', plan: 'Continue secondary prevention. ECG today.', tests: ['L05', 'L08', 'L14'] },
];

export const FREQUENCIES = ['Once daily (1-0-0)', 'At night (0-0-1)', 'Twice daily (1-0-1)', 'Three times daily (1-1-1)', 'Four times daily', 'Every 6 hours', 'As needed (SOS)', 'Weekly', 'Stat (once)'];
export const DURATIONS = ['1 day', '3 days', '5 days', '7 days', '10 days', '14 days', '1 month', '3 months', 'Until review', 'Continue'];
export const FOOD = ['After food', 'Before food', 'With food', 'Empty stomach', 'At bedtime', 'Not applicable'];

export interface SafetyAlert { level: 'crit' | 'warn' | 'info'; kind: 'Allergy' | 'Interaction' | 'Duplicate' | 'Dose' | 'Condition' | 'Lab'; title: string; detail: string; meds: string[]; }

const ALLERGY_CLASS: Record<string, RegExp> = {
  Sulfonamides: /sulfa|sulpha|trimethoprim/i, Penicillin: /amoxicillin|ampicillin|penicillin|clavulan|piperacillin/i,
  NSAIDs: /ibuprofen|diclofenac|aceclofenac|naproxen|aspirin|ketorolac/i, 'Iodinated contrast': /contrast|iohexol|iopamidol/i,
};
const INTERACTIONS: { a: RegExp; b: RegExp; level: 'crit' | 'warn'; text: string }[] = [
  { a: /clopidogrel/i, b: /omeprazole/i, level: 'warn', text: 'Omeprazole may reduce the antiplatelet effect of clopidogrel. Pantoprazole is often preferred.' },
  { a: /aspirin/i, b: /ibuprofen|diclofenac|aceclofenac/i, level: 'warn', text: 'NSAIDs with aspirin raise bleeding risk and may blunt cardioprotection.' },
  { a: /enoxaparin/i, b: /aspirin|clopidogrel|ibuprofen|diclofenac/i, level: 'crit', text: 'Anticoagulant with antiplatelet or NSAID: high bleeding risk. Confirm indication.' },
  { a: /telmisartan/i, b: /potassium/i, level: 'warn', text: 'ARB with potassium supplements can raise serum potassium.' },
  { a: /ciprofloxacin/i, b: /ondansetron|azithromycin/i, level: 'warn', text: 'Both can prolong the QT interval.' },
  { a: /glimepiride/i, b: /insulin/i, level: 'warn', text: 'Sulfonylurea with insulin increases hypoglycaemia risk.' },
];

/** Demo-only safety screen. Returns alerts that look like real CDS but are NOT clinically validated. */
export function safetyCheck(p: Patient | undefined, items: RxItem[], labs: LabOrder[] = []): SafetyAlert[] {
  if (!p) return [];
  const out: SafetyAlert[] = []; const names = items.map(i => `${i.generic || i.name}`);
  for (const al of p.allergies) {
    const re = ALLERGY_CLASS[al]; if (!re) continue;
    items.filter(i => re.test(i.generic + ' ' + i.name)).forEach(i => out.push({ level: 'crit', kind: 'Allergy', title: `${i.name} conflicts with recorded ${al} allergy`, detail: `The patient record lists an allergy to ${al}. Choose an alternative or document why the benefit outweighs the risk.`, meds: [i.name] }));
    if (al === 'Sulfonamides') items.filter(i => /glimepiride|furosemide/i.test(i.generic)).forEach(i => out.push({ level: 'info', kind: 'Allergy', title: `${i.name}: possible sulfonamide cross-sensitivity`, detail: 'Cross-reactivity with non-antibiotic sulfonamides is uncommon. Monitor for rash.', meds: [i.name] }));
  }
  for (const r of INTERACTIONS) {
    const A = names.filter(n => r.a.test(n)), B = names.filter(n => r.b.test(n));
    if (A.length && B.length && A[0] !== B[0]) out.push({ level: r.level, kind: 'Interaction', title: `${A[0]} + ${B[0]}`, detail: r.text, meds: [A[0], B[0]] });
  }
  const seen = new Map<string, string>();
  items.forEach(i => { const g = (i.generic || i.name).toLowerCase(); if (seen.has(g)) out.push({ level: 'warn', kind: 'Duplicate', title: `${i.generic} prescribed twice`, detail: 'Two lines contain the same active ingredient.', meds: [i.name] }); seen.set(g, i.name); });
  const nsaids = items.filter(i => /ibuprofen|diclofenac|aceclofenac/i.test(i.generic)); if (nsaids.length > 1) out.push({ level: 'warn', kind: 'Duplicate', title: 'Two NSAIDs on one prescription', detail: nsaids.map(n => n.name).join(' and ') + ' belong to the same class.', meds: nsaids.map(n => n.name) });
  items.filter(i => /paracetamol/i.test(i.generic) && /650/.test(i.strength) && /four|6 hours/i.test(i.frequency)).forEach(i => out.push({ level: 'warn', kind: 'Dose', title: 'Paracetamol 650 mg four times daily is 2.6 g a day', detail: 'Within the usual adult limit of 4 g a day, but check other paracetamol-containing products.', meds: [i.name] }));
  if (p.conditions.some(c => /kidney/i.test(c))) items.filter(i => /ibuprofen|diclofenac|aceclofenac/i.test(i.generic)).forEach(i => out.push({ level: 'warn', kind: 'Condition', title: `${i.name} with chronic kidney disease`, detail: 'NSAIDs can worsen kidney function. Consider paracetamol.', meds: [i.name] }));
  if (p.conditions.includes('Asthma')) items.filter(i => /metoprolol|propranolol/i.test(i.generic)).forEach(i => out.push({ level: 'warn', kind: 'Condition', title: `${i.name} in a patient with asthma`, detail: 'Beta blockers can trigger bronchospasm.', meds: [i.name] }));
  const k = labs.map(o => o.results['L08']?.['Potassium'] ?? o.results['L19']?.['Potassium']).find(v => v != null) as number | undefined;
  if (k != null && k >= 5.5) items.filter(i => /telmisartan|losartan|enalapril|spironolactone/i.test(i.generic)).forEach(i => out.push({ level: 'crit', kind: 'Lab', title: `${i.name} with potassium ${k} mmol/L`, detail: 'The latest potassium is above the critical limit. Review before continuing an ARB or ACE inhibitor.', meds: [i.name] }));
  return out;
}

/** Simplified NEWS2 early-warning score (demo; assumes alert, room air). Temperature in °F. */
export function news2(v: { rr: number; spo2: number; bp: string; hr: number; temp: number }): number {
  const sys = +String(v.bp).split('/')[0]; const c = (v.temp - 32) * 5 / 9; let s = 0;
  s += v.rr <= 8 ? 3 : v.rr <= 11 ? 1 : v.rr <= 20 ? 0 : v.rr <= 24 ? 2 : 3;
  s += v.spo2 <= 91 ? 3 : v.spo2 <= 93 ? 2 : v.spo2 <= 95 ? 1 : 0;
  s += sys <= 90 ? 3 : sys <= 100 ? 2 : sys <= 110 ? 1 : sys <= 219 ? 0 : 3;
  s += v.hr <= 40 ? 3 : v.hr <= 50 ? 1 : v.hr <= 90 ? 0 : v.hr <= 110 ? 1 : v.hr <= 130 ? 2 : 3;
  s += c <= 35 ? 3 : c <= 36 ? 1 : c <= 38 ? 0 : c <= 39 ? 1 : 2;
  return s;
}
