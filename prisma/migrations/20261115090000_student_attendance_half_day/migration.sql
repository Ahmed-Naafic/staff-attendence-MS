-- Student attendance, Phase 4 (docs/business-rules.md -> Student attendance): settings (school
-- defaults and branch values), attendance sessions with the class list fixed when they open, each
-- student's current mark, the history of every mark and change, and excuses. Additive only: new
-- types and tables, no existing table changes.

-- CreateEnum
CREATE TYPE "AttendanceFrequency" AS ENUM ('ONCE_DAILY', 'TWICE_DAILY');

-- CreateEnum
CREATE TYPE "StudentAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateEnum
CREATE TYPE "AttendanceSessionKind" AS ENUM ('HALF_DAY', 'LESSON');

-- CreateEnum
CREATE TYPE "DayHalf" AS ENUM ('WHOLE_DAY', 'BEFORE_BREAK', 'AFTER_BREAK');

-- CreateEnum
CREATE TYPE "AttendanceMarkSource" AS ENUM ('WEB', 'MOBILE');

-- CreateTable
CREATE TABLE "StudentAttendanceSettings" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT,
    "halfDayFrequency" "AttendanceFrequency",
    "halfDayOpensBeforeMinutes" INTEGER,
    "halfDayDeadlineAfterMinutes" INTEGER,
    "managerEditDays" INTEGER,
    "correctionReasonRequired" BOOLEAN,
    "lessonOpensBeforeMinutes" INTEGER,
    "lessonDeadlineAfterMinutes" INTEGER,
    "teacherCorrectionMinutes" INTEGER,
    "offlineGraceMinutes" INTEGER,
    "branchOverridable" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentAttendanceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentAttendanceSession" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "kind" "AttendanceSessionKind" NOT NULL DEFAULT 'HALF_DAY',
    "date" DATE NOT NULL,
    "half" "DayHalf",
    "timetableDay" "Weekday",
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "opensAt" TIMESTAMP(3) NOT NULL,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedById" TEXT,
    "openedByName" TEXT NOT NULL,

    CONSTRAINT "StudentAttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentAttendanceEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "addedLate" BOOLEAN NOT NULL DEFAULT false,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "StudentAttendanceStatus",
    "reason" TEXT,
    "note" TEXT,
    "markedAt" TIMESTAMP(3),
    "markedById" TEXT,
    "markedByName" TEXT,
    "occurredAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "source" "AttendanceMarkSource",
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StudentAttendanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentAttendanceChange" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fromStatus" "StudentAttendanceStatus",
    "toStatus" "StudentAttendanceStatus" NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorRole" "Role" NOT NULL,
    "source" "AttendanceMarkSource" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "afterDeadline" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StudentAttendanceChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentExcuse" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "half" "DayHalf",
    "periods" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledByName" TEXT,

    CONSTRAINT "StudentExcuse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentAttendanceSettings_branchId_key" ON "StudentAttendanceSettings"("branchId");

-- CreateIndex
CREATE INDEX "StudentAttendanceSettings_schoolId_idx" ON "StudentAttendanceSettings"("schoolId");

-- CreateIndex
CREATE INDEX "StudentAttendanceSession_branchId_date_idx" ON "StudentAttendanceSession"("branchId", "date");

-- CreateIndex
CREATE INDEX "StudentAttendanceSession_sectionId_date_idx" ON "StudentAttendanceSession"("sectionId", "date");

-- CreateIndex
CREATE INDEX "StudentAttendanceSession_schoolId_date_idx" ON "StudentAttendanceSession"("schoolId", "date");

-- CreateIndex
CREATE INDEX "StudentAttendanceEntry_studentId_idx" ON "StudentAttendanceEntry"("studentId");

-- CreateIndex
CREATE INDEX "StudentAttendanceEntry_enrollmentId_idx" ON "StudentAttendanceEntry"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentAttendanceEntry_sessionId_studentId_key" ON "StudentAttendanceEntry"("sessionId", "studentId");

-- CreateIndex
CREATE INDEX "StudentAttendanceChange_sessionId_recordedAt_idx" ON "StudentAttendanceChange"("sessionId", "recordedAt");

-- CreateIndex
CREATE INDEX "StudentAttendanceChange_entryId_idx" ON "StudentAttendanceChange"("entryId");

-- CreateIndex
CREATE INDEX "StudentExcuse_studentId_startDate_idx" ON "StudentExcuse"("studentId", "startDate");

-- CreateIndex
CREATE INDEX "StudentExcuse_branchId_startDate_idx" ON "StudentExcuse"("branchId", "startDate");

-- CreateIndex
CREATE INDEX "StudentExcuse_schoolId_idx" ON "StudentExcuse"("schoolId");

