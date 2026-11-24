import { badRequest } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { createNotifications } from '../notifications/notify.js';
import { actorOf, findScopedStudent, studentScope } from './feeAccess.js';
import { fullName } from './feeAccounts.service.js';
import { afterWithdrawal, catchUpSchool, syncSchoolExamFees } from './feeGeneration.service.js';
import { feeSettingsOf } from './feeSettings.js';
import { addDays, asDbDate, daysBetween, formatMoney, fromDbDate } from './feeRules.js';

/*
 * Scheduled fee work (runs inside the notification job, docs/notifications → Background processing):
 * monthly fee generation with catch-up and retries, withdrawals and examination fees kept in line, and
 * overdue notices to the staff the school chose. Parent reminders: EduTrack has no direct channel to
 * parents (no WhatsApp or SMS integration), so it lists the guardians due a reminder by the school's
 * policy; staff send it from their own phone and the reminder is logged.
 */

const DAY = 86_400_000;

/**
 * Students with overdue fees at least `minDays` days past due (+ grace), per school: [{ student, branchId,
 * amount, oldest, days }]. With remindersStop 'any_payment', a student who paid anything since their
 * oldest overdue fee fell due is left out.
 */
async function overdueStudents(schoolId, settings, today, minDays, extraWhere = {}) {
  const prisma = getPrisma();
  const cutoff = addDays(today, -(settings.overdueGraceDays + minDays));
  const rows = await prisma.feeObligation.findMany({
    where: { schoolId, status: 'OPEN', dueDate: { lt: asDbDate(addDays(today, -settings.overdueGraceDays)) }, student: { status: 'ENROLLED', ...extraWhere } },
    select: { studentId: true, netAmount: true, paidAmount: true, dueDate: true, student: { select: { id: true, firstName: true, middleName: true, lastName: true, studentNumber: true, branchId: true, guardianName: true, guardianPhone: true } } },
  });
  const by = new Map();
  for (const o of rows) {
    if (o.netAmount <= o.paidAmount) continue;
    const s = by.get(o.studentId) ?? { student: o.student, branchId: o.student.branchId, amount: 0, oldest: null };
    s.amount += o.netAmount - o.paidAmount;
    const due = fromDbDate(o.dueDate);
    if (!s.oldest || due < s.oldest) s.oldest = due;
    by.set(o.studentId, s);
  }
  let list = [...by.values()].filter((s) => s.oldest <= cutoff);
  if (settings.remindersStop === 'any_payment' && list.length) {
    const paid = await prisma.feePayment.findMany({ where: { schoolId, status: 'RECORDED', studentId: { in: list.map((s) => s.student.id) } }, select: { studentId: true, receivedAt: true } });
    list = list.filter((s) => !paid.some((p) => p.studentId === s.student.id && p.receivedAt.toISOString().slice(0, 10) >= s.oldest));
  }
  return list.map((s) => ({ ...s, days: daysBetween(s.oldest, today) })).sort((a, b) => b.amount - a.amount);
}

/**
 * Overdue notices to staff: once per cycle of `staffRepeatDays` (dedupe key per cycle), each chosen
 * role gets a summary of their scope (Managers and Accountants: their branch; the Owner: the school).
 */
export async function notifyOverdue(schoolId, { now = new Date(), today } = {}) {
  const prisma = getPrisma();
  const settings = await feeSettingsOf(schoolId);
  if (!settings.staffOverdueNotifications || !settings.staffRecipients.length) return 0;
  today ??= await calendarToday();
  const list = await overdueStudents(schoolId, settings, today, settings.staffFirstAfterDays);
  if (!list.length) return 0;
  const cycle = Math.floor(Date.parse(`${today}T00:00:00Z`) / DAY / settings.staffRepeatDays);
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { name: true, ownerId: true } });
  const items = [];
  const summary = (rows, scopeName) => ({
    scope: scopeName,
    students: rows.length,
    amount: formatMoney(rows.reduce((n, r) => n + r.amount, 0), settings.currency),
    top: rows.slice(0, 5).map((r) => ({ name: fullName(r.student), studentNumber: r.student.studentNumber, amount: formatMoney(r.amount, settings.currency), days: r.days })),
  });
  if (settings.staffRecipients.includes('OWNER') && school.ownerId) {
    items.push({ type: 'FEES_OVERDUE', recipientId: school.ownerId, schoolId, subjectType: 'school', subjectId: schoolId, params: summary(list, school.name), dedupeKey: `fees-overdue:${schoolId}:${school.ownerId}:${cycle}` });
  }
  const branchRoles = settings.staffRecipients.filter((r) => r === 'MANAGER' || r === 'ACCOUNTANT');
  if (branchRoles.length) {
    const branchIds = [...new Set(list.map((r) => r.branchId))];
    const [branches, staff] = await Promise.all([
      prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } }),
      prisma.user.findMany({ where: { branchId: { in: branchIds }, role: { in: branchRoles }, status: 'ACTIVE' }, select: { id: true, branchId: true } }),
    ]);
    for (const b of branches) {
      const rows = list.filter((r) => r.branchId === b.id);
      for (const u of staff.filter((x) => x.branchId === b.id)) {
        items.push({ type: 'FEES_OVERDUE', recipientId: u.id, schoolId, branchId: b.id, subjectType: 'branch', subjectId: b.id, params: summary(rows, b.name), dedupeKey: `fees-overdue:${b.id}:${u.id}:${cycle}` });
      }
    }
  }
  return (await createNotifications(items, { now })).length;
}

