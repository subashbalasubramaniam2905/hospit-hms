# HospitOS server

Spring Boot 3 (Java 21) API with PostgreSQL. The Angular app in the repository root talks to it.

## Run locally

```bash
# PostgreSQL 14+ with a database and user named hospit (password hospit), or set DATABASE_URL etc.
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='ChooseAStrong1' mvn spring-boot:run
```

On an empty database the first start creates a super administrator from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
Flyway applies the migrations in `src/main/resources/db/migration` automatically.

Tests use a separate database (`hospit_test`, or `TEST_DATABASE_URL`) which they wipe and rebuild: `mvn test`.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `jdbc:postgresql://localhost:5432/hospit` | JDBC URL. For Supabase add `?sslmode=require`. |
| `DATABASE_USER`, `DATABASE_PASSWORD` | `hospit` | |
| `JWT_SECRET` | dev-only value | **Required in every real environment**, 32+ random characters. |
| `TOKEN_HOURS` | `8` | Sign-in lifetime. |
| `CORS_ORIGINS` | `http://localhost:4200` | Comma-separated origins of the Angular app. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | empty | First super administrator, used only when no accounts exist. |
| `PORT` | `8080` | |

## API (foundation)

| Method and path | Who | What |
| --- | --- | --- |
| `POST /api/auth/login` | anyone | `{email, password}` → `{token, expiresAt, user}`. Five wrong passwords lock the account for 15 minutes. Accounts on a temporary password (`user.mustChangePw`) get 403 `PASSWORD_CHANGE_REQUIRED` everywhere until they change it. |
| `GET /api/auth/me`, `POST /api/auth/password` | signed in | Current account; change own password (returns a fresh token and signs out other sessions). |
| `GET/POST /api/users`, `PUT /api/users/{id}`, `POST /api/users/{id}/reset-password` | super-admin, admin | Staff accounts. Branch admins manage only their branches and cannot create super admins. |
| `GET /api/branches`, `/api/departments`, `/api/doctors` | signed in | Limited to the user's branches. |
| `GET /api/patients?q=`, `GET /api/patients/{id}`, `GET /api/patients/duplicates` | clinical, front desk, billing, lab, pharmacy, radiology | Search by name, UHID, mobile or ABHA. Opening a record is audited. |
| `POST /api/patients`, `PUT /api/patients/{id}` | super-admin, admin, doctor, nurse, receptionist | UHIDs are `HS-YY-NNNNN`. Updates must send `version`; a stale version returns 409. |
| `GET /api/audit`, `GET /api/audit/verify` | super-admin, admin (verify: super-admin) | Append-only, hash-chained audit trail, filtered to the admin's branches, and an integrity check. |

## API (appointments and OPD queue)

Front desk is `super-admin, admin, doctor, nurse, receptionist`. Everything is limited to the user's branches; pass `branch=BR2` to narrow a list.
Times are clinic time (`HOSPITOS_TIMEZONE`, default `Asia/Kolkata`), dates `YYYY-MM-DD`, times `HH:mm`.

| Method and path | Who | What |
| --- | --- | --- |
| `GET /api/appointments?from=&to=&doctorId=&patientId=&status=` | front desk, billing | Calendar. At most 400 days per call. |
| `GET /api/appointments/slots?doctorId=&date=&duration=` | front desk, billing | The doctor's slot grid for a day, each slot `{time, ok, reason}`, plus `dayBlock` when the doctor doesn't consult that day. |
| `GET /api/appointments/check?doctorId=&date=&time=&duration=&ignoreId=` | front desk, billing | Checks one time without booking. |
| `POST /api/appointments` | front desk | `{patientId, doctorId, date, time, duration, type, notes, recurring}` → `{appointment, repeats, skipped}`. 409 with the reason when the slot is taken, outside hours, in the break, on leave or already past. `recurring` (Weekly, Every 2 weeks, Monthly) adds up to 3 visits and lists dates it skipped. Today's bookings get a token. |
| `POST /api/appointments/walk-in` | front desk | `{patientId, doctorId, priority, emergency}` → `{appointment, queue}`. Books now and joins the queue at Billing. |
| `POST /api/appointments/{id}/status` | front desk | `{status}`. Arrived checks in to the queue; Waiting and In consultation move the queue; Cancelled and No-show take the patient out of it. |
| `POST /api/appointments/{id}/reschedule` | front desk | `{date, time}`. Scheduled or confirmed only. |
| `POST /api/appointments/{id}/reminder` | front desk | Records that a reminder was sent. No WhatsApp or SMS goes out yet. |
| `GET/POST /api/appointments/leave`, `DELETE /api/appointments/leave/{doctorId}/{date}` | read: front desk; change: super-admin, admin, receptionist | Doctor days off. Adding one returns the bookings that need moving. |
| `GET /api/queue?date=` | front desk, billing, pharmacy, lab, radiology | Today's queue: `{id, token, patientId, doctorId, deptId, step, since, arrivedAt, priority, emergency, appointmentId, history}`. Steps 0 to 6 are Registration, Billing, Triage, Consultation, Lab / imaging, Pharmacy, Discharge. `since` is minutes at the current step. |
| `POST /api/queue/{id}/move` | same | `{step}` or empty for the next step. Keeps the appointment status in step. |
| `POST /api/queue/call-next` | front desk | `{deptId, doctorId}` (optional). Calls the next patient at Triage into Consultation: emergency, then priority, then longest wait. 204 when nobody is waiting. |
| `PATCH /api/queue/{id}` | front desk | `{priority, emergency, doctorId}`. |
| `POST /api/queue/{id}/left` | front desk | Left without being seen. The appointment becomes a no-show. |

