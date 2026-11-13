-- Bell schedules and section timetables (docs/business-rules.md -> Bell schedules; Timetables),
-- and the rules for extra school days in the calendar. Additive only: no existing table loses or
-- changes data (the calendar's level check is replaced by one that also accepts SCHOOL_DAY and is
-- unchanged for the existing types).

-- ---- Calendar: extra school days ----------------------------------------------------------------

ALTER TABLE "CalendarEntry" DROP CONSTRAINT "CalendarEntry_level_check";
ALTER TABLE "CalendarEntry" ADD CONSTRAINT "CalendarEntry_level_check" CHECK (
    ("type" = 'HOLIDAY' AND "branchId" IS NULL AND "holidayId" IS NULL AND "timetableDay" IS NULL)
    OR ("type" = 'CLOSURE' AND "branchId" IS NOT NULL AND "holidayId" IS NULL AND NOT "allowBranchReopening" AND "timetableDay" IS NULL)
    OR ("type" = 'REOPENING' AND "branchId" IS NOT NULL AND "holidayId" IS NOT NULL AND NOT "allowBranchReopening" AND "timetableDay" IS NULL)
    -- School level (no branch) or one branch; always names the weekday it follows.
    OR ("type" = 'SCHOOL_DAY' AND "holidayId" IS NULL AND NOT "allowBranchReopening" AND "timetableDay" IS NOT NULL)
);

-- Active extra school days never overlap at the same level (the school's; each branch's).
ALTER TABLE "CalendarEntry" ADD CONSTRAINT "CalendarEntry_no_overlapping_school_days"
    EXCLUDE USING gist ("schoolId" WITH =, daterange("startDate", "endDate", '[]') WITH &&)
    WHERE ("type" = 'SCHOOL_DAY' AND "branchId" IS NULL AND "cancelledAt" IS NULL);
ALTER TABLE "CalendarEntry" ADD CONSTRAINT "CalendarEntry_no_overlapping_branch_school_days"
    EXCLUDE USING gist ("branchId" WITH =, daterange("startDate", "endDate", '[]') WITH &&)
    WHERE ("type" = 'SCHOOL_DAY' AND "branchId" IS NOT NULL AND "cancelledAt" IS NULL);

-- ---- Bell schedules -------------------------------------------------------------------------------

CREATE TYPE "BellPeriodKind" AS ENUM ('LESSON', 'BREAK');

CREATE TABLE "BellSchedule" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "description" TEXT,
    "status" "ClassStatus" NOT NULL DEFAULT 'ACTIVE',
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BellSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BellSchedule_schoolId_status_idx" ON "BellSchedule"("schoolId", "status");
CREATE INDEX "BellSchedule_branchId_idx" ON "BellSchedule"("branchId");
ALTER TABLE "BellSchedule" ADD CONSTRAINT "BellSchedule_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BellSchedule" ADD CONSTRAINT "BellSchedule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Names are unique per level: the school's schedules, and each branch's.
CREATE UNIQUE INDEX "BellSchedule_school_name" ON "BellSchedule"("schoolId", "nameKey") WHERE "branchId" IS NULL;
CREATE UNIQUE INDEX "BellSchedule_branch_name" ON "BellSchedule"("branchId", "nameKey") WHERE "branchId" IS NOT NULL;

CREATE TABLE "BellScheduleVersion" (
    "id" TEXT NOT NULL,
    "bellScheduleId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "BellScheduleVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BellScheduleVersion_bellScheduleId_effectiveFrom_idx" ON "BellScheduleVersion"("bellScheduleId", "effectiveFrom");
ALTER TABLE "BellScheduleVersion" ADD CONSTRAINT "BellScheduleVersion_bellScheduleId_fkey" FOREIGN KEY ("bellScheduleId") REFERENCES "BellSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One active version per schedule and date, even under simultaneous requests.
CREATE UNIQUE INDEX "BellScheduleVersion_one_per_date" ON "BellScheduleVersion"("bellScheduleId", "effectiveFrom") WHERE "cancelledAt" IS NULL;

CREATE TABLE "BellPeriod" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "kind" "BellPeriodKind" NOT NULL,
    "number" INTEGER,
    "name" TEXT,
    "days" "Weekday"[] NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "mainBreak" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BellPeriod_pkey" PRIMARY KEY ("id"),
    -- Same-day times; lessons numbered 1-20, breaks unnumbered; only a break can be the main break.
    CONSTRAINT "BellPeriod_times_check" CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute"),
    CONSTRAINT "BellPeriod_kind_check" CHECK (
        ("kind" = 'LESSON' AND "number" BETWEEN 1 AND 20 AND NOT "mainBreak")
        OR ("kind" = 'BREAK' AND "number" IS NULL)
    ),
    CONSTRAINT "BellPeriod_days_check" CHECK (cardinality("days") BETWEEN 1 AND 7)
);

CREATE INDEX "BellPeriod_versionId_idx" ON "BellPeriod"("versionId");
ALTER TABLE "BellPeriod" ADD CONSTRAINT "BellPeriod_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "BellScheduleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Section timetables -----------------------------------------------------------------------

CREATE TABLE "TimetableVersion" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "bellScheduleId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "TimetableVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TimetableVersion_sectionId_effectiveFrom_idx" ON "TimetableVersion"("sectionId", "effectiveFrom");
CREATE INDEX "TimetableVersion_schoolId_academicYearId_branchId_idx" ON "TimetableVersion"("schoolId", "academicYearId", "branchId");
CREATE INDEX "TimetableVersion_bellScheduleId_idx" ON "TimetableVersion"("bellScheduleId");
ALTER TABLE "TimetableVersion" ADD CONSTRAINT "TimetableVersion_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TimetableVersion" ADD CONSTRAINT "TimetableVersion_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TimetableVersion" ADD CONSTRAINT "TimetableVersion_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TimetableVersion" ADD CONSTRAINT "TimetableVersion_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TimetableVersion" ADD CONSTRAINT "TimetableVersion_bellScheduleId_fkey" FOREIGN KEY ("bellScheduleId") REFERENCES "BellSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One active version per section and date, even under simultaneous requests.
CREATE UNIQUE INDEX "TimetableVersion_one_per_date" ON "TimetableVersion"("sectionId", "effectiveFrom") WHERE "cancelledAt" IS NULL;

CREATE TABLE "TimetableSlot" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "weekday" "Weekday" NOT NULL,
    "periodNumber" INTEGER NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT,
    "room" TEXT,

    CONSTRAINT "TimetableSlot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TimetableSlot_period_check" CHECK ("periodNumber" BETWEEN 1 AND 20)
);

CREATE UNIQUE INDEX "TimetableSlot_versionId_weekday_periodNumber_key" ON "TimetableSlot"("versionId", "weekday", "periodNumber");
CREATE INDEX "TimetableSlot_teacherId_idx" ON "TimetableSlot"("teacherId");
CREATE INDEX "TimetableSlot_subjectId_idx" ON "TimetableSlot"("subjectId");
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TimetableVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
