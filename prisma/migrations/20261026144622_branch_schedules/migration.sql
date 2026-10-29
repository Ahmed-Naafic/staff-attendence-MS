-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN');

-- CreateTable
CREATE TABLE "BranchSchedule" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "timeZone" TEXT NOT NULL,
    "checkOutEnabled" BOOLEAN NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "BranchSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchShift" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "days" "Weekday"[],
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "graceMinutes" INTEGER NOT NULL,
    "absenceCutoffMinutes" INTEGER NOT NULL,

    CONSTRAINT "BranchShift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchSchedule_branchId_effectiveFrom_idx" ON "BranchSchedule"("branchId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "BranchShift_scheduleId_idx" ON "BranchShift"("scheduleId");

-- AddForeignKey
ALTER TABLE "BranchSchedule" ADD CONSTRAINT "BranchSchedule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchShift" ADD CONSTRAINT "BranchShift_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "BranchSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Added by hand (not expressible in the Prisma schema):
-- one non-cancelled version per branch and effective date.
CREATE UNIQUE INDEX "BranchSchedule_one_per_date" ON "BranchSchedule"("branchId", "effectiveFrom") WHERE "cancelledAt" IS NULL;
-- Each shift: same day (00:00-23:59), at least one day, grace within the shift, cutoff from the grace to the end of the shift.
ALTER TABLE "BranchShift" ADD CONSTRAINT "BranchShift_times_check" CHECK (
  "startMinute" >= 0 AND "endMinute" <= 1439 AND "startMinute" < "endMinute"
  AND "graceMinutes" >= 0 AND "absenceCutoffMinutes" >= "graceMinutes"
  AND "absenceCutoffMinutes" <= "endMinute" - "startMinute"
  AND cardinality("days") >= 1
);
ALTER TABLE "BranchShift" ADD CONSTRAINT "BranchShift_name_check" CHECK (char_length("name") BETWEEN 1 AND 60);
