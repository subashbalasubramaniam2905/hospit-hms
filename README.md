# HospitOS (prototype)

HospitOS Multispeciality Hospital, Udumalpet, Tamil Nadu (fictional demo setting).

An interactive, front-end-only prototype of a hospital management system, built for design and workflow review.

> **Prototype only.** Every patient, doctor, invoice and result is fictional. There is no backend, no real patient data and no connection to any hospital system or healthcare API. AI outputs and clinical safety alerts are rule-based demos, not validated clinical decision support. This is not production software.

## Run it

Requirements: Node.js 20 or later and npm.

```bash
npm install
npm start            # http://localhost:4200
```

Build a static copy that can be opened from any folder or web host:

```bash
npm run build:demo   # output in dist/hospit-hms/browser
```

`npm start` and `npm run build` regenerate the icon registry first (`gen-icons.mjs`). If you add a Lucide icon name that only appears inside TypeScript logic, add it to `scripts-icons.txt`.

## GitHub Pages

Every push to `main` builds the prototype and publishes it with `.github/workflows/pages.yml`. One-time setup: in the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**. The site appears at `https://<user>.github.io/hospit-hms/`. A Pages site is public, so keep it to fictional data.

## Demo mode and live mode

The app runs in one of two modes, set in `public/config.js` (served as `config.js` next to `index.html`, editable after deploy without a rebuild):

- **Demo mode** (`apiUrl: ''`, the default, and what GitHub Pages serves): fictional data in this browser, role picker, everything below.
- **Live mode** (`apiUrl: 'https://your-api-host'`): real staff sign-in against the HospitOS server in `server/`, forced change of temporary passwords, and patients (search, registration with duplicate check, profile, edits) stored on the server with every view and change audited. Real patient records are never written to browser storage. Other modules still show sample data until they are connected. The kiosk does not register patients in live mode.

To try live mode locally: start the server (see `server/README.md`), set `CORS_ORIGINS=http://localhost:4200`, set `apiUrl: 'http://localhost:8080'` in `public/config.js`, and run `npm start`. Sign in with the `ADMIN_EMAIL` account and create staff with `POST /api/users`.

## Signing in (demo mode)

The login screen is pre-filled (any valid email and a password of 6 or more characters works). After signing in, pick one of 12 roles. Each role gets its own dashboard and sidebar:

| Role | Demo user | Lands on |
|---|---|---|
| Super administrator | Super Admin (demo) | Admin dashboard, all branches |
| Hospital administrator | Meera Rao | Admin dashboard |
| Doctor | Dr. Sana Iqbal | Doctor dashboard, consultation worklist |
| Nurse | Rekha Pillai | Ward and triage dashboard |
| Receptionist | Arun Prakash | Front desk dashboard |
| Pharmacist | Farzana Ali | Pharmacy dashboard |
| Laboratory technician | Santosh Gowda | Lab dashboard |
| Radiologist | Dr. Farah Siddiqui | Imaging worklist |
| Billing executive | Kiran Shetty | Billing dashboard |
| HR manager | Lavanya HR | Staff dashboard |
| Inventory manager | Store manager | Stores dashboard |
| Patient | Lakshmi Narayan | Patient portal |

Switch roles any time from the profile menu. The patient portal (`#/portal`, demo OTP `123456`) and self-service kiosk (`#/kiosk`) also open without staff sign-in.

**Good records to try:** Lakshmi Narayan `HS-23-01041` (diabetes, sulfonamide allergy, full history) and Rohit Menon `HS-24-01082` (cardiac, contrast allergy, critical potassium 6.2).

**Reset demo data:** Hospital settings → Demo data → Reset. All changes are kept in this browser's local storage under `hospit-hms:v5`.

## Stack

- Angular 20 standalone components, lazy routes, signals, hash routing
- Angular Material (toggles, checkboxes, menus, tooltips) with a custom SCSS design system
- Reactive and template-driven forms
- Chart.js for charts, Lucide for icons
- Mock services over an in-memory store persisted to LocalStorage

## Project layout

```
src/app/
  core/
    models.ts            Typed data models for every module
    roles.ts             Roles and role-based navigation
    data/seed.ts         Fictional seed data (patients, visits, stock, invoices, beds…)
    data/clinical.ts     ICD-10 list, templates, demo safety rules, NEWS2
    services/            Store (mock backend), session, theme, toast, export, AI mock
  shared/                Reusable UI: page header, KPI card, table, drawer, modal,
                         chart, status badge, avatar, voice input, Rx editor, Rx document
  layout/shell.*         Sidebar, top bar, global search, notifications, role switcher
  features/              One folder per module (patients, appointments, queue, clinical,
                         pharmacy, lab, radiology, billing, ipd, org, admin, insights, ai,
                         portal, kiosk, auth, dashboard)
```

## Further documentation

- `docs/FEATURE-COVERAGE.md`: module-by-module checklist
- `docs/LIMITATIONS.md`: what is simulated or missing
- `docs/NEXT-PHASE-ARCHITECTURE.md`: recommended production architecture
- `screenshots/`: the 12 review screens, organised by module
