import { badRequest, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { zonedInstant } from '../../common/zonedTime.js';
import { getPrisma } from '../../config/prisma.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { platformTimeZone } from '../platform-settings/settings.service.js';
import { getExamOverview } from '../examinations/examConfig.service.js';
import { feeOverview } from '../fees/feeReports.service.js';
import { feeSettingsOf } from '../fees/feeSettings.js';
import { fullName, paymentInclude, toPayment } from '../fees/feeAccounts.service.js';
import { addDays, fromDbDate, monthsBetween, monthShort } from '../fees/feeRules.js';
import { dayOverview } from '../student-attendance/halfDay.service.js';
import { loadSectionDays } from '../timetable/lessons.js';
import { minutesToTime } from '../timetable/bellTimes.js';

/*
 * The School Owner's and the Managers' dashboards (read only). One service, two scopes:
 *   OWNER    scope.branch null: the whole school, or one branch of it (`branch` filter, checked here);
 *   MANAGER  scope.branch set from the account (requireManagerBranch): only that branch, whatever the
 *            request says (the reader ignores a `branch` filter for Managers).
 * Every figure is read from the records of the modules (enrollments, staff, sections, fee obligations
 * and payments, attendance sessions, examinations); the fee figures come from Fee Management's own
 * overview and branch report, so they match its pages. A module the school does not have switched on
 * answers `null` (the page explains), never zeros.
 */

const YEAR_STATUS = { CURRENT: 'current', CLOSED: 'closed', PLANNED: 'planned', UPCOMING: 'upcoming' };
const STUDENT_STATUSES = ['ENROLLED', 'PENDING_ENROLLMENT', 'TRANSFERRED_OUT', 'GRADUATED'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Filters from the query string. A Manager's `branch` is ignored (their branch comes from the account). */
export function readDashboardQuery(query, { role }) {
  const one = (k) => {
    const v = Array.isArray(query[k]) ? query[k][0] : query[k];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  const out = { academicYear: one('academicYear') ?? 'current', branch: role === 'OWNER' ? one('branch') : undefined, from: one('from'), to: one('to') };
  const errors = {};
  if (out.academicYear !== 'current' && !isUuid(out.academicYear)) errors.academicYear = 'Choose from the list.';
  if (out.branch && !isUuid(out.branch)) errors.branch = 'Choose from the list.';
  for (const k of ['from', 'to']) if (out[k] && (!DAY.test(out[k]) || Number.isNaN(Date.parse(`${out[k]}T00:00:00Z`)))) errors[k] = 'Choose a date.';
  if (!errors.from && !errors.to && out.from && out.to && out.from > out.to) errors.to = 'The end date is before the start date.';
  if (Object.keys(errors).length) throw badRequest('Check the filters.', errors);
  return out;
}

const pct = (part, whole) => (whole > 0 ? Math.round((part * 1000) / whole) / 10 : 0);

/** The dashboard of `scope` ({ school, branch, role, user }) with the filters `f`. */
export async function schoolDashboard(scope, f) {
  const prisma = getPrisma();
  const owner = scope.role === 'OWNER';
  const [school, today, tz] = await Promise.all([
    prisma.school.findUnique({ where: { id: scope.school.id }, select: { id: true, name: true, feesEnabled: true, examinationsEnabled: true, studentAttendanceEnabled: true } }),
    calendarToday(),
    platformTimeZone(),
  ]);

  // Branches the viewer may see; the Owner's filter must be one of their school's.
  const branches = await prisma.branch.findMany({ where: { schoolId: school.id, ...(scope.branch && { id: scope.branch.id }) }, orderBy: { number: 'asc' }, select: { id: true, name: true, code: true, status: true } });
  let selected = scope.branch ? branches[0] : null;
  if (owner && f.branch) {
    selected = branches.find((b) => b.id === f.branch);
    if (!selected) throw notFound('Branch not found.');
  }
  const branchId = selected?.id ?? null;
  const inBranch = branchId ? { branchId } : {};

  const years = await prisma.academicYear.findMany({ where: { schoolId: school.id }, orderBy: { startDate: 'desc' }, select: { id: true, name: true, status: true, startDate: true, endDate: true } });
  const year = f.academicYear === 'current' ? (years.find((y) => y.status === 'CURRENT') ?? null) : years.find((y) => y.id === f.academicYear);
  if (f.academicYear !== 'current' && !year) throw notFound('Academic year not found.');

  const base = {
    role: scope.role,
    today,
    school: { id: school.id, name: school.name },
    branch: selected ? { id: selected.id, name: selected.name } : null,
    filters: {
      academicYears: years.map((y) => ({ id: y.id, name: y.name, status: YEAR_STATUS[y.status] ?? y.status.toLowerCase(), startDate: fromDbDate(y.startDate), endDate: fromDbDate(y.endDate) })),
      branches: owner ? branches.map((b) => ({ id: b.id, name: b.name, status: b.status.toLowerCase() })) : [],
    },
    academicYear: year ? { id: year.id, name: year.name, status: YEAR_STATUS[year.status] ?? year.status.toLowerCase(), startDate: fromDbDate(year.startDate), endDate: fromDbDate(year.endDate), current: year.status === 'CURRENT' } : null,
    modules: { fees: school.feesEnabled, examinations: school.examinationsEnabled, studentAttendance: school.studentAttendanceEnabled },
  };
  if (!year) return { ...base, kpis: null, fees: null };

  const yearCurrent = year.status === 'CURRENT';
  // Students of the year: still enrolled (current year) or enrolled at any time (another year).
  const enrolledWhere = { schoolId: school.id, academicYearId: year.id, ...inBranch, ...(yearCurrent && { status: 'ACTIVE' }) };
  const previousYear = years.find((y) => y.startDate < year.startDate) ?? null;

  const scopeFor = { school: scope.school, branch: scope.branch, role: scope.role, user: scope.user };
  const feeFilters = { academicYear: year.id, branch: owner ? (branchId ?? undefined) : undefined, from: f.from, to: f.to, status: 'all', kind: 'all' };
  // Everything is independent: started together (each overview runs once and is shared).
  const feesP = school.feesEnabled ? feeOverview(scopeFor, feeFilters) : Promise.resolve(null);
  const examOverviewP = school.examinationsEnabled ? getExamOverview({ school: scope.school, branch: scope.branch }) : Promise.resolve(null);
  const dayP = !owner && school.studentAttendanceEnabled ? dayOverview(scopeFor, { date: today }) : Promise.resolve(null);
  const sectionsP = prisma.section.findMany({ where: { schoolId: school.id, academicYearId: year.id, status: 'ACTIVE', ...inBranch }, select: { id: true, branchId: true, classId: true } });
  const shared = { prisma, school, scope: scopeFor, year, today, tz, branchId, inBranch, f, feesP, examOverviewP, dayP };

  const [students, studentsAllYear, studentsPrevious, staff, sections, branchesActive, fees, examinations, alerts, extra] = await Promise.all([
    prisma.enrollment.count({ where: enrolledWhere }),
    prisma.enrollment.count({ where: { schoolId: school.id, academicYearId: year.id, ...inBranch } }),
    previousYear ? prisma.enrollment.count({ where: { schoolId: school.id, academicYearId: previousYear.id, ...inBranch } }) : null,
    prisma.user.count({ where: { role: 'STAFF', status: 'ACTIVE', branch: { schoolId: school.id }, ...inBranch } }),
    sectionsP,
    prisma.branch.count({ where: { schoolId: school.id, status: 'ACTIVE' } }),
    feesP,
    examinationsOf(shared),
    alertsOf(shared),
    owner
      ? Promise.all([enrollmentTrendOf(shared), studentsByBranchOf(shared, branches), school.feesEnabled ? branchPerformanceOf(shared) : null, recentActivityOf(shared)])
      : Promise.all([
          studentStatusOf(shared),
          school.studentAttendanceEnabled ? attendanceTodayOf(shared) : null,
          sectionsP.then((list) => todayActivitiesOf(shared, list)),
          school.feesEnabled ? recentPaymentsOf(shared) : null,
          school.feesEnabled ? dailySummaryOf(shared) : null,
        ]),
  ]);

  const kpis = {
    students: { value: students, enrolledInYear: studentsAllYear, previousYear: studentsPrevious, changePercent: studentsPrevious ? pct(studentsAllYear - studentsPrevious, studentsPrevious) : null },
    staff: { value: staff },
    classes: { value: new Set(sections.map((s) => s.classId)).size },
    sections: { value: sections.length },
    branches: owner ? { value: branchId ? 1 : branchesActive } : undefined,
    fees: fees?.kpis ? { currency: fees.currency, expected: fees.kpis.expected, collected: fees.kpis.collected, outstanding: fees.kpis.outstanding, overdue: fees.kpis.overdue, rate: fees.kpis.rate / 100 } : null,
  };
  const feeTrend = fees ? fees.trend.map((m) => ({ month: m.month, label: m.label, expected: m.expected, collected: m.collected })) : [];
  const common = { ...base, kpis, fees: fees && feeBlock(fees), feeTrend, examinations, alerts };

  if (owner) {
    const [enrollmentTrend, studentsByBranch, branchPerformance, recentActivity] = extra;
    return { ...common, enrollmentTrend, studentsByBranch, branchPerformance, recentActivity };
  }
  const [studentStatus, attendanceToday, todayActivities, recentPayments, dailySummary] = extra;
  return { ...common, studentStatus, attendanceToday, recentPayments, todayActivities, dailySummary };
}

const feeBlock = (fees) => ({ currency: fees.currency, overdueStudents: fees.overdueCount, statusCounts: fees.statusCounts, receivedToday: fees.kpis?.receivedToday ?? 0, paymentsToday: fees.kpis?.paymentsToday ?? 0 });

// ---- Owner ---------------------------------------------------------------------------------------------

/** Students enrolled at the end of each month of the year (to today), and new enrollments that month. */
async function enrollmentTrendOf({ prisma, school, year, today, tz, branchId }) {
  const last = [fromDbDate(year.endDate), today].sort()[0];
  const months = monthsBetween(fromDbDate(year.startDate), last);
  if (!months.length) return [];
  // Timestamps are stored as UTC wall time ("timestamp without time zone"): sent as ISO text.
  const ends = months.map((m, i) => (i === months.length - 1 && last === today ? zonedInstant(addDays(today, 1), 0, tz) : zonedInstant(nextMonth(m), 0, tz)).toISOString());
  const starts = months.map((m) => zonedInstant(m, 0, tz).toISOString());
  const rows = await prisma.$queryRaw`
    SELECT m.i::int AS i,
           COUNT(e."id") FILTER (WHERE e."enrolledAt" < m.ends AND (e."endedAt" IS NULL OR e."endedAt" >= m.ends))::int AS "enrolled",
           COUNT(e."id") FILTER (WHERE e."enrolledAt" >= m.starts AND e."enrolledAt" < m.ends AND e."entry" = 'NEW')::int AS "joined"
    FROM unnest(${starts}::text[]::timestamp[], ${ends}::text[]::timestamp[]) WITH ORDINALITY AS m(starts, ends, i)
    LEFT JOIN "Enrollment" e ON e."schoolId" = ${school.id} AND e."academicYearId" = ${year.id}
      AND (${branchId}::text IS NULL OR e."branchId" = ${branchId})
    GROUP BY m.i ORDER BY m.i`;
  return months.map((m, i) => ({ month: m, label: monthShort(m), enrolled: rows[i]?.enrolled ?? 0, joined: rows[i]?.joined ?? 0 }));
}

const nextMonth = (m) => {
  const d = new Date(`${m.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
};

async function studentsByBranchOf({ prisma, school, year, branchId }, branches) {
  const rows = await prisma.enrollment.groupBy({ by: ['branchId'], where: { schoolId: school.id, academicYearId: year.id, ...(year.status === 'CURRENT' && { status: 'ACTIVE' }), ...(branchId && { branchId }) }, _count: { _all: true } });
  const total = rows.reduce((n, r) => n + r._count._all, 0);
  return branches
    .map((b) => ({ id: b.id, name: b.name, students: rows.find((r) => r.branchId === b.id)?._count._all ?? 0 }))
    .filter((b) => !branchId || b.id === branchId)
    .map((b) => ({ ...b, percent: pct(b.students, total) }));
}

/**
 * Branch comparison of fees in one aggregate query, by the same rules as Fee Management's totals
 * (feeAccounts.service.js totalsOf; Fee Reports → Branch comparison): cancelled fees left out;
 * expected = net amounts, collected = paid amounts, overdue = open balances past the due date and
 * the school's grace days. Branch = where the fee was charged. Filters: year, due-date range.
 */
async function branchPerformanceOf({ prisma, school, year, f, today, branchId }) {
  const settings = await feeSettingsOf(school.id);
  const cutoff = addDays(today, -settings.overdueGraceDays);
  const from = f.from ?? null;
  const to = f.to ?? null;
  const rows = await prisma.$queryRaw`
    SELECT b."id", b."name",
           COUNT(DISTINCT o."studentId")::int AS "students",
           COALESCE(SUM(o."netAmount"), 0)::bigint AS "expected",
           COALESCE(SUM(o."paidAmount"), 0)::bigint AS "collected",
           COALESCE(SUM(CASE WHEN o."status" = 'OPEN' AND o."netAmount" > o."paidAmount" AND o."dueDate" < ${cutoff}::date THEN o."netAmount" - o."paidAmount" ELSE 0 END), 0)::bigint AS "overdue"
    FROM "Branch" b
    LEFT JOIN "FeeObligation" o ON o."branchId" = b."id" AND o."academicYearId" = ${year.id} AND o."status" <> 'CANCELLED'
      AND (${from}::date IS NULL OR o."dueDate" >= ${from}::date) AND (${to}::date IS NULL OR o."dueDate" <= ${to}::date)
    WHERE b."schoolId" = ${school.id}
    GROUP BY b."id", b."name", b."number" ORDER BY b."number"`;
  const list = rows
    .map((r) => ({ id: r.id, name: r.name, students: r.students, expected: Number(r.expected), collected: Number(r.collected), overdue: Number(r.overdue) }))
    .filter((r) => r.expected > 0 || r.students > 0)
    .map((r) => ({ ...r, outstanding: r.expected - r.collected, rate: pct(r.collected, r.expected), selected: r.id === branchId }));
  const sum = (k) => list.reduce((n, r) => n + r[k], 0);
  return {
    currency: settings.currency,
    rows: list,
    totals: list.length ? { students: sum('students'), expected: sum('expected'), collected: sum('collected'), outstanding: sum('outstanding'), rate: pct(sum('collected'), sum('expected')) } : null,
  };
}

/**
 * Recent events of the school (or the chosen branch), from the records themselves (so the branch
 * filter applies): new enrollments, payments, invoices (a bulk run counts once), fee structure changes
 * (school-wide: only without a branch filter), promotions, examinations scheduled and results published.
 */
async function recentActivityOf({ prisma, school, branchId, inBranch, f, tz }) {
  const fees = school.feesEnabled;
  const take = 8;
  const when = (field) => ((f.from || f.to) ? { [field]: { ...(f.from && { gte: zonedInstant(f.from, 0, tz) }), ...(f.to && { lt: zonedInstant(addDays(f.to, 1), 0, tz) }) } } : {});
  const examVisible = { schoolId: school.id, ...(branchId && { OR: [{ branchId: null }, { branchId }] }) };
  const [enrollments, payments, invoices, structures, promotions, scheduled, published] = await Promise.all([
    prisma.enrollment.findMany({ where: { schoolId: school.id, entry: 'NEW', ...inBranch, ...when('enrolledAt') }, orderBy: { enrolledAt: 'desc' }, take, select: { enrolledAt: true, student: { select: { id: true, firstName: true, middleName: true, lastName: true } }, section: { select: { name: true, class: { select: { name: true } } } }, branch: { select: { name: true } } } }),
    fees ? prisma.feePayment.findMany({ where: { schoolId: school.id, status: 'RECORDED', ...inBranch, ...when('receivedAt') }, orderBy: { receivedAt: 'desc' }, take, select: { id: true, amount: true, receivedAt: true, recordedByName: true, student: { select: { id: true, firstName: true, middleName: true, lastName: true } } } }) : [],
    fees ? prisma.feeInvoice.findMany({ where: { schoolId: school.id, ...inBranch, ...when('createdAt') }, orderBy: { createdAt: 'desc' }, take: 60, select: { id: true, number: true, batchId: true, createdAt: true, student: { select: { firstName: true, middleName: true, lastName: true } } } }) : [],
    fees && !branchId ? prisma.auditEvent.findMany({ where: { schoolId: school.id, result: 'SUCCESS', action: { in: ['FEE_STRUCTURE_CREATED', 'FEE_STRUCTURE_UPDATED'] }, ...when('occurredAt') }, orderBy: { occurredAt: 'desc' }, take, select: { id: true, action: true, targetName: true, occurredAt: true, actorName: true } }) : [],
    prisma.promotionBatch.findMany({ where: { schoolId: school.id, confirmedAt: { not: null }, ...inBranch, ...when('confirmedAt') }, orderBy: { confirmedAt: 'desc' }, take, select: { id: true, confirmedAt: true, confirmedByName: true, branch: { select: { name: true } }, fromYear: { select: { name: true } }, toYear: { select: { name: true } }, _count: { select: { items: true } } } }),
    prisma.examination.findMany({ where: { ...examVisible, scheduledAt: { not: null }, status: { not: 'CANCELLED' }, ...when('scheduledAt') }, orderBy: { scheduledAt: 'desc' }, take, select: { id: true, name: true, scheduledAt: true, startDate: true } }),
    prisma.examResultSet.groupBy({ by: ['examinationId'], where: { schoolId: school.id, status: 'PUBLISHED', publishedAt: { not: null }, ...inBranch, ...when('publishedAt') }, _max: { publishedAt: true }, _count: { _all: true }, orderBy: { _max: { publishedAt: 'desc' } }, take }),
  ]);
  const examNames = new Map((await prisma.examination.findMany({ where: { id: { in: published.map((p) => p.examinationId) } }, select: { id: true, name: true } })).map((e) => [e.id, e.name]));

  // A bulk run of invoices is one event.
  const invoiceEvents = [];
  const batches = new Map();
  for (const inv of invoices) {
    if (inv.batchId) {
      const b = batches.get(inv.batchId);
      if (b) b.count += 1;
      else {
        const e = { kind: 'invoice', at: inv.createdAt, count: 1, number: inv.number, student: inv.student, batch: true };
        batches.set(inv.batchId, e);
        invoiceEvents.push(e);
      }
    } else invoiceEvents.push({ kind: 'invoice', at: inv.createdAt, count: 1, number: inv.number, student: inv.student, batch: false });
  }

  const items = [
    ...enrollments.map((e) => ({ type: 'enrollment', at: e.enrolledAt, title: `${fullName(e.student)} enrolled in ${e.section.class.name} ${e.section.name}`, detail: e.branch.name, link: `/students/${e.student.id}` })),
    ...payments.map((p) => ({ type: 'payment', at: p.receivedAt, title: `Payment recorded for ${fullName(p.student)}`, amount: p.amount, detail: p.recordedByName, link: `/fees/payments?payment=${p.id}` })),
    ...invoiceEvents.map((e) => ({ type: 'invoice', at: e.at, title: e.batch && e.count > 1 ? `${e.count} invoices generated` : `Invoice ${e.number ?? ''} generated for ${fullName(e.student)}`.replace('  ', ' '), detail: null, link: '/fees/invoices' })),
    ...structures.map((s) => ({ type: 'fee-structure', at: s.occurredAt, title: `Fee structure ${s.action === 'FEE_STRUCTURE_CREATED' ? 'added' : 'updated'}${s.targetName ? ` for ${s.targetName}` : ''}`, detail: s.actorName, link: '/fees/structures' })),
    ...promotions.map((p) => ({ type: 'promotion', at: p.confirmedAt, title: `${p._count.items} students promoted from ${p.fromYear.name} to ${p.toYear.name}`, detail: p.branch.name, link: `/promotions/${p.id}` })),
    ...scheduled.map((e) => ({ type: 'examination', at: e.scheduledAt, title: `Examination ${e.name} scheduled`, detail: `Starts ${fromDbDate(e.startDate)}`, link: `/examinations/list/${e.id}` })),
    ...published.map((p) => ({ type: 'results', at: p._max.publishedAt, title: `Results of ${examNames.get(p.examinationId) ?? 'an examination'} published`, detail: `${p._count._all} section${p._count._all === 1 ? '' : 's'}`, link: '/examinations/results' })),
  ];
  return items
    .filter((i) => i.at)
    .sort((a, b) => b.at - a.at)
    .slice(0, take)
    .map((i) => ({ ...i, at: i.at.toISOString() }));
}

// ---- Manager -------------------------------------------------------------------------------------------

/** The branch's students by their lifecycle status (Student.status; their current branch). */
async function studentStatusOf({ prisma, school, branchId }) {
  const rows = await prisma.student.groupBy({ by: ['status'], where: { schoolId: school.id, ...(branchId && { branchId }) }, _count: { _all: true } });
  const total = rows.reduce((n, r) => n + r._count._all, 0);
  return { total, items: STUDENT_STATUSES.map((s) => ({ status: s.toLowerCase(), count: rows.find((r) => r.status === s)?._count._all ?? 0 })).map((x) => ({ ...x, percent: pct(x.count, total) })) };
}

/**
 * Today's student attendance (Manager sessions): each section's latest session of the day counts once
 * (a school taking it before and after the break does not count students twice). Present includes late.
 */
async function attendanceTodayOf({ prisma, school, today, branchId, dayP }) {
  const overview = await dayP;
  const sessions = await prisma.studentAttendanceSession.findMany({ where: { schoolId: school.id, kind: 'HALF_DAY', date: new Date(`${today}T00:00:00Z`), ...(branchId && { branchId }) }, select: { id: true, sectionId: true, startsAt: true, openedAt: true }, orderBy: [{ startsAt: 'desc' }, { openedAt: 'desc' }] });
  const latest = new Map();
  for (const s of sessions) if (!latest.has(s.sectionId)) latest.set(s.sectionId, s.id);
  const counts = latest.size ? await prisma.studentAttendanceEntry.groupBy({ by: ['status'], where: { sessionId: { in: [...latest.values()] } }, _count: { _all: true } }) : [];
  const n = (s) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const present = n('PRESENT');
  const late = n('LATE');
  const absent = n('ABSENT');
  const excused = n('EXCUSED');
  const marked = present + late + absent + excused;
  const schoolDay = overview.items.some((i) => i.schoolDay);
  const reason = schoolDay ? null : (overview.items.find((i) => i.reasonText)?.reasonText ?? null);
  return {
    date: today,
    schoolDay,
    reason,
    sections: overview.items.filter((i) => i.schoolDay).length,
    sectionsTaken: latest.size,
    sessionsDue: overview.totals.due,
    sessionsMissing: overview.totals.missing,
    marked,
    present,
    late,
    absent,
    excused,
    rate: pct(present + late, marked),
  };
}

/** Today in the branch: the bell times most of its sections follow, examination sessions, no-school reasons. */
async function todayActivitiesOf({ prisma, school, today, branchId }, sections) {
  const items = [];
  let note = null;
  if (sections.length && branchId) {
    const days = await loadSectionDays(school.id, sections.map((s) => ({ id: s.id, branchId: s.branchId })), today, today);
    const list = [...days.values()].map((d) => d[0]).filter(Boolean);
    const open = list.filter((d) => d.schoolDay);
    if (!open.length) note = list[0]?.holiday?.name ?? list[0]?.closure?.name ?? (list.length ? 'No school today.' : null);
    // The bell schedule most sections follow today.
    const counts = new Map();
    for (const d of open) if (d.bellSchedule) counts.set(d.bellSchedule.id, { n: (counts.get(d.bellSchedule.id)?.n ?? 0) + 1, day: d });
    const main = [...counts.values()].sort((a, b) => b.n - a.n)[0]?.day;
    if (main) {
      const periods = main.periods ?? [];
      if (periods.length) items.push({ time: minutesToTime(periods[0].startMinute), title: 'School starts', detail: main.bellSchedule.name, kind: 'start' });
      for (const p of periods) {
        if (p.kind === 'LESSON') continue;
        items.push({ time: minutesToTime(p.startMinute), end: minutesToTime(p.endMinute), title: p.name || 'Break', detail: p.mainBreak ? 'Main break' : null, kind: 'break' });
      }
      const lessons = periods.filter((p) => p.kind === 'LESSON');
      if (lessons.length) items.push({ time: minutesToTime(lessons[0].startMinute), title: `Lessons (${lessons.length} periods)`, detail: `Period 1 – ${lessons.length}`, kind: 'lessons' });
      if (periods.length) items.push({ time: minutesToTime(periods.at(-1).endMinute), title: 'School ends', detail: null, kind: 'end' });
    }
    if (open.length && !items.length) note = 'A school day, but no bell times are set for today.';
    if (open.some((d) => d.examination)) note = note ?? `Examination day: ${open.find((d) => d.examination).examination.name}`;
  }
  const examSessions = branchId
    ? await prisma.examSession.findMany({ where: { schoolId: school.id, branchId, date: new Date(`${today}T00:00:00Z`), examination: { status: 'SCHEDULED' } }, orderBy: [{ startMinute: 'asc' }], select: { startMinute: true, endMinute: true, shiftName: true, sequence: true, examination: { select: { id: true, name: true } }, _count: { select: { sittings: true } } } })
    : [];
  for (const s of examSessions) items.push({ time: minutesToTime(s.startMinute), end: minutesToTime(s.endMinute), title: `${s.examination.name}: session ${s.sequence}`, detail: `${s.shiftName}, ${s._count.sittings} paper${s._count.sittings === 1 ? '' : 's'}`, kind: 'exam', link: `/examinations/list/${s.examination.id}` });
  items.sort((a, b) => a.time.localeCompare(b.time));
  return { date: today, note, items };
}

/** The branch's latest payments, with each student's class. */
async function recentPaymentsOf({ prisma, school, branchId, inBranch, f, tz }) {
  const rows = await prisma.feePayment.findMany({
    where: { schoolId: school.id, ...inBranch, ...((f.from || f.to) && { receivedAt: { ...(f.from && { gte: zonedInstant(f.from, 0, tz) }), ...(f.to && { lt: zonedInstant(addDays(f.to, 1), 0, tz) }) } }) },
    include: { ...paymentInclude, student: { select: { id: true, firstName: true, middleName: true, lastName: true, studentNumber: true } } },
    orderBy: { receivedAt: 'desc' },
    take: 6,
  });
  const enrollments = await prisma.enrollment.findMany({ where: { studentId: { in: rows.map((r) => r.studentId) }, ...(branchId && { branchId }) }, orderBy: { enrolledAt: 'desc' }, select: { studentId: true, section: { select: { name: true, class: { select: { name: true } } } } } });
  return rows.map((p) => {
    const e = enrollments.find((x) => x.studentId === p.studentId);
    const payment = toPayment(p);
    return { id: payment.id, student: payment.student, class: e ? `${e.section.class.name} ${e.section.name}` : null, amount: payment.amount, receivedAt: payment.receivedAt, status: payment.status, receipt: payment.receipt?.number ?? null };
  });
}

/** Cash received today in the branch, payments, students covered, and whether each person's cash is closed. */
async function dailySummaryOf({ prisma, school, today, tz, inBranch, feesP }) {
  const fees = await feesP;
  const day = { gte: zonedInstant(today, 0, tz), lt: zonedInstant(addDays(today, 1), 0, tz) };
  const [sum, students] = await Promise.all([
    prisma.feePayment.aggregate({ where: { schoolId: school.id, status: 'RECORDED', ...inBranch, receivedAt: day }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.feePayment.groupBy({ by: ['studentId'], where: { schoolId: school.id, status: 'RECORDED', ...inBranch, receivedAt: day } }),
  ]);
  const closing = fees?.closing;
  const open = (closing?.notClosed ?? []).filter((n) => n.payments > 0);
  return {
    currency: fees?.currency ?? 'USD',
    date: today,
    received: sum._sum.amount ?? 0,
    payments: sum._count._all,
    students: students.length,
    closing: { closedToday: closing?.closings?.length ?? 0, notClosed: open.length, notClosedAmount: open.reduce((n, o) => n + o.amount, 0), state: open.length ? 'open' : closing?.closings?.length ? 'closed' : 'none' },
  };
}

// ---- Shared ---------------------------------------------------------------------------------------------

/**
 * The examinations of the year the viewer may see (school-wide ones and their branch's): the running
 * and upcoming ones and the latest completed, each with its progress, and the pending work (mark sheets
 * waiting for approval, results not published).
 */
async function examinationsOf({ prisma, school, year, today, branchId, examOverviewP }) {
  if (!school.examinationsEnabled) return null;
  const visible = { schoolId: school.id, academicYearId: year.id, status: { not: 'CANCELLED' }, ...(branchId && { OR: [{ branchId: null }, { branchId }] }) };
  const exams = await prisma.examination.findMany({ where: visible, orderBy: { startDate: 'asc' }, select: { id: true, name: true, status: true, startDate: true, endDate: true, branchId: true, examType: { select: { name: true } }, _count: { select: { papers: true } } } });
  const stateOf = (e) => {
    const s = fromDbDate(e.startDate);
    const end = fromDbDate(e.endDate);
    if (e.status === 'DRAFT') return 'draft';
    if (today < s) return 'planned';
    if (today > end) return 'completed';
    return 'active';
  };
  const ids = exams.map((e) => e.id);
  const inB = branchId ? { branchId } : {};
  const [sheets, results, sectionsByClass] = await Promise.all([
    ids.length ? prisma.examMarkSheet.groupBy({ by: ['examinationId', 'status'], where: { examinationId: { in: ids }, ...inB }, _count: { _all: true } }) : [],
    ids.length ? prisma.examResultSet.groupBy({ by: ['examinationId', 'status'], where: { examinationId: { in: ids }, ...inB }, _count: { _all: true } }) : [],
    prisma.section.groupBy({ by: ['classId'], where: { schoolId: school.id, academicYearId: year.id, status: 'ACTIVE', ...inB }, _count: { _all: true } }),
  ]);
  const papers = ids.length ? await prisma.examPaper.groupBy({ by: ['examinationId', 'classId'], where: { examinationId: { in: ids } }, _count: { _all: true } }) : [];
  const sectionCount = new Map(sectionsByClass.map((s) => [s.classId, s._count._all]));
  const count = (list, id, status) => list.filter((r) => r.examinationId === id && (!status || r.status === status)).reduce((n, r) => n + r._count._all, 0);

  const items = exams.map((e) => {
    const state = stateOf(e);
    const start = fromDbDate(e.startDate);
    const end = fromDbDate(e.endDate);
    const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
    const expectedSheets = papers.filter((p) => p.examinationId === e.id).reduce((n, p) => n + p._count._all * (sectionCount.get(p.classId) ?? 0), 0);
    const approved = count(sheets, e.id, 'APPROVED');
    const submitted = count(sheets, e.id, 'SUBMITTED');
    const publishedSections = count(results, e.id, 'PUBLISHED');
    const resultSections = new Set(papers.filter((p) => p.examinationId === e.id).map((p) => p.classId)).size ? [...new Set(papers.filter((p) => p.examinationId === e.id).map((p) => p.classId))].reduce((n, c) => n + (sectionCount.get(c) ?? 0), 0) : 0;
    let progress = null;
    let progressLabel = null;
    if (state === 'active') {
      const elapsed = Math.round((Date.parse(today) - Date.parse(start)) / 86_400_000) + 1;
      progress = pct(elapsed, days);
      progressLabel = `Day ${elapsed} of ${days}`;
    } else if (state === 'completed') {
      progress = expectedSheets ? pct(approved, expectedSheets) : 0;
      progressLabel = `${approved} of ${expectedSheets} mark sheets approved`;
    } else if (state === 'planned') {
      const until = Math.round((Date.parse(start) - Date.parse(today)) / 86_400_000);
      progressLabel = `Starts in ${until} day${until === 1 ? '' : 's'}`;
    }
    return {
      id: e.id,
      name: e.name,
      type: e.examType.name,
      level: e.branchId ? 'branch' : 'school',
      state,
      startDate: start,
      endDate: end,
      papers: e._count.papers,
      progress,
      progressLabel,
      marks: { expected: expectedSheets, approved, submitted },
      results: { sections: resultSections, published: publishedSections },
    };
  });

  const order = { active: 0, planned: 1, completed: 2, draft: 3 };
  const completedRecent = items.filter((i) => i.state === 'completed').sort((a, b) => b.endDate.localeCompare(a.endDate));
  const shown = [...items.filter((i) => i.state === 'active'), ...items.filter((i) => i.state === 'planned'), ...completedRecent.slice(0, 2), ...items.filter((i) => i.state === 'draft')].slice(0, 5).sort((a, b) => order[a.state] - order[b.state]);
  const pending = {
    marksToApprove: items.reduce((n, i) => n + i.marks.submitted, 0),
    resultsToPublish: items.filter((i) => i.state === 'completed').reduce((n, i) => n + Math.max(0, i.results.sections - i.results.published), 0),
    marksMissing: items.filter((i) => i.state === 'completed').reduce((n, i) => n + Math.max(0, i.marks.expected - i.marks.approved - i.marks.submitted), 0),
  };
  const overview = await examOverviewP;
  return {
    counts: { draft: items.filter((i) => i.state === 'draft').length, planned: items.filter((i) => i.state === 'planned').length, active: items.filter((i) => i.state === 'active').length, completed: items.filter((i) => i.state === 'completed').length },
    items: shown,
    pending,
    setupMissing: overview.setup.filter((s) => !s.done).map((s) => ({ key: s.key, label: s.label, note: s.note })),
  };
}

/** What needs attention: each alert with a count (0 left out) and the page that deals with it. */
async function alertsOf({ prisma, school, scope, year, today, inBranch, feesP, examOverviewP, dayP, branchId }) {
  const owner = scope.role === 'OWNER';
  const fees = await feesP;
  const alerts = [];
  const add = (key, tone, title, count, link) => count > 0 && alerts.push({ key, tone, title, count, link });

  if (fees) {
    add('overdue', 'error', `Student${fees.overdueCount === 1 ? '' : 's'} with overdue fees`, fees.overdueCount, '/fees/students');
    const failed = fees.generation.months.filter((m) => m.status === 'failed');
    add('generation-failed', 'error', 'Monthly fee generation failed', failed.length, '/fees');
    const pending = fees.generation.months.filter((m) => m.status === 'pending' && m.month <= today);
    add('generation-pending', 'warning', 'Monthly fees not generated yet', pending.length, '/fees');
    const open = (fees.closing?.notClosed ?? []).filter((n) => n.payments > 0);
    add('closing', 'warning', `Cash closing${open.length === 1 ? '' : 's'} pending`, open.length, '/fees/cash-closing');
    const examFeesUnpaid = await prisma.feeObligation.count({ where: { schoolId: school.id, academicYearId: year.id, kind: 'EXAM', status: 'OPEN', ...inBranch, examination: { status: 'SCHEDULED', endDate: { gte: new Date(`${today}T00:00:00Z`) } } } });
    add('exam-fees', 'info', 'Unpaid fees for upcoming examinations', examFeesUnpaid, '/fees/clearance');
  }
  if (school.examinationsEnabled) {
    const submitted = await prisma.examMarkSheet.count({ where: { schoolId: school.id, status: 'SUBMITTED', ...inBranch, examination: { academicYearId: year.id } } });
    add('marks', 'warning', 'Mark sheets waiting for approval', submitted, '/examinations/marks');
    const draftResults = await prisma.examResultSet.count({ where: { schoolId: school.id, status: { not: 'PUBLISHED' }, ...inBranch, examination: { academicYearId: year.id, status: 'SCHEDULED', endDate: { lt: new Date(`${today}T00:00:00Z`) } } } });
    add('results', 'info', 'Class results not published', draftResults, '/examinations/results');
    const overview = await examOverviewP;
    add('exam-setup', 'warning', 'Examination setup steps to finish', overview.setup.filter((s) => !s.done).length, '/examinations');
  }
  const pendingEnrollment = await prisma.student.count({ where: { schoolId: school.id, status: 'PENDING_ENROLLMENT', ...(branchId && { branchId }) } });
  add('pending-enrollment', 'info', 'Students waiting to be enrolled', pendingEnrollment, '/students');
  if (!owner && school.studentAttendanceEnabled) {
    const overview = await dayP;
    add('attendance', 'warning', 'Attendance sessions not taken today', overview.totals.missing, '/student-attendance/completion');
  }
  return alerts;
}
