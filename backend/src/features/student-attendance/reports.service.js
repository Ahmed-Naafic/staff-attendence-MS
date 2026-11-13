import { badRequest, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { addDays, asDbDay, daysBetween, toDay } from '../academic-calendar/schoolDays.js';
import { parseDay } from '../academic-years/academicYearInput.js';
import { sectionDisplayName } from '../classes/classInput.js';
import { completionTotals, loadAttendanceDays } from './attendanceDays.js';
import { effectiveStatus, HALF_FROM_DB, HALF_LABELS, STATUS_FROM_DB } from './attendanceRules.js';
import { activeExcuses } from './excuses.service.js';
import { excuseCoversSession } from './halfDay.service.js';

/*
 * Student attendance reports (docs/business-rules.md → Student attendance → Reports), read only.
 * Source: the Managers' daily sessions ('manager', the school's daily attendance; default) or the
 * teachers' lessons ('lessons', optionally one subject). Excuses are applied here, when read: an
 * absent or unmarked student who was excused counts as excused.
 *
 * Attendance rate = (present + late) / (present + late + absent). Excused and unmarked students are
 * left out (never counted as absent); a student with nothing counted has no rate. Sessions that were
 * never taken have no marks: they appear in each section's completion (taken / expected), not in
 * students' figures. Owner: every branch or one; Manager: their branch. At most 93 days at a time.
 */

export const MAX_REPORT_DAYS = 93;
export const SOURCES = ['manager', 'lessons'];
const KINDS = { manager: 'HALF_DAY', lessons: 'LESSON' };

const single = (v) => (Array.isArray(v) ? v[0] : v);

/** Filters: from/to (default this month to today), source, branch (Owner), section, class, subject (lessons), below (rate %), page. */
export function readReportQuery(query, { today, role }) {
  const errors = {};
  const to = single(query.to) || today;
  const from = single(query.from) || `${to.slice(0, 8)}01`;
  if (!parseDay(from)) errors.from = '"from" must be a date (YYYY-MM-DD).';
  if (!parseDay(to)) errors.to = '"to" must be a date (YYYY-MM-DD).';
  if (!errors.from && !errors.to) {
    if (to < from) errors.to = '"to" cannot be before "from".';
    else if (daysBetween(from, to) + 1 > MAX_REPORT_DAYS) errors.to = `Ask for at most ${MAX_REPORT_DAYS} days at a time.`;
  }
  const source = single(query.source) || 'manager';
  if (!SOURCES.includes(source)) errors.source = `Choose one of: ${SOURCES.join(', ')}.`;
  const id = (name, label) => {
    const value = single(query[name]);
    if (!value) return undefined;
    if (!isUuid(value)) errors[name] = `Choose a ${label}.`;
    return value;
  };
  const branch = id('branch', 'branch');
  if (branch && role !== 'OWNER') errors.branch = 'Your branch is decided by your account.';
  const section = id('section', 'section');
  const classId = id('class', 'class');
  const subject = id('subject', 'subject');
  if (subject && source !== 'lessons') errors.subject = 'Subjects apply to lesson attendance.';
  let below;
  if (single(query.below)) {
    below = Number(single(query.below));
    if (!Number.isFinite(below) || below <= 0 || below > 100) errors.below = 'Enter a percentage from 1 to 100.';
  }
  const page = Number(single(query.page) ?? 1);
  const pageSize = Number(single(query.pageSize) ?? 25);
  if (!Number.isInteger(page) || page < 1) errors.page = 'Invalid page.';
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) errors.pageSize = 'Page size must be 1–200.';
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return { from, to, source, branch, section, classId, subject, below, page, pageSize };
}

const emptyCounts = () => ({ present: 0, late: 0, absent: 0, excused: 0, notMarked: 0, total: 0 });
const tally = (counts, effective) => {
  counts.total += 1;
  if (effective === 'pending' || effective === 'not_marked') counts.notMarked += 1;
  else counts[effective] += 1;
};
/** Attendance rate (%, one decimal) or null when nothing counts. */
export const attendanceRate = (c) => {
  const counted = c.present + c.late + c.absent;
  return counted ? Math.round(((c.present + c.late) / counted) * 1000) / 10 : null;
};
const studentName = (s) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' ');

async function branchesOf(prisma, scope, branchId) {
  if (scope.branch) return [{ id: scope.branch.id, name: scope.branch.name, code: scope.branch.code }];
  const rows = await prisma.branch.findMany({ where: { schoolId: scope.school.id, ...(branchId && { id: branchId }) }, select: { id: true, name: true, code: true }, orderBy: { number: 'asc' } });
  if (branchId && !rows.length) throw notFound('Branch not found.');
  return rows;
}

