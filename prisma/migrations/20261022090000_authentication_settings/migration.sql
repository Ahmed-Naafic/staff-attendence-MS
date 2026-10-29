-- Authentication Settings: absolute session lifetime for new sign-ins (nullable; additive only).
ALTER TABLE "PlatformSettings" ADD COLUMN "sessionLifetimeHours" INTEGER;
