-- Authentication Settings: inactivity timeout in minutes (nullable = disabled; additive only).
ALTER TABLE "PlatformSettings" ADD COLUMN "inactivityTimeoutMinutes" INTEGER;
