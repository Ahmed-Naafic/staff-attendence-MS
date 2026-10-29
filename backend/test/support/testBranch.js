/*
 * Test fixture: MANAGER and STAFF accounts need a branch, and STAFF a Staff ID and phone key
 * (database checks User_branch_role_check and User_staff_check). branchFor(role) gives the data to
 * spread into prisma.user.create: a branch of one temporary school (created on first use, once per
 * test file) for MANAGER and STAFF, plus a unique Staff ID and phone key for STAFF; nothing for
 * other roles.
 * removeTestBranches() deletes that school and branch; call it at the end of the file's cleanup,
 * after the test accounts are deleted.
 */
import { randomBytes } from 'node:crypto';
import { getPrisma } from '../../src/config/prisma.js';

let fixture;
let staffCount = 0;

async function create() {
  const prisma = getPrisma();
  const tag = randomBytes(3).toString('hex').toUpperCase();
  const school = await prisma.school.create({ data: { code: `TMB-${tag}`, name: `Manager fixture ${tag}`, location: 'Test City' } });
  const branch = await prisma.branch.create({
    data: { schoolId: school.id, number: 1, code: `TMB-${tag}-B001`, name: 'Fixture', nameKey: 'fixture', address: 'Test street', city: 'Test City' },
  });
  return { schoolId: school.id, branchId: branch.id, code: branch.code };
}

export async function branchFor(role) {
  if (role !== 'MANAGER' && role !== 'STAFF') return {};
  fixture ??= create();
  const { branchId, code } = await fixture;
  if (role === 'MANAGER') return { branchId };
  staffCount += 1;
  const unique = randomBytes(5).toString('hex');
  return { branchId, staffId: `${code}-ST${String(staffCount).padStart(3, '0')}`, jobTitle: 'Test staff', phoneKey: `+999${parseInt(unique, 16)}` };
}

export async function removeTestBranches() {
  if (!fixture) return;
  const { schoolId, branchId } = await fixture;
  const prisma = getPrisma();
  await prisma.managerAssignment.deleteMany({ where: { branchId } });
  await prisma.user.deleteMany({ where: { branchId } });
  await prisma.branch.deleteMany({ where: { id: branchId } });
  await prisma.auditEvent.deleteMany({ where: { schoolId } });
  await prisma.school.deleteMany({ where: { id: schoolId } });
  fixture = undefined;
}
