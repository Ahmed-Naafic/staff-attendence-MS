# Data & Backup — Architecture

Platform Settings → Data & Backup (Super Admin). Business rules: `data-backup-specification.md`. API: `backup-api.md`. Restores: `recovery-procedures.md`, `disaster-recovery-runbook.md`.

## 1. Existing infrastructure (inspected 2026-11-01)

| Area | Finding |
|---|---|
| Database | PostgreSQL on **Neon**, region eu-central-1. Production uses one Neon branch (`backend/.env`, endpoint `ep-summer-river-…`); development another (`backend/.env.dev`, `ep-lingering-poetry-…`). Prisma 7 with the pg adapter; migrations hand-written and applied with `prisma migrate deploy`. |
| Hosting | API and web app on **Vercel** serverless functions. No resident worker. One Vercel Cron (`backend/vercel.json`: notification job, daily 03:15 UTC) that needs `CRON_SECRET`, which is **not set yet**. |
| Files | **None.** EduTrack stores no uploads, images or documents (logo uploads are "not available yet"). Exports (CSV/XLSX/PDF) are generated on request and not stored. |
| Secrets | Server environment variables only (Vercel, `backend/.env*`, ignored by Git). |
| Authorization | `requireAuth` + `requireRole('SUPER_ADMIN')` on `/api/platform`. |
| Audit | `AuditEvent` table, `recordAuditEvent()`, action registry `auditActions.js`. |
| Notifications | Owners, Managers and Staff only. **Super Admins have no notification centre (rule N16)**, and push is Staff-app only. |
| Existing backups | Nothing in EduTrack. Neon itself keeps every branch's **history** for the plan's restore window (point-in-time restore from the Neon console), and offers **snapshots** (manual on every plan; scheduled snapshots on paid plans). |

### What Neon provides, and what each one is

| Neon feature | What it is | Used by EduTrack |
|---|---|---|
| History / instant restore (PITR) | Restore a branch to any moment inside the plan's restore window. Only root branches. | Not from the page. It is the first tool of the disaster-recovery runbook (best recovery point). |
| Branches | Copy-on-write copies of a branch at a moment. | Staged restores are branches. |
| **Snapshots** | Named copies of a branch at a moment, kept outside the branch until they expire or are deleted. Manual (no limit on age) or scheduled (daily/weekly/monthly, kept ≤ 35 days, stored incrementally after the first). Restore to a new branch, check, then finalize. | **These are EduTrack's backups.** |

Point-in-time history, snapshots and an off-site export are three different things: the module manages **snapshots**; history is used from the console; there is **no off-site export** yet.

## 2. Chosen architecture

```
Super Admin ──► /api/platform/backups ──► Neon API (snapshots, schedule, restore)
                       │                         │
                       ▼                         ▼
          BackupRecord / BackupOperation    snapshots of NEON_BRANCH_ID
          / BackupSettings / AuditEvent     staged restore branches
```

- **No second backup system.** Backups are Neon snapshots of this deployment's branch (`NEON_BRANCH_ID`). Neon runs the scheduled ones; EduTrack starts manual ones.
- **The branch follows the database.** Backups apply to the branch that this server's database endpoint runs on, found through the Neon API (a restore changes the branch id).
- **Neon is the source of truth** for which backups exist (the list lives outside the database, so a restore cannot erase it). EduTrack's tables add what Neon does not keep: who created a backup, protection, the last integrity check, operation outcomes, and the fate of snapshots Neon no longer lists (expired or deleted).
- **Scheduling: Neon's backup schedule.** No EduTrack job creates backups, so Vercel's execution limits, retries and duplicate cron runs do not affect them. Neon's schedule hours are UTC.
- **Long operations never block a function.** Snapshot creation and restore are asynchronous at Neon; EduTrack records Neon's operation ids and advances its records when the page reads them (idempotent, never starts anything). A step still running after 2 hours is marked failed.
- **Restore = stage → check → finalize.** Staging restores onto a **new branch** (`finalize_restore: false`); EduTrack reads it and compares it with production (`verify.js`); only a separate, typed confirmation calls Neon's `finalize_restore`, which moves production's computes onto the restored branch (connection strings unchanged) and keeps the replaced branch as the **recovery point**.
- **Concurrency.** One active operation per lane (`backup`, `restore`), enforced by a partial unique index; staged-restore checks take a 2-minute lease so two page loads never check at once.

### Files

