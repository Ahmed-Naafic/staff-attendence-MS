# Disaster Recovery Runbook

For the person on call. Keep a copy outside EduTrack (the platform may be down). Page procedures: `recovery-procedures.md`.

## 0. First five minutes

1. **Stop the damage**: if a bug or a person is changing data, stop it (revert the deployment in Vercel, suspend the account).
2. **Note the time** the problem started (as exactly as possible, in UTC).
3. **Do not delete anything**: not branches, not snapshots, not the Vercel project.
4. Decide which case below applies.

## 1. Which case?

| Case | Go to |
|---|---|
| Wrong or lost data, platform running, problem started **within Neon's restore window** | §2 Instant restore (least data lost) |
| Wrong or lost data, older than the restore window | §3 Restore from a snapshot (page) |
| Platform down because the **database** is unreachable | §4 |
| Platform down for **another reason** (code, Vercel, DNS) | §5 — the database is fine; do not restore |
| Neon **project or account lost** | §6 |

## 2. Instant restore (Neon console)

1. Neon console → project → **Branches** → production branch → **Restore**.
2. Choose **a point in time** just before the problem (UTC). Use **Preview / compare** to check the data at that time first, if offered.
3. Confirm. Neon keeps the replaced state as a backup branch (`<branch>_old_<time>`).
4. Go to §7 (after recovery).

## 3. Restore from a snapshot

Use Data & Backup → Restore Management (`recovery-procedures.md`). If the web app is down but the database is fine, use the Neon console: **Backup & restore** → snapshot → **Restore** to a new branch → inspect → **finalize** into the production branch.

## 4. Database unreachable

1. Check https://neonstatus.com and the Neon console (compute suspended? limits reached? plan?).
2. If Neon is down: wait; nothing to restore. Tell the schools.
3. If the production branch is damaged: §2 or §3.

## 5. Platform down, database fine

Vercel → API project → **Deployments** → promote the last working deployment. Check `/api/health`. Do not restore data for a code problem.

## 6. Neon project or account lost

Today there is **no off-site copy**, so the data cannot be recovered from EduTrack's backups. Contact Neon support immediately (deleted projects can sometimes be recovered within a short time). This is the gap the recommended off-site export closes (`backup-architecture.md` §7).

To rebuild an empty platform: new Neon project → set `DATABASE_URL`/`DIRECT_URL` in Vercel → `npx prisma migrate deploy` → `scripts/create-super-admin.js`.

## 7. After any recovery

1. If the backup was older than the latest migration: `cd backend && npx prisma migrate deploy` with production's `DIRECT_URL`.
2. `GET /api/health` → `{"status":"ok"}`; sign in as Super Admin; open Dashboard and a school.
3. Tell school owners what was restored and from when; Managers re-enter records made after that time.
4. Staff phones re-upload waiting attendance automatically.
5. Record: what happened, the time chosen, the recovery-point branch name, how long it took (actual RTO), what was lost (actual RPO).
6. Keep the recovery-point branch for at least 7 days, then delete it in the Neon console.

## Contacts and access (fill in)

| What | Where |
|---|---|
| Neon console owner | … |
| Vercel project owner | … |
| Secrets (DATABASE_URL, DIRECT_URL, JWT_SECRET, CRON_SECRET, NEON_API_KEY) | password manager entry … |
