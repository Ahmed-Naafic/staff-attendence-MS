/*
 * DEV BRANCH ONLY — fills the Neon "dev" branch with clearly fictional sample data covering the
 * whole system (every table):
 *
 *   1. the 28 sample schools and their owners used while the pages were built, and sample
 *      platform settings (only when the branch has no schools yet);
 *   2. the dev sign-in accounts (scripts/dev-seed/accounts.js; passwords from backend/.env.dev);
 *   3. the demo school: the dev Owner's school filled with consistent data for every feature
 *      (scripts/dev-seed/demoSchool.js; only once — skipped when it already has academic years);
 *   4. the demo school's examinations: configuration, a completed examination with marks and
 *      published results, a planned one with its timetable and a draft (scripts/dev-seed/examinations.js;
 *      adds only what is missing, so it also runs on a demo school seeded before).
 *
 *   npm run seed:dev --workspace backend
 *
 * Refuses to run unless EDUTRACK_DB_BRANCH is "dev" (set only in backend/.env.dev). Safe to run
 * again: it never deletes data, and only the dev accounts' passwords are reset.
 */
import { createMockSettings } from '../../apps/web/src/features/platform-settings/data/mockSettings.js';
import { createMockOwners } from '../../apps/web/src/features/school-owners/data/mockOwners.js';
import { getPrisma } from '../src/config/prisma.js';
import { assertDevEnvironment, seedAccounts } from './dev-seed/accounts.js';
import { seedDemoSchool } from './dev-seed/demoSchool.js';
import { seedExaminations } from './dev-seed/examinations.js';

assertDevEnvironment();
const prisma = getPrisma();

try {
  // 1. Sample schools and owners (sample owners have no password: they cannot sign in).
  if ((await prisma.school.count()) === 0) {
    const now = new Date();
    const { owners } = createMockOwners({ now });
    for (const owner of owners.toReversed()) {
      const user = await prisma.user.create({
        data: {
          name: owner.name,
          email: owner.email,
          phone: owner.phone,
          role: 'OWNER',
          // Owner accounts are ACTIVE / SUSPENDED only.
          status: owner.status === 'suspended' ? 'SUSPENDED' : 'ACTIVE',
          createdAt: new Date(owner.registeredAt),
          lastSignInAt: owner.lastSignInAt ? new Date(owner.lastSignInAt) : null,
        },
      });
      await prisma.school.create({
        data: {
          code: `SCL-${new Date(owner.school.registeredAt).getFullYear()}-${owner.school.id.slice(-3)}`,
          name: owner.school.name,
          location: owner.school.location,
          // School statuses are ACTIVE / SUSPENDED only (no approval step).
          status: owner.status === 'suspended' ? 'SUSPENDED' : 'ACTIVE',
          description: `${owner.school.name} is a school in ${owner.school.location}, Somalia.`,
          registeredAt: new Date(owner.school.registeredAt),
          ownerId: user.id,
        },
      });
    }
    console.log(`Sample schools: ${owners.length} schools and owners.`);
  } else {
    console.log('Sample schools: already there.');
  }
  const { settings } = createMockSettings();
  await prisma.platformSettings.upsert({
    where: { id: 'platform' },
    create: { id: 'platform', ...settings.information, ...settings.localization },
    update: {},
  });

  // 2. Dev sign-in accounts.
  await seedAccounts(prisma);

  // 3. The demo school, then the accounts again so the demo teacher's password is set too.
  await seedDemoSchool(prisma);
  await seedAccounts(prisma, () => {});

  // 4. Examinations of the demo school (scripts/dev-seed/examinations.js; adds what is missing).
  await seedExaminations(prisma);
} finally {
  await prisma.$disconnect();
}
