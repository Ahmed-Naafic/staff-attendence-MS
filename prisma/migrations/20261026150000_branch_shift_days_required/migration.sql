-- Prisma creates list columns without NOT NULL; a shift always has at least one working day.
ALTER TABLE "BranchShift" ADD CONSTRAINT "BranchShift_days_check" CHECK ("days" IS NOT NULL);
