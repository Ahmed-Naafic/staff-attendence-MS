-- Examinations, phase 2: examinations, the classes sitting them and their papers. New tables only.
-- CreateEnum
CREATE TYPE "ExaminationStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Examination" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "academicPeriodId" TEXT,
    "examTypeId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "description" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "stopsLessons" BOOLEAN NOT NULL,
    "status" "ExaminationStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Examination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExaminationClass" (
    "id" TEXT NOT NULL,
    "examinationId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExaminationClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamPaper" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "examinationId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "maxMarks" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamPaper_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Examination_schoolId_academicYearId_startDate_idx" ON "Examination"("schoolId", "academicYearId", "startDate");

-- CreateIndex
CREATE INDEX "Examination_schoolId_status_startDate_idx" ON "Examination"("schoolId", "status", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "Examination_academicYearId_nameKey_key" ON "Examination"("academicYearId", "nameKey");

-- CreateIndex
CREATE INDEX "ExaminationClass_classId_idx" ON "ExaminationClass"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "ExaminationClass_examinationId_classId_key" ON "ExaminationClass"("examinationId", "classId");

-- CreateIndex
CREATE INDEX "ExamPaper_schoolId_idx" ON "ExamPaper"("schoolId");

-- CreateIndex
CREATE INDEX "ExamPaper_subjectId_idx" ON "ExamPaper"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaper_examinationId_classId_subjectId_key" ON "ExamPaper"("examinationId", "classId", "subjectId");

-- AddForeignKey
ALTER TABLE "Examination" ADD CONSTRAINT "Examination_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Examination" ADD CONSTRAINT "Examination_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Examination" ADD CONSTRAINT "Examination_academicPeriodId_fkey" FOREIGN KEY ("academicPeriodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Examination" ADD CONSTRAINT "Examination_examTypeId_fkey" FOREIGN KEY ("examTypeId") REFERENCES "ExamType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Examination" ADD CONSTRAINT "Examination_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExaminationClass" ADD CONSTRAINT "ExaminationClass_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExaminationClass" ADD CONSTRAINT "ExaminationClass_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Dates in order; papers within sensible limits (the API checks them too).
ALTER TABLE "Examination" ADD CONSTRAINT "Examination_dates_check" CHECK ("endDate" >= "startDate");
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_limits_check" CHECK ("maxMarks" BETWEEN 1 AND 1000 AND "durationMinutes" BETWEEN 15 AND 480);
