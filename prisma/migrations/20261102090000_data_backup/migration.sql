-- Data & Backup (docs/data-backup/): metadata of Neon snapshots, backup and restore operations, and
-- settings. The backups themselves are Neon snapshots, outside this database.

CREATE TABLE "BackupRecord" (
    "snapshotId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "protected" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByName" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verification" JSONB,
    "deletedAt" TIMESTAMP(3),
    "deletedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupRecord_pkey" PRIMARY KEY ("snapshotId")
);

CREATE TYPE "BackupOperationType" AS ENUM ('CREATE', 'DELETE', 'RESTORE');
CREATE TYPE "BackupOperationStatus" AS ENUM ('RUNNING', 'VERIFIED', 'COMPLETED', 'FAILED', 'DISCARDED');

CREATE TABLE "BackupOperation" (
    "id" TEXT NOT NULL,
    "type" "BackupOperationType" NOT NULL,
    "status" "BackupOperationStatus" NOT NULL DEFAULT 'RUNNING',
    "lane" TEXT NOT NULL,
    "snapshotId" TEXT,
    "branchId" TEXT,
    "branchName" TEXT,
    "providerOperationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "requestedById" TEXT,
    "requestedByName" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "BackupOperation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackupOperation_type_startedAt_idx" ON "BackupOperation"("type", "startedAt");
CREATE INDEX "BackupOperation_snapshotId_idx" ON "BackupOperation"("snapshotId");
-- One active operation per lane: no two backups, and no two restores, at the same time.
CREATE UNIQUE INDEX "BackupOperation_one_active_per_lane" ON "BackupOperation"("lane") WHERE "status" IN ('RUNNING', 'VERIFIED');

CREATE TABLE "BackupSettings" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "manualRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupSettings_pkey" PRIMARY KEY ("id")
);
