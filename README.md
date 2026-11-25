# ScholarDesk Pro

Commercial school management system for private schools (Class 1–10). It has two connected parts:

| Part | Folder | Stack | Runs on |
|---|---|---|---|
| **Desktop app** (offline-first) | [`desktop/`](desktop) | Tauri v2 (Rust) + React/TypeScript + Tailwind + Lucide, local SQLite | The school's Windows/Mac PC |
| **License & subscription API** | [`server/`](server) | Node.js Express + PostgreSQL (Supabase) | `https://api.yourdomain.com` |
| **Owner admin panel** | [`admin/`](admin) | Next.js (static export) + Tailwind | `https://admin.yourdomain.com` |

```
+-----------------------------------+          HTTPS REST API          +-------------------------------------------+
|   SCHOOL PC (Desktop App .exe)    |  ----------------------------->  |   YOUR DOMAIN (api.yourdomain.com)        |
|  - React + Tailwind UI            |  Sends: License Key + PC ID      |  - PostgreSQL / Supabase license DB       |
|  - Local SQLite database (fast)   |  <-----------------------------  |  - Signed 7-day RS256 offline token       |
|  - Google Drive text-only backup  |  Returns: ACTIVE or SUSPENDED    |  - Admin panel (admin.yourdomain.com)     |
|  - Auto-updater (latest.json)     |                                  |  - Tauri update release hosting           |
+-----------------------------------+                                  +-------------------------------------------+
```

Step-by-step build, deploy and sell guide: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. Screenshots are in [`docs/screenshots/`](docs/screenshots).

## Quick start (local)

```bash
# 1. License server (needs PostgreSQL)
cd server && cp .env.example .env      # fill DATABASE_URL, ADMIN_*, etc.
npm install && npm run keys && npm run migrate && npm run dev

# 2. Admin panel
cd ../admin && npm install && NEXT_PUBLIC_API_URL=http://localhost:8080/api/v1 npm run dev   # http://localhost:3000

# 3. Desktop app (browser demo mode — same UI, sql.js instead of native SQLite)
cd ../desktop && npm install && VITE_LICENSE_API=http://localhost:8080/api/v1 npm run dev   # http://localhost:1420
#    …or the real desktop window:
VITE_LICENSE_API=http://localhost:8080/api/v1 npx tauri dev
```

## Feature map

| Requirement | Where |
|---|---|
| License activation, machine binding, heartbeat, 7-day RS256 grace, clock-rollback guard, full-screen lock | `desktop/src/lib/license.ts`, `desktop/src/pages/LicenseGate.tsx`, `desktop/src-tauri/src/license.rs`, `server/src/routes/public.ts` |
| Remote ACTIVATE / SUSPEND, payments auto-extend expiry, PC reset, key regeneration | `server/src/routes/admin.ts`, `admin/app/schools/` |
| PINs `0000` (Settings) and `5555` (modify/delete), both changeable | `desktop/src/lib/pin.ts`, `components/AppContext.tsx` |
| Module ON/OFF with dynamic UI pruning; per-class section counts (1–6) | `pages/Settings.tsx`, `components/Layout.tsx` |
| `YYCCRR` auto-ID, Class 9–10 streams, 200/class capacity | `lib/util.ts → makeStudentId`, `pages/Admission.tsx`, `migrations/001_init.sql` |
| Ctrl+K omnibox (ID / roll / mobile); profile + fees first, results behind **View Result** | `components/Layout.tsx`, `components/StudentProfile.tsx` |
| Admission with webcam / file photo and an A4 review before saving (Print / Modify / Confirm) | `pages/Admission.tsx`, `docs/Documents.tsx → AdmissionInvoice` |
| Directory filters, PIN-protected edit/delete, contact CSV + A4 | `pages/Students.tsx` |
| Attendance: mark, daily summary (+ CSV/A4 per class), monthly colour matrix | `pages/Attendance.tsx` |
| Subjects builder, marks entry (half yearly/final), GPA, A4 marksheet, merit promotion | `pages/Exams.tsx`, `lib/grading.ts`, `lib/promotion.ts` |
| Fees: partial payments, previous dues, 2-page A4 (receipt + monthly attendance) | `pages/Fees.tsx`, `lib/fees.ts` |
| Staff registration, mobile search, partial salary, A4 payslip | `pages/Staff.tsx` |
| Google Drive `drive.file` text-only backup + restore; local file backup | `lib/gdrive.ts`, `lib/backup.ts`, `pages/Backup.tsx` |
| Demo data, settings-config export/import | `lib/demo.ts`, `lib/config.ts` |
| SQLite schema / PostgreSQL schema | `desktop/src-tauri/migrations/001_init.sql`, `server/db/schema.sql` |

## Notes on design decisions

* **SQLite access goes through `rusqlite`, not `tauri-plugin-sql`.** The plugin runs queries on a connection pool, so a `BEGIN … COMMIT` spread over several calls is not guaranteed to land on one connection. Year promotion, attendance submission, demo import and backup restore must be all-or-nothing, so the Rust side exposes `db_select`, `db_execute` and `db_batch` on one serialized WAL connection. `db_batch` runs a list of statements inside one transaction.
* **Roll numbers 100–200** make the ID 7 characters (`2609150`), because "2-digit roll" and "up to 200 students" cannot both be true. Rolls 1–99 keep the exact `YYCCRR` format.
* **Anti-tamper floor:** the lock compares the PC clock with `max(last_known_utc, token.iat)`. `iat` is signed by your server, so editing the SQLite file cannot move the floor back. Each successful sync resets `last_known_utc` to *server* time.
* **Payment = reactivation:** recording a payment in the admin panel extends `valid_until` and sets the license back to `ACTIVE`. The school unlocks on its next sync (automatic every 15 min, or right away with the button).
