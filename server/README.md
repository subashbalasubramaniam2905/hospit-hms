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
