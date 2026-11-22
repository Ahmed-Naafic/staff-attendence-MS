-- Examinations, phase 9: paper files kept in a private storage bucket (records only). New table.

-- CreateEnum
CREATE TYPE "ExamPaperFileKind" AS ENUM ('QUESTION_PAPER', 'MARKING_SCHEME', 'OTHER');

-- CreateEnum
CREATE TYPE "ExamPaperFileStatus" AS ENUM ('PENDING', 'READY', 'REMOVED');

-- CreateTable
CREATE TABLE "ExamPaperFile" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "kind" "ExamPaperFileKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "ExamPaperFileStatus" NOT NULL DEFAULT 'PENDING',
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "removedByName" TEXT,

    CONSTRAINT "ExamPaperFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaperFile_storageKey_key" ON "ExamPaperFile"("storageKey");

-- CreateIndex
CREATE INDEX "ExamPaperFile_paperId_status_idx" ON "ExamPaperFile"("paperId", "status");

-- AddForeignKey
ALTER TABLE "ExamPaperFile" ADD CONSTRAINT "ExamPaperFile_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ExamPaper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

