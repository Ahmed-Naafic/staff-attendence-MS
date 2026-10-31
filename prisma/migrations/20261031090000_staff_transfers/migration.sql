-- Staff transfers between branches of the same school (docs/business-rules.md → Staff transfers):
-- the transfer history table and the TRANSFER notification category. New table and enum value
-- only; no existing row changes.

-- CreateEnum
CREATE TYPE "StaffTransferStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'TRANSFER';

-- CreateTable
CREATE TABLE "StaffTransfer" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "fromBranchId" TEXT NOT NULL,
    "toBranchId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "timeZone" TEXT NOT NULL,
    "assignmentId" TEXT,
    "status" "StaffTransferStatus" NOT NULL DEFAULT 'SCHEDULED',
    "requestedById" TEXT,
    "cancelledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "StaffTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffTransfer_staffUserId_effectiveAt_idx" ON "StaffTransfer"("staffUserId", "effectiveAt");

-- CreateIndex
CREATE INDEX "StaffTransfer_status_effectiveAt_idx" ON "StaffTransfer"("status", "effectiveAt");

-- CreateIndex
CREATE INDEX "StaffTransfer_fromBranchId_idx" ON "StaffTransfer"("fromBranchId");

-- CreateIndex
CREATE INDEX "StaffTransfer_toBranchId_idx" ON "StaffTransfer"("toBranchId");

-- CreateIndex
CREATE INDEX "StaffTransfer_schoolId_idx" ON "StaffTransfer"("schoolId");

-- AddForeignKey
ALTER TABLE "StaffTransfer" ADD CONSTRAINT "StaffTransfer_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTransfer" ADD CONSTRAINT "StaffTransfer_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTransfer" ADD CONSTRAINT "StaffTransfer_fromBranchId_fkey" FOREIGN KEY ("fromBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTransfer" ADD CONSTRAINT "StaffTransfer_toBranchId_fkey" FOREIGN KEY ("toBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- At most one scheduled transfer per staff member: two simultaneous requests cannot both schedule one.
CREATE UNIQUE INDEX "StaffTransfer_one_scheduled_per_staff" ON "StaffTransfer"("staffUserId") WHERE "status" = 'SCHEDULED';
ALTER TABLE "StaffTransfer" ADD CONSTRAINT "StaffTransfer_branches_check" CHECK ("fromBranchId" <> "toBranchId");
ALTER TABLE "StaffTransfer" ADD CONSTRAINT "StaffTransfer_state_check" CHECK (
  ("status" = 'SCHEDULED' AND "completedAt" IS NULL AND "cancelledAt" IS NULL)
  OR ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL AND "cancelledAt" IS NULL)
  OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "completedAt" IS NULL)
);
