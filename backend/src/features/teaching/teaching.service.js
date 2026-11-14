import { badRequest, conflict, forbidden, notFound } from '../../common/httpError.js';
import { fromDbStatus } from '../../common/listQuery.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { calendarToday, firstEditableDay } from '../academic-calendar/calendar.service.js';
import { addDays, asDbDay, toDay } from '../academic-calendar/schoolDays.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockActiveSchool, lockOperatingBranch } from '../branches/branches.service.js';
import { sectionDisplayName } from '../classes/classInput.js';
import { isTeachingTitle, teachingTitleWhere } from '../staff/jobTitles.js';

/*
 * Teaching assignments (docs/business-rules.md → Teaching assignments): who teaches which subject
 * to which section (SUBJECT_TEACHER), and who is each section's class teacher (CLASS_TEACHER), in
 * one academic year, from a start date to an optional end date. Teaching permissions come from
 * these assignments only, never from a job title. A teacher keeps their home branch (User.branchId);
 * the section may be in any branch of the same school.
 *
 * Scope (from the account, never the request): { school, branch: null } for the School Owner — any
 * active staff member of the school, any section of the school; { school, branch } for a Manager —
 * staff whose home branch is theirs, sections of their branch. A Manager reads every assignment in
 * their branch (also teachers the Owner brought from other branches) but changes only their own
 * staff's (403 otherwise). Anything outside the scope is not found (404).
 *
 * Writes share the school's class lock (`classes:<schoolId>`: sections, subjects and curricula
 * change one at a time with assignments), need the school ACTIVE (and a Manager's branch operating),
 * and a planned or current year. Days before today are fixed, as in the calendar: an assignment
 * starts today or later; one that has started only ends (from today on); one that has not started
 * can be cancelled. The database keeps one class teacher per section at a time and never the same
 * teacher twice for a section's subject at once. Each change is audited in the same transaction.
 */

const TX = { timeout: 20000, maxWait: 10000 };
const ROLE_LABELS = { SUBJECT_TEACHER: 'Subject teacher', CLASS_TEACHER: 'Class teacher' };
const invalid = (errors) => badRequest('Check the highlighted fields.', errors);
const YEAR_CLOSED = (year) => conflict('YEAR_CLOSED', `${year.name} is closed. Its teaching assignments are kept as they are.`);
const OTHER_BRANCH_TEACHER = () =>
  forbidden('This teacher’s home branch is another branch. Their assignments in your branch are managed by your School Owner.');

const mentions = (error, text) => {
  try {
    return `${error?.message ?? ''} ${JSON.stringify(error?.meta ?? {})}`.includes(text);
  } catch {
    return false;
  }
};
function translateDbError(error) {
  if (mentions(error, 'TeachingAssignment_one_class_teacher')) return conflict('CLASS_TEACHER_EXISTS', 'This section already has a class teacher for these dates.');
  if (mentions(error, 'TeachingAssignment_no_duplicate_subject_teacher')) return conflict('ALREADY_ASSIGNED', 'This teacher already teaches this subject in this section for these dates.');
  return error;
}

