# Data & Backup — Security

| Topic | Measure |
|---|---|
| Who | Only `SUPER_ADMIN` (`/api/platform` router: `requireAuth` + `requireRole`). Owners, Managers and Staff get 403; nothing is called at Neon for a refused request (tested). |
| Credentials | `NEON_API_KEY` is read from the server environment only. It is never sent to the browser, never logged, never stored in the database, and removed from Neon error messages before they are recorded (`neon.js → clean`). The page shows only "set / not set". |
| Connection strings | Requested from Neon only by the server, only for checking a staged restore, used once and not stored. Tests fail if any response contains one. |
| Backup contents | Never leave Neon: no download, no export file, no public URL, nothing in notifications or audit events. |
| Storage | Neon snapshots inside the project (encrypted at rest by Neon). Not off-site (see the architecture's open points). |
| Destructive actions | Delete: confirmation; protected backups refused; backups of an active restore refused. Production restore: staged and checked first, typed `RESTORE PRODUCTION`, backup id match, schema-gap acknowledgement, recovery point kept, single active restore, never from a GET, a job or a retry. |
| Audit | Every create, delete, protection change, check, schedule and retention change, restore stage/check/discard/start/completion/failure, with actor, time, target backup and result. No secrets or connection strings. Events recorded after a backup and before a production restore remain in the recovery-point branch. |
| Least privilege | Prefer a project-scoped Neon API key. Rotate it in the Neon console if it may have leaked, then update Vercel and redeploy. |
| Git | `.env*`, keys and dumps are not committed (`.gitignore`). No backup files exist locally. |
