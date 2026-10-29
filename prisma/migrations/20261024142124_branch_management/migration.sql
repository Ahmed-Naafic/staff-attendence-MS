-- CreateEnum
CREATE TYPE "BranchStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "branchSequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "phone" TEXT,
    "status" "BranchStatus" NOT NULL DEFAULT 'ACTIVE',
    "suspensionReason" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchLocation" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyMeters" DOUBLE PRECISION NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "BranchLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Branch_schoolId_status_idx" ON "Branch"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_schoolId_number_key" ON "Branch"("schoolId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_schoolId_code_key" ON "Branch"("schoolId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_schoolId_nameKey_key" ON "Branch"("schoolId", "nameKey");

-- CreateIndex
CREATE INDEX "BranchLocation_branchId_effectiveFrom_idx" ON "BranchLocation"("branchId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchLocation" ADD CONSTRAINT "BranchLocation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Safety net for the approved rules (the API validates first). Added by hand; Prisma does not model CHECK constraints.
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_number_check" CHECK ("number" > 0);
ALTER TABLE "BranchLocation" ADD CONSTRAINT "BranchLocation_position_check" CHECK (
  "latitude" BETWEEN -90 AND 90
  AND "longitude" BETWEEN -180 AND 180
  AND "accuracyMeters" > 0 AND "accuracyMeters" <= 50
);
