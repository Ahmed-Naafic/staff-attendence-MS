-- Fee Management access for staff members (granted by the School Owner): the Accountant web workspace
-- of their branch with their staff sign-in. Additive: existing accounts get false.
ALTER TABLE "User" ADD COLUMN "feeAccess" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD CONSTRAINT "User_fee_access_check" CHECK ("feeAccess" = false OR "role" = 'STAFF');
