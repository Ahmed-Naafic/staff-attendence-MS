-- Student attendance, Phase 6 (docs/business-rules.md -> Student attendance -> Completion and
-- notifications): a notification category for student attendance, and two settings that let a
-- school (or a permitted branch) turn the reminders off. Additive only.

ALTER TYPE "NotificationCategory" ADD VALUE 'STUDENT_ATTENDANCE';

ALTER TABLE "StudentAttendanceSettings" ADD COLUMN "managerAlerts" BOOLEAN,
ADD COLUMN "teacherReminders" BOOLEAN;
