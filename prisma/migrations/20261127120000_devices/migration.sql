-- Registered phones of mobile accounts (at most three active per account), requests for more,
-- and remote wipe of a lost or stolen phone. See prisma/schema.prisma (Device, DeviceRequest).

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'REVOKED', 'LOST');

-- CreateEnum
CREATE TYPE "WipeState" AS ENUM ('REQUESTED', 'DELIVERED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DeviceRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'USED');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "deviceId" TEXT;

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "model" TEXT,
    "appVersion" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokedByName" TEXT,
    "revokeReason" TEXT,
    "wipeState" "WipeState",
    "wipeRequestedAt" TIMESTAMP(3),
    "wipeRequestedById" TEXT,
    "wipeRequestedByName" TEXT,
    "wipeDeliveredAt" TIMESTAMP(3),
    "wipeCompletedAt" TIMESTAMP(3),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "model" TEXT,
    "status" "DeviceRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_secretHash_key" ON "Device"("secretHash");

-- CreateIndex
CREATE INDEX "Device_userId_status_idx" ON "Device"("userId", "status");

-- CreateIndex
CREATE INDEX "Device_installationId_idx" ON "Device"("installationId");

-- CreateIndex
CREATE INDEX "DeviceRequest_userId_status_idx" ON "DeviceRequest"("userId", "status");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceRequest" ADD CONSTRAINT "DeviceRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One active registration per phone and account, and one waiting request per phone and account.
CREATE UNIQUE INDEX "Device_one_active_per_installation" ON "Device"("userId", "installationId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "DeviceRequest_one_pending_per_installation" ON "DeviceRequest"("userId", "installationId") WHERE "status" = 'PENDING';
-- A wipe exists only for a phone reported lost or stolen.
ALTER TABLE "Device" ADD CONSTRAINT "Device_wipe_only_when_lost" CHECK ("wipeState" IS NULL OR "status" = 'LOST');
