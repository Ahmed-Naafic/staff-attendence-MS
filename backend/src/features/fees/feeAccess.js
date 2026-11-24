import { forbidden, HttpError, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { feeSettingsOf } from './feeSettings.js';

/*
 * Who may do what in Fee Management (docs/business-rules.md → Fee Management → Permissions). The
 * backend is the security boundary: every service checks here, whatever the web app shows.
 *
 * scope: { school, branch, role, user }. OWNER: the whole school (branch null). MANAGER and ACCOUNTANT:
 * their branch only: students whose current branch it is (their financial history comes with them),
 * payments received there, their own cash closings.
 */

export const FEES_DISABLED = () => new HttpError(403, 'FEATURE_DISABLED', 'Fee Management is not switched on for your school. Contact EduTrack support to switch it on.');

/** Fee Management must be switched on for the school (Super Admin; School.feesEnabled). */
export const requireFees = (scopeOf) => async (req, res, next) => {
  try {
    const school = await getPrisma().school.findUnique({ where: { id: scopeOf(req).school.id }, select: { feesEnabled: true } });
    if (!school?.feesEnabled) return next(FEES_DISABLED());
    return next();
  } catch (error) {
    return next(error);
  }
};

export const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });

/**
 * The actions each role may take. Some follow the school's policies (settings): reversing payments
 * and granting clearance exceptions (chosen roles), Managers adjusting fees (on/off).
 */
export function permissions(scope, settings) {
  const { role } = scope;
  const owner = role === 'OWNER';
  const manager = role === 'MANAGER';
  return {
    configure: owner,
    manageAccountants: owner,
    transferBranch: owner,
    adjust: owner || (manager && settings.managersAdjustFees),
    charge: owner || manager,
    assignDiscounts: owner || manager,
    cancelObligations: owner || manager,
    recordPayments: true,
    reversePayments: settings.reversalRoles.includes(role),
    invoices: true,
    grantExceptions: settings.exceptionRoles.includes(role),
    closeCash: true,
    correctOthersClosings: owner,
    runGeneration: true,
    remindParents: true,
    reports: true,
  };
}

/** Throws 403 unless the scope may `action` (message explains). Returns the settings for the caller's use. */
export async function requirePermission(scope, action, message) {
  const settings = await feeSettingsOf(scope.school.id);
  if (!permissions(scope, settings)[action]) throw forbidden(message ?? 'You do not have permission to do this.');
  return settings;
}

/** Students the scope may see (by current branch). */
export const studentScope = (scope) => ({ schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) });

/** A student of the scope, or 404. */
export async function findScopedStudent(client, scope, id, include) {
  if (!isUuid(id)) throw notFound('Student not found.');
  const student = await client.student.findFirst({ where: { id, ...studentScope(scope) }, ...(include && { include }) });
  if (!student) throw notFound('Student not found.');
  return student;
}

/** One change at a time to a student's account (payments, reversals, adjustments): an advisory lock in `tx`. */
export const lockStudentAccount = (tx, studentId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fee-account:${studentId}`}))`;

/** The school's current academic year, or the one asked for (id), or null. */
export async function yearOf(client, scope, academicYear) {
  if (academicYear && academicYear !== 'current') {
    if (!isUuid(academicYear)) throw notFound('Academic year not found.');
    const year = await client.academicYear.findFirst({ where: { id: academicYear, schoolId: scope.school.id } });
    if (!year) throw notFound('Academic year not found.');
    return year;
  }
  return client.academicYear.findFirst({ where: { schoolId: scope.school.id, status: 'CURRENT' } });
}

export const feeToday = () => calendarToday();

/** Writes need the school (and the branch for branch roles) to be operating. */
export async function lockOperating(tx, scope) {
  const [school] = await tx.$queryRaw`SELECT "status"::text AS "status" FROM "School" WHERE "id" = ${scope.school.id} FOR SHARE`;
  if (school?.status !== 'ACTIVE') throw new HttpError(409, 'SCHOOL_SUSPENDED', 'Your school is suspended. Fee records can be viewed but not changed until it is reactivated.');
  if (scope.branch) {
    const [branch] = await tx.$queryRaw`SELECT "status"::text AS "status" FROM "Branch" WHERE "id" = ${scope.branch.id} FOR SHARE`;
    if (branch?.status !== 'ACTIVE') throw new HttpError(409, 'BRANCH_NOT_OPERATING', 'Your branch is suspended. Fee records can be viewed but not changed until it is reactivated.');
  }
}

/** Interactive transactions here wait for locks and write several rows. */
export const TX = { timeout: 30000, maxWait: 15000 };
