# Data & Backup — Business Specification

Platform Settings → Data & Backup. **Super Admin only.** Architecture: `backup-architecture.md`.

## Rules

| # | Rule |
|---|---|
| B1 | A backup is a **Neon snapshot** of the whole platform database (this deployment's branch). There is no partial or per-school backup. |
| B2 | **Scheduled backups** are made by Neon on the configured schedule: daily, weekly (a weekday) or monthly (day 1–28), at a whole hour **in UTC** (the page also shows the platform time zone). Kept 1–35 days (default 14; Neon's maximum is 35). |
| B3 | **Manual backups** (Create Backup Now) are kept the configured number of days (1–365, default 30), then Neon deletes them, unless protected. |
| B4 | Backup type: full snapshot. Neon stores the first scheduled snapshot in full and later ones as changes (incremental storage); every backup restores the whole database on its own. EduTrack does not claim another incremental mechanism. |
| B5 | Creating a backup needs a confirmation. One backup operation at a time (another one → refused). |
| B6 | **Protection**: a protected manual backup has no expiry and cannot be deleted until protection is removed. Removing protection gives it the manual retention from that day. |
| B7 | **Deletion**: only unprotected backups, never the backup of a restore in progress. Deletion is permanent at Neon. |
| B8 | Changing retention affects new backups; existing backups keep the expiry they were created with (shortening the scheduled retention may let Neon remove older scheduled backups). |
| B9 | **Integrity check** (Verify integrity): Neon lists the snapshot for this branch, it is complete, not expired, and from this branch. The data itself is checked by staging a restore. |
| B10 | **Restore** has three steps. **Stage**: Neon restores the backup onto a new branch; production is unchanged. **Check**: EduTrack reads the staged database (it opens; migrations recorded and finished; same schema version as the application or the missing migrations listed; application tables present; at least one active Super Admin) and shows row counts next to production's. **Decide**: discard, or replace production. |
| B11 | Replacing production requires a staged restore that **passed** its check, typing `RESTORE PRODUCTION`, the backup id to match, and — when the backup is behind the application's migrations — confirming that they will be applied at once. It is never done by a page load, a job or a retry. |
| B12 | Before production is replaced, Neon keeps the current database as a branch named `edutrack-before-restore-<time>` (the **recovery point**). |
| B13 | One restore at a time (staged or checked). A staged restore waiting more than a day is reported. |
| B14 | After a production restore, everything recorded after the backup is gone from production (it stays in the recovery point). Users signed in after the backup are signed out. EduTrack writes the restore's own record, the backup records and audit events into the restored database. |
| B15 | Statuses: Completed, Running, Scheduled (next run), Failed, Expired, Restoring (and Deleted in the history). |
| B16 | Warnings on the Overview: not configured; Neon unreachable; no schedule; schedule unreadable; scheduled backup **overdue** (latest scheduled backup older than the interval + 3 h); latest manual backup failed; latest restore failed; staged restore waiting > 1 day; no backup yet. |
| B17 | Audited: backup created (success/failure), deleted, protection changed, verified (success/failure), schedule changed, retention changed, restore staged, checked, discarded, production restore started, completed, failed. Never with secrets or connection strings. |
| B18 | Backups cannot be downloaded (Neon snapshots are not files). |

## Defaults

Daily at 02:00 UTC (05:00 Africa/Mogadishu), scheduled backups kept 14 days, manual backups kept 30 days. They take effect when the Super Admin saves the configuration (EduTrack does not create a schedule by itself).
