/*
 * DEV BRANCH ONLY — fills the Neon "dev" branch with clearly fictional sample data so the web
 * app and tests have something to show: the 28 sample schools and their owners used while the
 * pages were built, sample platform settings, and a dev Super Admin
 * (admin@edutrack.example, password DEV_ADMIN_PASSWORD from backend/.env.dev).
 *
 *   npm run seed:dev --workspace backend
 *
 * Refuses to run unless EDUTRACK_DB_BRANCH is "dev" (set only in backend/.env.dev), and does
 * nothing when the branch already has schools. It never deletes or overwrites data. No audit
 * events are seeded: the audit log only holds events recorded by real actions.
 */
import { createMockSettings } from '../../apps/web/src/features/platform-settings/data/mockSettings.js';
import { createMockOwners } from '../../apps/web/src/features/school-owners/data/mockOwners.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/features/auth/password.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') {
  console.error('Refusing to seed: EDUTRACK_DB_BRANCH is not "dev". Run `npm run seed:dev` (uses backend/.env.dev).');
  process.exit(1);
}
if (!process.env.DEV_ADMIN_PASSWORD) {
  console.error('DEV_ADMIN_PASSWORD is not set in backend/.env.dev.');
  process.exit(1);
}

const prisma = getPrisma();
if ((await prisma.school.count()) > 0) {
  console.log('The dev branch already has schools; nothing was changed.');
  process.exit(0);
}

const now = new Date();

if (!(await prisma.user.findUnique({ where: { email: 'admin@edutrack.example' } }))) {
  await prisma.user.create({
    data: {
      email: 'admin@edutrack.example',
      name: 'Demo Administrator',
      role: 'SUPER_ADMIN',
      passwordHash: await hashPassword(process.env.DEV_ADMIN_PASSWORD),
      createdAt: new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000),
    },
  });
}

// Owners and schools (sample owners have no password: they cannot sign in).
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

const { settings } = createMockSettings();
await prisma.platformSettings.upsert({
  where: { id: 'platform' },
  create: { id: 'platform', ...settings.information, ...settings.localization },
  update: {},
});

console.log(`Seeded the dev branch: ${owners.length} schools and owners, settings, and the dev Super Admin.`);
await prisma.$disconnect();
