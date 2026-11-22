/*
 * DEV BRANCH ONLY — makes sure the dev sign-in accounts exist with known passwords:
 *
 *   Super Admin  admin@edutrack.example    password DEV_ADMIN_PASSWORD
 *   Owner        owner@edutrack.example    password DEV_OWNER_PASSWORD
 *   Manager      manager@edutrack.example  password DEV_MANAGER_PASSWORD
 *   Staff        phone +252 61 7000001     password DEV_STAFF_PASSWORD (created by `npm run seed:dev`)
 *
 *   npm run seed:dev-accounts --workspace backend
 *
 * Safe to run again: it creates what is missing and resets these accounts' passwords (and status)
 * to the values in backend/.env.dev. See scripts/dev-seed/accounts.js. `npm run seed:dev` does this
 * too, and also fills the demo school.
 */
import { getPrisma } from '../src/config/prisma.js';
import { assertDevEnvironment, seedAccounts } from './dev-seed/accounts.js';

assertDevEnvironment();
const prisma = getPrisma();
try {
  await seedAccounts(prisma);
} finally {
  await prisma.$disconnect();
}
