-- Scheduling & Assignments settings (Platform Settings). Nullable: an empty value means the
-- default (a 1-day effective delay; the first schedule and first assignment set may start today),
-- which is the behaviour before this setting existed, so no row needs updating.
ALTER TABLE "PlatformSettings"
  ADD COLUMN "effectiveDelayDays" INTEGER,
  ADD COLUMN "immediateFirstSchedule" BOOLEAN,
  ADD COLUMN "immediateFirstAssignment" BOOLEAN;

ALTER TABLE "PlatformSettings"
  ADD CONSTRAINT "PlatformSettings_effectiveDelayDays_check"
  CHECK ("effectiveDelayDays" IS NULL OR "effectiveDelayDays" BETWEEN 1 AND 30);