/**
 * The whole report (every student; callers page or export it): { filters, branches, totals,
 * sections: [...], students: [...] (lowest rate first), subjects, classes }.
 */
export async function buildReport(scope, filters) {
  const prisma = getPrisma();
  const { from, to, source, section, classId, subject } = filters;
  const branches = await branchesOf(prisma, scope, filters.branch);
  const branchIds = branches.map((b) => b.id);
  const now = new Date();
  const [entries, days] = await Promise.all([
    prisma.studentAttendanceEntry.findMany({
      where: {
        schoolId: scope.school.id,
        branchId: { in: branchIds },
        session: {
          kind: KINDS[source],
          date: { gte: asDbDay(from), lte: asDbDay(to) },
          ...(section && { sectionId: section }),
          ...(classId && { section: { classId } }),
          ...(subject && { subjectId: subject }),
        },
      },
      select: { studentId: true, status: true, session: { select: { kind: true, date: true, half: true, periodNumber: true, deadlineAt: true, sectionId: true, subjectId: true } } },
    }),
    loadAttendanceDays(scope.school.id, branchIds, from, to, { now, client: prisma }),
  ]);
  const studentIds = [...new Set(entries.map((e) => e.studentId))];
  const [students, excuses] = await Promise.all([
    studentIds.length ? prisma.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, studentNumber: true, firstName: true, middleName: true, lastName: true, gender: true, branchId: true } }) : [],
    activeExcuses(prisma, scope.school.id, studentIds, from, to),
  ]);
  const studentById = new Map(students.map((s) => [s.id, s]));

  // Sections: completion from the expected sessions, marks from the entries.
  const rows = days.rows.filter((r) => (!section || r.section.id === section) && (!classId || r.section.classId === classId));
  const sectionMap = new Map();
  const sectionOf = (s) => {
    if (!sectionMap.has(s.id)) {
      sectionMap.set(s.id, { section: { id: s.id, displayName: sectionDisplayName(s.class.name, s.name), classId: s.classId, branch: { id: s.branch.id, name: s.branch.name } }, counts: emptyCounts(), completion: completionTotals([]), items: [] });
    }
    return sectionMap.get(s.id);
  };
  for (const r of rows) {
    const items = source === 'manager' ? r.halves : r.lessons.filter((l) => !subject || l.subject.id === subject);
    if (items.length) sectionOf(r.section).items.push(...items);
  }
  for (const s of sectionMap.values()) {
    s.completion = completionTotals(s.items);
    delete s.items;
  }
  const sectionById = new Map(rows.map((r) => [r.section.id, r.section]));

  const perStudent = new Map();
  const totals = emptyCounts();
  for (const e of entries) {
    const date = toDay(e.session.date);
    const excused = (excuses.get(e.studentId) ?? []).some((x) => excuseCoversSession(x, date, e.session));
    const effective = effectiveStatus(STATUS_FROM_DB[e.status], { excused, overdue: now > e.session.deadlineAt });
    tally(totals, effective);
    if (!perStudent.has(e.studentId)) perStudent.set(e.studentId, { counts: emptyCounts(), sectionIds: new Set() });
    const p = perStudent.get(e.studentId);
    tally(p.counts, effective);
    p.sectionIds.add(e.session.sectionId);
    const sec = sectionById.get(e.session.sectionId);
    if (sec) tally(sectionOf(sec).counts, effective);
  }
  const studentRows = [...perStudent.entries()]
    .map(([id, p]) => {
      const s = studentById.get(id);
      const secs = [...p.sectionIds].map((sid) => sectionById.get(sid)).filter(Boolean);
      return {
        student: { id, number: s.studentNumber, name: studentName(s), gender: s.gender.toLowerCase() },
        sections: secs.map((x) => sectionDisplayName(x.class.name, x.name)),
        branch: secs[0] ? secs[0].branch.name : null,
        counts: p.counts,
        rate: attendanceRate(p.counts),
      };
    })
    .filter((r) => filters.below === undefined || (r.rate !== null && r.rate < filters.below))
    .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || a.student.name.localeCompare(b.student.name));

  const sections = [...sectionMap.values()].map((s) => ({ ...s, rate: attendanceRate(s.counts) })).sort((a, b) => a.section.branch.name.localeCompare(b.section.branch.name) || a.section.displayName.localeCompare(b.section.displayName));
  const subjects = source === 'lessons' ? [...new Map(days.rows.flatMap((r) => r.lessons.map((l) => [l.subject.id, l.subject]))).values()].sort((a, b) => a.name.localeCompare(b.name)) : [];
  const allSections = [...new Map(days.rows.map((r) => [r.section.id, { id: r.section.id, displayName: sectionDisplayName(r.section.class.name, r.section.name), classId: r.section.classId, branchId: r.section.branchId }])).values()];
  const classes = [...new Map(days.rows.map((r) => [r.section.class.id, { id: r.section.class.id, name: r.section.class.name, sequence: r.section.class.sequence }])).values()].sort((a, b) => a.sequence - b.sequence);
  const completion = completionTotals(rows.flatMap((r) => (source === 'manager' ? r.halves : r.lessons.filter((l) => !subject || l.subject.id === subject))));
  return {
    filters: { from, to, source, branch: filters.branch ?? null, section: section ?? null, class: classId ?? null, subject: subject ?? null, below: filters.below ?? null },
    branches,
    totals: { ...totals, rate: attendanceRate(totals), students: perStudent.size, completion },
    sections,
    students: studentRows,
    options: { sections: allSections, classes, subjects },
  };
}

