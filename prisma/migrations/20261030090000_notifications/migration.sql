-- Notifications (docs/notifications/notification-specification.md): personal notifications, the
-- outbox, platform announcements with their audience, settings and preferences, push devices and
-- push messages. New tables only; no existing table or row is changed.

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('ATTENDANCE', 'MISSING_CHECK_OUT', 'DIGEST', 'ASSIGNMENT', 'SCHEDULE', 'BRANCH_SETUP', 'MANAGER_ASSIGNMENT', 'STATUS', 'ANNOUNCEMENT');

-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "PushStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'so',
    "recipientId" TEXT NOT NULL,
    "schoolId" TEXT,
    "branchId" TEXT,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "params" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'so',
    "imageUrl" TEXT,
    "linkUrl" TEXT,
    "roles" "Role"[],
    "allSchools" BOOLEAN NOT NULL DEFAULT true,
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "publishAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "pushQueuedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementSchool" (
    "announcementId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,

    CONSTRAINT "AnnouncementSchool_pkey" PRIMARY KEY ("announcementId","schoolId")
);

-- CreateTable
CREATE TABLE "AnnouncementRead" (
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementRead_pkey" PRIMARY KEY ("announcementId","userId")
);

-- CreateTable
CREATE TABLE "NotificationSettings" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "checkInReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "checkOutReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "uploadReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "checkInLeadDefault" INTEGER NOT NULL DEFAULT 15,
    "checkInLeadMin" INTEGER NOT NULL DEFAULT 0,
    "checkInLeadMax" INTEGER NOT NULL DEFAULT 30,
    "checkOutLeadDefault" INTEGER NOT NULL DEFAULT 10,
    "checkOutLeadMin" INTEGER NOT NULL DEFAULT 0,
    "checkOutLeadMax" INTEGER NOT NULL DEFAULT 60,
    "staffCanAdjustTiming" BOOLEAN NOT NULL DEFAULT true,
    "digestHour" INTEGER NOT NULL DEFAULT 6,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchReminderSettings" (
    "branchId" TEXT NOT NULL,
    "checkInReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "checkOutReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "checkInLeadMinutes" INTEGER,
    "checkOutLeadMinutes" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchReminderSettings_pkey" PRIMARY KEY ("branchId")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "disabledCategories" "NotificationCategory"[] DEFAULT ARRAY[]::"NotificationCategory"[],
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "checkInReminder" BOOLEAN NOT NULL DEFAULT true,
    "checkOutReminder" BOOLEAN NOT NULL DEFAULT true,
    "uploadReminder" BOOLEAN NOT NULL DEFAULT true,
    "checkInLeadMinutes" INTEGER,
    "checkOutLeadMinutes" INTEGER,
    "locationConsentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PushDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "status" "PushStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "PushMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_recipientId_createdAt_idx" ON "Notification"("recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_idx" ON "Notification"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_expiresAt_idx" ON "Notification"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationEvent_dedupeKey_key" ON "NotificationEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationEvent_status_nextAttemptAt_idx" ON "NotificationEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Announcement_status_publishAt_idx" ON "Announcement"("status", "publishAt");

-- CreateIndex
CREATE INDEX "Announcement_expiresAt_idx" ON "Announcement"("expiresAt");

-- CreateIndex
CREATE INDEX "AnnouncementSchool_schoolId_idx" ON "AnnouncementSchool"("schoolId");

-- CreateIndex
CREATE INDEX "AnnouncementRead_userId_idx" ON "AnnouncementRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_sessionId_key" ON "PushDevice"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_token_key" ON "PushDevice"("token");

-- CreateIndex
CREATE INDEX "PushDevice_userId_idx" ON "PushDevice"("userId");

-- CreateIndex
CREATE INDEX "PushMessage_status_nextAttemptAt_idx" ON "PushMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushMessage_userId_sourceKey_key" ON "PushMessage"("userId", "sourceKey");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementSchool" ADD CONSTRAINT "AnnouncementSchool_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementSchool" ADD CONSTRAINT "AnnouncementSchool_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchReminderSettings" ADD CONSTRAINT "BranchReminderSettings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushMessage" ADD CONSTRAINT "PushMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hard limits (the API checks them first; these keep stored values valid whatever writes them).
ALTER TABLE "NotificationSettings" ADD CONSTRAINT "NotificationSettings_limits_check" CHECK (
  "id" = 'platform'
  AND "checkInLeadMin" >= 0 AND "checkInLeadMax" <= 30 AND "checkInLeadMin" <= "checkInLeadMax"
  AND "checkInLeadDefault" BETWEEN "checkInLeadMin" AND "checkInLeadMax"
  AND "checkOutLeadMin" >= 0 AND "checkOutLeadMax" <= 120 AND "checkOutLeadMin" <= "checkOutLeadMax"
  AND "checkOutLeadDefault" BETWEEN "checkOutLeadMin" AND "checkOutLeadMax"
  AND "digestHour" BETWEEN 0 AND 23
);
ALTER TABLE "BranchReminderSettings" ADD CONSTRAINT "BranchReminderSettings_minutes_check" CHECK (
  ("checkInLeadMinutes" IS NULL OR "checkInLeadMinutes" BETWEEN 0 AND 30)
  AND ("checkOutLeadMinutes" IS NULL OR "checkOutLeadMinutes" BETWEEN 0 AND 120)
);
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_minutes_check" CHECK (
  ("checkInLeadMinutes" IS NULL OR "checkInLeadMinutes" BETWEEN 0 AND 30)
  AND ("checkOutLeadMinutes" IS NULL OR "checkOutLeadMinutes" BETWEEN 0 AND 120)
);
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_expiry_check" CHECK ("expiresAt" > "createdAt");
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_audience_check" CHECK (
  cardinality("roles") >= 1 AND NOT ('SUPER_ADMIN' = ANY ("roles"))
);
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_dates_check" CHECK (
  ("status" = 'DRAFT' OR "publishAt" IS NOT NULL) AND ("publishAt" IS NULL OR "expiresAt" > "publishAt")
);