async function withTeachingLock(scope, work) {
  try {
    return await getPrisma().$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`classes:${scope.school.id}`}))`;
      if (scope.branch) await lockOperatingBranch(tx, scope, 'teaching assignments');
      else await lockActiveSchool(tx, scope.school);
      return work(tx);
    }, TX);
  } catch (error) {
    throw translateDbError(error);
  }
}

// ---- shapes -----------------------------------------------------------------------------------

const teacherSelect = { id: true, name: true, staffId: true, jobTitle: true, status: true, branchId: true, branch: { select: { id: true, name: true, code: true } } };
const assignmentInclude = {
  teacher: { select: teacherSelect },
  subject: { select: { id: true, name: true, code: true, status: true } },
  section: { select: { id: true, name: true, status: true, class: { select: { id: true, name: true, sequence: true } } } },
  branch: { select: { id: true, name: true, code: true } },
  academicYear: { select: { id: true, name: true, status: true, startDate: true, endDate: true } },
};

export const toTeacher = (t) => ({
  id: t.id,
  name: t.name,
  staffId: t.staffId,
  jobTitle: t.jobTitle ?? '',
  status: fromDbStatus(t.status),
  homeBranch: t.branch ? { id: t.branch.id, name: t.branch.name, code: t.branch.code } : null,
});

/** scheduled (not started) | active | ended | cancelled, on `today`. */
export function assignmentState(a, today) {
  if (a.cancelledAt) return 'cancelled';
  if (toDay(a.startDate) > today) return 'scheduled';
  if (a.endDate && toDay(a.endDate) < today) return 'ended';
  return 'active';
}

function toAssignment(a, today, scope) {
  return {
    id: a.id,
    role: a.role === 'CLASS_TEACHER' ? 'class' : 'subject',
    teacher: toTeacher(a.teacher),
    subject: a.subject ? { id: a.subject.id, name: a.subject.name, code: a.subject.code ?? '', status: fromDbStatus(a.subject.status) } : null,
    section: { id: a.section.id, name: a.section.name, displayName: sectionDisplayName(a.section.class.name, a.section.name), class: { id: a.section.class.id, name: a.section.class.name, sequence: a.section.class.sequence } },
    branch: { id: a.branch.id, name: a.branch.name, code: a.branch.code },
    academicYear: { id: a.academicYear.id, name: a.academicYear.name, status: a.academicYear.status.toLowerCase() },
    startDate: toDay(a.startDate),
    endDate: a.endDate ? toDay(a.endDate) : null,
    state: assignmentState(a, today),
    cancelledAt: a.cancelledAt?.toISOString() ?? null,
    // Whether the signed-in user may end or cancel it (the API checks again).
    canManage: !scope?.branch || (a.branchId === scope.branch.id && a.teacher.branchId === scope.branch.id),
  };
}

const describeAssignment = (a) =>
  a.role === 'CLASS_TEACHER'
    ? `${a.teacher.name}: class teacher of ${sectionDisplayName(a.section.class.name, a.section.name)}`
    : `${a.teacher.name}: ${a.subject.name} in ${sectionDisplayName(a.section.class.name, a.section.name)}`;

/** Prisma filter for a state on `today` ('live': scheduled or active). */
function stateWhere(state, today) {
  const day = asDbDay(today);
  const notEnded = { OR: [{ endDate: null }, { endDate: { gte: day } }] };
  switch (state) {
    case 'cancelled':
      return { cancelledAt: { not: null } };
    case 'scheduled':
      return { cancelledAt: null, startDate: { gt: day } };
    case 'active':
      return { cancelledAt: null, startDate: { lte: day }, ...notEnded };
    case 'ended':
      return { cancelledAt: null, endDate: { lt: day } };
    case 'live':
      return { cancelledAt: null, ...notEnded };
    default:
      return {};
  }
}

async function resolveYear(client, school, value) {
  const year = await client.academicYear.findFirst({ where: value === 'current' ? { schoolId: school.id, status: 'CURRENT' } : { id: value, schoolId: school.id } });
  if (!year && value !== 'current') throw notFound('Academic year not found.');
  return year;
}

// ---- reads ------------------------------------------------------------------------------------

/**
 * Assignments of one academic year (default: the current one) in the scope, by class, section,
 * role and subject. Filters: branch (Owner), section, teacher, subject, role, state (default live).
 */
export async function listTeachingAssignments(scope, filters) {
  const prisma = getPrisma();
  const [today, year] = await Promise.all([calendarToday(), resolveYear(prisma, scope.school, filters.academicYear)]);
  if (!year) return { academicYear: null, today, items: [] };
  const rows = await prisma.teachingAssignment.findMany({
    where: {
      schoolId: scope.school.id,
      academicYearId: year.id,
      ...(scope.branch ? { branchId: scope.branch.id } : filters.branch && { branchId: filters.branch }),
      ...(filters.section && { sectionId: filters.section }),
      ...(filters.teacher && { teacherId: filters.teacher }),
      ...(filters.subject && { subjectId: filters.subject }),
      ...(filters.role && { role: filters.role === 'class' ? 'CLASS_TEACHER' : 'SUBJECT_TEACHER' }),
      ...stateWhere(filters.state, today),
    },
    include: assignmentInclude,
    orderBy: [{ section: { class: { sequence: 'asc' } } }, { section: { nameKey: 'asc' } }, { role: 'desc' }, { subject: { name: 'asc' } }, { startDate: 'asc' }],
  });
  return { academicYear: { id: year.id, name: year.name, status: year.status.toLowerCase(), startDate: toDay(year.startDate), endDate: toDay(year.endDate) }, today, items: rows.map((a) => toAssignment(a, today, scope)) };
}

/**
 * One section's teaching: its class teacher(s) and, per subject of the class (its curriculum, or
 * every active subject when the class has none), the teachers — live assignments only.
 */
export async function sectionTeaching(scope, sectionId) {
  const prisma = getPrisma();
  const section = isUuid(sectionId)
    ? await prisma.section.findFirst({
        where: { id: sectionId, schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) },
        include: { class: true, branch: { select: { id: true, name: true, code: true } }, academicYear: true },
      })
    : null;
  if (!section) throw notFound('Section not found.');
  const today = await calendarToday();
  const [curriculum, assignments] = await Promise.all([
    prisma.classSubject.findMany({ where: { classId: section.classId }, include: { subject: true }, orderBy: { subject: { name: 'asc' } } }),
    prisma.teachingAssignment.findMany({ where: { sectionId: section.id, ...stateWhere('live', today) }, include: assignmentInclude, orderBy: [{ startDate: 'asc' }] }),
  ]);
  const open = curriculum.length === 0;
  const subjects = open
    ? (await prisma.subject.findMany({ where: { schoolId: scope.school.id, status: 'ACTIVE' }, orderBy: { name: 'asc' } })).map((s) => ({ subject: s, weeklyLessons: null }))
    : curriculum;
  const shaped = assignments.map((a) => toAssignment(a, today, scope));
  // Subjects still taught here but no longer on the class's list (or inactive) stay visible.
  const listed = new Set(subjects.map((s) => s.subject.id));
  const extra = shaped.filter((a) => a.subject && !listed.has(a.subject.id));
  return {
    today,
    firstEditableDate: firstEditableDay(today),
    section: {
      id: section.id,
      name: section.name,
      displayName: sectionDisplayName(section.class.name, section.name),
      status: fromDbStatus(section.status),
      class: { id: section.class.id, name: section.class.name, status: fromDbStatus(section.class.status) },
      branch: section.branch,
      academicYear: { id: section.academicYear.id, name: section.academicYear.name, status: section.academicYear.status.toLowerCase(), startDate: toDay(section.academicYear.startDate), endDate: toDay(section.academicYear.endDate) },
    },
    curriculumSet: !open,
    classTeachers: shaped.filter((a) => a.role === 'class'),
    subjects: [
      ...subjects.map(({ subject, weeklyLessons }) => ({
        subject: { id: subject.id, name: subject.name, code: subject.code ?? '', status: fromDbStatus(subject.status) },
        weeklyLessons,
        teachers: shaped.filter((a) => a.subject?.id === subject.id),
      })),
      ...[...new Map(extra.map((a) => [a.subject.id, a.subject])).values()].map((subject) => ({
        subject,
        weeklyLessons: null,
        offList: true,
        teachers: shaped.filter((a) => a.subject?.id === subject.id),
      })),
    ],
  };
}

/**
 * Staff who can be given teaching: active STAFF of the school (Owner) or of the Manager's branch.
 * `show: 'teachers'` (default) lists staff whose job title is a teaching one (staff/jobTitles.js);
 * `show: 'all'` lists every active staff member, teachers first (the title grants nothing: anyone
 * may be assigned). Then by name, each with their live assignment count in the year, to balance
 * loads, and `total` (how many match before the 50 shown).
 */
export async function eligibleTeachers(scope, { q, academicYear, show = 'teachers' }) {
  const prisma = getPrisma();
  const today = await calendarToday();
  const year = academicYear ? await resolveYear(prisma, scope.school, academicYear) : null;
  const where = {
    role: 'STAFF',
    status: 'ACTIVE',
    ...(scope.branch ? { branchId: scope.branch.id } : { branch: { schoolId: scope.school.id } }),
    AND: [
      ...(q ? [{ OR: [{ name: { contains: q, mode: 'insensitive' } }, { staffId: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] }] : []),
      ...(show === 'all' ? [] : [teachingTitleWhere()]),
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        ...teacherSelect,
        _count: { select: { teachingAssignments: { where: { ...stateWhere('live', today), ...(year && { academicYearId: year.id }) } } } },
      },
      take: 300,
    }),
    prisma.user.count({ where }),
  ]);
  const teaches = (t) => (isTeachingTitle(t.jobTitle) ? 0 : 1);
  rows.sort((a, b) => teaches(a) - teaches(b) || a.name.localeCompare(b.name));
  return { show, total, items: rows.slice(0, 50).map((t) => ({ ...toTeacher(t), suggested: teaches(t) === 0, liveAssignments: t._count.teachingAssignments })) };
}

/**
 * A staff member's live teaching anywhere in the school (for their profile and the transfer
 * warning): assignments that are running or scheduled, in planned or current years.
 */
export async function liveTeachingOf(teacherId, client = getPrisma()) {
  const today = await calendarToday();
  const rows = await client.teachingAssignment.findMany({
    where: { teacherId, ...stateWhere('live', today), academicYear: { status: { in: ['PLANNED', 'CURRENT'] } } },
    include: assignmentInclude,
    orderBy: [{ startDate: 'asc' }],
  });
  return rows.map((a) => toAssignment(a, today, null));
}

// ---- changes ----------------------------------------------------------------------------------

/** Overlapping live assignment that the database would refuse, or null. */
function clashing(tx, { role, sectionId, subjectId, teacherId, startDate, endDate }, exceptId) {
  return tx.teachingAssignment.findFirst({
    where: {
      sectionId,
      role,
      cancelledAt: null,
      ...(role === 'SUBJECT_TEACHER' && { subjectId, teacherId }),
      ...(exceptId && { id: { not: exceptId } }),
      ...(endDate && { startDate: { lte: asDbDay(endDate) } }),
      OR: [{ endDate: null }, { endDate: { gte: asDbDay(startDate) } }],
    },
    include: assignmentInclude,
  });
}

function clashError(role, other) {
  const until = other.endDate ? ` until ${toDay(other.endDate)}` : '';
  return role === 'CLASS_TEACHER'
    ? conflict('CLASS_TEACHER_EXISTS', `${sectionDisplayName(other.section.class.name, other.section.name)} already has ${other.teacher.name} as class teacher from ${toDay(other.startDate)}${until}. End that assignment first, or start this one after it.`)
    : conflict('ALREADY_ASSIGNED', `${other.teacher.name} already teaches ${other.subject.name} in ${sectionDisplayName(other.section.class.name, other.section.name)} from ${toDay(other.startDate)}${until}.`);
}

const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const audit = (tx, action, scope, a, { user, req, description, fields }) =>
  recordAuditEvent({
    client: tx,
    action,
    actor: actorOf(user),
    target: { type: 'teaching', id: a.id, name: describeAssignment(a) },
    schoolId: scope.school.id,
    description,
    change: { fields, academicYearId: a.academicYearId, branchId: a.branchId, sectionId: a.sectionId, teacherId: a.teacherId, role: a.role },
    req,
  });

/**
 * Gives a staff member teaching: a subject in a section, or a section's class teacher. The section
 * must be active (its class too) in a planned or current year; the teacher an active staff member
 * (home branch: any of the school for the Owner, the Manager's own); the subject active and — when
 * the class has a subject list — on it (409 SUBJECT_NOT_IN_CLASS). Starts today at the earliest.
 */
export async function assignTeaching(scope, values, user, req) {
  const today = await calendarToday();
  const fe = firstEditableDay(today);
  const created = await withTeachingLock(scope, async (tx) => {
    const section = await tx.section.findFirst({
      where: { id: values.sectionId, schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) },
      include: { class: true, academicYear: true },
    });
    if (!section) throw notFound('Section not found.');
    const year = section.academicYear;
    if (year.status === 'CLOSED') throw YEAR_CLOSED(year);
    const name = sectionDisplayName(section.class.name, section.name);
    if (section.status !== 'ACTIVE' || section.class.status !== 'ACTIVE') throw conflict('SECTION_INACTIVE', `${name} is inactive. Reactivate it before assigning teachers.`);

    const teacher = await tx.user.findFirst({
      where: { id: values.teacherId, role: 'STAFF', ...(scope.branch ? { branchId: scope.branch.id } : { branch: { schoolId: scope.school.id } }) },
      select: teacherSelect,
    });
    if (!teacher) throw notFound('Teacher not found.');
    if (teacher.status !== 'ACTIVE') throw conflict('TEACHER_SUSPENDED', `${teacher.name}'s account is suspended. Reactivate it before assigning teaching.`);

    let subject = null;
    if (values.role === 'SUBJECT_TEACHER') {
      subject = await tx.subject.findFirst({ where: { id: values.subjectId, schoolId: scope.school.id } });
      if (!subject) throw notFound('Subject not found.');
      if (subject.status !== 'ACTIVE') throw conflict('SUBJECT_INACTIVE', `${subject.name} is inactive. Reactivate it before assigning teachers.`);
      const curriculum = await tx.classSubject.findMany({ where: { classId: section.classId }, select: { subjectId: true } });
      if (curriculum.length && !curriculum.some((c) => c.subjectId === subject.id)) {
        throw conflict('SUBJECT_NOT_IN_CLASS', `${subject.name} is not one of ${section.class.name}'s subjects. Your School Owner can add it to the class.`);
      }
    }

    const yearStart = toDay(year.startDate);
    const yearEnd = toDay(year.endDate);
    const earliest = fe > yearStart ? fe : yearStart;
    const startDate = values.startDate ?? earliest;
    const errors = {};
    if (startDate < earliest) errors.startDate = startDate < yearStart ? `Choose a date within ${year.name} (${yearStart} to ${yearEnd}).` : `Teaching starts today (${fe}) at the earliest.`;
    else if (startDate > yearEnd) errors.startDate = `Choose a date within ${year.name} (${yearStart} to ${yearEnd}).`;
    if (values.endDate && values.endDate > yearEnd) errors.endDate = `Choose a date within ${year.name} (${yearStart} to ${yearEnd}).`;
    if (values.endDate && values.endDate < startDate) errors.endDate = 'The end date cannot be before the start date.';
    if (Object.keys(errors).length) throw invalid(errors);

    const range = { role: values.role, sectionId: section.id, subjectId: subject?.id ?? null, teacherId: teacher.id, startDate, endDate: values.endDate };
    const other = await clashing(tx, range);
    if (other) throw clashError(values.role, other);

    const row = await tx.teachingAssignment.create({
      data: {
        schoolId: scope.school.id,
        academicYearId: year.id,
        branchId: section.branchId,
        sectionId: section.id,
        teacherId: teacher.id,
        role: values.role,
        subjectId: subject?.id ?? null,
        startDate: asDbDay(startDate),
        endDate: values.endDate ? asDbDay(values.endDate) : null,
      },
      include: assignmentInclude,
    });
    await audit(tx, AUDIT_ACTIONS.TEACHING_ASSIGNED, scope, row, {
      user,
      req,
      description: `${describeAssignment(row)} from ${startDate}${values.endDate ? ` to ${values.endDate}` : ''}.`,
      fields: [
        { field: 'Role', from: null, to: ROLE_LABELS[row.role] },
        { field: 'Teacher', from: null, to: `${teacher.name} (${teacher.staffId})` },
        { field: 'Section', from: null, to: `${name} (${year.name})` },
        ...(subject ? [{ field: 'Subject', from: null, to: subject.name }] : []),
        { field: 'Start date', from: null, to: startDate },
        { field: 'End date', from: null, to: values.endDate ?? 'End of the year' },
      ],
    });
    return row;
  });
  return toAssignment(created, today, scope);
}

