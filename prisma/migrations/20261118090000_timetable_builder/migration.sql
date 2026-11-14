
-- CreateEnum
CREATE TYPE "TimetableDraftStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DISCARDED');

-- CreateTable
CREATE TABLE "TimetableSetup" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "defaultBellScheduleId" TEXT,
    "sectionBells" JSONB NOT NULL DEFAULT '{}',
    "excludedSectionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxSubjectPerDay" INTEGER NOT NULL DEFAULT 2,
    "allowDoubleLessons" BOOLEAN NOT NULL DEFAULT true,
    "spreadSubjects" BOOLEAN NOT NULL DEFAULT true,
    "avoidTeacherGaps" BOOLEAN NOT NULL DEFAULT true,
    "teacherMaxPerDay" INTEGER,
    "morningSubjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "searchSeconds" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimetableSetup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherTimetableProfile" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "maxPerDay" INTEGER,
    "maxPerWeek" INTEGER,
    "unavailable" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherTimetableProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetableFixedLesson" (
    "id" TEXT NOT NULL,
    "setupId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "weekday" "Weekday" NOT NULL,
    "periodNumber" INTEGER NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimetableFixedLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetableDraft" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "setupId" TEXT NOT NULL,
    "status" "TimetableDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "planDate" DATE NOT NULL,
    "sections" JSONB NOT NULL,
    "seed" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "report" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "publishedFrom" DATE,
    "discardedAt" TIMESTAMP(3),

    CONSTRAINT "TimetableDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetableDraftLesson" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "weekday" "Weekday" NOT NULL,
    "periodNumber" INTEGER NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "fixed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TimetableDraftLesson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimetableSetup_schoolId_idx" ON "TimetableSetup"("schoolId");

