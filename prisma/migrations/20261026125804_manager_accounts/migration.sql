-- AlterTable
ALTER TABLE "User" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ManagerAssignment" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ManagerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManagerAssignment_managerId_startedAt_idx" ON "ManagerAssignment"("managerId", "startedAt");

-- CreateIndex
CREATE INDEX "ManagerAssignment_branchId_idx" ON "ManagerAssignment"("branchId");

-- CreateIndex
CREATE INDEX "User_branchId_idx" ON "User"("branchId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerAssignment" ADD CONSTRAINT "ManagerAssignment_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerAssignment" ADD CONSTRAINT "ManagerAssignment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Added by hand (not expressible in the Prisma schema):
-- a branch exactly for MANAGER accounts, and every MANAGER has one.
ALTER TABLE "User" ADD CONSTRAINT "User_manager_branch_check" CHECK (("role" = 'MANAGER') = ("branchId" IS NOT NULL));
-- At most one current (open) assignment per Manager.
CREATE UNIQUE INDEX "ManagerAssignment_one_open_per_manager" ON "ManagerAssignment"("managerId") WHERE "endedAt" IS NULL;
-- An assignment cannot end before it starts.
ALTER TABLE "ManagerAssignment" ADD CONSTRAINT "ManagerAssignment_period_check" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");
