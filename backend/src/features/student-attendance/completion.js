import { badRequest, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { addDays, asDbDay, daysBetween, toDay } from '../academic-calendar/schoolDays.js';
import { parseDay } from '../academic-years/academicYearInput.js';
import { sectionDisplayName } from '../classes/classInput.js';
import { createNotifications } from '../notifications/notify.js';
import { platformNotificationSettings } from '../notifications/notificationSettings.service.js';
import { localDateTime } from '../../common/zonedTime.js';
import { uploadUntil } from './attendanceRules.js';
import { completionTotals, loadAttendanceDays } from './attendanceDays.js';

/*
 * Completion of student attendance and its notifications (docs/business-rules.md → Student
 * attendance → Completion and notifications). Everything is computed when read from the stored
 * sessions, marks and deadlines (attendanceDays.js); nothing is written when a deadline passes.
 *
 * Notifications (the scheduled notification job; idempotent through dedupe keys, catching up over
 * the last days, only for schools with Student Attendance switched on):
 *  - LESSON_ATTENDANCE_MISSING  to a lesson's teacher (the named one, else the section's teachers of
 *    that subject), once, after the lesson's deadline when its attendance was never taken, while
 *    offline marks can still be uploaded (setting teacherReminders).
 *  - STUDENT_ATTENDANCE_INCOMPLETE  to the branch's Managers, once per day, after the day's last
 *    deadline, when some sessions or lessons were not taken or not completed (setting managerAlerts).
 *  - STUDENT_ATTENDANCE_SUMMARY  to the School Owner, once per school day, after the digest hour of
 *    the next day: Manager sessions and lessons taken, and students present, absent, late, excused.
 * Recipients can turn the optional STUDENT_ATTENDANCE category off in their preferences.
 */

export const MAX_COMPLETION_DAYS = 31;
const NOTIFY_LOOKBACK_DAYS = 2;
const ATTENTION = ['missing', 'incomplete'];

// ---- the completion screen -----------------------------------------------------------------------

/** Query: from/to (default the last 7 days up to today, at most 31), branch (Owner). */
export function readCompletionQuery(query, { today, role }) {
  const single = (v) => (Array.isArray(v) ? v[0] : v);
  const errors = {};
  const to = single(query.to) || today;
  const from = single(query.from) || addDays(to, -6);
  if (!parseDay(from)) errors.from = '"from" must be a date (YYYY-MM-DD).';
  if (!parseDay(to)) errors.to = '"to" must be a date (YYYY-MM-DD).';
  if (!errors.from && !errors.to) {
    if (to < from) errors.to = '"to" cannot be before "from".';
    else if (daysBetween(from, to) + 1 > MAX_COMPLETION_DAYS) errors.to = `Ask for at most ${MAX_COMPLETION_DAYS} days at a time.`;
  }
  const branch = single(query.branch);
  if (branch) {
    if (role !== 'OWNER') errors.branch = 'Your branch is decided by your account.';
    else if (!isUuid(branch)) errors.branch = 'Choose a branch.';
  }
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return { from, to, branch: branch || undefined };
}

const add = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + b[k]]));
const emptyTotals = () => completionTotals([]);

/**
 * Completion by day and branch: for each, the totals of Manager sessions and of lessons, and the
 * items needing attention (missing or incomplete), newest day first. Owner: every branch or one;
 * Manager: their branch.
 */
