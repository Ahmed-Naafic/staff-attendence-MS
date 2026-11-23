/*
 * DEV BRANCH ONLY — the demo school's examination sample data (scripts/dev-seed/examinations.js):
 *
 *   npm run seed:dev-exams --workspace backend
 *
 * Adds only what is missing (matched by name); never changes or deletes existing data.
 */
import { getPrisma } from '../src/config/prisma.js';
import { assertDevEnvironment } from './dev-seed/accounts.js';
import { seedExaminations } from './dev-seed/examinations.js';

assertDevEnvironment();
const prisma = getPrisma();
try {
  await seedExaminations(prisma);
} finally {
  await prisma.$disconnect();
}
// The in-process API may keep timers (rate limits, schedulers) alive.
process.exit(0);
