# Data & Backup — Testing

## Automated tests (mocked provider)

These replace Neon's API with a local HTTP stub. **They do not prove that Neon backs up or restores data.**

| File | Covers |
|---|---|
| `backend/test/backups.test.js` (13 tests, dev branch) | Authorization (Super Admin only; 401 signed out; refused requests never reach Neon); not configured (warning; 503); manual backup (confirmation, 30-day expiry sent to Neon, one at a time → 409, Running → Completed, audit; Neon 500 → FAILED row, warning, audit FAILURE, next backup allowed; refused key → 502 without the key; 2-hour timeout); history (13 rows, pagination, type and status filters, EXPIRED record, invalid filter 400); protection (no expiry at Neon, delete refused, unprotect sets an expiry, delete → DELETED row, audits); integrity check (passes; missing backup fails; audits SUCCESS/FAILURE); configuration (field validation, unknown fields, schedule sent to Neon with retention in seconds, schedule and retention audited separately, Neon refusing → 502 SCHEDULE_REJECTED); overview (last backup, next run in UTC, storage total, overdue warning); restore (confirmation, unknown backup 404, staged with `finalize_restore: false`, second restore 409, deleting its backup 409, finalize before the check 409, page loads advance the check, **the check really reads a database (the dev branch)**, the temporary compute removed, wrong phrase refused, finalize sends the recovery-point name, audits of every step); discard deletes the staged branch; Neon refusing the switch leaves production unchanged and keeps the staged restore; a failed Neon restore frees the lane. Every response is checked for the API key and connection strings. |
| `backend/test/backup-rules.test.js` (9 tests) | Next run (daily, weekly Mon=1…Sun=7, monthly, month ends), overdue rule, schedule text, configuration merging and limits, names, the check's verdicts (identical; behind on migrations = warning; no Super Admin / unfinished migrations / missing tables / empty = failure) |
| `apps/web/src/features/data-backup/utils/backupRules.test.js` (5 tests) | Sizes, UTC hours with the platform time zone, changed values, limits and retention consequences, allowed actions and the confirmation phrase |

Run: `cd backend && node --env-file=.env.dev --test --test-concurrency=1 test/backups.test.js test/backup-rules.test.js`; web: `npm run test:web`.

**Browser check (2026-11-01):** all five sections were opened in Chrome against a local Neon stand-in, at 1440 px and 390 px (no horizontal scroll, no console errors). Create Backup Now went Running → Completed; a restore was staged, checked (real read of the dev database), refused with a wrong phrase, and confirmed with `RESTORE PRODUCTION`; the stand-in received the switch only after the confirmation.

## Real restore drill (actual Neon)

`backend/scripts/backup-restore-drill.mjs` runs the module's own Neon client and check against **real Neon**, on throwaway branches created from the dev branch: marker → real snapshot → damage → staged restore (marker as before, verification) → finalize into the drill branch → read through the **original** connection string (marker restored, recovery-point branch present) → delete everything it created. It refuses to run with production's branch.

```
cd backend
node --env-file=.env.dev scripts/backup-restore-drill.mjs
```

Neon snapshots **root branches only**, and the dev branch is a child of production, so the drill runs in a **separate, disposable Neon project** (`edutrack-restore-drill`, PostgreSQL 18, eu-central-1) with its own project-scoped key, configured in `backend/.env.drill` (git-ignored: `EDUTRACK_DB_BRANCH="drill"`, `DATABASE_URL`, `DIRECT_URL`, `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_BRANCH_ID` = that project's root branch). Its database holds EduTrack's schema (all migrations) and one test Super Admin.

```
cd backend
node --env-file=.env.drill scripts/backup-restore-drill.mjs
```

The guard refuses to start unless that project holds neither the production nor the dev database (resolved from `backend/.env` and `.env.dev` hosts through the Neon API), `.env.drill`'s database belongs to `NEON_BRANCH_ID`, and that branch is the project's root. Only branches named after the run are deleted. The drill finds the database's current branch from `.env.drill`'s endpoint (each restore changes it), so `NEON_BRANCH_ID` there may go out of date; the drill says so and carries on.

`--module` runs the recovery through the module's own services instead of raw Neon calls (`node --env-file=.env.drill scripts/backup-restore-drill.mjs --module`): Create Backup Now, stage and check, Restore production, delete, back up again. The drill database plays production and receives the module's records and audit events.

| Date | Who | Result | Total time | Notes |
|---|---|---|---|---|
| **2026-11-01 18:02 UTC** | Drill script **`--module`** (the Data & Backup services themselves), drill project | **PASSED.** createBackupNow → real snapshot, COMPLETED 4.6 s → damage → startRestore + getRestore (staged, checked: opens, migrations, schema, tables, Super Admin) 13.0 s → finalizeRestore with `RESTORE PRODUCTION` 7.4 s (recovery point `edutrack-before-restore-20261101-180257`) → data back through the original connection string, the restore record COMPLETED and the RESTORE_COMPLETED audit event present **in the restored database** 1.4 s → branch id changed (`br-odd-sky-…` → `br-bitter-sound-…`) and the module follows it 0.5 s → deleteBackup 2.4 s → a new backup's snapshot is taken from the **restored** branch 4.6 s. Cleanup ✔ (one branch, 0 snapshots) | **35.7 s** (restore from start to verified data: **21.8 s**) | Confirms the branch-id fix on real Neon. An earlier run (17:55) found that after the switch the database held the backup's own creation record still RUNNING, which blocked the next backup action; fixed (records read before the switch replace the older copies; actions refresh operations first) |
| 2026-11-01 17:54 UTC | Drill script (standard), drill project, run 2 | **PASSED.** Found the database's branch by itself after the earlier restore (NEON_BRANCH_ID out of date), and after the switch confirmed the database runs on the restored branch | 29.8 s | Branch-id fix, Neon level |
| **2026-11-01 17:20 UTC** | Drill script in project `winter-smoke-18109735`, approved by the project owner | **PASSED.** Marker "before" 1.5 s → real snapshot `snap-bold-poetry-balxllus` 2.9 s → damage (marker "after") 0.3 s → restore staged on `br-delicate-art-basohqll` 5.4 s → EduTrack check passed (opens, migrations, schema, tables, Super Admin) and staged marker = "before" 7.8 s → finalize, recovery point `…-before-restore` kept 5.6 s → marker = "before" read through the **original connection string** 2.3 s. Cleanup ✔: 0 snapshots; recovery-point branch deleted; one branch left (the restored one, now named "production", default, root, with the original compute `ep-aged-silence-…`) | **25.8 s** (stage → check → switch → verified: 21.1 s) | Small database (schema + 1 account). Snapshot size not reported by Neon right after creation (`sizeBytes: null`). **Finding:** after finalize the deployment's branch **id changes** (the restored branch takes over the name and compute; the old id becomes the recovery point). |
| 2026-11-01 16:46 UTC | Drill script, approved by the project owner | **Stopped at the snapshot step.** Neon: `not allowed to snapshot non-root branch` (HTTP 400). Guard ✔ (production resolved as br-lively-scene-b18tcl0c, refused when targeted); drill branch from dev ✔ 6.6 s; marker written ✔ 4.5 s; cleanup ✔ (project back to production + dev, 0 snapshots) | 11 s | Snapshots work only on **root** branches. Dev (br-solitary-moon-b1fvjusi) is a child of production, and drill branches are children of dev. **Restore is not verified yet.** |
