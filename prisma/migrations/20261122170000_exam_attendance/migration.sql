-- Examinations, phase 4: attendance of each student at each paper, on their seat. Nullable columns on a new table.

-- CreateEnum
CREATE TYPE "ExamAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- AlterTable
ALTER TABLE "ExamSeat" ADD COLUMN     "attendance" "ExamAttendanceStatus",
ADD COLUMN     "attendanceAt" TIMESTAMP(3),
ADD COLUMN     "attendanceById" TEXT,
ADD COLUMN     "attendanceByName" TEXT,
ADD COLUMN     "attendanceNote" TEXT;

