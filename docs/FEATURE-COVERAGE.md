# Feature coverage checklist

Status key: **Built** = interactive in the prototype · **Simulated** = the UI works but the outside effect (SMS, payment, device, insurer) is faked · **Not in prototype** = deliberately left for the production phase.

All 45 routes were tested for every role's dashboard, at desktop (1440 px) and phone (390 px) widths, in light and dark mode, with no console errors and no horizontal scrolling.

## 1. Access, layout and platform

| Feature | Status | Where |
|---|---|---|
| Sign in, forgot password, remember me | Built (any valid email + 6-char password) | `#/login` |
| 12 roles with role-based sidebar and dashboards | Built | `#/select-role`, profile menu |
| Light and dark mode | Built | Top bar |
| Global search (patients, UHID, mobile, pages) with Ctrl+K | Built | Top bar |
| Notification bell, toasts with undo/links | Built | Top bar |
| Branch switcher | Built (only Udumalpet has full data) | Top bar |
| Responsive layout with mobile drawer navigation | Built | All screens |
| Empty, loading and error states | Built | Shared components |
| Print and CSV export | Built | Most list and document screens |
| 404 page | Built | Any unknown route |

## 2. Front desk

| Feature | Status | Where |
|---|---|---|
| Patient directory with search, filters, sort, paging, CSV | Built | `#/patients` |
| Registration with duplicate detection, ABHA field, consent, insurance | Built | `#/patients/new` |
| Unified patient profile: overview, visits, Rx, labs and imaging, billing, documents, timeline, HbA1c trend | Built | `#/patients/:id` |
| Appointment calendar: day, week, month, list; overlap lanes; reschedule; reminders; no-show | Built | `#/appointments` |
| Booking with live conflict check, nearest free slots, walk-in, recurring | Built | `#/appointments/new` |
| Queue and patient journey, 7 lanes, drag and drop, priority, announce token | Built | `#/queue` |
| Self-service kiosk: check-in by mobile or UHID, walk-in token, new registration | Built (printing simulated) | `#/kiosk` |

## 3. Clinical

| Feature | Status | Where |
|---|---|---|
| Consultation workspace: worklist, pinned patient bar, templates, vitals with BMI and flags, SOAP, voice dictation, ICD-10, orders, follow-up | Built | `#/consultation/:id` |
| AI assist lane (summary, differentials, tests, follow-up) with accept or dismiss | Simulated, labelled "Suggestions only" | Consultation |
| Review-and-sign with mandatory diagnosis, confirmation and override reason | Built | Consultation |
| Clinical notes, read and compare modes with diff highlights | Built | `#/clinical-notes/:id` |
| Prescription builder with formulary search, stock badges, dose and frequency, live printable preview | Built | `#/prescriptions/new` |
| Prescriptions list: print, send, repeat, dispense | Built | `#/prescriptions` |
| Demo safety alerts: allergy, interaction, duplicate, dose, condition, potassium | Simulated, labelled "Demo alert, not validated" | Rx builder, consultation, clinical safety |
| Nursing: ward tasks and MAR, OPD triage, SBAR handover | Built | `#/nursing` |
| Emergency: triage board, unknown patient registration, orders, admit | Built | `#/emergency` |
| Operation theatre: room timeline, booking with clash check, WHO checklist gate | Built | `#/ot` |

## 4. Diagnostics

| Feature | Status | Where |
|---|---|---|
| Lab orders pipeline with TAT | Built | `#/lab/orders` |
| Sample collection with barcode and scan | Built (scanner simulated) | `#/lab/samples` |
| Result entry, flags, previous values, verify, critical alerts | Built (analyser autofill simulated) | `#/lab/results` |
| Printable lab report and delivery | Built | `#/lab/report/:id` |
| Radiology board, simulated viewer, report templates | Built (no DICOM) | `#/radiology` |

## 5. Pharmacy and stores

| Feature | Status | Where |
|---|---|---|
| Pharmacy stock: batches, FEFO, expiry, adjust, transfer, reorder, return | Built | `#/pharmacy/inventory` |
| Dispensing: FEFO plan, substitution, GST, payment, counselling, labels | Built | `#/pharmacy/dispense` |
| Hospital inventory and assets with service schedule | Built | `#/inventory` |
| Procurement: requisitions, POs, approvals, goods receipt, suppliers | Built | `#/procurement` |

## 6. Finance

| Feature | Status | Where |
|---|---|---|
| Billing dashboard, 7-day chart, payment mix, unbilled alert | Built | `#/billing` |
| New invoice: tariff search, pending items, discount flag, insurance split | Built | `#/billing/new` |
| Tax invoice with amount in words (lakh/crore), payment, refund | Built (payments simulated) | `#/billing/invoice/:id` |
| Insurance and TPA claims pipeline, documents, decision, settlement | Built (insurer simulated) | `#/insurance` |
| Revenue leakage: unbilled services, high discounts, overdue balances, rejected claims | Built | `#/revenue-leakage` |

## 7. Inpatients

| Feature | Status | Where |
|---|---|---|
| IPD overview, ward occupancy, NEWS scores | Built | `#/ipd` |
| Bed map with status, transfer, admit to bed | Built | `#/ipd/beds` |
| Admission form with bed picker, estimate, advance, pre-auth | Built | `#/ipd/admit` |
| Admission record: notes, MAR, observations with NEWS2, intake/output, bill, discharge with AI draft | Built (AI draft labelled) | `#/ipd/admission/:id` |

## 8. Organisation and admin

| Feature | Status | Where |
|---|---|---|
| Staff directory, roster, leave, attendance, payroll preview | Built | `#/staff` |
| Notifications: message log, staff inbox, compose, channel rules | Simulated delivery | `#/notifications` |
| Users and roles, invite, suspend, MFA, permission matrix | Built (enforced in the UI only) | `#/admin/users` |
| Audit log and sign-in history, flag for review, export | Built | `#/admin/audit` |
| Hospital settings: profile, hours, booking and queue rules, tariff, taxes, departments, demo reset | Built | `#/admin/config` |
| Integrations: ABDM, HL7, FHIR, LIS, PACS, payments, SMS, email, WhatsApp, TPA, devices | Simulated | `#/admin/integrations` |
| Workflow builder with trigger, condition, action and test run | Simulated runs | `#/admin/workflows` |

## 9. Insights and AI

| Feature | Status | Where |
|---|---|---|
| Role dashboards with KPIs and charts | Built | `#/dashboard` |
| Alerts centre: acknowledge, assign, resolve, reopen | Built | `#/alerts` |
| Reports: 8 reports, filters, chart, table, CSV, print, schedule | Built (schedule simulated) | `#/reports` |
| Follow-ups: overdue list, bulk reminders, book | Built | `#/follow-ups` |
| Clinical safety review across active prescriptions | Simulated rules | `#/clinical-safety` |
| Multi-branch comparison | Built (sample figures for 2 branches) | `#/branches` |
| AI operations assistant | Simulated (keyword rules on demo data) | `#/assistant` |

## 10. Patient-facing

| Feature | Status | Where |
|---|---|---|
| Patient portal: OTP login, appointments, records, prescriptions, bills, feedback, mobile bottom nav | Built (OTP and payment simulated) | `#/portal` |
| Kiosk | Built | `#/kiosk` |
