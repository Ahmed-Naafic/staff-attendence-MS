import { conflict, forbidden, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { addDays, asDbDay, toDay } from '../academic-calendar/schoolDays.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockOperatingBranch } from '../branches/branches.service.js';
import { HALF_FROM_DB, HALF_LABELS, HALF_TO_DB } from './attendanceRules.js';
import { effectiveSettings } from './settings.js';

/*
 * Student excuses (docs/business-rules.md → Student attendance → Excuses): a Manager records that a
 * student of their branch is excused for whole days, one half of each day, or some lessons of each
 * day (teachers' lessons, Phase 5), from a date to a date, with a reason. Excuses are kept apart from
 * the marks and applied when attendance is read: an absent or unmarked student counts as excused,
 * a student marked present or late came anyway. Past days only within the correction period
 * (managerEditDays); future days freely (e.g. a planned medical leave). Never deleted: cancelled.
 * The School Owner reads every branch's; only Managers record or cancel them (403).
 */

const MANAGERS_ONLY = () => forbidden('Managers record excuses for students of their branch. You can view them here.');
const TX = { timeout: 20000, maxWait: 10000 };
const studentName = (s) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' ');

const periodsText = (periods) => (periods.length === 1 ? `period ${periods[0]}` : `periods ${periods.join(', ')}`);
export const excuseScopeText = (e) => (e.periods?.length ? periodsText(e.periods) : e.half ? HALF_LABELS[e.half].toLowerCase() : 'whole day');

/** Plain excuse (API half, 'YYYY-MM-DD' dates) for the rules in attendanceRules.js. */
const plain = (e) => ({ id: e.id, studentId: e.studentId, startDate: toDay(e.startDate), endDate: toDay(e.endDate), half: e.half ? HALF_FROM_DB[e.half] : null, periods: e.periods ?? [], reason: e.reason });

/** What a session shows of a covering excuse. */
export const toExcuseBrief = (e) => ({ id: e.id, reason: e.reason, startDate: e.startDate, endDate: e.endDate, half: e.half, periods: e.periods, covers: excuseScopeText(e) });

/** Active excuses of `studentIds` (one school) overlapping from..to (one query): Map studentId → [plain excuse]. */
export async function activeExcuses(client, schoolId, studentIds, from, to) {
  const result = new Map();
  if (!studentIds.length) return result;
  const rows = await client.studentExcuse.findMany({
    where: { schoolId, studentId: { in: studentIds }, cancelledAt: null, startDate: { lte: asDbDay(to) }, endDate: { gte: asDbDay(from) } },
    select: { id: true, studentId: true, startDate: true, endDate: true, half: true, periods: true, reason: true },
  });
  for (const r of rows) result.set(r.studentId, [...(result.get(r.studentId) ?? []), plain(r)]);
  return result;
}

const excuseInclude = {
  student: { select: { id: true, studentNumber: true, firstName: true, middleName: true, lastName: true } },
  branch: { select: { id: true, name: true, code: true } },
};

function toExcuse(e, today) {
  const p = plain(e);
  return {
    id: e.id,
    student: { id: e.student.id, number: e.student.studentNumber, name: studentName(e.student) },
    branch: e.branch,
    startDate: p.startDate,
    endDate: p.endDate,
    half: p.half,
    periods: p.periods,
    covers: excuseScopeText(p),
    reason: e.reason,
    note: e.note,
    createdAt: e.createdAt,
    createdBy: e.createdByName,
    status: e.cancelledAt ? 'cancelled' : p.endDate < today ? 'past' : p.startDate > today ? 'upcoming' : 'current',
    cancelledAt: e.cancelledAt,
    cancelledBy: e.cancelledByName,
  };
}

