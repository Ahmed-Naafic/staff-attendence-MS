-- The account's interface theme, shared by the web and mobile apps. Light for every account.
CREATE TYPE "ThemePreference" AS ENUM ('LIGHT', 'DARK');
ALTER TABLE "User" ADD COLUMN "theme" "ThemePreference" NOT NULL DEFAULT 'LIGHT';