Double booking is blocked twice: bookings for one doctor-day are serialised with an advisory lock, and a Postgres exclusion
constraint rejects overlapping scheduled or confirmed bookings even if something slips past. Tokens (`G-001`, `C-014`) are per
branch, department and day, issued with an atomic upsert. Doctor hours come from `doctor.days/start_time/end_time/slot_min`, with a
daily break in `doctor.break_start/break_end` (13:00 to 14:00 by default).

## Conventions for modules

- **Package:** `com.hospitos.<module>` (for example `com.hospitos.appointments`). Controllers under `/api/<module>`.
- **Database:** plain SQL through `JdbcClient`. Flyway versions are reserved per module so parallel work never collides:
  foundation V1–V9, appointments and queue V10–V19, clinical V20–V29, billing V30–V39, pharmacy V40–V44, lab V45–V49.
  Use snake_case. Use `text` ids where the Angular model already has readable ids, `uuid` otherwise.
- **Keys you will reference:** `patient(id text)` (UHID), `branch(id text)` (`BR1` Udumalpet, `BR2` Pollachi, `BR3` Palani),
  `department(id text)`, `doctor(id text, dept_id, user_id → app_user)`, `app_user(id uuid)`.
- **Money:** `numeric(12,2)`, rupees.
- **Security:** roles are the Angular role ids. Check them with `@PreAuthorize("hasAnyRole('super-admin','admin','billing')")`.
  Read the signed-in user with `CurrentUser.get()` and scope every query to `CurrentUser.canSee(branchId)`.
- **Audit:** call `AuditService.logForBranch(branchId, action, entity, entityId, detail)` on every change and every read of a clinical record
  (pass the record's branch so that branch's admins can review it). `log(...)` without a branch is visible to super admins only.
- **Sessions:** role, branches and status are re-read from `app_user` on every request, so `CurrentUser` is always current.
- **Errors:** throw `ApiException(status, message)`. Responses are RFC 7807 problem details with the message in `detail`.
- **Optimistic locking:** editable records carry `version int`; updates send it and get 409 when stale.
- **Tests:** `@SpringBootTest` + MockMvc against PostgreSQL with `@ActiveProfiles("test")` and `@Import(CleanDatabase.class)`.
  See `FoundationTest` for signing in as different roles.

## API (clinical)

Consultations, vitals, diagnoses and prescriptions. Package `com.hospitos.clinical`, migrations V20–V22.
Only doctors write notes and sign prescriptions, and nurses may record vitals. Super-admin, admin, doctor and nurse can
read consultations; pharmacists can also read prescriptions; billing gets the consultation list without clinical text
(to find unbilled visits). A doctor account linked to a doctor profile can only write as that doctor. Every read of a single record is audited.

