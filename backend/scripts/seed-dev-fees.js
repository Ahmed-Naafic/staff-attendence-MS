/*
 * DEV BRANCH ONLY — the demo school's Fee Management sample data (scripts/dev-seed/fees.js):
 *
 *   npm run seed:dev-fees --workspace backend
 *
 * Adds only what is missing; never changes or deletes existing data.
 */
import { getPrisma } from '../src/config/prisma.js';
import { assertDevEnvironment } from './dev-seed/accounts.js';
import { seedFees } from './dev-seed/fees.js';

assertDevEnvironment();
const prisma = getPrisma();
try {
  await seedFees(prisma);
} finally {
  await prisma.$disconnect();
}
// The in-process API may keep timers (rate limits, schedulers) alive.
process.exit(0);
