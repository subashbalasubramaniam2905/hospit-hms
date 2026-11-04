# Known prototype limitations

HospitOS is a review prototype. It is **not production-ready** and must not be used with real patients.

> **Live mode (in progress).** With `apiUrl` set in `config.js`, sign-in, staff accounts, patients and the audit trail run on the HospitOS server (`server/`): real authentication, server-side role and branch checks, and an append-only audit log. The points below still apply to every other module and to demo mode. Before real patient data goes in, a pilot review is still needed (hosting in India, backups, penetration test, DPDP consent process).

## Data and storage
- All data is fictional and generated in the browser (`core/data/seed.ts`).
- Changes live only in this browser's LocalStorage. They are not shared between users or devices and are lost if storage is cleared.
- There is no server, database, backup, concurrency control or data validation beyond the form level.
- Only the Udumalpet branch has full records. Pollachi and Palani show sample figures on the branches screen.

## Security and access
- Sign-in accepts any valid-looking email and a 6-character password. There is no real authentication, session expiry or MFA.
- Role permissions are enforced only in the browser (sidebar and route guard). The permission matrix changes last for the current browser session.
- Audit entries are written to LocalStorage and can be cleared. Production needs append-only, tamper-evident storage.
- No encryption at rest, no consent management beyond a checkbox, no DPDP Act or ABDM compliance work.

## Clinical safety
- AI summaries, differentials, test suggestions, discharge drafts and the operations assistant are fixed rules over demo data. No language model is called.
- Safety alerts (allergy, interaction, dose, condition, potassium) use a small hand-written rule set. They will miss real risks and are labelled "Demo alert, not validated clinical decision support".
- NEWS2 is simplified (assumes alert patient on room air).
- ICD-10 list has about 45 codes; the formulary has 48 medicines.
- No clinical content has been reviewed by clinicians.

## Simulated integrations
- SMS, email, WhatsApp, OTP, payment gateway, insurer and TPA decisions, ABDM/ABHA, HL7, FHIR, LIS analysers, PACS/DICOM, barcode scanners, printers, biometric attendance and accounting export are all mocked. Nothing leaves the browser.
- Voice dictation types a canned sentence; it does not use the microphone.
- The radiology viewer shows a placeholder image.

## Product gaps
- Languages other than English are not translated (the kiosk shows the switch only).
- Payroll, statutory reports, full GST returns, MLC/police case handling, blood bank, dietary, CSSD, ambulance dispatch and teleconsultation video are not included.
- Workflow builder runs are visual simulations; workflows do not execute.
- Report figures before today for some charts (bed occupancy trend, lab TAT) are illustrative.
- Accessibility has been considered (labels, contrast, keyboard focus) but not audited against WCAG 2.2.
- No automated unit or end-to-end test suite is committed; testing so far was scripted browser checks across every route and role.
