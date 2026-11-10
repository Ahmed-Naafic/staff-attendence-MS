-- Academic years (docs/business-rules.md → Academic years): school level, managed by the School
-- Owner and read by the school's Managers. PLANNED → CURRENT → CLOSED.

CREATE TYPE "AcademicYearStatus" AS ENUM ('PLANNED', 'CURRENT', 'CLOSED');

CREATE TABLE "AcademicYear" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "AcademicYearStatus" NOT NULL DEFAULT 'PLANNED',
    "startedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademicYear_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AcademicYear_dates_check" CHECK ("endDate" > "startDate")
);

CREATE UNIQUE INDEX "AcademicYear_schoolId_nameKey_key" ON "AcademicYear"("schoolId", "nameKey");
CREATE INDEX "AcademicYear_schoolId_startDate_idx" ON "AcademicYear"("schoolId", "startDate");

ALTER TABLE "AcademicYear" ADD CONSTRAINT "AcademicYear_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most one CURRENT year per school (the API also checks this under a lock; this is the backstop).
CREATE UNIQUE INDEX "AcademicYear_one_current" ON "AcademicYear"("schoolId") WHERE "status" = 'CURRENT';

-- The years of one school never overlap (both dates inclusive), even under simultaneous requests.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "AcademicYear" ADD CONSTRAINT "AcademicYear_no_overlap"
    EXCLUDE USING gist ("schoolId" WITH =, daterange("startDate", "endDate", '[]') WITH &&);
