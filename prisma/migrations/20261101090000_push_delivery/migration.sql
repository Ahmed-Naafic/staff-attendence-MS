-- Notification phase 3 (remote push): per-device deliveries with Expo tickets and receipts, and
-- message states that tell "submitted to Expo" from "accepted by FCM/APNs"
-- (docs/notifications/notification-architecture.md → Push delivery). Existing rows are kept:
-- SENT becomes SUBMITTED (what it meant: Expo accepted it) and sentAt becomes submittedAt.

ALTER TYPE "PushStatus" RENAME VALUE 'SENT' TO 'SUBMITTED';
ALTER TYPE "PushStatus" ADD VALUE 'ACCEPTED' AFTER 'SUBMITTED';

ALTER TABLE "PushMessage" RENAME COLUMN "sentAt" TO "submittedAt";
ALTER TABLE "PushMessage" ADD COLUMN "acceptedAt" TIMESTAMP(3);

CREATE TYPE "PushDeliveryStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'FAILED', 'UNCONFIRMED');

CREATE TABLE "PushDelivery" (
    "id" TEXT NOT NULL,
    "pushMessageId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" "PushDeliveryStatus" NOT NULL,
    "ticketId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receiptCheckedAt" TIMESTAMP(3),

    CONSTRAINT "PushDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PushDelivery_status_submittedAt_idx" ON "PushDelivery"("status", "submittedAt");
CREATE INDEX "PushDelivery_ticketId_idx" ON "PushDelivery"("ticketId");
CREATE UNIQUE INDEX "PushDelivery_pushMessageId_token_key" ON "PushDelivery"("pushMessageId", "token");

ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_pushMessageId_fkey" FOREIGN KEY ("pushMessageId") REFERENCES "PushMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
