-- Supabase Storage integration (docs/storage/supabase-storage.md): paper-file records gain the
-- metadata of the shared storage layer and the states of a safe upload / replace / delete cycle.
-- Additive only: no row is deleted; existing rows are filled in from what they already hold.

-- AlterEnum (new values are not used in this migration)
ALTER TYPE "ExamPaperFileStatus" ADD VALUE 'REPLACED';
ALTER TYPE "ExamPaperFileStatus" ADD VALUE 'REJECTED';
ALTER TYPE "ExamPaperFileStatus" ADD VALUE 'ABANDONED';

-- AlterTable
ALTER TABLE "ExamPaperFile"
    ADD COLUMN "extension" TEXT,
    ADD COLUMN "branchId" TEXT,
    ADD COLUMN "bucket" TEXT,
    ADD COLUMN "statusReason" TEXT,
    ADD COLUMN "replacesId" TEXT,
    ADD COLUMN "replacedById" TEXT,
    ADD COLUMN "objectDeletedAt" TIMESTAMP(3);

-- Existing records: the extension from the stored key, the examination's branch, and the bucket of
-- the first release (SUPABASE_EXAM_BUCKET's default). Removed records already had their object deleted.
UPDATE "ExamPaperFile" f SET
    "extension" = COALESCE(lower(substring(f."storageKey" from '\.([A-Za-z0-9]+)$')), 'bin'),
    "bucket" = 'exam-papers',
    "objectDeletedAt" = CASE WHEN f."status" = 'REMOVED' THEN COALESCE(f."removedAt", CURRENT_TIMESTAMP) ELSE NULL END,
    "branchId" = (SELECT e."branchId" FROM "ExamPaper" p JOIN "Examination" e ON e."id" = p."examinationId" WHERE p."id" = f."paperId");

ALTER TABLE "ExamPaperFile" ALTER COLUMN "extension" SET NOT NULL, ALTER COLUMN "bucket" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ExamPaperFile_status_createdAt_idx" ON "ExamPaperFile"("status", "createdAt");
