-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'EXCUSED');

-- CreateEnum
CREATE TYPE "AttendanceEventType" AS ENUM ('CHECK_IN', 'CHECK_OUT');

-- CreateTable
CREATE TABLE "SuspensionPeriod" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT,
    "branchId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "startedById" TEXT,
    "endedById" TEXT,

    CONSTRAINT "SuspensionPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceEvent" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "type" "AttendanceEventType" NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "workDate" DATE NOT NULL,
    "shiftKey" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyMeters" DOUBLE PRECISION NOT NULL,
    "distanceMeters" DOUBLE PRECISION NOT NULL,
    "status" "AttendanceStatus",
    "checkInEventId" TEXT,

    CONSTRAINT "AttendanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SuspensionPeriod_schoolId_startedAt_idx" ON "SuspensionPeriod"("schoolId", "startedAt");

-- CreateIndex
CREATE INDEX "SuspensionPeriod_branchId_startedAt_idx" ON "SuspensionPeriod"("branchId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceEvent_checkInEventId_key" ON "AttendanceEvent"("checkInEventId");

-- CreateIndex
CREATE INDEX "AttendanceEvent_staffUserId_workDate_idx" ON "AttendanceEvent"("staffUserId", "workDate");

-- CreateIndex
CREATE INDEX "AttendanceEvent_branchId_workDate_idx" ON "AttendanceEvent"("branchId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceEvent_staffUserId_clientEventId_key" ON "AttendanceEvent"("staffUserId", "clientEventId");

-- AddForeignKey
ALTER TABLE "SuspensionPeriod" ADD CONSTRAINT "SuspensionPeriod_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuspensionPeriod" ADD CONSTRAINT "SuspensionPeriod_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "BranchSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "StaffAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "BranchLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_checkInEventId_fkey" FOREIGN KEY ("checkInEventId") REFERENCES "AttendanceEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Added by hand (not expressible in the Prisma schema):
-- a suspension period belongs to exactly one school or one branch, and cannot end before it starts.
ALTER TABLE "SuspensionPeriod" ADD CONSTRAINT "SuspensionPeriod_target_check" CHECK (("schoolId" IS NULL) <> ("branchId" IS NULL));
ALTER TABLE "SuspensionPeriod" ADD CONSTRAINT "SuspensionPeriod_period_check" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");
-- At most one open (current) suspension per school and per branch.
CREATE UNIQUE INDEX "SuspensionPeriod_one_open_school" ON "SuspensionPeriod"("schoolId") WHERE "endedAt" IS NULL AND "schoolId" IS NOT NULL;
CREATE UNIQUE INDEX "SuspensionPeriod_one_open_branch" ON "SuspensionPeriod"("branchId") WHERE "endedAt" IS NULL AND "branchId" IS NOT NULL;
-- Schools and branches suspended now get an open period from their recorded suspension time
-- (earlier suspensions exist only in the audit log; no attendance existed then).
INSERT INTO "SuspensionPeriod" ("id", "schoolId", "startedAt", "reason")
  SELECT gen_random_uuid()::text, "id", COALESCE("suspendedAt", "updatedAt"), COALESCE("suspensionReason", 'Suspended before suspension periods were recorded')
  FROM "School" WHERE "status" = 'SUSPENDED';
INSERT INTO "SuspensionPeriod" ("id", "branchId", "startedAt", "reason")
  SELECT gen_random_uuid()::text, "id", COALESCE("suspendedAt", "updatedAt"), COALESCE("suspensionReason", 'Suspended before suspension periods were recorded')
  FROM "Branch" WHERE "status" = 'SUSPENDED';

-- One check-in per staff member, day and shift; check-ins carry a status, check-outs the check-in they close.
CREATE UNIQUE INDEX "AttendanceEvent_one_check_in_per_shift" ON "AttendanceEvent"("staffUserId", "workDate", "shiftKey") WHERE "type" = 'CHECK_IN';
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_kind_check" CHECK (
  ("type" = 'CHECK_IN' AND "status" IN ('PRESENT', 'LATE') AND "checkInEventId" IS NULL)
  OR ("type" = 'CHECK_OUT' AND "status" IS NULL AND "checkInEventId" IS NOT NULL)
);
-- The approved GPS limits, also in the database.
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_position_check" CHECK (
  "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180
  AND "accuracyMeters" > 0 AND "accuracyMeters" <= 50
  AND "distanceMeters" >= 0 AND "distanceMeters" <= 100
);
-- Received within 24 hours of the event time, and the event not after it was sent.
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_times_check" CHECK (
  "occurredAt" <= "sentAt" AND "receivedAt" - "occurredAt" <= interval '24 hours'
);
