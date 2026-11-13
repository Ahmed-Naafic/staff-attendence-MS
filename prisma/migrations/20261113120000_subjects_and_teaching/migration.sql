-- Subjects, class curricula and teaching assignments (docs/business-rules.md → Subjects; Teaching
-- assignments). Additive only: no existing table changes.

CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "status" "ClassStatus" NOT NULL DEFAULT 'ACTIVE',
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subject_schoolId_nameKey_key" ON "Subject"("schoolId", "nameKey");
CREATE INDEX "Subject_schoolId_status_idx" ON "Subject"("schoolId", "status");
-- A code, when given, is unique in the school (stored upper case by the API).
CREATE UNIQUE INDEX "Subject_schoolId_code_key" ON "Subject"("schoolId", "code") WHERE "code" IS NOT NULL;
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ClassSubject" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "weeklyLessons" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassSubject_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClassSubject_weeklyLessons_check" CHECK ("weeklyLessons" IS NULL OR "weeklyLessons" BETWEEN 1 AND 40)
);

CREATE UNIQUE INDEX "ClassSubject_classId_subjectId_key" ON "ClassSubject"("classId", "subjectId");
CREATE INDEX "ClassSubject_schoolId_idx" ON "ClassSubject"("schoolId");
CREATE INDEX "ClassSubject_subjectId_idx" ON "ClassSubject"("subjectId");
ALTER TABLE "ClassSubject" ADD CONSTRAINT "ClassSubject_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClassSubject" ADD CONSTRAINT "ClassSubject_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClassSubject" ADD CONSTRAINT "ClassSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "TeachingRole" AS ENUM ('SUBJECT_TEACHER', 'CLASS_TEACHER');

CREATE TABLE "TeachingAssignment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "role" "TeachingRole" NOT NULL,
    "subjectId" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "TeachingAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TeachingAssignment_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate"),
    -- A subject teacher names the subject; a class teacher does not.
    CONSTRAINT "TeachingAssignment_role_check" CHECK (("role" = 'SUBJECT_TEACHER') = ("subjectId" IS NOT NULL))
);

CREATE INDEX "TeachingAssignment_sectionId_role_idx" ON "TeachingAssignment"("sectionId", "role");
CREATE INDEX "TeachingAssignment_teacherId_academicYearId_idx" ON "TeachingAssignment"("teacherId", "academicYearId");
CREATE INDEX "TeachingAssignment_schoolId_academicYearId_branchId_idx" ON "TeachingAssignment"("schoolId", "academicYearId", "branchId");
CREATE INDEX "TeachingAssignment_subjectId_idx" ON "TeachingAssignment"("subjectId");
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One active class teacher per section at a time, and never the same teacher twice for a section's
-- subject at once (an open end date runs to infinity), even under simultaneous requests.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_one_class_teacher"
    EXCLUDE USING gist ("sectionId" WITH =, daterange("startDate", "endDate", '[]') WITH &&)
    WHERE ("role" = 'CLASS_TEACHER' AND "cancelledAt" IS NULL);
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_no_duplicate_subject_teacher"
    EXCLUDE USING gist ("sectionId" WITH =, "subjectId" WITH =, "teacherId" WITH =, daterange("startDate", "endDate", '[]') WITH &&)
    WHERE ("role" = 'SUBJECT_TEACHER' AND "cancelledAt" IS NULL);
