-- The first version of this check let a CHECK_IN without a status through: "status" IN (...) is
-- NULL for a NULL status, and a CHECK whose result is NULL passes. Require the status explicitly.
ALTER TABLE "AttendanceEvent" DROP CONSTRAINT "AttendanceEvent_kind_check";
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_kind_check" CHECK (
  ("type" = 'CHECK_IN' AND "status" IS NOT NULL AND "status" IN ('PRESENT', 'LATE') AND "checkInEventId" IS NULL)
  OR ("type" = 'CHECK_OUT' AND "status" IS NULL AND "checkInEventId" IS NOT NULL)
);