/** The assignment in scope, its year writable; a Manager only their own staff's in their branch. */
async function findManageable(tx, scope, id) {
  const a = isUuid(id) ? await tx.teachingAssignment.findFirst({ where: { id, schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) }, include: assignmentInclude }) : null;
  if (!a) throw notFound('Teaching assignment not found.');
  if (scope.branch && a.teacher.branchId !== scope.branch.id) throw OTHER_BRANCH_TEACHER();
  if (a.academicYear.status === 'CLOSED') throw YEAR_CLOSED(a.academicYear);
  return a;
}

/**
 * Sets an assignment's last day (null: until the year ends) — to end it early, or extend it. The
 * days added or removed must be today or later; an assignment that has ended is kept (409
 * ASSIGNMENT_IN_PAST); one that has not started is cancelled instead.
 */
export async function setAssignmentEnd(scope, id, { lastDay }, user, req) {
  const today = await calendarToday();
  const fe = firstEditableDay(today);
  const saved = await withTeachingLock(scope, async (tx) => {
    const a = await findManageable(tx, scope, id);
    if (a.cancelledAt) throw conflict('ASSIGNMENT_CANCELLED', 'This assignment was cancelled. Make a new one instead.');
    const start = toDay(a.startDate);
    const end = a.endDate ? toDay(a.endDate) : null;
    const yearEnd = toDay(a.academicYear.endDate);
    if (end && end < fe) throw conflict('ASSIGNMENT_IN_PAST', `This assignment ended on ${end}. Past teaching is kept as it was.`);
    if ((lastDay ?? null) === end) return a;
    if (lastDay !== null && lastDay < start) throw invalid({ lastDay: `The last day cannot be before the start (${start}). Cancel the assignment instead.` });
    if (lastDay !== null && lastDay > yearEnd) throw invalid({ lastDay: `Choose a date within ${a.academicYear.name} (up to ${yearEnd}).` });
    const earliestEnd = addDays(fe, -1);
    if (lastDay !== null && lastDay < earliestEnd) throw invalid({ lastDay: `Days before ${fe} are fixed: the last day can be ${earliestEnd} at the earliest.` });

    if (lastDay === null || (end && lastDay > end)) {
      const other = await clashing(tx, { role: a.role, sectionId: a.sectionId, subjectId: a.subjectId, teacherId: a.teacherId, startDate: end ? addDays(end, 1) : start, endDate: lastDay }, a.id);
      if (other) throw clashError(a.role, other);
    }
    const row = await tx.teachingAssignment.update({ where: { id: a.id }, data: { endDate: lastDay ? asDbDay(lastDay) : null }, include: assignmentInclude });
    await audit(tx, AUDIT_ACTIONS.TEACHING_ASSIGNMENT_CHANGED, scope, row, {
      user,
      req,
      description: lastDay && lastDay < today ? `${describeAssignment(row)} ended: last day ${lastDay}.` : `${describeAssignment(row)}: last day ${lastDay ?? 'the end of the year'}.`,
      fields: [{ field: 'End date', from: end ?? 'End of the year', to: lastDay ?? 'End of the year' }],
    });
    return row;
  });
  return toAssignment(saved, today, scope);
}

/** Cancels an assignment that has not started (409 ASSIGNMENT_STARTED otherwise: end it instead). Kept as cancelled. */
export async function cancelAssignment(scope, id, user, req) {
  const today = await calendarToday();
  const fe = firstEditableDay(today);
  const saved = await withTeachingLock(scope, async (tx) => {
    const a = await findManageable(tx, scope, id);
    if (a.cancelledAt) return a;
    if (toDay(a.startDate) < fe) throw conflict('ASSIGNMENT_STARTED', `This assignment started on ${toDay(a.startDate)}. End it instead; past teaching is kept.`);
    const row = await tx.teachingAssignment.update({ where: { id: a.id }, data: { cancelledAt: new Date() }, include: assignmentInclude });
    await audit(tx, AUDIT_ACTIONS.TEACHING_ASSIGNMENT_CANCELLED, scope, row, {
      user,
      req,
      description: `${describeAssignment(row)} (from ${toDay(row.startDate)}) cancelled.`,
      fields: [{ field: 'Status', from: 'Scheduled', to: 'Cancelled' }],
    });
    return row;
  });
  return toAssignment(saved, today, scope);
}
