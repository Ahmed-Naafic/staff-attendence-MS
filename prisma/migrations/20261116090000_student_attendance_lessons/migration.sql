-- Student attendance, Phase 5 (docs/business-rules.md -> Student attendance -> Teacher lesson
-- attendance): lesson sessions name their timetable period and subject; each mark records the role
-- of who set it. Additive only: new nullable columns, a new index, and the session shape check
-- replaced by one that is unchanged for half-day sessions.

ALTER TABLE "StudentAttendanceEntry" ADD COLUMN "markedByRole" "Role";

ALTER TABLE "StudentAttendanceSession" ADD COLUMN "periodNumber" INTEGER,
ADD COLUMN "subjectId" TEXT;

ALTER TABLE "StudentAttendanceSession" ADD CONSTRAINT "StudentAttendanceSession_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Half-day sessions: a half, no period. Lessons: a period (1-20) and a subject; the half is the
-- half of the day the lesson is in (null without a main break), never the whole day.
ALTER TABLE "StudentAttendanceSession" DROP CONSTRAINT "StudentAttendanceSession_shape_check";
ALTER TABLE "StudentAttendanceSession" ADD CONSTRAINT "StudentAttendanceSession_shape_check" CHECK (
    (
        ("kind" = 'HALF_DAY' AND "half" IS NOT NULL AND "periodNumber" IS NULL AND "subjectId" IS NULL)
        OR ("kind" = 'LESSON' AND "periodNumber" BETWEEN 1 AND 20 AND "subjectId" IS NOT NULL AND "half" IS DISTINCT FROM 'WHOLE_DAY')
    )
    AND ("startsAt" IS NULL) = ("endsAt" IS NULL)
    AND ("startsAt" IS NULL OR "startsAt" < "endsAt")
    AND "opensAt" < "deadlineAt"
);

-- One lesson session per section, date and period, even under simultaneous requests.
CREATE UNIQUE INDEX "StudentAttendanceSession_one_per_lesson" ON "StudentAttendanceSession"("sectionId", "date", "periodNumber") WHERE "kind" = 'LESSON';
