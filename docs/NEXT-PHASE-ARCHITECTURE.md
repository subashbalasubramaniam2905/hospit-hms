# Next-phase production architecture (recommendation)

This is a recommendation for discussion after the prototype is reviewed and approved. Nothing here has been built.

## Principles
1. **Keep the Angular front end.** The screens, shared components and typed models carry over. Replace `StoreService` with API clients one module at a time behind the same method names.
2. **Patient safety first.** Clinical decision support, AI assistance and any medication logic go through clinical validation, governance sign-off and audit before go-live.
3. **Standards at the boundary.** Store data in a relational model that suits the hospital, and expose and exchange it as FHIR R4, HL7 v2 and ABDM-compliant records.
4. **Compliance by design.** Plan for India's DPDP Act 2023, ABDM health data management policy, NABH documentation and CERT-In incident reporting from day one.

## Suggested shape

```
Angular SPA (staff)   Patient app / portal   Kiosk
        \                   |                 /
         API gateway (auth, rate limits, WAF)
                     |
   ┌───────────── Modular backend (one deployable, clear module boundaries) ─────────────┐
   │ Identity & RBAC │ Patients/MPI │ Scheduling & queue │ Clinical (EMR) │ Orders & results │
   │ Pharmacy & stock │ Billing & claims │ IPD & beds │ HR │ Notifications │ Audit │ Reports │
   └──────────────────────────────────────────────────────────────────────────────────────┘
        |                |                    |                  |
   PostgreSQL       Object storage       Message queue     Integration engine
   (per-module      (documents,          (events, retries)  (HL7 v2, FHIR, ABDM,
    schemas)         reports, images)                        LIS, PACS, payments, SMS)
```

- **Backend:** a modular monolith first (for example NestJS or .NET, or Java/Spring if the team prefers), split into services only where load or team ownership demands it.
- **Database:** PostgreSQL with row-level security per branch, point-in-time recovery, and read replicas for reporting.
- **Identity:** OpenID Connect provider (Keycloak or a managed equivalent) with MFA for all clinical and finance roles, short sessions and device trust. Server-side authorisation for every API call, mirroring the role matrix prototyped here.
- **Audit:** every read of a patient record and every change written to an append-only store, with export for compliance review.
- **Integration engine:** a dedicated component (for example a FHIR server plus an HL7 interface engine) so external systems never talk to module databases directly.
- **Events:** a queue (RabbitMQ, or a managed service) for notifications, lab results, billing triggers and workflow automation, with retries and dead-letter handling.
- **Files:** encrypted object storage for reports, scans and consent forms; DICOM images stay in PACS and are linked, not copied.
- **Hosting:** Indian data-centre region, separate production and non-production environments, infrastructure as code, encrypted backups tested by restore drills.

## AI and clinical decision support
- Keep AI strictly assistive: drafts and suggestions that a clinician accepts, edits or rejects, with the source data shown.
- Use a licensed, maintained drug-interaction and allergy knowledge base rather than hand-written rules.
- Log every suggestion, the model or rule version, and the clinician's decision. Monitor override rates.
- Run a clinical safety case (hazard log, risk assessment, clinical safety officer sign-off) before any CDS feature goes live.
- Never send identifiable data to an external model without a data processing agreement, de-identification where possible and patient consent where required.

## Delivery plan
1. **Foundation (6–8 weeks):** identity, RBAC, audit, patient master index, appointments and queue, notifications. Pilot at the front desk.
2. **OPD clinical (8–10 weeks):** consultation, prescriptions, lab orders and results with LIS integration, pharmacy dispensing and stock.
3. **Finance (6–8 weeks):** billing, payments, insurance and TPA, accounting export.
4. **Inpatient (8–10 weeks):** admissions, beds, nursing, MAR, OT, discharge.
5. **Insights and automation:** reporting warehouse, alerts, workflows, then validated AI assistance.

Each phase ends with user acceptance testing, security testing (including a third-party penetration test), performance testing and a go-live readiness review.

## Testing and quality
- Unit tests on domain rules; API contract tests; end-to-end tests for each critical journey (register → consult → prescribe → dispense → bill).
- Accessibility audit to WCAG 2.2 AA.
- Load tests sized to peak OPD hours across all branches.