export async function completion(scope, { from, to, branch: branchId }) {
  const prisma = getPrisma();
  const branches = scope.branch
    ? [{ id: scope.branch.id, name: scope.branch.name, code: scope.branch.code }]
    : await prisma.branch.findMany({ where: { schoolId: scope.school.id, ...(branchId && { id: branchId }) }, select: { id: true, name: true, code: true }, orderBy: { number: 'asc' } });
  if (branchId && !branches.length) throw notFound('Branch not found.');
  const { rows } = await loadAttendanceDays(scope.school.id, branches.map((b) => b.id), from, to, { client: prisma });
  const days = [];
  const total = { halves: emptyTotals(), lessons: emptyTotals() };
  for (let date = to; date >= from; date = addDays(date, -1)) {
    const dayRows = rows.filter((r) => r.date === date);
    const perBranch = branches
      .map((b) => {
        const mine = dayRows.filter((r) => r.section.branchId === b.id);
        const halves = completionTotals(mine.flatMap((r) => r.halves));
        const lessons = completionTotals(mine.flatMap((r) => r.lessons));
        const attention = mine.flatMap((r) => [
          ...r.halves.filter((h) => ATTENTION.includes(h.status)).map((h) => ({ section: { id: r.section.id, displayName: sectionDisplayName(r.section.class.name, r.section.name) }, kind: 'half_day', label: h.label, status: h.status, sessionId: h.session?.id ?? null, half: h.half })),
          ...r.lessons.filter((l) => ATTENTION.includes(l.status)).map((l) => ({ section: { id: r.section.id, displayName: sectionDisplayName(r.section.class.name, r.section.name) }, kind: 'lesson', label: `Period ${l.period} · ${l.subject.name}`, status: l.status, sessionId: l.session?.id ?? null, period: l.period, teacher: l.teacher })),
        ]);
        return { branch: b, halves, lessons, attention };
      })
      .filter((b) => b.halves.expected || b.lessons.expected);
    for (const b of perBranch) {
      total.halves = add(total.halves, b.halves);
      total.lessons = add(total.lessons, b.lessons);
    }
    days.push({ date, branches: perBranch });
  }
  return { from, to, today: await calendarToday(), totals: total, days };
}

// ---- notifications ---------------------------------------------------------------------------------

const studentCounts = (rows) => {
  const c = { present: 0, absent: 0, late: 0, excused: 0, notMarked: 0 };
  for (const r of rows) for (const h of r.halves) if (h.session) for (const k of Object.keys(c)) c[k] += h.session.counts[k];
  return c;
};
const clockText = (instant, timeZone) => {
  const l = localDateTime(instant, timeZone);
  return `${l.date} ${l.time}`;
};