| Path | Role |
|---|---|
| `backend/src/features/backups/neon.js` | Neon API client (ids, names, times, sizes; connection strings only for the server-side check); finds the deployment's branch from its database endpoint |
| `backend/src/features/backups/backupRules.js` | Schedule timing, overdue rule, validation, names |
| `backend/src/features/backups/backups.service.js` | Overview, history, manual backup, protection, deletion, integrity check, configuration |
| `backend/src/features/backups/restore.service.js` | Stage, check, finalize, discard |
| `backend/src/features/backups/verify.js` | Reads a staged branch and compares it with production |
| `backend/src/features/backups/backups.routes.js` | `/api/platform/backups` (Super Admin) |
| `backend/scripts/backup-restore-drill.mjs` | Real restore drill on throwaway branches |
| `prisma/migrations/20261102090000_data_backup` | `BackupRecord`, `BackupOperation`, `BackupSettings` |
| `apps/web/src/features/data-backup/` | The five sections of the page |

## 3. Scope: what a backup covers

| Covered | Not covered |
|---|---|
| The whole PostgreSQL database of the deployment: schools, branches, accounts, sessions, schedules, assignments, transfers, attendance, notifications, announcements, settings, audit events, backup metadata | Server environment variables and secrets (keep them in a password manager) |
| | Application code (Git, Vercel deployments) |
| | Staff app builds and credentials (Expo/EAS, Firebase) |
| | An **off-site** copy: snapshots stay in the Neon project; deleting the project or losing the Neon account loses them |

There is no file storage to back up. **A database backup is therefore not a complete platform recovery**: the runbook lists what else is needed.

## 4. Recovery objectives

What the infrastructure can actually support (to be confirmed by the drill and by the Neon plan in use):

| Scenario | RPO (data lost at most) | RTO (time to recover) |
|---|---|---|
| Mistake noticed within Neon's restore window, recovered with **Neon instant restore** (console) | Seconds (any moment in the window) | Minutes |
| Recovery from a **scheduled snapshot** (daily) | Up to 24 h (+ up to 1 h Neon scheduling) | Staging and check: a few minutes; production switch: seconds to 2 minutes; plus the Super Admin's decision time. Target ≤ 30 minutes, **not yet measured** |
| Recovery from a **manual snapshot** | Since that snapshot | As above |
| Loss of the Neon project or account | **No recovery** today (no off-site copy) | — |

The restore window and scheduled snapshots depend on the **Neon plan** (scheduled snapshots need a paid plan; the free plan allows one manual snapshot). The page reports Neon's refusals as they come.

## 5. Security

`security.md`. In short: Super Admin only; the Neon key lives in the server environment; responses carry no key or connection string; no download links; no backup content in notifications; every action audited.

## 6. Notifications

The brief asks to notify the Super Admin about failures. **Super Admins have no notification centre (N16)**, and adding one changes an approved business rule. So failures, overdue backups, failed restores and waiting staged restores are shown as **warnings at the top of Data & Backup → Overview**, and failures are audit events (result FAILURE) visible in Audit Logs. No notification is sent for successful backups. If you approve a Super Admin notification centre later, these warnings are the events to send (Somali templates per the notification language policy).

## 7. Open points (checked by the real drill)

- **Weekly `day`.** Neon's guide describes 1–7 as Monday–Sunday; its API reference says 0–6. EduTrack sends 1–7 (Monday = 1). Confirm on the first weekly schedule with `GET …/backup_schedule`.
- **Disabling the schedule.** Neon documents no way to remove a schedule, so the page offers changing it, not turning it off.
- **`finalize_restore` is a Neon beta endpoint.** Exercised by the real drill on 2026-11-01: it worked (5.6 s), the connection string stayed the same, and the replaced branch was kept under the given name.
- **The branch id changes after a production restore (confirmed 2026-11-01; resolved).** Neon gives the restored branch the original's name, default flag and compute; the old branch id becomes the recovery point. EduTrack therefore finds its branch from its own database endpoint (`DATABASE_URL` → `GET /projects/{id}/endpoints/{endpoint}` → `branch_id`, cached one minute, forgotten after a restore). `NEON_BRANCH_ID` is only an expectation: when it differs, the Overview warns and backups still follow the database. Verified on real Neon by the module drill (the next backup copied the restored branch).
- **Snapshots are listed for the whole project**, not filtered by branch: backups taken before a restore keep the old branch id as their source and remain this database's backups. Neon snapshots root branches only, so a child branch such as dev never adds snapshots.
- **Snapshots need a root branch (confirmed 2026-11-01).** Neon answers `not allowed to snapshot non-root branch`. Production (`br-lively-scene-b18tcl0c`) is a root branch, so backups work there. The dev branch is a child of production, so **Data & Backup cannot create backups in development**; the page shows Neon's refusal. A real drill needs a root branch that is not production (a separate Neon project).
- **Off-site export (recommended next step).** A scheduled runner (for example GitHub Actions) with `pg_dump` → encryption (age/GPG) → separate object storage (S3 or R2) with lifecycle rules, reporting its result to EduTrack. It needs a storage account and credentials, so it is not configured.
