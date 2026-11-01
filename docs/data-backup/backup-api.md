# Data & Backup — API

Base: `/api/platform/backups`. Every route requires a signed-in **SUPER_ADMIN** (others: 403; signed out: 401). State-changing requests follow the platform's origin check. Responses never contain the Neon API key or a connection string.

Errors: `{ code, error, details? }`. Neon failures: `BACKUPS_NOT_CONFIGURED` 503, `PROVIDER_UNAUTHORIZED` 502, `PROVIDER_REJECTED` 502, `PROVIDER_BUSY` 409, `RATE_LIMITED` 429, `PROVIDER_UNAVAILABLE` 503, `NOT_FOUND` 404.

| Method and path | Body | Answer |
|---|---|---|
| GET `/overview` | — | `{ provider: { configured, projectId, branchId, apiKeySet }, schedule, nextScheduledAt, settings: { manualRetentionDays }, stats: { total, completed, failed, expired, storageBytes }, lastSuccessful, latest, runningBackup, activeRestore, lastRestore, alerts: [{ level, code, text }], coverage }` |
| GET `/` | query `status` (COMPLETED, RUNNING, RESTORING, FAILED, EXPIRED, DELETED), `kind` (MANUAL, SCHEDULED), `page`, `pageSize` ≤ 50 | `{ items: [backup], total, page, pageSize, providerError }` |
| POST `/` | `{ "confirm": true }` | 202 `{ operationId, snapshotId, status: "RUNNING" }` (201 when Neon finished at once). 409 `BACKUP_IN_PROGRESS` |
| GET `/operations/:id` | — | `{ id, type, status, snapshotId, startedAt, finishedAt, error }` |
| POST `/:snapshotId/verify` | `{}` | `{ verification: { level: "provider", ok, checks, sizeBytes, checkedAt, checkedBy } }` |
| POST `/:snapshotId/protection` | `{ "protected": true \| false }` | `{ snapshotId, protected, expiresAt }` |
| DELETE `/:snapshotId` | — | `{ snapshotId, deleted: true }`. 409 `BACKUP_PROTECTED`, `BACKUP_IN_USE` |
| GET `/configuration` | — | `{ schedule: { frequency, hour, day, retentionDays, text } \| null, scheduleError, manualRetentionDays, provider }` |
| PUT `/configuration` | any of `frequency` (daily, weekly, monthly), `hour` 0–23 (UTC), `day` (weekly 1–7 Mon–Sun; monthly 1–28), `retentionDays` 1–35, `manualRetentionDays` 1–365 | the configuration. 400 with `details` per field; 502 `SCHEDULE_REJECTED` (for example a free Neon plan) |
| GET `/restores` | query `limit` ≤ 50 | `{ items: [restore] }` |
| POST `/restores` | `{ "snapshotId": "…", "confirm": true }` | 202 `{ restore }` (staged on a new branch). 409 `RESTORE_IN_PROGRESS` |
| GET `/restores/:id` | — | `{ restore }` — advances the check; never touches production |
| POST `/restores/:id/discard` | `{}` | `{ restore }` (DISCARDED; staged branch deleted) |
| POST `/restores/:id/finalize` | `{ "confirmation": "RESTORE PRODUCTION", "snapshotId": "…", "acknowledgeSchemaGap": true? }` | `{ restore }` (COMPLETED with `recoveryPoint`, or FAILED). 409 `NOT_VERIFIED`; 400 with `details` |

**backup**: `{ id, name, kind, status, createdAt, sizeBytes, sizeKind ("full" | "incremental"), provider, providerRef, expiresAt, protected, createdBy, verifiedAt, verification, pointInTime, deletedAt?, deletedBy?, error? }`

**restore**: `{ id, status (RUNNING, VERIFIED, COMPLETED, FAILED, DISCARDED), snapshotId, stagedBranch, phase, verification: { ok, checks, counts, missingMigrations, checkedAt }, recoveryPoint, startedAt, finishedAt, requestedBy, error }`
