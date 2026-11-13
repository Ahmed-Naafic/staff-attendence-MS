-- Academic calendar (docs/business-rules.md → Academic calendar) and the per-school Student
-- Attendance switch. Additive only: no existing table loses or changes data.

-- Student Attendance per school (Super Admin); off for every existing school.
ALTER TABLE "School" ADD COLUMN "studentAttendanceEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Whether Managers may set their branch's own school days in a year (School Owner); off by default.
ALTER TABLE "AcademicYear" ADD COLUMN "branchWeekdaysAllowed" BOOLEAN NOT NULL DEFAULT false;

-- ---- Weekly school days, versioned (school default or one branch) -------------------------------

CREATE TABLE "AcademicWeekdays" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "branchId" TEXT,
    "days" "Weekday"[] NOT NULL,
    "followsSchool" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" DATE NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "AcademicWeekdays_pkey" PRIMARY KEY ("id"),
    -- A version names its days (1–7); only a branch version that follows the school has none.
    CONSTRAINT "AcademicWeekdays_days_check" CHECK (
        ("followsSchool" AND "branchId" IS NOT NULL AND cardinality("days") = 0)
        OR (NOT "followsSchool" AND cardinality("days") BETWEEN 1 AND 7)
    )
);

CREATE INDEX "AcademicWeekdays_academicYearId_branchId_effectiveFrom_idx" ON "AcademicWeekdays"("academicYearId", "branchId", "effectiveFrom");
CREATE INDEX "AcademicWeekdays_schoolId_idx" ON "AcademicWeekdays"("schoolId");
ALTER TABLE "AcademicWeekdays" ADD CONSTRAINT "AcademicWeekdays_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AcademicWeekdays" ADD CONSTRAINT "AcademicWeekdays_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AcademicWeekdays" ADD CONSTRAINT "AcademicWeekdays_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One active version per level and date (the school's, and each branch's), even under simultaneous requests.
CREATE UNIQUE INDEX "AcademicWeekdays_one_school_version" ON "AcademicWeekdays"("academicYearId", "effectiveFrom")
    WHERE "branchId" IS NULL AND "cancelledAt" IS NULL;
CREATE UNIQUE INDEX "AcademicWeekdays_one_branch_version" ON "AcademicWeekdays"("academicYearId", "branchId", "effectiveFrom")
    WHERE "branchId" IS NOT NULL AND "cancelledAt" IS NULL;

-- ---- Calendar entries: school holidays, branch closures, branch reopenings ----------------------

CREATE TYPE "CalendarEntryType" AS ENUM ('HOLIDAY', 'CLOSURE', 'REOPENING');

CREATE TABLE "CalendarEntry" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "branchId" TEXT,
    "type" "CalendarEntryType" NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "allowBranchReopening" BOOLEAN NOT NULL DEFAULT false,
    "holidayId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "CalendarEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CalendarEntry_dates_check" CHECK ("endDate" >= "startDate"),
    -- HOLIDAY: school level; CLOSURE: one branch; REOPENING: one branch and the holiday it reopens.
    CONSTRAINT "CalendarEntry_level_check" CHECK (
        ("type" = 'HOLIDAY' AND "branchId" IS NULL AND "holidayId" IS NULL)
        OR ("type" = 'CLOSURE' AND "branchId" IS NOT NULL AND "holidayId" IS NULL AND NOT "allowBranchReopening")
        OR ("type" = 'REOPENING' AND "branchId" IS NOT NULL AND "holidayId" IS NOT NULL AND NOT "allowBranchReopening")
    )
);

CREATE INDEX "CalendarEntry_schoolId_academicYearId_startDate_idx" ON "CalendarEntry"("schoolId", "academicYearId", "startDate");
CREATE INDEX "CalendarEntry_branchId_startDate_idx" ON "CalendarEntry"("branchId", "startDate");
CREATE INDEX "CalendarEntry_holidayId_idx" ON "CalendarEntry"("holidayId");
ALTER TABLE "CalendarEntry" ADD CONSTRAINT "CalendarEntry_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarEntry" ADD CONSTRAINT "CalendarEntry_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarEntry" ADD CONSTRAINT "CalendarEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarEntry" ADD CONSTRAINT "CalendarEntry_holidayId_fkey" FOREIGN KEY ("holidayId") REFERENCES "CalendarEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Active entries of one type never overlap at the same level (both dates inclusive), even under
-- simultaneous requests; cancelled entries are ignored. btree_gist was installed with academic years.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "CalendarEntry" ADD CONSTRAINT "CalendarEntry_no_overlapping_holidays"
    EXCLUDE USING gist ("schoolId" WITH =, daterange("startDate", "endDate", '[]') WITH &&)
    WHERE ("type" = 'HOLIDAY' AND "cancelledAt" IS NULL);
ALTER TABLE "CalendarEntry" ADD CONSTRAINT "CalendarEntry_no_overlapping_closures"
    EXCLUDE USING gist ("branchId" WITH =, daterange("startDate", "endDate", '[]') WITH &&)
    WHERE ("type" = 'CLOSURE' AND "cancelledAt" IS NULL);
ALTER TABLE "CalendarEntry" ADD CONSTRAINT "CalendarEntry_no_overlapping_reopenings"
    EXCLUDE USING gist ("branchId" WITH =, daterange("startDate", "endDate", '[]') WITH &&)
    WHERE ("type" = 'REOPENING' AND "cancelledAt" IS NULL);
