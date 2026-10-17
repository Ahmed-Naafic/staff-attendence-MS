-- School Management (approved rules): statuses are ACTIVE and SUSPENDED only; new schools start ACTIVE.
-- Contact fields and suspension details are added as nullable columns (required by the API on
-- register/edit; existing rows have none). No rows or columns are removed.

-- PENDING no longer exists: schools still marked PENDING become ACTIVE (approved).
UPDATE "School" SET "status" = 'ACTIVE' WHERE "status" = 'PENDING';

-- AlterEnum: recreate SchoolStatus without PENDING (only the enum type is replaced; data is kept).
BEGIN;
CREATE TYPE "SchoolStatus_new" AS ENUM ('ACTIVE', 'SUSPENDED');
ALTER TABLE "School" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "School" ALTER COLUMN "status" TYPE "SchoolStatus_new" USING ("status"::text::"SchoolStatus_new");
ALTER TYPE "SchoolStatus" RENAME TO "SchoolStatus_old";
ALTER TYPE "SchoolStatus_new" RENAME TO "SchoolStatus";
DROP TYPE "SchoolStatus_old";
ALTER TABLE "School" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
COMMIT;

-- AlterTable: new optional columns
ALTER TABLE "School" ADD COLUMN     "address" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspensionReason" TEXT,
ADD COLUMN     "website" TEXT;
