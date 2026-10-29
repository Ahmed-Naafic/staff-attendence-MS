-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "staffSequence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
-- Existing shifts keep their own id as their key (edited by hand: Prisma cannot add a required column to rows).
ALTER TABLE "BranchShift" ADD COLUMN     "shiftKey" TEXT;
UPDATE "BranchShift" SET "shiftKey" = "id";
ALTER TABLE "BranchShift" ALTER COLUMN "shiftKey" SET NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "phoneKey" TEXT,
ADD COLUMN     "staffId" TEXT;

-- CreateTable
CREATE TABLE "StaffAssignment" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "timeZone" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "StaffAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAssignmentShift" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "shiftKey" TEXT NOT NULL,
    "days" "Weekday"[],

    CONSTRAINT "StaffAssignmentShift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffAssignment_staffUserId_effectiveFrom_idx" ON "StaffAssignment"("staffUserId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "StaffAssignment_branchId_idx" ON "StaffAssignment"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAssignmentShift_assignmentId_shiftKey_key" ON "StaffAssignmentShift"("assignmentId", "shiftKey");

-- CreateIndex
CREATE UNIQUE INDEX "BranchShift_scheduleId_shiftKey_key" ON "BranchShift"("scheduleId", "shiftKey");

-- CreateIndex
CREATE UNIQUE INDEX "User_staffId_key" ON "User"("staffId");

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignmentShift" ADD CONSTRAINT "StaffAssignmentShift_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "StaffAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Added by hand (not expressible in the Prisma schema):
-- a branch exactly for MANAGER and STAFF accounts (replaces the MANAGER-only check).
ALTER TABLE "User" DROP CONSTRAINT "User_manager_branch_check";
ALTER TABLE "User" ADD CONSTRAINT "User_branch_role_check" CHECK (("role" IN ('MANAGER', 'STAFF')) = ("branchId" IS NOT NULL));
-- a Staff ID exactly for STAFF, and a phone key for every STAFF account.
ALTER TABLE "User" ADD CONSTRAINT "User_staff_check" CHECK ((("role" = 'STAFF') = ("staffId" IS NOT NULL)) AND ("role" <> 'STAFF' OR "phoneKey" IS NOT NULL));
-- One staff account per phone number (the staff sign-in identifier).
CREATE UNIQUE INDEX "User_staff_phoneKey_key" ON "User"("phoneKey") WHERE "role" = 'STAFF';
-- One non-cancelled assignment set per staff member and date.
CREATE UNIQUE INDEX "StaffAssignment_one_per_date" ON "StaffAssignment"("staffUserId", "effectiveFrom") WHERE "cancelledAt" IS NULL;
-- An assigned shift has at least one day.
ALTER TABLE "StaffAssignmentShift" ADD CONSTRAINT "StaffAssignmentShift_days_check" CHECK ("days" IS NOT NULL AND cardinality("days") >= 1);
