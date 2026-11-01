# Data & Backup — Recovery and Restore Procedures

Use the page (Platform Settings → Data & Backup → Restore Management). For emergencies and cases the page cannot handle, see `disaster-recovery-runbook.md`.

## Before any restore

1. Decide the point to return to. Ask: when did the problem start? What will be lost (everything recorded after the backup)?
2. If the problem started **within Neon's restore window** (minutes or hours ago), Neon's **instant restore** in the console can return to just before it (runbook §2). It loses less data than a snapshot.
3. Tell school owners that the platform will be briefly unavailable, and that recent records may need to be entered again.
4. Create a manual backup of the current state (Create Backup Now), so the state before the restore is also kept as a backup. (The restore keeps a recovery-point branch as well.)

## Restore from a backup (page)

1. **Backup History** → the backup's actions → **Restore…**. Check its date ("Data as of"), type and size.
2. **Stage**: tick the confirmation and select **Stage restore**. Neon creates the branch `edutrack-restore-<time>`; production is unchanged.
3. **Check**: the page updates by itself (Step: staging → starting compute → checked). Read the result:
   - all checks **Passed**;
   - **Warning** "Same schema version": the backup is older than the application's migrations. Continue only if you can run `npx prisma migrate deploy` (from `backend/`, with production's `DIRECT_URL`) **immediately** after the switch;
   - the row counts: do they look like the platform at that date?
   - **Failed**: the staged database cannot be used. It is removed; production is unchanged. Try another backup.
4. **Decide**:
   - **Discard staged restore**: deletes the staged branch; nothing else changes.
   - **Restore production…**: read the consequences, type `RESTORE PRODUCTION`, confirm. Neon switches the production computes to the restored branch (seconds; connections drop briefly) and keeps the previous database as `edutrack-before-restore-<time>`.
5. **After the switch**:
   - Apply missing migrations if the page said so.
   - Sign in again if you were signed out (your session may be newer than the backup).
   - Check the Dashboard, a few schools, and today's attendance.
   - Staff phones upload their waiting check-ins again by themselves; records that were already on the server after the backup time are gone and must be re-entered by Managers if needed.
   - Write down the recovery-point branch name (Recent restores).
   - The database now runs on a **new Neon branch id** (shown in the restore's audit event and in Storage Configuration). Set `NEON_BRANCH_ID` to it in Vercel. Backups already follow the database; the setting only silences the Overview warning.

## Undo a production restore

The previous database is the Neon branch `edutrack-before-restore-<time>`. In the Neon console, open the production branch → **Restore** → choose that branch as the source (or use `POST /projects/{id}/branches/{production}/restore` with `source_branch_id` and `preserve_under_name`). Neon again keeps the replaced state as a branch.

## When something fails

| Situation | What happened | What to do |
|---|---|---|
| Staging failed | Neon could not restore the snapshot | Production unchanged. Try again or another backup; check Neon's status page |
| Check failed | The staged database is not usable by this application | Production unchanged; the staged branch is removed. Use another backup |
| "Neon refused" on Restore production | Neon did not switch (busy, permission, plan) | Production unchanged; the staged restore is kept. Retry later or discard |
| "Neon was still finishing the switch" | The switch took longer than 2 minutes | Check in the Neon console that the production branch shows the restored data, and the recovery-point branch exists |
| Switch failed at Neon | Neon reported a failure | Open the Neon console: the production branch, the staged branch and the recovery point. Follow the runbook |
| Signed out and cannot sign in | Your account did not exist at the backup time | Use another Super Admin, or `scripts/reset-super-admin-password.js` |

## Rehearse

Run the real drill (`testing.md` → Real restore drill) after setting up, and at least every quarter, and record the timings: they are the measured RTO.
