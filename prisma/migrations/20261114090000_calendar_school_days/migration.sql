-- Extra school days in the academic calendar (docs/business-rules.md -> Academic calendar). The new
-- enum value has its own migration: PostgreSQL cannot use a value added in the same transaction.
-- Additive only.
ALTER TYPE "CalendarEntryType" ADD VALUE 'SCHOOL_DAY';

-- SCHOOL_DAY only: the weekday whose timetable and bell times the day follows.
ALTER TABLE "CalendarEntry" ADD COLUMN "timetableDay" "Weekday";
