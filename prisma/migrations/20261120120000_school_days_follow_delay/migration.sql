-- Platform Settings → Scheduling & Assignments: whether changes of school days (Academic Calendar)
-- also wait for the effective delay. Nullable: existing rows mean "no" (the behaviour so far).
ALTER TABLE "PlatformSettings" ADD COLUMN "schoolDaysFollowDelay" BOOLEAN;