| Method and path | What |
| --- | --- |
| `GET /api/clinical/consultations?patientId=&doctorId=&status=&date=` | List, newest first (vitals history left out). |
| `POST /api/clinical/consultations` `{patientId, doctorId?, appointmentId?}` (doctorId defaults to the signed-in doctor) | Opens the patient's draft with this doctor, or starts one prefilled from the patient record and the last height and weight. |
| `GET /api/clinical/consultations/{id}` | `{consultation, prescription, alerts}`. |
| `PUT /api/clinical/consultations/{id}` | Saves a draft: notes, `dx[]`, `vitals` (a new reading when they changed) and `prescription {items, notes}` as the linked draft prescription. Needs `version`. |
| `POST /api/clinical/consultations/{id}/vitals` | Adds a vitals reading (doctor or nurse). |
| `POST /api/clinical/consultations/{id}/complete` `{version, prescription?, overrideReason?}` | Signs the consultation and signs the prescription and sends it to the pharmacy, in one transaction. |
| `GET /api/clinical/prescriptions?status=&patientId=` | List, for example `status=Sent to pharmacy`. |
| `GET /api/clinical/prescriptions/{id}` | `{prescription, alerts}`. |
| `POST /api/clinical/prescriptions`, `PUT /api/clinical/prescriptions/{id}` | Create or edit a draft. |
| `POST /api/clinical/prescriptions/{id}/sign` `{version, sendToPharmacy, overrideReason?}`, `POST .../{id}/send` | Sign, and send a signed prescription to the pharmacy. |
| `POST /api/clinical/prescriptions/check` `{patientId, items}` | Safety screen for unsaved lines. |

**Safety checks.** Lines are screened against the patient's recorded allergies (class rules such as Penicillin →
amoxicillin, plus any allergy recorded as a drug name), drug interactions and duplicate ingredients. The demo rules live in
`drug_allergy_rule` and `drug_interaction_rule` and are **not validated clinical decision support**; replace them with a
reviewed drug knowledge base before real use. Signing with a critical alert returns **422** with the alerts in `alerts`
until an `overrideReason` (5+ characters) is given; the reason is stored per alert in `prescription_override` and audited.

**For the pharmacy module:** `PrescriptionService.find(UUID)` and `PrescriptionService.markDispensed(UUID, partial)`
(allowed only from `Sent to pharmacy` or `Partially dispensed`). They do not check roles or audit, so the caller does.

## API (billing)

All amounts are rupees. GST is worked out on the server from the tariff and the category rates; the client never sends totals.
Invoices are never edited once issued: cancel (admin, nothing paid, no open claim) and raise a new one.

| Method and path | Who | What |
| --- | --- | --- |
| `GET /api/billing/settings`, `PUT /api/billing/settings` | read: billing staff · write: super-admin, admin | Hospital legal name, GSTIN (format and check digit verified), state, discount approval limit, default co-pay. Seeded with **sample** values (`sampleData: true`) until an admin saves real ones. A branch's own `branch.gstin` overrides the hospital GSTIN on its invoices. |
| `PUT /api/billing/tax-rates/{category}` | super-admin, admin | GST % and HSN/SAC per category (consultation, lab, imaging, room and nursing exempt; pharmacy 12%; other 18% by default). |
| `GET /api/billing/tariff?q=&category=`, `POST`, `PUT /api/billing/tariff/{id}` | read: billing staff · write: super-admin, admin | Price list. Doctor consultations appear as `DOC-<doctorId>` priced from the doctor's fee. Updates send `version`. |
| `GET /api/billing/invoices?q=&status=&kind=&patientId=&from=&to=` | billing, receptionist, admin, pharmacy, lab, radiology | Newest first; `status=OUTSTANDING` for unpaid and part-paid. |
| `POST /api/billing/invoices` | super-admin, admin, billing, receptionist | `{patientId, kind, discountPct, lines:[{tariffCode} or {description, category, rate}, qty, taxPct?, refType?, refId?]}`. Numbers are `INV-<FY>-NNNNNN`, gap-free per financial year. Discounts above the limit need an admin. |
| `POST /api/billing/invoices/{id}/payments` | cashiers | `{mode, amount, reference}`. Receipt `RCT-<FY>-NNNNNN`. Cannot exceed the balance. `INSURANCE` is only posted by settling a claim. |
| `POST /api/billing/invoices/{id}/refunds` | cashiers | `{amount, reason, mode}`. Voucher `RFD-<FY>-NNNNNN`. Cannot exceed what was paid. |
| `POST /api/billing/invoices/{id}/cancel` | super-admin, admin | `{reason}`. |
| `GET /api/billing/summary` | billing staff | Collected today, outstanding, insurance receivable, refunds this month, by payment mode, last 7 days by invoice type. |
| `GET /api/billing/billed?refType=CONSULTATION&refIds=a,b` | billing staff | Which references are already on a live invoice (revenue leakage checks). |
| `GET /api/billing/insurance-providers`, `/api/billing/claim-documents` | billing, front desk, clinical | Insurers/TPAs (sample list, ids `IP1`–`IP5`) and the claim checklist. |
| `GET/POST /api/billing/claims`, `PUT /api/billing/claims/{id}/documents`, `POST /api/billing/claims/{id}/status` | super-admin, admin, billing | Claim workflow DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → SETTLED (REJECTED can be resubmitted). Settling with a UTR posts an `INSURANCE` payment to the invoice. TPA/NHCX portals are not connected yet. |

