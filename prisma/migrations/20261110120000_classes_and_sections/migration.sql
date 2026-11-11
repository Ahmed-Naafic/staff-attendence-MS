-- Classes and sections (docs/business-rules.md → Classes and sections). Classes are permanent and
-- belong to a school (School Owner); sections belong to one class, one academic year and one branch
-- (School Owner or the branch's Manager). Nothing is deleted: both are deactivated instead.

CREATE TYPE "ClassStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "SchoolClass" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "description" TEXT,
    "sequence" INTEGER NOT NULL,
    "status" "ClassStatus" NOT NULL DEFAULT 'ACTIVE',
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolClass_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SchoolClass_sequence_check" CHECK ("sequence" >= 1)
);

CREATE UNIQUE INDEX "SchoolClass_schoolId_nameKey_key" ON "SchoolClass"("schoolId", "nameKey");
CREATE UNIQUE INDEX "SchoolClass_schoolId_sequence_key" ON "SchoolClass"("schoolId", "sequence");
CREATE INDEX "SchoolClass_schoolId_status_idx" ON "SchoolClass"("schoolId", "status");
ALTER TABLE "SchoolClass" ADD CONSTRAINT "SchoolClass_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "capacity" INTEGER,
    "room" TEXT,
    "status" "ClassStatus" NOT NULL DEFAULT 'ACTIVE',
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Section_capacity_check" CHECK ("capacity" IS NULL OR "capacity" BETWEEN 1 AND 1000)
);

-- One section name per class, academic year and branch (names compared case-insensitively via nameKey).
CREATE UNIQUE INDEX "Section_classId_academicYearId_branchId_nameKey_key" ON "Section"("classId", "academicYearId", "branchId", "nameKey");
CREATE INDEX "Section_schoolId_academicYearId_idx" ON "Section"("schoolId", "academicYearId");
CREATE INDEX "Section_branchId_academicYearId_idx" ON "Section"("branchId", "academicYearId");

ALTER TABLE "Section" ADD CONSTRAINT "Section_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Section" ADD CONSTRAINT "Section_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Section" ADD CONSTRAINT "Section_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Section" ADD CONSTRAINT "Section_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
