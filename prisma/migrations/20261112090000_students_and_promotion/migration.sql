-- Students, enrollments and Bulk Academic Year Enrollment & Promotion (docs/business-rules.md →
-- Students; Student enrollment; Academic year promotion). Additive only: new types, tables and one
-- new column with a default; no existing row is changed.

ALTER TABLE "Branch" ADD COLUMN "studentSequence" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "StudentStatus" AS ENUM ('PENDING_ENROLLMENT', 'ENROLLED', 'TRANSFERRED_OUT', 'GRADUATED');
CREATE TYPE "StudentGender" AS ENUM ('MALE', 'FEMALE');
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'TRANSFERRED_OUT', 'GRADUATED');
CREATE TYPE "EnrollmentEntry" AS ENUM ('NEW', 'PROMOTED', 'REPEATED');
CREATE TYPE "EnrollmentResult" AS ENUM ('PASSED', 'FAILED');
CREATE TYPE "PromotionBatchStatus" AS ENUM ('DRAFT', 'PROCESSING', 'COMPLETED');
CREATE TYPE "PromotionDecision" AS ENUM ('PROMOTE', 'REPEAT', 'TRANSFER_OUT', 'GRADUATE', 'PENDING');
CREATE TYPE "PromotionItemStatus" AS ENUM ('DRAFT', 'WAITING', 'DONE', 'FAILED', 'EXCLUDED');

CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "studentNumber" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "gender" "StudentGender" NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "guardianName" TEXT NOT NULL,
    "guardianPhone" TEXT NOT NULL,
    "guardianRelationship" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "status" "StudentStatus" NOT NULL DEFAULT 'PENDING_ENROLLMENT',
    "statusReason" TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Student_studentNumber_key" ON "Student"("studentNumber");
CREATE INDEX "Student_schoolId_branchId_status_idx" ON "Student"("schoolId", "branchId", "status");
CREATE INDEX "Student_schoolId_nameKey_dateOfBirth_idx" ON "Student"("schoolId", "nameKey", "dateOfBirth");
ALTER TABLE "Student" ADD CONSTRAINT "Student_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Student" ADD CONSTRAINT "Student_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "entry" "EnrollmentEntry" NOT NULL DEFAULT 'NEW',
    "result" "EnrollmentResult",
    "previousEnrollmentId" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);
-- One enrollment per student and academic year: retries and simultaneous requests can never create two.
CREATE UNIQUE INDEX "Enrollment_studentId_academicYearId_key" ON "Enrollment"("studentId", "academicYearId");
CREATE UNIQUE INDEX "Enrollment_previousEnrollmentId_key" ON "Enrollment"("previousEnrollmentId");
CREATE INDEX "Enrollment_sectionId_status_idx" ON "Enrollment"("sectionId", "status");
CREATE INDEX "Enrollment_branchId_academicYearId_status_idx" ON "Enrollment"("branchId", "academicYearId", "status");
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_previousEnrollmentId_fkey" FOREIGN KEY ("previousEnrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PromotionBatch" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "fromYearId" TEXT NOT NULL,
    "toYearId" TEXT NOT NULL,
    "status" "PromotionBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "confirmedById" TEXT,
    "confirmedByName" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionBatch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PromotionBatch_years_check" CHECK ("fromYearId" <> "toYearId")
);
CREATE UNIQUE INDEX "PromotionBatch_branchId_fromYearId_toYearId_key" ON "PromotionBatch"("branchId", "fromYearId", "toYearId");
CREATE INDEX "PromotionBatch_schoolId_idx" ON "PromotionBatch"("schoolId");
ALTER TABLE "PromotionBatch" ADD CONSTRAINT "PromotionBatch_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionBatch" ADD CONSTRAINT "PromotionBatch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionBatch" ADD CONSTRAINT "PromotionBatch_fromYearId_fkey" FOREIGN KEY ("fromYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionBatch" ADD CONSTRAINT "PromotionBatch_toYearId_fkey" FOREIGN KEY ("toYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PromotionItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fromEnrollmentId" TEXT NOT NULL,
    "fromSectionId" TEXT NOT NULL,
    "recommendation" "PromotionDecision" NOT NULL,
    "recommendationNote" TEXT NOT NULL,
    "decision" "PromotionDecision" NOT NULL,
    "targetSectionId" TEXT,
    "status" "PromotionItemStatus" NOT NULL DEFAULT 'DRAFT',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resultEnrollmentId" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PromotionItem_batchId_fromEnrollmentId_key" ON "PromotionItem"("batchId", "fromEnrollmentId");
CREATE INDEX "PromotionItem_batchId_status_idx" ON "PromotionItem"("batchId", "status");
ALTER TABLE "PromotionItem" ADD CONSTRAINT "PromotionItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PromotionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionItem" ADD CONSTRAINT "PromotionItem_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionItem" ADD CONSTRAINT "PromotionItem_fromEnrollmentId_fkey" FOREIGN KEY ("fromEnrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionItem" ADD CONSTRAINT "PromotionItem_fromSectionId_fkey" FOREIGN KEY ("fromSectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionItem" ADD CONSTRAINT "PromotionItem_targetSectionId_fkey" FOREIGN KEY ("targetSectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionItem" ADD CONSTRAINT "PromotionItem_resultEnrollmentId_fkey" FOREIGN KEY ("resultEnrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
