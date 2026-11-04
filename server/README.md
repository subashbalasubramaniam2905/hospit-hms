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
