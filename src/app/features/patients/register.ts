import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, Validators, AbstractControl } from '@angular/forms';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { SHARED, ageOf } from '../../shared';
import { StoreService, DuplicateMatch } from '../../core/services/store.service';
import { ToastService } from '../../core/services/toast.service';
import { SessionService } from '../../core/services/session.service';
import { PatientInput, PatientsApi } from '../../core/api/patients-api';
import { apiMessage } from '../../core/api/auth.service';
import { Patient } from '../../core/models';

const notFuture = (c: AbstractControl) => c.value && c.value > new Date().toISOString().slice(0, 10) ? { future: true } : null;

@Component({
  standalone: true, imports: [SHARED],
  template: `
  <div class="page">
    <cf-page-head title="Register patient" [crumbs]="['Patients', 'New registration']" sub="A unique UHID is generated when you save. Fields marked * are required.">
      <a class="btn ghost" routerLink="/patients">Cancel</a>
    </cf-page-head>
    <form class="layout" [formGroup]="f" (ngSubmit)="save(false)" novalidate>
      <div class="stack">
        <!-- Identity -->
        <section class="card" id="sec-id">
          <div class="card-h"><h3>Identity</h3><span class="muted small r">Step 1 of 5</span></div>
          <div class="idrow">
            <div class="photo"><cf-avatar [name]="f.value.name || '?'" size="xl"></cf-avatar>
              <label class="linkbtn small"><input type="file" accept="image/*" hidden (change)="photo($event)">{{ photoName() ? 'Change photo' : 'Add photo' }}</label>
              @if (photoName()) { <span class="hint">{{ photoName() }} (not stored)</span> }</div>
            <div class="form-grid" style="flex:1">
              <div class="field span2"><label for="name">Full name <span class="req">*</span></label><input id="name" class="inp" formControlName="name" placeholder="As on ID proof" (blur)="checkDup()">
                @if (err('name')) { <span class="errmsg">Enter the full name (at least 3 letters).</span> }</div>
              <div class="field"><label for="dob">Date of birth <span class="req">*</span></label><input id="dob" type="date" class="inp" formControlName="dob" [max]="today" (blur)="checkDup()">
                @if (err('dob')) { <span class="errmsg">{{ f.controls.dob.errors?.['future'] ? 'Date of birth cannot be in the future.' : 'Enter the date of birth.' }}</span> }
                @if (age() !== null) { <span class="hint">Age {{ age() }} years</span> }</div>
              <div class="field"><label>Gender <span class="req">*</span></label>
                <div class="chips">@for (g of ['Female', 'Male', 'Other']; track g) { <button type="button" class="chip" [class.on]="f.value.gender === g" (click)="f.controls.gender.setValue(g)">{{ g }}</button> }</div>
                @if (err('gender')) { <span class="errmsg">Select a gender.</span> }</div>
              <div class="field"><label for="blood">Blood group</label><select id="blood" class="inp" formControlName="blood"><option>Unknown</option>@for (b of ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']; track b) { <option>{{ b }}</option> }</select></div>
              <div class="field"><label for="doc">Primary doctor</label><select id="doc" class="inp" formControlName="doctor">@for (d of store.db.doctors; track d.id) { <option [value]="d.id">{{ d.name }} · {{ store.dept(d.deptId)?.name }}</option> }</select></div>
            </div>
          </div>
        </section>
        <!-- Contact -->
        <section class="card" id="sec-contact">
          <div class="card-h"><h3>Contact and address</h3><span class="muted small r">Step 2 of 5</span></div>
          <div class="form-grid">
            <div class="field"><label for="mobile">Mobile <span class="req">*</span></label><input id="mobile" class="inp" formControlName="mobile" inputmode="numeric" placeholder="10-digit mobile" (blur)="checkDup()">
              @if (err('mobile')) { <span class="errmsg">Enter a 10-digit Indian mobile number starting with 6–9.</span> }</div>
            <div class="field"><label for="email">Email</label><input id="email" class="inp" formControlName="email" placeholder="Optional">
              @if (err('email')) { <span class="errmsg">Enter a valid email or leave it empty.</span> }</div>
            <div class="field span2"><label for="line">Address</label><input id="line" class="inp" formControlName="line" placeholder="House, street, area"></div>
            <div class="field"><label for="city">City</label><input id="city" class="inp" formControlName="city"></div>
            <div class="form-grid" style="gap:10px"><div class="field"><label for="state">State</label><select id="state" class="inp" formControlName="state">@for (s of states; track s) { <option>{{ s }}</option> }</select></div>
              <div class="field"><label for="pin">PIN code</label><input id="pin" class="inp" formControlName="pin" inputmode="numeric">@if (err('pin')) { <span class="errmsg">6 digits.</span> }</div></div>
            <div class="field"><label for="ename">Emergency contact <span class="req">*</span></label><input id="ename" class="inp" formControlName="eName" placeholder="Name">@if (err('eName')) { <span class="errmsg">Enter a contact name.</span> }</div>
            <div class="form-grid" style="gap:10px"><div class="field"><label for="erel">Relation</label><select id="erel" class="inp" formControlName="eRel">@for (r of ['Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Friend']; track r) { <option>{{ r }}</option> }</select></div>
              <div class="field"><label for="ephone">Phone <span class="req">*</span></label><input id="ephone" class="inp" formControlName="ePhone" inputmode="numeric">@if (err('ePhone')) { <span class="errmsg">10 digits.</span> }</div></div>
          </div>
        </section>
        <!-- Medical -->
        <section class="card" id="sec-med">
          <div class="card-h"><h3>Medical background</h3><span class="muted small r">Step 3 of 5</span></div>
          <div class="stack">
            <div class="field"><label>Known allergies</label>
              <div class="chips">@for (a of allergies(); track a) { <span class="st r">{{ a }} <button type="button" class="x" (click)="toggleAllergy(a)" [attr.aria-label]="'Remove ' + a">×</button></span> }
                <input class="inp" style="width:200px" placeholder="Type and press Enter" (keydown.enter)="addAllergy($event)" aria-label="Add allergy"></div>
              <div class="chips">@for (a of commonAllergies; track a) { @if (!allergies().includes(a)) { <button type="button" class="chip" (click)="toggleAllergy(a)">+ {{ a }}</button> } }</div></div>
            <div class="field"><label>Chronic conditions</label>
              <div class="chips">@for (c of commonConditions; track c) { <button type="button" class="chip" [class.on]="conditions().includes(c)" (click)="toggleCond(c)">{{ c }}</button> }</div></div>
            <div class="form-grid">
              <div class="field"><label for="hist">Medical history</label><textarea id="hist" class="inp" rows="3" formControlName="history" placeholder="Past illnesses, hospitalisations"></textarea></div>
              <div class="field"><label for="meds">Current medicines</label><textarea id="meds" class="inp" rows="3" formControlName="medications" placeholder="Name, dose, frequency"></textarea></div>
            </div>
          </div>
        </section>
        <!-- Insurance & ABHA -->
        <section class="card" id="sec-ins">
          <div class="card-h"><h3>ABHA and insurance</h3><span class="muted small r">Step 4 of 5</span></div>
          <div class="form-grid">
            <div class="field span2"><label for="abha">ABHA number <span class="sim">ABDM sandbox · simulated</span></label>
              <div class="row" style="flex-wrap:nowrap"><input id="abha" class="inp" formControlName="abha" placeholder="14-digit ABHA number (optional)"><button type="button" class="btn ghost" (click)="verifyAbha()" [disabled]="abhaBusy()">{{ abhaBusy() ? 'Checking…' : 'Verify' }}</button><button type="button" class="btn soft-btn" (click)="createAbha()">Create ABHA</button></div>
              @if (err('abha')) { <span class="errmsg">ABHA number has 14 digits.</span> }
              @if (abhaOk()) { <span class="hint" style="color:var(--green)">ABHA verified against the sandbox. Name and year of birth match.</span> }</div>
            <div class="field span2"><mat-slide-toggle formControlName="insured">Patient has health insurance</mat-slide-toggle></div>
            @if (f.value.insured) {
              <div class="field"><label for="prov">Insurer / TPA <span class="req">*</span></label><select id="prov" class="inp" formControlName="provider"><option value="">Select</option>@for (p of store.db.providers; track p.id) { <option [value]="p.id">{{ p.name }}</option> }</select>@if (err('provider')) { <span class="errmsg">Select the insurer.</span> }</div>
              <div class="field"><label for="pol">Policy number <span class="req">*</span></label><input id="pol" class="inp" formControlName="policy">@if (err('policy')) { <span class="errmsg">Enter the policy number.</span> }</div>
              <div class="field"><label for="valid">Valid till</label><input id="valid" type="date" class="inp" formControlName="validTill"></div>
              <div class="field"><label for="sum">Sum insured (₹)</label><input id="sum" type="number" class="inp" formControlName="sum"></div>
            }
          </div>
        </section>
        <!-- Consent & documents -->
        <section class="card" id="sec-consent">
          <div class="card-h"><h3>Consent and documents</h3><span class="muted small r">Step 5 of 5</span></div>
          <div class="stack">
            <label class="drop"><input type="file" multiple hidden (change)="docs($event)"><lucide-icon name="upload" [size]="20"></lucide-icon><span><b>Upload ID proof or old reports</b><br><span class="muted small">Files stay in your browser for this demo and are not uploaded anywhere.</span></span></label>
            @for (d of files(); track d) { <div class="row small"><lucide-icon name="file-text" [size]="15"></lucide-icon>{{ d }}<cf-status s="Ready" tone="g"></cf-status></div> }
            <mat-checkbox formControlName="consent">The patient has read and agreed to the registration and data-sharing consent. <span class="req">*</span></mat-checkbox>
            @if (err('consent')) { <span class="errmsg">Consent is required to register the patient.</span> }
          </div>
        </section>
      </div>

      <aside class="side">
        <div class="card stack sticky">
          <h3 style="font-size:15px">Summary</h3>
          <div class="row" style="flex-wrap:nowrap"><cf-avatar [name]="f.value.name || '?'" size="lg"></cf-avatar><div><b>{{ f.value.name || 'New patient' }}</b><div class="muted small">{{ f.value.gender || 'Gender' }} · {{ age() ?? '–' }} y · {{ f.value.blood }}</div></div></div>
          <div class="soft small"><b>UHID</b><br>Generated on save (format HS-YY-NNNNN)</div>
          @if (dups().length) {
            <div class="alert-box warn" style="flex-direction:column">
              <b><lucide-icon name="triangle-alert" [size]="15"></lucide-icon> Possible duplicate record</b>
              @for (d of dups(); track d.patient.id) {
                <div class="dup"><div><b>{{ d.patient.name }}</b> · {{ d.patient.id }}<br><span class="small">{{ d.reasons.join(', ') }} · {{ d.score }}% match</span></div><a class="btn sm ghost" [routerLink]="['/patients', d.patient.id]">Open</a></div>
              }
              <mat-checkbox [checked]="dupAck()" (change)="dupAck.set($event.checked)">I checked these. This is a different person.</mat-checkbox>
              <span class="small">Matching is simulated using name, mobile and date of birth.</span>
            </div>
          }
          @if (submitted() && f.invalid) { <div class="alert-box crit">Fix the {{ invalidCount() }} highlighted fields to continue.</div> }
          <button class="btn" type="submit" [disabled]="saving()">@if (saving()) { Saving… } @else { Save patient }</button>
          <button class="btn ghost" type="button" [disabled]="saving()" (click)="save(true)">Save and book appointment</button>
        </div>
      </aside>
    </form>
  </div>`,
  styles: [`.layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:18px;align-items:start}.sticky{position:sticky;top:88px}
  .idrow{display:flex;gap:20px;align-items:flex-start}.photo{display:flex;flex-direction:column;align-items:center;gap:6px;width:110px;text-align:center}
  .drop{border:2px dashed var(--line);border-radius:12px;padding:16px;display:flex;gap:12px;align-items:center;cursor:pointer;color:var(--fg)}.drop:hover{border-color:var(--pri)}
  .st .x{border:0;background:none;color:inherit;padding:0 0 0 4px;font-weight:800}
  .dup{display:flex;justify-content:space-between;gap:8px;align-items:center;background:var(--card);border-radius:8px;padding:8px;color:var(--fg)}
  @media(max-width:1100px){.layout{grid-template-columns:1fr}.sticky{position:static}}@media(max-width:620px){.idrow{flex-direction:column;align-items:center}}`]
})
export class RegisterPage {
  store = inject(StoreService); toast = inject(ToastService); router = inject(Router);
  session = inject(SessionService); private patientsApi = inject(PatientsApi);
  saving = signal(false);
  today = new Date().toISOString().slice(0, 10);
  states = ['Tamil Nadu', 'Karnataka', 'Kerala', 'Andhra Pradesh', 'Telangana', 'Maharashtra', 'Delhi', 'Other'];
  commonAllergies = ['Penicillin', 'Sulfonamides', 'NSAIDs', 'Peanuts', 'Latex', 'Iodinated contrast'];
  commonConditions = ['Type 2 diabetes', 'Hypertension', 'Asthma', 'Hypothyroidism', 'Coronary artery disease', 'Osteoarthritis', 'Chronic kidney disease', 'Pregnancy'];
  allergies = signal<string[]>([]); conditions = signal<string[]>([]); files = signal<string[]>([]); photoName = signal('');
  dups = signal<DuplicateMatch[]>([]); dupAck = signal(false); submitted = signal(false); abhaBusy = signal(false); abhaOk = signal(false);
  f = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(3)]], dob: ['', [Validators.required, notFuture]], gender: ['', Validators.required], blood: ['Unknown'], doctor: ['D01'],
    mobile: ['', [Validators.required, Validators.pattern(/^[6-9]\d{9}$/)]], email: ['', Validators.email], line: [''], city: ['Udumalpet'], state: ['Tamil Nadu'], pin: ['', Validators.pattern(/^\d{6}$/)],
    eName: ['', Validators.required], eRel: ['Spouse'], ePhone: ['', [Validators.required, Validators.pattern(/^[6-9]\d{9}$/)]],
    history: [''], medications: [''], abha: ['', Validators.pattern(/^\d{2}-?\d{4}-?\d{4}-?\d{4}$/)], insured: [false], provider: [''], policy: [''], validTill: [''], sum: [500000], consent: [false, Validators.requiredTrue],
  });
  private v = toSignal(this.f.valueChanges, { initialValue: this.f.getRawValue() });
  age = computed(() => { const d = this.v().dob; return d ? ageOf(d) : null; });
  invalidCount = computed(() => { this.v(); return Object.values(this.f.controls).filter(c => c.invalid).length; });
  constructor() {
    this.f.controls.insured.valueChanges.subscribe(on => {
      for (const k of ['provider', 'policy'] as const) { this.f.controls[k].setValidators(on ? Validators.required : null); this.f.controls[k].updateValueAndValidity(); }
    });
  }
  err(k: keyof typeof this.f.controls) { const c = this.f.controls[k]; return c.invalid && (c.touched || this.submitted()); }
  async checkDup() {
    const v = this.f.getRawValue(); if (v.name.length < 3 && v.mobile.length < 10) return;
    if (this.session.live) {
      try { this.dups.set(await this.patientsApi.duplicates(v.name, v.mobile, v.dob || undefined)); }
      catch { this.dups.set([]); }
    } else this.dups.set(this.store.findDuplicates(v.name, v.mobile, v.dob));
    this.dupAck.set(false);
  }
  toggleAllergy(a: string) { this.allergies.update(l => l.includes(a) ? l.filter(x => x !== a) : [...l, a]); }
  addAllergy(e: Event) { e.preventDefault(); const el = e.target as HTMLInputElement; const v = el.value.trim(); if (v && !this.allergies().includes(v)) this.allergies.update(l => [...l, v]); el.value = ''; }
  toggleCond(c: string) { this.conditions.update(l => l.includes(c) ? l.filter(x => x !== c) : [...l, c]); }
  photo(e: Event) { const f = (e.target as HTMLInputElement).files?.[0]; if (f) this.photoName.set(f.name); }
  docs(e: Event) { const fl = Array.from((e.target as HTMLInputElement).files ?? []).map(f => `${f.name} · ${(f.size / 1024).toFixed(0)} KB`); this.files.update(l => [...l, ...fl]); }
  verifyAbha() {
    const c = this.f.controls.abha; c.markAsTouched(); if (!c.value || c.invalid) { this.toast.warn('Enter a 14-digit ABHA number to verify'); return; }
    this.abhaBusy.set(true); setTimeout(() => { this.abhaBusy.set(false); this.abhaOk.set(true); this.toast.ok('ABHA verified (sandbox simulation)'); }, 900);
  }
  createAbha() {
    if (!/^[6-9]\d{9}$/.test(this.f.value.mobile || '')) { this.f.controls.mobile.markAsTouched(); this.toast.warn('Enter the mobile number first. An OTP is sent to it to create the ABHA.'); return; }
    const n = () => Math.floor(1000 + Math.random() * 9000);
    this.f.controls.abha.setValue(`91-${n()}-${n()}-${n()}`); this.abhaOk.set(true); this.toast.ok('OTP verified and ABHA created (simulated)');
  }
  async save(book: boolean) {
    if (this.saving()) return;
    this.submitted.set(true); this.f.markAllAsTouched();
    if (this.f.invalid) { this.toast.err('Some required fields are missing or invalid'); return; }
    if (!this.dupAck()) await this.checkDup();
    if (this.dups().length && !this.dupAck()) { this.toast.warn('Review the possible duplicate before saving'); return; }
    const v = this.f.getRawValue();
    const input: PatientInput = {
      name: v.name.trim(), dob: v.dob, gender: v.gender as 'Female', mobile: '+91 ' + v.mobile.slice(0, 5) + ' ' + v.mobile.slice(5), email: v.email || undefined,
      address: { line: v.line, city: v.city, state: v.state, pin: v.pin }, blood: v.blood, allergies: this.allergies(), conditions: this.conditions(),
      history: v.history || 'No significant past medical history.', medications: v.medications || 'None', emergency: { name: v.eName, relation: v.eRel, phone: '+91 ' + v.ePhone },
      insurance: v.insured ? { providerId: v.provider, policyNo: v.policy, validTill: v.validTill || this.store.day(365), sumInsured: +v.sum } : undefined,
      abha: v.abha ? v.abha.replace(/\D/g, '').replace(/^(\d{2})(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3-$4') : undefined, consent: 'Given', primaryDoctorId: v.doctor,
    };
    let p: Patient;
    if (this.session.live) {
      this.saving.set(true);
      try { p = this.store.upsertPatient(await this.patientsApi.create({ ...input, branchId: this.session.branchId() })); }
      catch (e) { this.toast.err(apiMessage(e, 'Could not register the patient')); return; }
      finally { this.saving.set(false); }
    } else p = this.store.addPatient(input);
    this.files().forEach((d, i) => p.documents.push({ id: 'DOC-N' + i, name: d.split(' · ')[0], type: 'Upload', date: this.store.today(), size: d.split(' · ')[1] }));
    this.toast.ok(`Registered ${p.name} · UHID ${p.id}`);
    this.router.navigate(book ? ['/appointments/new'] : ['/patients', p.id], book ? { queryParams: { patient: p.id } } : {});
  }
}