Other modules raise invoices in-process through `com.hospitos.billing.api.BillingApi` (`createInvoice`, `recordPayment`,
`isBilled`); the call joins the caller's transaction.

## API (pharmacy)

Stock is held per branch. Reads use the signed-in user's first branch unless `?branchId=` names another branch they can see.

| Method and path | Who | What |
| --- | --- | --- |
| `GET /api/pharmacy/medicines?q=&branchId=`, `GET /api/pharmacy/medicines/{id}` | pharmacist, doctor, nurse, inventory, admins | Formulary with branch stock and batches, earliest expiry first. |
| `GET /api/pharmacy/medicines/{id}/fefo?qty=` | same | Which batches a quantity would come from. Expired batches are never used. |
| `POST /api/pharmacy/medicines`, `PUT /api/pharmacy/medicines/{id}` | pharmacist, admins | Add or edit a medicine (`version` required on update). Ids are `M001`... |
| `POST /api/pharmacy/medicines/{id}/batches` | pharmacist, admins | Receive stock into a batch. |
| `POST /api/pharmacy/stock/adjust`, `POST /api/pharmacy/stock/transfer` | pharmacist, admins | Count corrections, damage, returns to supplier, and first-expiry-first-out transfers between branches. |
| `GET /api/pharmacy/stock/moves`, `GET /api/pharmacy/suppliers` | pharmacy readers | Stock movement ledger and suppliers. |
| `POST /api/pharmacy/dispense` | pharmacist, admins | `{prescriptionId, payMode, counselled, lines:[{medicineId, qty, substitutedFor?}]}`. Takes stock FEFO, raises and settles a pharmacy invoice through billing, and marks the prescription Dispensed or Partially dispensed, all in one transaction. A substitute must share the generic. |
| `GET /api/pharmacy/prescriptions/{id}/remaining`, `GET /api/pharmacy/dispenses?from=&to=` | pharmacist, admins | What is left to hand out on a prescription; dispenses by day. |

`V41__pharmacy_sample_stock.sql` loads fictional stock for the demo branches. Remove its rows before going live.

## API (laboratory)

Order flow: Awaiting sample → Sample collected → Processing → Result ready → Verified → Delivered. A rejected sample goes back to Awaiting sample; Result ready can be reopened until it is verified.

| Method and path | Who | What |
| --- | --- | --- |
| `GET /api/lab/tests` | lab, clinical, front desk, billing | Test catalogue with reference and critical ranges. |
| `GET /api/lab/orders?status=&patientId=&priority=&q=&from=&to=`, `GET /api/lab/orders/{id}`, `GET /api/lab/scan/{sampleOrOrderId}` | same | Orders in the user's branches. Opening one is audited. |
| `POST /api/lab/orders` | doctor, nurse, receptionist, lab-tech, admins | `{patientId, doctorId, testIds, priority, bill}`. Ids are `LO05200`...; with `bill` (default true) a lab invoice is raised through billing. |
| `POST /api/lab/orders/{id}/collect`, `/reject`, `/receive` | lab-tech (nurses may collect), admins | Sample ids are `SMP089000`... |
| `PUT /api/lab/orders/{id}/results` | lab-tech, admins | `{results:{testId:{param:value}}, comments, version, submit}`. `submit` needs every value and moves to Result ready; flags N/L/H/C are worked out from the ranges. |
| `POST /api/lab/orders/{id}/reopen`, `/verify` | lab-tech, doctor, admins | Verify returns the critical values, which are also written to the audit trail. |
| `POST /api/lab/orders/{id}/deliver`, `GET /api/lab/orders/{id}/report` | lab-tech, admins / lab readers | Report includes each parameter's flag and the patient's previous verified value. |
