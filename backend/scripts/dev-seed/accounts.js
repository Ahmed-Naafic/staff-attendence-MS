/*
 * DEV BRANCH ONLY — the dev sign-in accounts, with the passwords from backend/.env.dev:
 *
 *   Super Admin  admin@edutrack.example    DEV_ADMIN_PASSWORD
 *   Owner        owner@edutrack.example    DEV_OWNER_PASSWORD
 *   Manager      manager@edutrack.example  DEV_MANAGER_PASSWORD
 *   Staff        phone +252 61 7000001     DEV_STAFF_PASSWORD  (a teacher; created by demoSchool.js)
 *
 * Safe to run again: creates what is missing and resets these accounts' passwords and status. The
 * Manager is placed in the first branch of the first ACTIVE school (by code); a "Main Branch" is
 * created there when the school has no branch. The Owner owns the Manager's school: that school's
 * sample owner (who has no password) takes the owner@edutrack.example email and the password.
 */
import { hashPassword, MIN_PASSWORD_LENGTH } from '../../src/features/auth/password.js';
import { nameKey } from '../../src/features/branches/branchInput.js';
import { phoneKey } from '../../src/features/schools/schoolInput.js';

export const ADMIN_EMAIL = 'admin@edutrack.example';
export const OWNER_EMAIL = 'owner@edutrack.example';
export const MANAGER_EMAIL = 'manager@edutrack.example';
export const STAFF_PHONE = '+252 61 7000001';

const PASSWORD_KEYS = ['DEV_ADMIN_PASSWORD', 'DEV_OWNER_PASSWORD', 'DEV_MANAGER_PASSWORD', 'DEV_STAFF_PASSWORD'];

/** Stops unless this is the dev branch and every dev password is set and long enough. */
export function assertDevEnvironment() {
  const problems = [];
  if (process.env.EDUTRACK_DB_BRANCH !== 'dev') problems.push('EDUTRACK_DB_BRANCH is not "dev" (use backend/.env.dev).');
  for (const key of PASSWORD_KEYS) {
    const value = process.env[key];
    if (!value) problems.push(`${key} is not set in backend/.env.dev.`);
    else if (value.length < MIN_PASSWORD_LENGTH) problems.push(`${key} must have at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (problems.length) {
    console.error(`Refusing to seed:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
}

const signInReady = (passwordHash) => ({ passwordHash, status: 'ACTIVE', mustChangePassword: false });

export async function seedAccounts(prisma, log = console.log) {
  // Super Admin
  const adminHash = await hashPassword(process.env.DEV_ADMIN_PASSWORD);
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: { email: ADMIN_EMAIL, name: 'Demo Administrator', role: 'SUPER_ADMIN', ...signInReady(adminHash) },
    update: signInReady(adminHash),
  });

  // Manager
  const managerHash = await hashPassword(process.env.DEV_MANAGER_PASSWORD);
  const manager = await prisma.user.findUnique({ where: { email: MANAGER_EMAIL }, select: { id: true } });
  if (manager) {
    await prisma.user.update({ where: { id: manager.id }, data: signInReady(managerHash) });
  } else {
    const school = await prisma.school.findFirst({ where: { status: 'ACTIVE' }, orderBy: { code: 'asc' }, select: { id: true, name: true } });
    if (!school) throw new Error('No ACTIVE school on the dev branch to place the Manager in.');
    await prisma.$transaction(async (tx) => {
      let branch = await tx.branch.findFirst({ where: { schoolId: school.id, status: 'ACTIVE' }, orderBy: { number: 'asc' }, select: { id: true } });
      if (!branch) {
        const [row] = await tx.$queryRaw`
          UPDATE "School" SET "branchSequence" = "branchSequence" + 1
          WHERE "id" = ${school.id} RETURNING "branchSequence", "code"`;
        const number = Number(row.branchSequence);
        branch = await tx.branch.create({
          data: {
            schoolId: school.id,
            number,
            code: `${row.code}-B${String(number).padStart(3, '0')}`,
            name: 'Main Branch',
            nameKey: nameKey('Main Branch'),
            address: 'Maka Al-Mukarama Road',
            city: 'Mogadishu',
            status: 'ACTIVE',
          },
          select: { id: true },
        });
        await tx.branchLocation.create({ data: { branchId: branch.id, latitude: 2.0469, longitude: 45.3182, accuracyMeters: 10, effectiveFrom: new Date() } });
      }
      const created = await tx.user.create({
        data: { email: MANAGER_EMAIL, name: 'Demo Manager', phone: '+252 61 0000001', role: 'MANAGER', branchId: branch.id, ...signInReady(managerHash) },
        select: { id: true },
      });
      await tx.managerAssignment.create({ data: { managerId: created.id, branchId: branch.id } });
    });
    log(`Demo Manager placed in ${school.name}.`);
  }

  // Owner (of the Manager's school)
  const ownerHash = await hashPassword(process.env.DEV_OWNER_PASSWORD);
  const owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL }, select: { id: true } });
  if (owner) {
    await prisma.user.update({ where: { id: owner.id }, data: signInReady(ownerHash) });
  } else {
    const { branch } = await prisma.user.findUnique({
      where: { email: MANAGER_EMAIL },
      select: { branch: { select: { school: { select: { id: true, name: true, ownerId: true } } } } },
    });
    const school = branch.school;
    if (school.ownerId) {
      await prisma.user.update({ where: { id: school.ownerId }, data: { email: OWNER_EMAIL, ...signInReady(ownerHash) } });
    } else {
      await prisma.user.create({
        data: { email: OWNER_EMAIL, name: 'Demo Owner', phone: '+252 61 0000002', role: 'OWNER', ...signInReady(ownerHash), ownedSchool: { connect: { id: school.id } } },
      });
    }
    log(`Demo Owner set as the owner of ${school.name}.`);
  }

  // Staff (teacher): created with the demo school; here only its password is reset.
  const staff = await prisma.user.findFirst({ where: { role: 'STAFF', phoneKey: phoneKey(STAFF_PHONE) }, select: { id: true } });
  if (staff) await prisma.user.update({ where: { id: staff.id }, data: signInReady(await hashPassword(process.env.DEV_STAFF_PASSWORD)) });

  log(`Dev accounts ready: ${ADMIN_EMAIL}, ${OWNER_EMAIL}, ${MANAGER_EMAIL}${staff ? `, staff ${STAFF_PHONE}` : ''}.`);
}
