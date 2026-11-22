-- Examinations, phase 5: mark sheets (paper x section) and marks. New tables only.

-- CreateEnum
CREATE TYPE "MarkSheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED');

-- CreateTable
CREATE TABLE "ExamMarkSheet" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "examinationId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" "MarkSheetStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "submittedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedByName" TEXT,
    "returnedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamMarkSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamMark" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "marks" DECIMAL(6,2),
    "absent" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamMark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExamMarkSheet_examinationId_branchId_idx" ON "ExamMarkSheet"("examinationId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamMarkSheet_paperId_sectionId_key" ON "ExamMarkSheet"("paperId", "sectionId");

-- CreateIndex
CREATE INDEX "ExamMark_studentId_idx" ON "ExamMark"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamMark_sheetId_studentId_key" ON "ExamMark"("sheetId", "studentId");

-- AddForeignKey
ALTER TABLE "ExamMarkSheet" ADD CONSTRAINT "ExamMarkSheet_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamMarkSheet" ADD CONSTRAINT "ExamMarkSheet_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ExamPaper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamMarkSheet" ADD CONSTRAINT "ExamMarkSheet_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamMark" ADD CONSTRAINT "ExamMark_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "ExamMarkSheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamMark" ADD CONSTRAINT "ExamMark_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "ExamMark" ADD CONSTRAINT "ExamMark_marks_check" CHECK ("marks" IS NULL OR "marks" >= 0);
