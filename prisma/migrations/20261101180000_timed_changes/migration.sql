-- Changes at their scheduled time (Platform Settings → Scheduling & Assignments). Schedule versions
-- and assignment sets get the instant they take effect (effectiveAt), not only a date: 00:00 of
-- effectiveFrom in the version's time zone for every existing row (what they have always meant),
-- or a chosen time when the setting allows it. Staff transfers already have effectiveAt.
--
-- Safe to apply before the code that uses it is deployed: the trigger fills effectiveAt with
-- 00:00 of effectiveFrom when an insert leaves it out (as the previous code does), and the new
-- unique indexes allow everything the old ones did for those rows.

ALTER TABLE "PlatformSettings" ADD COLUMN "timedChanges" BOOLEAN;

ALTER TABLE "BranchSchedule" ADD COLUMN "effectiveAt" TIMESTAMP(3);
UPDATE "BranchSchedule" SET "effectiveAt" = ("effectiveFrom"::timestamp AT TIME ZONE "timeZone") AT TIME ZONE 'UTC';
ALTER TABLE "BranchSchedule" ALTER COLUMN "effectiveAt" SET NOT NULL;

ALTER TABLE "StaffAssignment" ADD COLUMN "effectiveAt" TIMESTAMP(3);
UPDATE "StaffAssignment" SET "effectiveAt" = ("effectiveFrom"::timestamp AT TIME ZONE "timeZone") AT TIME ZONE 'UTC';
ALTER TABLE "StaffAssignment" ALTER COLUMN "effectiveAt" SET NOT NULL;

-- TIMESTAMP(3) holds UTC (as Prisma writes it): "AT TIME ZONE zone" on a local timestamp gives a
-- timestamptz, stored here as its UTC wall-clock value.
CREATE FUNCTION "fill_effective_at"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."effectiveAt" IS NULL THEN
    NEW."effectiveAt" := (NEW."effectiveFrom"::timestamp AT TIME ZONE NEW."timeZone") AT TIME ZONE 'UTC';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "BranchSchedule_fill_effective_at" BEFORE INSERT ON "BranchSchedule" FOR EACH ROW EXECUTE FUNCTION "fill_effective_at"();
CREATE TRIGGER "StaffAssignment_fill_effective_at" BEFORE INSERT ON "StaffAssignment" FOR EACH ROW EXECUTE FUNCTION "fill_effective_at"();

-- One non-cancelled version / set per branch / staff member and instant (was: per date). Several
-- may now share a date (e.g. 00:00 and 13:00) when the setting allows times.
DROP INDEX "BranchSchedule_one_per_date";
CREATE UNIQUE INDEX "BranchSchedule_one_per_instant" ON "BranchSchedule"("branchId", "effectiveAt") WHERE "cancelledAt" IS NULL;
DROP INDEX "StaffAssignment_one_per_date";
CREATE UNIQUE INDEX "StaffAssignment_one_per_instant" ON "StaffAssignment"("staffUserId", "effectiveAt") WHERE "cancelledAt" IS NULL;
CREATE INDEX "BranchSchedule_branchId_effectiveAt_idx" ON "BranchSchedule"("branchId", "effectiveAt");
CREATE INDEX "StaffAssignment_staffUserId_effectiveAt_idx" ON "StaffAssignment"("staffUserId", "effectiveAt");