/** Withdrawals of the last weeks handled again (idempotent), in case the hook did not run. */
async function sweepWithdrawals(schoolId, now) {
  const recent = await getPrisma().enrollment.findMany({ where: { schoolId, status: 'TRANSFERRED_OUT', endedAt: { gte: new Date(now.getTime() - 45 * DAY) } }, select: { studentId: true }, distinct: ['studentId'] });
  for (const r of recent) await afterWithdrawal(schoolId, r.studentId);
  return recent.length;
}

/**
 * The daily fee run for every school with Fee Management on: generation (catch-up, the current month,
 * retries of failed months), withdrawals, examination fees, overdue notices. A failing school is
 * reported and does not stop the others. `stop()` ends the run when the time budget is spent.
 */
export async function runFeeJobs({ now = new Date(), stop = () => false, schoolIds } = {}) {
  const prisma = getPrisma();
  const schools = await prisma.school.findMany({ where: { feesEnabled: true, status: 'ACTIVE', ...(schoolIds && { id: { in: schoolIds } }) }, select: { id: true } });
  const today = await calendarToday();
  const result = { schools: schools.length, generated: 0, examFees: 0, notices: 0, failures: [] };
  for (const s of schools) {
    if (stop()) {
      result.stopped = true;
      break;
    }
    try {
      const runs = await catchUpSchool(s.id, { now, today, backoffMs: 0 });
      result.generated += runs.reduce((n, r) => n + (r.created ?? 0), 0);
      await sweepWithdrawals(s.id, now);
      result.examFees += await syncSchoolExamFees(s.id);
      result.notices += await notifyOverdue(s.id, { now, today });
    } catch (error) {
      console.error(`[fees] daily run for school ${s.id} failed:`, error.message);
      result.failures.push({ schoolId: s.id, error: error.message });
    }
  }
  return result;
}

// ---- parent reminders -------------------------------------------------------------------------------

const digits = (phone) => (phone ?? '').replace(/[^\d+]/g, '').replace(/^\+/, '');

/** The guardians due a reminder (policy: first after N days overdue, then every M days), with a message to send. */
export async function parentReminders(scope) {
  const settings = await feeSettingsOf(scope.school.id);
  const today = await calendarToday();
  const school = await getPrisma().school.findUnique({ where: { id: scope.school.id }, select: { name: true } });
  const list = await overdueStudents(scope.school.id, settings, today, settings.parentFirstAfterDays, studentScope(scope).branchId ? { branchId: scope.branch.id } : {});
  const logs = list.length ? await getPrisma().feeReminderLog.findMany({ where: { studentId: { in: list.map((r) => r.student.id) } }, orderBy: { sentAt: 'desc' } }) : [];
  const items = list.map((r) => {
    const last = logs.find((l) => l.studentId === r.student.id) ?? null;
    const nextDue = last ? addDays(last.sentAt.toISOString().slice(0, 10), settings.parentRepeatDays) : today;
    const message = `${school.name}: Dear ${r.student.guardianName}, ${fullName(r.student)} (${r.student.studentNumber}) has school fees of ${formatMoney(r.amount, settings.currency)} overdue since ${r.oldest}. Please pay at the school office. Thank you.`;
    return {
      student: { id: r.student.id, name: fullName(r.student), studentNumber: r.student.studentNumber },
      guardian: { name: r.student.guardianName, phone: r.student.guardianPhone },
      amount: r.amount,
      oldestDue: r.oldest,
      daysOverdue: r.days,
      lastReminder: last ? { at: last.sentAt.toISOString(), channel: last.channel.toLowerCase(), by: last.sentByName } : null,
      due: nextDue <= today,
      nextDue,
      message,
      links: { whatsapp: `https://wa.me/${digits(r.student.guardianPhone)}?text=${encodeURIComponent(message)}`, sms: `sms:${r.student.guardianPhone}?body=${encodeURIComponent(message)}` },
    };
  });
  return { enabled: settings.parentReminders, currency: settings.currency, firstAfterDays: settings.parentFirstAfterDays, repeatDays: settings.parentRepeatDays, today, items };
}

export function readReminderLog(body) {
  const errors = {};
  if (!isUuid(body.student)) errors.student = 'Choose the student.';
  if (!['whatsapp', 'sms', 'call', 'other'].includes(body.channel)) errors.channel = 'Choose how it was sent.';
  if (body.note !== undefined && body.note !== null && (typeof body.note !== 'string' || body.note.length > 300)) errors.note = 'At most 300 characters.';
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return { studentId: body.student, channel: body.channel.toUpperCase(), note: body.note?.trim() || null };
}

/** Logs a reminder sent to a guardian (with the overdue amount at the time). */
export async function logReminder(scope, values, user, req) {
  const prisma = getPrisma();
  const student = await findScopedStudent(prisma, scope, values.studentId);
  const settings = await feeSettingsOf(scope.school.id);
  const open = await prisma.feeObligation.findMany({ where: { studentId: student.id, status: 'OPEN' }, select: { netAmount: true, paidAmount: true } });
  const amount = open.reduce((n, o) => n + o.netAmount - o.paidAmount, 0);
  const log = await prisma.feeReminderLog.create({ data: { schoolId: scope.school.id, studentId: student.id, channel: values.channel, amount, note: values.note, sentById: user.id, sentByName: user.name } });
  await recordAuditEvent({ action: AUDIT_ACTIONS.FEE_REMINDER_LOGGED, actor: actorOf(user), target: { type: 'student', id: student.id, name: `${fullName(student)} (${student.studentNumber})` }, schoolId: scope.school.id, description: `Fee reminder sent to the guardian by ${values.channel.toLowerCase()} (${formatMoney(amount, settings.currency)} owed).`, req });
  return { id: log.id };
}