/** Excuses of the scope's students: by student, dates covered, status (active / cancelled / all), branch (Owner). */
export async function listExcuses(scope, { student, from, to, status, branch, page, pageSize }) {
  const prisma = getPrisma();
  const where = {
    schoolId: scope.school.id,
    ...(scope.branch ? { branchId: scope.branch.id } : branch && { branchId: branch }),
    ...(student && { studentId: student }),
    ...(status === 'active' && { cancelledAt: null }),
    ...(status === 'cancelled' && { cancelledAt: { not: null } }),
    ...(from && { endDate: { gte: asDbDay(from) } }),
    ...(to && { startDate: { lte: asDbDay(to) } }),
  };
  const [rows, total, today] = await Promise.all([
    prisma.studentExcuse.findMany({ where, include: excuseInclude, orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.studentExcuse.count({ where }),
    calendarToday(),
  ]);
  return { items: rows.map((r) => toExcuse(r, today)), total, page, pageSize, pageCount: Math.ceil(total / pageSize), canManage: Boolean(scope.branch) };
}

/** Records an excuse (Manager) for a student registered in their branch. */
export async function createExcuse(scope, values, user, req) {
  if (!scope.branch) throw MANAGERS_ONLY();
  const prisma = getPrisma();
  const student = isUuid(values.studentId)
    ? await prisma.student.findFirst({ where: { id: values.studentId, schoolId: scope.school.id, branchId: scope.branch.id }, select: { id: true, studentNumber: true, firstName: true, middleName: true, lastName: true } })
    : null;
  if (!student) throw notFound('Student not found.');
  const [today, settings] = await Promise.all([calendarToday(), effectiveSettings({ id: scope.branch.id, schoolId: scope.school.id }, prisma)]);
  const earliest = addDays(today, -settings.managerEditDays);
  if (values.startDate < earliest) {
    throw conflict('EDIT_PERIOD_OVER', `Excuses can start on ${earliest} at the earliest (${settings.managerEditDays} days back).`, { startDate: `From ${earliest}.` });
  }
  const created = await prisma.$transaction(async (tx) => {
    await lockOperatingBranch(tx, scope, 'student excuses');
    const excuse = await tx.studentExcuse.create({
      data: {
        schoolId: scope.school.id,
        branchId: scope.branch.id,
        studentId: student.id,
        startDate: asDbDay(values.startDate),
        endDate: asDbDay(values.endDate),
        half: values.half ? HALF_TO_DB[values.half] : null,
        periods: values.periods,
        reason: values.reason,
        note: values.note,
        createdById: user.id,
        createdByName: user.name,
      },
      include: excuseInclude,
    });
    const covers = excuseScopeText(plain(excuse));
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.STUDENT_EXCUSE_CREATED,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { type: 'Student', id: student.id, name: `${studentName(student)} (${student.studentNumber})` },
      schoolId: scope.school.id,
      description: `Excused ${studentName(student)} from ${values.startDate} to ${values.endDate} (${covers}): ${values.reason}.`,
      change: { startDate: values.startDate, endDate: values.endDate, covers, reason: values.reason, ...(values.note && { note: values.note }) },
      req,
    });
    return excuse;
  }, TX);
  return toExcuse(created, today);
}

/** Cancels an excuse (Manager, their branch's): from then on it no longer applies to any day. */
export async function cancelExcuse(scope, id, user, req) {
  if (!scope.branch) throw MANAGERS_ONLY();
  if (!isUuid(id)) throw notFound('Excuse not found.');
  const today = await calendarToday();
  const updated = await getPrisma().$transaction(async (tx) => {
    await lockOperatingBranch(tx, scope, 'student excuses');
    const [row] = await tx.$queryRaw`SELECT "id" FROM "StudentExcuse" WHERE "id" = ${id} AND "schoolId" = ${scope.school.id} AND "branchId" = ${scope.branch.id} FOR UPDATE`;
    if (!row) throw notFound('Excuse not found.');
    const excuse = await tx.studentExcuse.findUnique({ where: { id }, include: excuseInclude });
    if (excuse.cancelledAt) throw conflict('ALREADY_CANCELLED', 'This excuse is already cancelled.');
    const result = await tx.studentExcuse.update({ where: { id }, data: { cancelledAt: new Date(), cancelledById: user.id, cancelledByName: user.name }, include: excuseInclude });
    const p = plain(excuse);
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.STUDENT_EXCUSE_CANCELLED,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { type: 'Student', id: excuse.student.id, name: `${studentName(excuse.student)} (${excuse.student.studentNumber})` },
      schoolId: scope.school.id,
      description: `Cancelled ${studentName(excuse.student)}’s excuse from ${p.startDate} to ${p.endDate} (${excuseScopeText(p)}).`,
      change: { startDate: p.startDate, endDate: p.endDate, covers: excuseScopeText(p), reason: excuse.reason },
      req,
    });
    return result;
  }, TX);
  return toExcuse(updated, today);
}