-- CreateIndex
CREATE INDEX "TimetableSetup_defaultBellScheduleId_idx" ON "TimetableSetup"("defaultBellScheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "TimetableSetup_branchId_academicYearId_key" ON "TimetableSetup"("branchId", "academicYearId");

-- CreateIndex
CREATE INDEX "TeacherTimetableProfile_schoolId_academicYearId_idx" ON "TeacherTimetableProfile"("schoolId", "academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherTimetableProfile_teacherId_academicYearId_key" ON "TeacherTimetableProfile"("teacherId", "academicYearId");

-- CreateIndex
CREATE INDEX "TimetableFixedLesson_sectionId_idx" ON "TimetableFixedLesson"("sectionId");

-- CreateIndex
CREATE INDEX "TimetableFixedLesson_subjectId_idx" ON "TimetableFixedLesson"("subjectId");

-- CreateIndex
CREATE INDEX "TimetableFixedLesson_teacherId_idx" ON "TimetableFixedLesson"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "TimetableFixedLesson_setupId_sectionId_weekday_periodNumber_key" ON "TimetableFixedLesson"("setupId", "sectionId", "weekday", "periodNumber");

-- CreateIndex
CREATE INDEX "TimetableDraft_schoolId_academicYearId_branchId_idx" ON "TimetableDraft"("schoolId", "academicYearId", "branchId");

-- CreateIndex
CREATE INDEX "TimetableDraft_setupId_idx" ON "TimetableDraft"("setupId");

-- CreateIndex
CREATE INDEX "TimetableDraftLesson_draftId_teacherId_idx" ON "TimetableDraftLesson"("draftId", "teacherId");

-- CreateIndex
CREATE INDEX "TimetableDraftLesson_sectionId_idx" ON "TimetableDraftLesson"("sectionId");

-- CreateIndex
CREATE INDEX "TimetableDraftLesson_subjectId_idx" ON "TimetableDraftLesson"("subjectId");

-- CreateIndex
CREATE INDEX "TimetableDraftLesson_teacherId_idx" ON "TimetableDraftLesson"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "TimetableDraftLesson_draftId_sectionId_weekday_periodNumber_key" ON "TimetableDraftLesson"("draftId", "sectionId", "weekday", "periodNumber");

-- AddForeignKey
ALTER TABLE "TimetableSetup" ADD CONSTRAINT "TimetableSetup_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSetup" ADD CONSTRAINT "TimetableSetup_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSetup" ADD CONSTRAINT "TimetableSetup_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSetup" ADD CONSTRAINT "TimetableSetup_defaultBellScheduleId_fkey" FOREIGN KEY ("defaultBellScheduleId") REFERENCES "BellSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherTimetableProfile" ADD CONSTRAINT "TeacherTimetableProfile_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherTimetableProfile" ADD CONSTRAINT "TeacherTimetableProfile_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherTimetableProfile" ADD CONSTRAINT "TeacherTimetableProfile_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableFixedLesson" ADD CONSTRAINT "TimetableFixedLesson_setupId_fkey" FOREIGN KEY ("setupId") REFERENCES "TimetableSetup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableFixedLesson" ADD CONSTRAINT "TimetableFixedLesson_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableFixedLesson" ADD CONSTRAINT "TimetableFixedLesson_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableFixedLesson" ADD CONSTRAINT "TimetableFixedLesson_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableDraft" ADD CONSTRAINT "TimetableDraft_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableDraft" ADD CONSTRAINT "TimetableDraft_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableDraft" ADD CONSTRAINT "TimetableDraft_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableDraft" ADD CONSTRAINT "TimetableDraft_setupId_fkey" FOREIGN KEY ("setupId") REFERENCES "TimetableSetup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableDraftLesson" ADD CONSTRAINT "TimetableDraftLesson_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "TimetableDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableDraftLesson" ADD CONSTRAINT "TimetableDraftLesson_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableDraftLesson" ADD CONSTRAINT "TimetableDraftLesson_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableDraftLesson" ADD CONSTRAINT "TimetableDraftLesson_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---- Hand-written constraints (docs/business-rules.md → Timetable builder) ----

ALTER TABLE "TimetableSetup" ADD CONSTRAINT "TimetableSetup_limits_check" CHECK (
  "maxSubjectPerDay" BETWEEN 1 AND 6
  AND ("teacherMaxPerDay" IS NULL OR "teacherMaxPerDay" BETWEEN 1 AND 20)
  AND "searchSeconds" BETWEEN 5 AND 60
  AND jsonb_typeof("sectionBells") = 'object'
);

ALTER TABLE "TeacherTimetableProfile" ADD CONSTRAINT "TeacherTimetableProfile_limits_check" CHECK (
  ("maxPerDay" IS NULL OR "maxPerDay" BETWEEN 1 AND 20)
  AND ("maxPerWeek" IS NULL OR "maxPerWeek" BETWEEN 1 AND 140)
  AND jsonb_typeof("unavailable") = 'array'
);

ALTER TABLE "TimetableFixedLesson" ADD CONSTRAINT "TimetableFixedLesson_period_check" CHECK ("periodNumber" BETWEEN 1 AND 20);
ALTER TABLE "TimetableDraftLesson" ADD CONSTRAINT "TimetableDraftLesson_period_check" CHECK ("periodNumber" BETWEEN 1 AND 20);

ALTER TABLE "TimetableDraft" ADD CONSTRAINT "TimetableDraft_shape_check" CHECK (
  "revision" >= 1
  AND jsonb_typeof("sections") = 'array'
  AND (("status" = 'PUBLISHED') = ("publishedAt" IS NOT NULL AND "publishedFrom" IS NOT NULL AND "publishedById" IS NOT NULL))
  AND (("status" = 'DISCARDED') = ("discardedAt" IS NOT NULL))
);

-- At most one open draft per branch and academic year.
CREATE UNIQUE INDEX "TimetableDraft_one_open" ON "TimetableDraft"("branchId", "academicYearId") WHERE "status" = 'DRAFT';
