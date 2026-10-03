/*
 * DEV BRANCH ONLY — fills the Neon "dev" branch with clearly fictional sample data so the web
 * app and tests have something to show: the 28 sample schools and their owners used while the
 * pages were built, their sample audit history, sample platform settings, and a dev Super Admin
 * (admin@edutrack.example, password DEV_ADMIN_PASSWORD from backend/.env.dev).
 *
 *   npm run seed:dev --workspace backend
 *
 * Refuses to run unless EDUTRACK_DB_BRANCH is "dev" (set only in backend/.env.dev), and does
 * nothing when the branch already has schools. It never deletes or overwrites data.
 */
import { createMockAuditLogs } from '../../apps/web/src/features/audit-logs/data/mockAuditLogs.js';
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
const UPPER = (status) => status.toUpperCase();

const admin =
  (await prisma.user.findUnique({ where: { email: 'admin@edutrack.example' } })) ??
  (await prisma.user.create({
    data: {
      email: 'admin@edutrack.example',
      name: 'Demo Administrator',
      role: 'SUPER_ADMIN',
      passwordHash: await hashPassword(process.env.DEV_ADMIN_PASSWORD),
      createdAt: new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000),
    },
  }));

// Owners and schools (sample owners have no password: they cannot sign in).
const { owners } = createMockOwners({ now });
const ownerIds = new Map();
const schoolIds = new Map();
for (const owner of owners.toReversed()) {
  const user = await prisma.user.create({
    data: {
      name: owner.name,
      email: owner.email,
      phone: owner.phone,
      role: 'OWNER',
      status: UPPER(owner.status),
      createdAt: new Date(owner.registeredAt),
      lastSignInAt: owner.lastSignInAt ? new Date(owner.lastSignInAt) : null,
    },
  });
  ownerIds.set(owner.id, user.id);
  const school = await prisma.school.create({
    data: {
      code: `SCL-${new Date(owner.school.registeredAt).getFullYear()}-${owner.school.id.slice(-3)}`,
      name: owner.school.name,
      location: owner.school.location,
      status: UPPER(owner.status),
      description: `${owner.school.name} is a school in ${owner.school.location}, Somalia.`,
      registeredAt: new Date(owner.school.registeredAt),
      ownerId: user.id,
    },
  });
  schoolIds.set(owner.school.id, school.id);
}

// Sample audit history, linked to the seeded records. User agents are rebuilt from the sample
// browser and device so the audit log shows them like real ones.
const agents = {
  'Windows 11': 'Windows NT 10.0; Win64; x64',
  'Windows 10': 'Windows NT 10.0; Win64; x64',
  'Android 15': 'Linux; Android 15',
  'iPhone (iOS 18)': 'iPhone; CPU iPhone OS 18_0 like Mac OS X',
  'macOS 15': 'Macintosh; Intel Mac OS X 10_15_7',
};
function userAgentFor({ browser, device }) {
  const [name, major] = browser.split(' ');
  const platform = agents[device] ?? 'X11; Linux x86_64';
  if (name === 'Firefox') return `Mozilla/5.0 (${platform}; rv:${major}.0) Gecko/20100101 Firefox/${major}.0`;
  if (name === 'Safari') return `Mozilla/5.0 (${platform}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${major}.0 Mobile/15E148 Safari/604.1`;
  const chrome = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  return name === 'Edge' ? `${chrome} Edg/${major}.0.0.0` : chrome;
}

const { events } = createMockAuditLogs({ now });
const idOf = (mockId) => (mockId === 'demo-super-admin' ? admin.id : (ownerIds.get(mockId) ?? schoolIds.get(mockId) ?? null));
await prisma.auditEvent.createMany({
  data: events.map((e) => ({
    occurredAt: new Date(e.occurredAt),
    action: e.action,
    result: e.result === 'failure' ? 'FAILURE' : 'SUCCESS',
    actorId: idOf(e.actor.id),
    actorName: e.actor.name,
    actorRole: e.actor.role,
    targetType: e.target.type,
    targetId: e.target.id ? idOf(e.target.id) : null,
    targetName: e.target.name,
    schoolId: e.school ? schoolIds.get(e.school.id) : null,
    description: e.description,
    change: e.change ?? undefined,
    ipAddress: e.context.ipAddress,
    userAgent: userAgentFor(e.context),
  })),
});

const { settings } = createMockSettings();
await prisma.platformSettings.upsert({
  where: { id: 'platform' },
  create: { id: 'platform', ...settings.information, ...settings.localization },
  update: {},
});

console.log(`Seeded the dev branch: ${owners.length} schools and owners, ${events.length} audit events, settings, and the dev Super Admin.`);
await prisma.$disconnect();