/** The notification task (see the header). → { created }. `schoolIds` limits it (tests, operations). */
export async function studentAttendanceNotifications({ now = new Date(), schoolIds } = {}) {
  const prisma = getPrisma();
  const today = await calendarToday();
  const from = addDays(today, -NOTIFY_LOOKBACK_DAYS);
  const schools = await prisma.school.findMany({
    where: { studentAttendanceEnabled: true, status: 'ACTIVE', ...(schoolIds && { id: { in: schoolIds } }) },
    select: { id: true, name: true, ownerId: true, branches: { where: { status: 'ACTIVE' }, select: { id: true, name: true, code: true, managers: { where: { role: 'MANAGER', status: 'ACTIVE' }, select: { id: true } } }, orderBy: { number: 'asc' } } },
  });
  const { digestHour } = await platformNotificationSettings(prisma);
  let created = 0;
  for (const school of schools) {
    if (!school.branches.length) continue;
    const { rows, timeZone } = await loadAttendanceDays(school.id, school.branches.map((b) => b.id), from, today, { now, client: prisma });
    if (!rows.length) continue;
    const items = [];

    // Teachers: lessons never taken, after the deadline, while offline marks can still arrive.
    const assignments = await prisma.teachingAssignment.findMany({
      where: { schoolId: school.id, role: 'SUBJECT_TEACHER', cancelledAt: null, startDate: { lte: asDbDay(today) }, OR: [{ endDate: null }, { endDate: { gte: asDbDay(from) } }] },
      select: { sectionId: true, subjectId: true, teacherId: true, startDate: true, endDate: true },
    });
    for (const r of rows) {
      if (r.settings.teacherReminders === false) continue;
      for (const l of r.lessons) {
        if (l.status !== 'missing' || now > uploadUntil(l.deadlineAt, r.settings)) continue;
        const teacherIds = l.teacher
          ? [l.teacher.id]
          : assignments.filter((a) => a.sectionId === r.section.id && a.subjectId === l.subject.id && toDay(a.startDate) <= r.date && (!a.endDate || toDay(a.endDate) >= r.date)).map((a) => a.teacherId);
        const params = {
          date: r.date,
          section: sectionDisplayName(r.section.class.name, r.section.name),
          subject: l.subject.name,
          period: l.period,
          start: l.start,
          end: l.end,
          uploadUntil: clockText(uploadUntil(l.deadlineAt, r.settings), timeZone),
        };
        for (const teacherId of [...new Set(teacherIds)]) {
          items.push({ type: 'LESSON_ATTENDANCE_MISSING', recipientId: teacherId, schoolId: school.id, branchId: r.section.branchId, subjectType: 'section', subjectId: r.section.id, params, dedupeKey: `lesson-missing:${r.section.id}:${r.date}:${l.period}:${teacherId}` });
        }
      }
    }

    // Managers: a branch's day once everything in it is past its deadline, when something is left.
    for (const branch of school.branches) {
      for (let date = from; date <= today; date = addDays(date, 1)) {
        const mine = rows.filter((r) => r.date === date && r.section.branchId === branch.id);
        if (!mine.length || mine[0].settings.managerAlerts === false) continue;
        const all = mine.flatMap((r) => [...r.halves, ...r.lessons]);
        if (all.some((i) => ['upcoming', 'open', 'in_progress'].includes(i.status))) continue;
        const halves = completionTotals(mine.flatMap((r) => r.halves));
        const lessons = completionTotals(mine.flatMap((r) => r.lessons));
        if (!halves.missing && !halves.incomplete && !lessons.missing && !lessons.incomplete) continue;
        const sections = [...new Set(mine.filter((r) => [...r.halves, ...r.lessons].some((i) => ATTENTION.includes(i.status))).map((r) => sectionDisplayName(r.section.class.name, r.section.name)))];
        const params = { date, branch: { name: branch.name, code: branch.code }, halves, lessons, sections: sections.slice(0, 10), moreSections: Math.max(0, sections.length - 10) };
        for (const m of branch.managers) {
          items.push({ type: 'STUDENT_ATTENDANCE_INCOMPLETE', recipientId: m.id, schoolId: school.id, branchId: branch.id, subjectType: 'branch', subjectId: branch.id, params, dedupeKey: `sa-incomplete:${date}:${branch.id}:${m.id}` });
        }
      }
    }

    // The Owner: each school day, from the digest hour of the next day.
    if (school.ownerId) {
      const local = localDateTime(now, timeZone);
      for (let date = from; date < today; date = addDays(date, 1)) {
        if (date === addDays(today, -1) && local.minutes < digestHour * 60) continue;
        const dayRows = rows.filter((r) => r.date === date);
        const halves = completionTotals(dayRows.flatMap((r) => r.halves));
        const lessons = completionTotals(dayRows.flatMap((r) => r.lessons));
        if (!halves.expected && !lessons.expected) continue;
        const branches = school.branches
          .map((b) => ({ name: b.name, code: b.code, halves: completionTotals(dayRows.filter((r) => r.section.branchId === b.id).flatMap((r) => r.halves)), lessons: completionTotals(dayRows.filter((r) => r.section.branchId === b.id).flatMap((r) => r.lessons)) }))
          .filter((b) => b.halves.expected || b.lessons.expected);
        items.push({
          type: 'STUDENT_ATTENDANCE_SUMMARY',
          recipientId: school.ownerId,
          schoolId: school.id,
          subjectType: 'school',
          subjectId: school.id,
          params: { date, schoolName: school.name, halves, lessons, students: studentCounts(dayRows), branches },
          dedupeKey: `sa-summary:${date}:${school.id}`,
        });
      }
    }
    created += (await createNotifications(items, { now, client: prisma })).length;
  }
  return { created };
}
