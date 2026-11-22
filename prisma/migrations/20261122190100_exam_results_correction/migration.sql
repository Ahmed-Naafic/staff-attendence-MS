-- Examinations, phase 7: the reason a published result set was reopened. Nullable column.

-- AlterTable
ALTER TABLE "ExamResultSet" ADD COLUMN     "correctionReason" TEXT;

