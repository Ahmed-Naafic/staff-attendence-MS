-- CreateEnum
CREATE TYPE "FeeObligationKind" AS ENUM ('MONTHLY', 'EXAM', 'OTHER');

-- CreateEnum
CREATE TYPE "FeeObligationStatus" AS ENUM ('OPEN', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FeeDiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "FeeDiscountCategory" AS ENUM ('DISCOUNT', 'SCHOLARSHIP');

-- CreateEnum
CREATE TYPE "FeePaymentStatus" AS ENUM ('RECORDED', 'REVERSED');

-- CreateEnum
CREATE TYPE "FeeInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FeeRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "FeeRunTrigger" AS ENUM ('AUTOMATIC', 'MANUAL');


-- AlterTable
ALTER TABLE "School" ADD COLUMN     "feesEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FeeSettings" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeBranding" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schoolName" TEXT NOT NULL,
    "logo" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "footer" TEXT,
    "showSignature" BOOLEAN NOT NULL DEFAULT true,
    "signatureLabel" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeBranding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeCounter" (
    "schoolId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FeeCounter_pkey" PRIMARY KEY ("schoolId","key")
);

-- CreateTable
CREATE TABLE "FeeStructure" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "excludedMonths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ClassStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeStructureRate" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "effectiveMonth" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeStructureRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamFeeRate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "examTypeId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamFeeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentFeeAdjustment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "originalAmount" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "fromMonth" DATE NOT NULL,
    "toMonth" DATE,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdByRole" "Role",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedByName" TEXT,
    "endReason" TEXT,

    CONSTRAINT "StudentFeeAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeObligation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "academicYearId" TEXT NOT NULL,
    "classId" TEXT,
    "sectionId" TEXT,
    "kind" "FeeObligationKind" NOT NULL,
    "billingMonth" DATE,
    "examinationId" TEXT,
    "title" TEXT NOT NULL,
    "standardAmount" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "netAmount" INTEGER NOT NULL,
    "paidAmount" INTEGER NOT NULL DEFAULT 0,
    "status" "FeeObligationStatus" NOT NULL DEFAULT 'OPEN',
    "dueDate" DATE NOT NULL,
    "structureRateId" TEXT,
    "examFeeRateId" TEXT,
    "adjustmentId" TEXT,
    "generationRunId" TEXT,
    "source" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledByName" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeObligationDiscount" (
    "id" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "studentDiscountId" TEXT,
    "name" TEXT NOT NULL,
    "category" "FeeDiscountCategory" NOT NULL,
    "type" "FeeDiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeObligationDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeObligationChange" (
    "id" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromAmount" INTEGER,
    "toAmount" INTEGER,
    "reason" TEXT,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorRole" "Role",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeObligationChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeDiscountPolicy" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "description" TEXT,
    "category" "FeeDiscountCategory" NOT NULL,
    "type" "FeeDiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "appliesTo" "FeeObligationKind"[],
    "classIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "branchIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eligibility" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "maxAmount" INTEGER,
    "maxStudents" INTEGER,
    "combinable" BOOLEAN NOT NULL DEFAULT true,
    "managersAssign" BOOLEAN NOT NULL DEFAULT true,
    "status" "ClassStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeDiscountPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentDiscount" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "startMonth" DATE NOT NULL,
    "endMonth" DATE,
    "reason" TEXT NOT NULL,
    "assignedById" TEXT,
    "assignedByName" TEXT,
    "assignedByRole" "Role",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByName" TEXT,
    "revokeReason" TEXT,

    CONSTRAINT "StudentDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeePayment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "requestKey" TEXT,
    "status" "FeePaymentStatus" NOT NULL DEFAULT 'RECORDED',
    "recordedById" TEXT NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "recordedByRole" "Role" NOT NULL,
    "closingId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reversedByName" TEXT,
    "reversedByRole" "Role",
    "reversalReason" TEXT,
    "reversalCashUserId" TEXT,
    "reversalClosingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeReceipt" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "brandingId" TEXT,
    "content" JSONB NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "printCount" INTEGER NOT NULL DEFAULT 0,
    "lastPrintedAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeInvoice" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYearId" TEXT,
    "number" TEXT,
    "status" "FeeInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "periodFrom" DATE,
    "periodTo" DATE,
    "note" TEXT,
    "brandingId" TEXT,
    "content" JSONB NOT NULL DEFAULT '{}',
    "batchId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByName" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "standardAmount" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "FeeInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeClearanceException" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "examinationId" TEXT,
    "reason" TEXT NOT NULL,
    "grantedById" TEXT,
    "grantedByName" TEXT,
    "grantedByRole" "Role",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByName" TEXT,
    "revokeReason" TEXT,

    CONSTRAINT "FeeClearanceException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashClosing" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "userRole" "Role" NOT NULL,
    "closingDate" DATE NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentsCount" INTEGER NOT NULL,
    "reversalsCount" INTEGER NOT NULL,
    "recordedAmount" INTEGER NOT NULL,
    "reversedAmount" INTEGER NOT NULL,
    "expectedAmount" INTEGER NOT NULL,
    "countedAmount" INTEGER NOT NULL,
    "difference" INTEGER NOT NULL,
    "explanation" TEXT,
    "correctedAt" TIMESTAMP(3),

    CONSTRAINT "CashClosing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashClosingRevision" (
    "id" TEXT NOT NULL,
    "closingId" TEXT NOT NULL,
    "countedAmount" INTEGER NOT NULL,
    "difference" INTEGER NOT NULL,
    "explanation" TEXT,
    "reason" TEXT,
    "actorName" TEXT,
    "actorRole" "Role",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashClosingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeGenerationRun" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "billingMonth" DATE NOT NULL,
    "trigger" "FeeRunTrigger" NOT NULL,
    "status" "FeeRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "triggeredById" TEXT,
    "triggeredByName" TEXT,

    CONSTRAINT "FeeGenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeReminderLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "sentById" TEXT,
    "sentByName" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeeSettings_schoolId_key" ON "FeeSettings"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeBranding_schoolId_version_key" ON "FeeBranding"("schoolId", "version");

-- CreateIndex
CREATE INDEX "FeeStructure_schoolId_idx" ON "FeeStructure"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeStructure_academicYearId_classId_key" ON "FeeStructure"("academicYearId", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeStructureRate_structureId_effectiveMonth_key" ON "FeeStructureRate"("structureId", "effectiveMonth");

-- CreateIndex
CREATE INDEX "ExamFeeRate_schoolId_idx" ON "ExamFeeRate"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamFeeRate_academicYearId_classId_examTypeId_key" ON "ExamFeeRate"("academicYearId", "classId", "examTypeId");

-- CreateIndex
CREATE INDEX "StudentFeeAdjustment_studentId_academicYearId_idx" ON "StudentFeeAdjustment"("studentId", "academicYearId");

-- CreateIndex
CREATE INDEX "FeeObligation_schoolId_academicYearId_kind_idx" ON "FeeObligation"("schoolId", "academicYearId", "kind");

-- CreateIndex
CREATE INDEX "FeeObligation_studentId_status_idx" ON "FeeObligation"("studentId", "status");

-- CreateIndex
CREATE INDEX "FeeObligation_branchId_academicYearId_idx" ON "FeeObligation"("branchId", "academicYearId");

-- CreateIndex
CREATE INDEX "FeeObligation_examinationId_idx" ON "FeeObligation"("examinationId");

-- CreateIndex
CREATE INDEX "FeeObligation_schoolId_dueDate_idx" ON "FeeObligation"("schoolId", "dueDate");

-- CreateIndex
CREATE INDEX "FeeObligationDiscount_obligationId_idx" ON "FeeObligationDiscount"("obligationId");

-- CreateIndex
CREATE INDEX "FeeObligationChange_obligationId_idx" ON "FeeObligationChange"("obligationId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeDiscountPolicy_schoolId_nameKey_key" ON "FeeDiscountPolicy"("schoolId", "nameKey");

-- CreateIndex
CREATE INDEX "StudentDiscount_studentId_idx" ON "StudentDiscount"("studentId");

-- CreateIndex
CREATE INDEX "StudentDiscount_policyId_idx" ON "StudentDiscount"("policyId");

-- CreateIndex
CREATE INDEX "FeePayment_schoolId_receivedAt_idx" ON "FeePayment"("schoolId", "receivedAt");

-- CreateIndex
CREATE INDEX "FeePayment_studentId_idx" ON "FeePayment"("studentId");

-- CreateIndex
CREATE INDEX "FeePayment_recordedById_closingId_idx" ON "FeePayment"("recordedById", "closingId");

-- CreateIndex
CREATE INDEX "FeePayment_reversalCashUserId_reversalClosingId_idx" ON "FeePayment"("reversalCashUserId", "reversalClosingId");

-- CreateIndex
CREATE INDEX "FeePayment_branchId_receivedAt_idx" ON "FeePayment"("branchId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeePayment_schoolId_requestKey_key" ON "FeePayment"("schoolId", "requestKey");

-- CreateIndex
CREATE INDEX "FeeAllocation_obligationId_idx" ON "FeeAllocation"("obligationId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeAllocation_paymentId_obligationId_key" ON "FeeAllocation"("paymentId", "obligationId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeReceipt_paymentId_key" ON "FeeReceipt"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeReceipt_schoolId_number_key" ON "FeeReceipt"("schoolId", "number");

-- CreateIndex
CREATE INDEX "FeeInvoice_schoolId_status_idx" ON "FeeInvoice"("schoolId", "status");

-- CreateIndex
CREATE INDEX "FeeInvoice_studentId_idx" ON "FeeInvoice"("studentId");

-- CreateIndex
CREATE INDEX "FeeInvoice_batchId_idx" ON "FeeInvoice"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeInvoice_schoolId_number_key" ON "FeeInvoice"("schoolId", "number");

-- CreateIndex
CREATE INDEX "FeeInvoiceLine_invoiceId_idx" ON "FeeInvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "FeeInvoiceLine_obligationId_idx" ON "FeeInvoiceLine"("obligationId");

-- CreateIndex
CREATE INDEX "FeeClearanceException_studentId_idx" ON "FeeClearanceException"("studentId");

-- CreateIndex
CREATE INDEX "FeeClearanceException_examinationId_idx" ON "FeeClearanceException"("examinationId");

-- CreateIndex
CREATE INDEX "CashClosing_schoolId_closingDate_idx" ON "CashClosing"("schoolId", "closingDate");

-- CreateIndex
CREATE INDEX "CashClosing_userId_closedAt_idx" ON "CashClosing"("userId", "closedAt");

-- CreateIndex
CREATE INDEX "CashClosingRevision_closingId_idx" ON "CashClosingRevision"("closingId");

-- CreateIndex
CREATE INDEX "FeeGenerationRun_schoolId_billingMonth_startedAt_idx" ON "FeeGenerationRun"("schoolId", "billingMonth", "startedAt");

-- CreateIndex
CREATE INDEX "FeeReminderLog_studentId_sentAt_idx" ON "FeeReminderLog"("studentId", "sentAt");

-- AddForeignKey
ALTER TABLE "FeeSettings" ADD CONSTRAINT "FeeSettings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeBranding" ADD CONSTRAINT "FeeBranding_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeStructure" ADD CONSTRAINT "FeeStructure_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeStructure" ADD CONSTRAINT "FeeStructure_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeStructure" ADD CONSTRAINT "FeeStructure_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeStructureRate" ADD CONSTRAINT "FeeStructureRate_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "FeeStructure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamFeeRate" ADD CONSTRAINT "ExamFeeRate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamFeeRate" ADD CONSTRAINT "ExamFeeRate_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamFeeRate" ADD CONSTRAINT "ExamFeeRate_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamFeeRate" ADD CONSTRAINT "ExamFeeRate_examTypeId_fkey" FOREIGN KEY ("examTypeId") REFERENCES "ExamType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFeeAdjustment" ADD CONSTRAINT "StudentFeeAdjustment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFeeAdjustment" ADD CONSTRAINT "StudentFeeAdjustment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFeeAdjustment" ADD CONSTRAINT "StudentFeeAdjustment_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeObligation" ADD CONSTRAINT "FeeObligation_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeObligation" ADD CONSTRAINT "FeeObligation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeObligation" ADD CONSTRAINT "FeeObligation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeObligation" ADD CONSTRAINT "FeeObligation_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeObligation" ADD CONSTRAINT "FeeObligation_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeObligation" ADD CONSTRAINT "FeeObligation_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeObligation" ADD CONSTRAINT "FeeObligation_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeObligation" ADD CONSTRAINT "FeeObligation_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeObligation" ADD CONSTRAINT "FeeObligation_structureRateId_fkey" FOREIGN KEY ("structureRateId") REFERENCES "FeeStructureRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeObligation" ADD CONSTRAINT "FeeObligation_examFeeRateId_fkey" FOREIGN KEY ("examFeeRateId") REFERENCES "ExamFeeRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeObligation" ADD CONSTRAINT "FeeObligation_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "StudentFeeAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeObligationDiscount" ADD CONSTRAINT "FeeObligationDiscount_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "FeeObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeObligationDiscount" ADD CONSTRAINT "FeeObligationDiscount_studentDiscountId_fkey" FOREIGN KEY ("studentDiscountId") REFERENCES "StudentDiscount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeObligationChange" ADD CONSTRAINT "FeeObligationChange_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "FeeObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeDiscountPolicy" ADD CONSTRAINT "FeeDiscountPolicy_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentDiscount" ADD CONSTRAINT "StudentDiscount_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentDiscount" ADD CONSTRAINT "StudentDiscount_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentDiscount" ADD CONSTRAINT "StudentDiscount_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "FeeDiscountPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "CashClosing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_reversalClosingId_fkey" FOREIGN KEY ("reversalClosingId") REFERENCES "CashClosing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeAllocation" ADD CONSTRAINT "FeeAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "FeePayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeAllocation" ADD CONSTRAINT "FeeAllocation_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "FeeObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeReceipt" ADD CONSTRAINT "FeeReceipt_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeReceipt" ADD CONSTRAINT "FeeReceipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "FeePayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeReceipt" ADD CONSTRAINT "FeeReceipt_brandingId_fkey" FOREIGN KEY ("brandingId") REFERENCES "FeeBranding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeInvoice" ADD CONSTRAINT "FeeInvoice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeInvoice" ADD CONSTRAINT "FeeInvoice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeInvoice" ADD CONSTRAINT "FeeInvoice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeInvoice" ADD CONSTRAINT "FeeInvoice_brandingId_fkey" FOREIGN KEY ("brandingId") REFERENCES "FeeBranding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeInvoiceLine" ADD CONSTRAINT "FeeInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "FeeInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeInvoiceLine" ADD CONSTRAINT "FeeInvoiceLine_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "FeeObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeClearanceException" ADD CONSTRAINT "FeeClearanceException_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeClearanceException" ADD CONSTRAINT "FeeClearanceException_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeClearanceException" ADD CONSTRAINT "FeeClearanceException_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashClosing" ADD CONSTRAINT "CashClosing_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashClosing" ADD CONSTRAINT "CashClosing_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashClosingRevision" ADD CONSTRAINT "CashClosingRevision_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "CashClosing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeGenerationRun" ADD CONSTRAINT "FeeGenerationRun_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeReminderLog" ADD CONSTRAINT "FeeReminderLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeReminderLog" ADD CONSTRAINT "FeeReminderLog_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---- Added by hand (not expressible in the Prisma schema) -------------------------------------------

-- A branch exactly for MANAGER, STAFF and ACCOUNTANT accounts (the Accountant is a branch role).
ALTER TABLE "User" DROP CONSTRAINT "User_branch_role_check";
ALTER TABLE "User" ADD CONSTRAINT "User_branch_role_check" CHECK (("role" IN ('MANAGER', 'STAFF', 'ACCOUNTANT')) = ("branchId" IS NOT NULL));

-- One monthly fee per student and month, one examination fee per student and examination (cancelled
-- ones included), so generation and retries can never charge twice.
CREATE UNIQUE INDEX "FeeObligation_one_monthly" ON "FeeObligation"("studentId", "billingMonth") WHERE "kind" = 'MONTHLY';
CREATE UNIQUE INDEX "FeeObligation_one_exam" ON "FeeObligation"("studentId", "examinationId") WHERE "kind" = 'EXAM';
-- Each kind names what it charges.
ALTER TABLE "FeeObligation" ADD CONSTRAINT "FeeObligation_kind_check" CHECK (
  ("kind" = 'MONTHLY' AND "billingMonth" IS NOT NULL AND "examinationId" IS NULL)
  OR ("kind" = 'EXAM' AND "examinationId" IS NOT NULL AND "billingMonth" IS NULL)
  OR ("kind" = 'OTHER' AND "billingMonth" IS NULL AND "examinationId" IS NULL)
);
-- Amounts: never negative; payable = amount - discounts; never paid beyond what is payable.
ALTER TABLE "FeeObligation" ADD CONSTRAINT "FeeObligation_amounts_check" CHECK (
  "standardAmount" >= 0 AND "amount" >= 0 AND "discountAmount" >= 0 AND "discountAmount" <= "amount"
  AND "netAmount" = "amount" - "discountAmount" AND "paidAmount" >= 0 AND "paidAmount" <= "netAmount"
);
ALTER TABLE "FeeObligation" ADD CONSTRAINT "FeeObligation_paid_status_check" CHECK ("status" <> 'PAID' OR "paidAmount" = "netAmount");

ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_amount_check" CHECK ("amount" > 0);
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_method_check" CHECK ("method" = 'CASH');
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_reversal_check" CHECK (("status" = 'REVERSED') = ("reversedAt" IS NOT NULL AND "reversalReason" IS NOT NULL));
ALTER TABLE "FeeAllocation" ADD CONSTRAINT "FeeAllocation_amount_check" CHECK ("amount" > 0);

ALTER TABLE "FeeStructureRate" ADD CONSTRAINT "FeeStructureRate_amount_check" CHECK ("amount" >= 0 AND EXTRACT(DAY FROM "effectiveMonth") = 1);
ALTER TABLE "ExamFeeRate" ADD CONSTRAINT "ExamFeeRate_amount_check" CHECK ("amount" >= 0);
ALTER TABLE "StudentFeeAdjustment" ADD CONSTRAINT "StudentFeeAdjustment_amount_check" CHECK ("amount" >= 0 AND "originalAmount" >= 0 AND ("toMonth" IS NULL OR "toMonth" >= "fromMonth"));
ALTER TABLE "FeeDiscountPolicy" ADD CONSTRAINT "FeeDiscountPolicy_value_check" CHECK ("value" > 0 AND ("type" <> 'PERCENTAGE' OR "value" <= 10000) AND cardinality("appliesTo") >= 1);
ALTER TABLE "StudentDiscount" ADD CONSTRAINT "StudentDiscount_months_check" CHECK ("endMonth" IS NULL OR "endMonth" >= "startMonth");
ALTER TABLE "FeeObligationDiscount" ADD CONSTRAINT "FeeObligationDiscount_amount_check" CHECK ("amount" >= 0);
ALTER TABLE "CashClosing" ADD CONSTRAINT "CashClosing_amounts_check" CHECK (
  "recordedAmount" >= 0 AND "reversedAmount" >= 0 AND "countedAmount" >= 0
  AND "expectedAmount" = "recordedAmount" - "reversedAmount" AND "difference" = "countedAmount" - "expectedAmount"
  AND ("difference" = 0 OR "explanation" IS NOT NULL)
);
