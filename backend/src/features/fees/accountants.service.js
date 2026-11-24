import { Prisma } from '@prisma/client';
import { conflict, notFound } from '../../common/httpError.js';
import { fromDbStatus } from '../../common/listQuery.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { hashPassword } from '../auth/password.js';
import { lockActiveSchool } from '../branches/branches.service.js';
import { actorOf } from './feeAccess.js';

/*
 * Accountant accounts (docs/business-rules.md → Fee Management → Accountants). The School Owner
 * creates them for a branch: they sign in to the web app (email and a temporary password changed at
 * first sign-in, like Managers) and work only in Fee Management for that branch. Never deleted:
 * suspended. The forms and their checks are the Manager ones (features/managers/managerInput.js).
 */

const select = { id: true, name: true, email: true, phone: true, status: true, suspensionReason: true, suspendedAt: true, mustChangePassword: true, createdAt: true, lastSignInAt: true, branch: { select: { id: true, code: true, name: true, status: true } } };
const toAccountant = (a) => ({
  id: a.id,
  name: a.name,
  email: a.email ?? '',
  phone: a.phone ?? '',
  status: fromDbStatus(a.status),
  suspensionReason: a.suspensionReason,
  suspendedAt: a.suspendedAt?.toISOString() ?? null,
  passwordChangePending: a.mustChangePassword,
  createdAt: a.createdAt.toISOString(),
  lastSignInAt: a.lastSignInAt?.toISOString() ?? null,
  branch: { id: a.branch.id, code: a.branch.code, name: a.branch.name, status: fromDbStatus(a.branch.status) },
});
const target = (a) => ({ type: 'accountant', id: a.id, name: a.name });
const EMAIL_TAKEN = () => conflict('EMAIL_TAKEN', 'An account with this email already exists.', { email: 'An account with this email already exists.' });
const isUniqueViolation = (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export async function listAccountants(school) {
  const rows = await getPrisma().user.findMany({ where: { role: 'ACCOUNTANT', branch: { schoolId: school.id } }, select, orderBy: [{ status: 'asc' }, { name: 'asc' }] });
  const branches = await getPrisma().branch.findMany({ where: { schoolId: school.id }, select: { id: true, name: true, code: true, status: true }, orderBy: { number: 'asc' } });
  return { items: rows.map(toAccountant), branches: branches.map((b) => ({ ...b, status: fromDbStatus(b.status) })) };
}

async function findOne(tx, school, id) {
  if (!isUuid(id)) throw notFound('Accountant not found.');
  await tx.$executeRaw`SELECT 1 FROM "User" WHERE "id" = ${id} FOR UPDATE`;
  const a = await tx.user.findFirst({ where: { id, role: 'ACCOUNTANT', branch: { schoolId: school.id } }, select });
  if (!a) throw notFound('Accountant not found.');
  return a;
}

async function schoolBranch(tx, school, branchId) {
  const b = await tx.branch.findFirst({ where: { id: branchId, schoolId: school.id } });
  if (!b) throw notFound('Branch not found.');
  if (b.status !== 'ACTIVE') throw conflict('BRANCH_NOT_OPERATING', `${b.name} is suspended.`);
  return b;
}

export async function createAccountant(school, { password, branchId, ...details }, user, req) {
  const passwordHash = await hashPassword(password);
  try {
    const created = await getPrisma().$transaction(async (tx) => {
      await lockActiveSchool(tx, school);
      const branch = await schoolBranch(tx, school, branchId);
      if (await tx.user.findUnique({ where: { email: details.email } })) throw EMAIL_TAKEN();
      const a = await tx.user.create({ data: { ...details, role: 'ACCOUNTANT', status: 'ACTIVE', passwordHash, mustChangePassword: true, branchId: branch.id }, select });
      await recordAuditEvent({ client: tx, action: AUDIT_ACTIONS.ACCOUNTANT_CREATED, actor: actorOf(user), target: target(a), schoolId: school.id, description: `Accountant account created for ${branch.name} (${branch.code}), with a temporary password to change at first sign-in.`, req });
      return a;
    });
    return toAccountant(created);
  } catch (error) {
    if (isUniqueViolation(error)) throw EMAIL_TAKEN();
    throw error;
  }
}

/** Name, email, phone and (unlike Managers) branch: an Accountant may be moved to another branch. */
export async function updateAccountant(school, id, values, user, req) {
  try {
    const updated = await getPrisma().$transaction(async (tx) => {
      await lockActiveSchool(tx, school);
      const a = await findOne(tx, school, id);
      const data = {};
      const fields = [];
      for (const k of ['name', 'email', 'phone']) {
        if (values[k] !== undefined && values[k] !== (a[k] ?? '')) {
          data[k] = values[k] || null;
          fields.push({ field: k[0].toUpperCase() + k.slice(1), from: a[k] ?? '', to: values[k] ?? '' });
        }
      }
      if (values.branchId && values.branchId !== a.branch.id) {
        const b = await schoolBranch(tx, school, values.branchId);
        data.branchId = b.id;
        fields.push({ field: 'Branch', from: a.branch.name, to: b.name });
      }
      if (!fields.length) return a;
      if (data.email && (await tx.user.findFirst({ where: { email: data.email, id: { not: a.id } } }))) throw EMAIL_TAKEN();
      const u = await tx.user.update({ where: { id: a.id }, data, select });
      if (data.branchId) await tx.session.deleteMany({ where: { userId: a.id } });
      await recordAuditEvent({ client: tx, action: AUDIT_ACTIONS.ACCOUNTANT_UPDATED, actor: actorOf(user), target: target(u), schoolId: school.id, description: `Accountant details changed: ${fields.map((f) => f.field).join(', ')}.`, change: { fields }, req });
      return u;
    });
    return toAccountant(updated);
  } catch (error) {
    if (isUniqueViolation(error)) throw EMAIL_TAKEN();
    throw error;
  }
}

export async function setAccountantStatus(school, id, { suspend, reason }, user, req) {
  const updated = await getPrisma().$transaction(async (tx) => {
    await lockActiveSchool(tx, school);
    const a = await findOne(tx, school, id);
    if (suspend && a.status !== 'ACTIVE') throw conflict('INVALID_STATUS', 'Only an active Accountant can be suspended.');
    if (!suspend && a.status !== 'SUSPENDED') throw conflict('INVALID_STATUS', 'Only a suspended Accountant can be reactivated.');
    const u = await tx.user.update({ where: { id: a.id }, data: suspend ? { status: 'SUSPENDED', suspensionReason: reason, suspendedAt: new Date() } : { status: 'ACTIVE', suspensionReason: null, suspendedAt: null }, select });
    if (suspend) await tx.session.deleteMany({ where: { userId: a.id } });
    await recordAuditEvent({ client: tx, action: suspend ? AUDIT_ACTIONS.ACCOUNTANT_SUSPENDED : AUDIT_ACTIONS.ACCOUNTANT_REACTIVATED, actor: actorOf(user), target: target(a), schoolId: school.id, description: suspend ? `Accountant account suspended. Reason: ${reason}` : 'Accountant account reactivated.', change: { field: 'Status', from: suspend ? 'Active' : 'Suspended', to: suspend ? 'Suspended' : 'Active' }, req });
    return u;
  });
  return toAccountant(updated);
}

export async function resetAccountantPassword(school, id, password, user, req) {
  const passwordHash = await hashPassword(password);
  const updated = await getPrisma().$transaction(async (tx) => {
    await lockActiveSchool(tx, school);
    const a = await findOne(tx, school, id);
    await tx.user.update({ where: { id: a.id }, data: { passwordHash, mustChangePassword: true } });
    const { count } = await tx.session.deleteMany({ where: { userId: a.id } });
    await recordAuditEvent({ client: tx, action: AUDIT_ACTIONS.ACCOUNTANT_PASSWORD_RESET, actor: actorOf(user), target: target(a), schoolId: school.id, description: `New temporary password set; the Accountant must change it at the next sign-in. Sessions ended: ${count}.`, req });
    return a;
  });
  return toAccountant(updated);
}
