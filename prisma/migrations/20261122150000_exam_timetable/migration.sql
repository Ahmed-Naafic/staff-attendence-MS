-- Examinations, phase 3: the timetable of an examination per branch (sessions, sittings, seats and
-- invigilators) and how it was generated. New tables only.

-- CreateTable
CREATE TABLE "ExamTimetable" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "examinationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "generatedById" TEXT,
    "generatedByName" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publications" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamTimetable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamSession" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "examinationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shiftName" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamSitting" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "ExamSitting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamSeat" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sittingId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "seatNumber" INTEGER NOT NULL,

    CONSTRAINT "ExamSeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamInvigilation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,

    CONSTRAINT "ExamInvigilation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExamTimetable_schoolId_idx" ON "ExamTimetable"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamTimetable_examinationId_branchId_key" ON "ExamTimetable"("examinationId", "branchId");

-- CreateIndex
CREATE INDEX "ExamSession_examinationId_branchId_date_idx" ON "ExamSession"("examinationId", "branchId", "date");

-- CreateIndex
CREATE INDEX "ExamSession_branchId_date_idx" ON "ExamSession"("branchId", "date");

-- CreateIndex
CREATE INDEX "ExamSitting_sessionId_idx" ON "ExamSitting"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamSitting_paperId_branchId_key" ON "ExamSitting"("paperId", "branchId");

-- CreateIndex
CREATE INDEX "ExamSeat_studentId_idx" ON "ExamSeat"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamSeat_sittingId_studentId_key" ON "ExamSeat"("sittingId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamSeat_sessionId_studentId_key" ON "ExamSeat"("sessionId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamSeat_sessionId_roomId_seatNumber_key" ON "ExamSeat"("sessionId", "roomId", "seatNumber");

-- CreateIndex
CREATE INDEX "ExamInvigilation_staffId_idx" ON "ExamInvigilation"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamInvigilation_sessionId_roomId_staffId_key" ON "ExamInvigilation"("sessionId", "roomId", "staffId");

-- AddForeignKey
ALTER TABLE "ExamTimetable" ADD CONSTRAINT "ExamTimetable_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamTimetable" ADD CONSTRAINT "ExamTimetable_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamTimetable" ADD CONSTRAINT "ExamTimetable_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSession" ADD CONSTRAINT "ExamSession_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSession" ADD CONSTRAINT "ExamSession_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSession" ADD CONSTRAINT "ExamSession_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSitting" ADD CONSTRAINT "ExamSitting_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExamSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSitting" ADD CONSTRAINT "ExamSitting_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ExamPaper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSitting" ADD CONSTRAINT "ExamSitting_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSeat" ADD CONSTRAINT "ExamSeat_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExamSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSeat" ADD CONSTRAINT "ExamSeat_sittingId_fkey" FOREIGN KEY ("sittingId") REFERENCES "ExamSitting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSeat" ADD CONSTRAINT "ExamSeat_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ExamRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSeat" ADD CONSTRAINT "ExamSeat_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSeat" ADD CONSTRAINT "ExamSeat_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamInvigilation" ADD CONSTRAINT "ExamInvigilation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExamSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamInvigilation" ADD CONSTRAINT "ExamInvigilation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ExamRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamInvigilation" ADD CONSTRAINT "ExamInvigilation_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Session times within the day, end after start.
ALTER TABLE "ExamSession" ADD CONSTRAINT "ExamSession_times_check" CHECK ("startMinute" >= 0 AND "endMinute" > "startMinute" AND "endMinute" <= 1440 AND "sequence" >= 1);
ALTER TABLE "ExamSeat" ADD CONSTRAINT "ExamSeat_number_check" CHECK ("seatNumber" >= 1);
