-- Owner Management: suspension reason and date for owner accounts (additive, nullable).
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspensionReason" TEXT;
