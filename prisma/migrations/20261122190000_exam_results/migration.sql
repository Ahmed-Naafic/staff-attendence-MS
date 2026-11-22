-- Examinations, phase 7: result sets per section, results per revision, publication history. New tables only.

-- CreateEnum
CREATE TYPE "ResultSetStatus" AS ENUM ('DRAFT', 'APPROVED', 'PUBLISHED');

-- CreateTable
CREATE TABLE "ExamResultSet" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "examinationId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" "ResultSetStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "approvedByName" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamResultSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamResult" (
    "id" TEXT NOT NULL,
    "resultSetId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "studentId" TEXT NOT NULL,
    "papers" JSONB NOT NULL,
    "totalMarks" DECIMAL(8,2) NOT NULL,
    "totalMax" INTEGER NOT NULL,
    "percent" DECIMAL(5,2),
    "grade" TEXT,
    "points" DECIMAL(5,2),
    "remark" TEXT,
    "passed" BOOLEAN,
    "failedPapers" INTEGER NOT NULL,
    "rank" INTEGER,

    CONSTRAINT "ExamResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamResultRevision" (
    "id" TEXT NOT NULL,
    "resultSetId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "publishedByName" TEXT,
    "reason" TEXT,
    "summary" JSONB NOT NULL,

    CONSTRAINT "ExamResultRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExamResultSet_schoolId_status_idx" ON "ExamResultSet"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExamResultSet_examinationId_sectionId_key" ON "ExamResultSet"("examinationId", "sectionId");

-- CreateIndex
CREATE INDEX "ExamResult_studentId_idx" ON "ExamResult"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamResult_resultSetId_revision_studentId_key" ON "ExamResult"("resultSetId", "revision", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamResultRevision_resultSetId_revision_key" ON "ExamResultRevision"("resultSetId", "revision");

-- AddForeignKey
ALTER TABLE "ExamResultSet" ADD CONSTRAINT "ExamResultSet_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResultSet" ADD CONSTRAINT "ExamResultSet_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_resultSetId_fkey" FOREIGN KEY ("resultSetId") REFERENCES "ExamResultSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResultRevision" ADD CONSTRAINT "ExamResultRevision_resultSetId_fkey" FOREIGN KEY ("resultSetId") REFERENCES "ExamResultSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

