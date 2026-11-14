-- Every lesson period of a class has a lesson (docs/business-rules.md → Timetable builder). On by default.
ALTER TABLE "TimetableSetup" ADD COLUMN "fillAllPeriods" BOOLEAN NOT NULL DEFAULT true;