/** The report screen: the report with one page of students. */
export async function studentAttendanceReport(scope, filters) {
  const report = await buildReport(scope, filters);
  const { page, pageSize } = filters;
  const total = report.students.length;
  return { ...report, today: await calendarToday(), students: { items: report.students.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, pageCount: Math.ceil(total / pageSize) } };
}

/** One student's attendance from..to: each Manager session and lesson with its mark and what it counts as. */
export async function studentAttendanceHistory(scope, studentId, { from, to }) {
  const prisma = getPrisma();
  const student = isUuid(studentId)
    ? await prisma.student.findFirst({ where: { id: studentId, schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) }, select: { id: true, studentNumber: true, firstName: true, middleName: true, lastName: true } })
    : null;
  if (!student) throw notFound('Student not found.');
  const now = new Date();
  const [entries, excuses] = await Promise.all([
    prisma.studentAttendanceEntry.findMany({
      where: { studentId: student.id, schoolId: scope.school.id, session: { date: { gte: asDbDay(from), lte: asDbDay(to) } } },
      select: {
        status: true,
        reason: true,
        markedByName: true,
        markedAt: true,
        session: { select: { id: true, kind: true, date: true, half: true, periodNumber: true, deadlineAt: true, subject: { select: { name: true } }, section: { select: { name: true, class: { select: { name: true } } } } } },
      },
    }),
    activeExcuses(prisma, scope.school.id, [student.id], from, to),
  ]);
  const items = entries
    .map((e) => {
      const date = toDay(e.session.date);
      const excuse = (excuses.get(student.id) ?? []).find((x) => excuseCoversSession(x, date, e.session)) ?? null;
      const status = STATUS_FROM_DB[e.status] ?? null;
      return {
        sessionId: e.session.id,
        date,
        kind: e.session.kind === 'LESSON' ? 'lesson' : 'half_day',
        label: e.session.kind === 'LESSON' ? `Period ${e.session.periodNumber} · ${e.session.subject?.name ?? 'Lesson'}` : HALF_LABELS[HALF_FROM_DB[e.session.half]],
        order: e.session.kind === 'LESSON' ? 10 + e.session.periodNumber : { WHOLE_DAY: 0, BEFORE_BREAK: 1, AFTER_BREAK: 9 }[e.session.half],
        section: sectionDisplayName(e.session.section.class.name, e.session.section.name),
        status,
        effective: effectiveStatus(status, { excused: Boolean(excuse), overdue: now > e.session.deadlineAt }),
        reason: e.reason,
        excuse: excuse ? excuse.reason : null,
        markedBy: e.markedByName,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.order - b.order)
    .map(({ order: _order, ...rest }) => rest);
  const counts = { manager: emptyCounts(), lessons: emptyCounts() };
  for (const i of items) tally(counts[i.kind === 'lesson' ? 'lessons' : 'manager'], i.effective);
  return {
    student: { id: student.id, number: student.studentNumber, name: studentName(student) },
    from,
    to,
    summary: { manager: { ...counts.manager, rate: attendanceRate(counts.manager) }, lessons: { ...counts.lessons, rate: attendanceRate(counts.lessons) } },
    items,
  };
}

/** One student's history range: from/to (default the last 30 days), at most 93 days. */
export function readHistoryQuery(query, { today }) {
  const to = single(query.to) || today;
  const from = single(query.from) || addDays(to, -29);
  const errors = {};
  if (!parseDay(from)) errors.from = '"from" must be a date (YYYY-MM-DD).';
  if (!parseDay(to)) errors.to = '"to" must be a date (YYYY-MM-DD).';
  if (!errors.from && !errors.to && (to < from || daysBetween(from, to) + 1 > MAX_REPORT_DAYS)) errors.to = `Choose a range of at most ${MAX_REPORT_DAYS} days.`;
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return { from, to };
}