-- AddForeignKey
ALTER TABLE "StudentAttendanceSettings" ADD CONSTRAINT "StudentAttendanceSettings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAttendanceSettings" ADD CONSTRAINT "StudentAttendanceSettings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAttendanceSession" ADD CONSTRAINT "StudentAttendanceSession_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAttendanceSession" ADD CONSTRAINT "StudentAttendanceSession_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAttendanceSession" ADD CONSTRAINT "StudentAttendanceSession_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAttendanceSession" ADD CONSTRAINT "StudentAttendanceSession_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAttendanceEntry" ADD CONSTRAINT "StudentAttendanceEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudentAttendanceSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAttendanceEntry" ADD CONSTRAINT "StudentAttendanceEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAttendanceEntry" ADD CONSTRAINT "StudentAttendanceEntry_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAttendanceChange" ADD CONSTRAINT "StudentAttendanceChange_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "StudentAttendanceEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAttendanceChange" ADD CONSTRAINT "StudentAttendanceChange_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudentAttendanceSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentExcuse" ADD CONSTRAINT "StudentExcuse_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentExcuse" ADD CONSTRAINT "StudentExcuse_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentExcuse" ADD CONSTRAINT "StudentExcuse_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Checks -------------------------------------------------------------------------------------

-- Settings limits (null: not set at this level). Only the school row lists what branches may change.
ALTER TABLE "StudentAttendanceSettings" ADD CONSTRAINT "StudentAttendanceSettings_limits_check" CHECK (
    ("halfDayOpensBeforeMinutes" IS NULL OR "halfDayOpensBeforeMinutes" BETWEEN 0 AND 240)
    AND ("halfDayDeadlineAfterMinutes" IS NULL OR "halfDayDeadlineAfterMinutes" BETWEEN 0 AND 1440)
    AND ("managerEditDays" IS NULL OR "managerEditDays" BETWEEN 0 AND 90)
    AND ("lessonOpensBeforeMinutes" IS NULL OR "lessonOpensBeforeMinutes" BETWEEN 0 AND 60)
    AND ("lessonDeadlineAfterMinutes" IS NULL OR "lessonDeadlineAfterMinutes" BETWEEN 0 AND 720)
    AND ("teacherCorrectionMinutes" IS NULL OR "teacherCorrectionMinutes" BETWEEN 0 AND 1440)
    AND ("offlineGraceMinutes" IS NULL OR "offlineGraceMinutes" BETWEEN 0 AND 4320)
    AND ("branchId" IS NULL OR cardinality(coalesce("branchOverridable", ARRAY[]::TEXT[])) = 0)
);
-- One school row per school (branch rows: the unique branchId).
CREATE UNIQUE INDEX "StudentAttendanceSettings_one_per_school" ON "StudentAttendanceSettings"("schoolId") WHERE "branchId" IS NULL;

ALTER TABLE "StudentAttendanceSession" ADD CONSTRAINT "StudentAttendanceSession_shape_check" CHECK (
    ("kind" = 'HALF_DAY' AND "half" IS NOT NULL OR "kind" = 'LESSON' AND "half" IS NULL)
    AND ("startsAt" IS NULL) = ("endsAt" IS NULL)
    AND ("startsAt" IS NULL OR "startsAt" < "endsAt")
    AND "opensAt" < "deadlineAt"
);
-- One session per section, date and half, even under simultaneous requests ...
CREATE UNIQUE INDEX "StudentAttendanceSession_one_per_half" ON "StudentAttendanceSession"("sectionId", "date", "half") WHERE "kind" = 'HALF_DAY';
-- ... and never a whole-day session beside half-day sessions of the same section and date.
ALTER TABLE "StudentAttendanceSession" ADD CONSTRAINT "StudentAttendanceSession_whole_or_halves"
    EXCLUDE USING gist ("sectionId" WITH =, "date" WITH =, (CASE WHEN "half" = 'WHOLE_DAY' THEN 1 ELSE 0 END) WITH <>)
    WHERE ("kind" = 'HALF_DAY');

-- A mark has who and when; EXCUSED always has a reason.
ALTER TABLE "StudentAttendanceEntry" ADD CONSTRAINT "StudentAttendanceEntry_mark_check" CHECK (
    ("status" IS NULL AND "markedAt" IS NULL AND "version" = 0)
    OR ("status" IS NOT NULL AND "markedAt" IS NOT NULL AND "markedByName" IS NOT NULL AND "occurredAt" IS NOT NULL AND "source" IS NOT NULL)
);
ALTER TABLE "StudentAttendanceEntry" ADD CONSTRAINT "StudentAttendanceEntry_excused_reason_check" CHECK (
    "status" IS DISTINCT FROM 'EXCUSED' OR length(btrim("reason")) > 0
);
ALTER TABLE "StudentAttendanceChange" ADD CONSTRAINT "StudentAttendanceChange_excused_reason_check" CHECK (
    "toStatus" <> 'EXCUSED' OR length(btrim("reason")) > 0
);

-- Dates in order; a half or some lessons, not both; lessons numbered 1-20; a reason.
ALTER TABLE "StudentExcuse" ADD CONSTRAINT "StudentExcuse_shape_check" CHECK (
    "startDate" <= "endDate"
    AND ("half" IS NULL OR "half" <> 'WHOLE_DAY')
    AND ("half" IS NULL OR cardinality(coalesce("periods", ARRAY[]::INTEGER[])) = 0)
    AND cardinality(coalesce("periods", ARRAY[]::INTEGER[])) <= 20
    AND 1 <= ALL (coalesce("periods", ARRAY[]::INTEGER[])) AND 20 >= ALL (coalesce("periods", ARRAY[]::INTEGER[]))
    AND length(btrim("reason")) > 0
    AND ("cancelledAt" IS NULL) = ("cancelledByName" IS NULL)
);
