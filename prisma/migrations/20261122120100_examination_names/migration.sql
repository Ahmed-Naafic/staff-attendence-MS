-- Examination names: unique per year among examinations not cancelled, school-wide examinations
-- together and each branch's together (a Manager never collides with another branch's names).
DROP INDEX "Examination_academicYearId_nameKey_key";
CREATE INDEX "Examination_academicYearId_nameKey_idx" ON "Examination"("academicYearId", "nameKey");
CREATE UNIQUE INDEX "Examination_school_name_key" ON "Examination"("academicYearId", "nameKey") WHERE "branchId" IS NULL AND "status" <> 'CANCELLED';
CREATE UNIQUE INDEX "Examination_branch_name_key" ON "Examination"("academicYearId", "branchId", "nameKey") WHERE "branchId" IS NOT NULL AND "status" <> 'CANCELLED';
