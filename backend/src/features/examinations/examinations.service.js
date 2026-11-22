import { Prisma } from '@prisma/client';
import { badRequest, conflict, forbidden, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { addDays, asDbDay, daysBetween, toDay } from '../academic-calendar/schoolDays.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockActiveSchool, lockOperatingBranch } from '../branches/branches.service.js';
import { examNameKey } from './examInput.js';
import { effectiveExamSettings } from './examSettings.js';
import { refuseIfAttendance } from './examAttendance.service.js';
import { dropPaperSittings, refitPaperSessions } from './examTimetable.service.js';

/*
 * Examinations (docs/business-rules.md → Examinations → Examinations): an examination of a year —
 * its type, period, dates, the branches holding it (one, or every branch), the classes sitting it and
 * their papers (class × subject, filled in from the class's curriculum).
 *
 *   DRAFT      being prepared; no effect anywhere.
 *   SCHEDULED  on the academic calendar; when it stops lessons, its classes' normal lessons stop on
 *              its days in its branches (examDays.js, timetable/lessons.js). Shown as planned before
 *              its first day, active during it, completed after.
 *   CANCELLED  called off before it started; kept for history.
 *
 * Days before today are fixed: once a scheduled examination has started, its type, period, branches,
 * classes, first day and whether it stops lessons stay as they are (otherwise past lessons would
 * reappear or vanish); it can only end early (its last day becomes yesterday at the earliest). A
 * class never sits two scheduled examinations on the same day in the same branch (409 EXAM_OVERLAP).
 *
 * School Owner: every examination. Manager: sees school-wide examinations and their branch's, and
 * manages their branch's when the school lets Managers create examinations (setting
 * managersCreateExams). Writes take the school's examination lock and are audited in the same
 * transaction. Nothing is deleted except papers nothing refers to yet.
 */

const TX = { timeout: 30000, maxWait: 10000 };
const status = (s) => s.toLowerCase();
const isUnique = (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const NAME_TAKEN = () => conflict('NAME_TAKEN', 'Another examination of this year already has this name.', { name: 'Another examination of this year already has this name.' });
const brief = (x) => x && { id: x.id, name: x.name, ...(x.code !== undefined && { code: x.code }) };
const LOCKED_WHEN_STARTED = ['examType', 'period', 'branch', 'startDate', 'stopsLessons', 'classes'];
const FIELD_LABELS = { examType: 'type', period: 'period', branch: 'branches', startDate: 'first day', stopsLessons: 'lessons setting', classes: 'classes' };

export const examInclude = {
  academicYear: { select: { id: true, name: true, status: true, startDate: true, endDate: true } },
  academicPeriod: { select: { id: true, name: true, startDate: true, endDate: true, status: true } },
  examType: { select: { id: true, name: true, stopsLessons: true, defaultMaxMarks: true, status: true } },
  branch: { select: { id: true, name: true, code: true } },
  classes: { select: { class: { select: { id: true, name: true, sequence: true } } } },
  _count: { select: { papers: true } },
};

// ---- pure rules (exported for tests) --------------------------------------------------------------

/** draft | planned | active | completed | cancelled, from the stored status and today. */
export function examState(exam, today) {
  if (exam.status === 'CANCELLED') return 'cancelled';
  if (exam.status === 'DRAFT') return 'draft';
  return today < exam.startDate ? 'planned' : today > exam.endDate ? 'completed' : 'active';
}

/**
 * What can be done with an examination ({ status, startDate, endDate } with 'YYYY-MM-DD' dates) today,
 * by someone who may manage it: edit (and which fields are locked), schedule, unschedule (back to
 * draft), cancel ('cancel' | 'end' | null), papers.
 */
export function examActions(exam, today, canManage) {
  const none = { edit: false, locked: [], schedule: false, unschedule: false, cancel: null, papers: false };
  if (!canManage || exam.status === 'CANCELLED') return none;
  const scheduled = exam.status === 'SCHEDULED';
  const started = scheduled && exam.startDate < today;
  const past = scheduled && exam.endDate < today;
  return {
    edit: true,
    locked: past ? [...LOCKED_WHEN_STARTED, 'endDate'] : started ? LOCKED_WHEN_STARTED : [],
    schedule: exam.status === 'DRAFT',
    unschedule: scheduled && !started,
    cancel: !started ? 'cancel' : past ? null : 'end',
    papers: true,
  };
}

// ---- reading ----------------------------------------------------------------------------------

async function findYear(client, scope, value) {
  const year =
    value === 'current'
      ? await client.academicYear.findFirst({ where: { schoolId: scope.school.id, status: 'CURRENT' } })
      : isUuid(value)
        ? await client.academicYear.findFirst({ where: { id: value, schoolId: scope.school.id } })
        : null;
  if (!year && value !== 'current') throw notFound('Academic year not found.');
  return year;
}

/** Where a scope may see examinations: the Owner all; a Manager school-wide ones and their branch's. */
const visible = (scope) => ({ schoolId: scope.school.id, ...(scope.branch && { OR: [{ branchId: null }, { branchId: scope.branch.id }] }) });

async function managerMayCreate(scope, client) {
  if (!scope.branch) return true;
  return (await effectiveExamSettings(scope.school.id, scope.branch.id, client)).managersCreateExams;
}
const canManage = (scope, exam, managersCreate) => !scope.branch || (exam.branchId === scope.branch.id && managersCreate);

function toExamination(e, today, manage) {
  const plainDates = { status: e.status, startDate: toDay(e.startDate), endDate: toDay(e.endDate) };
  return {
    id: e.id,
    name: e.name,
    description: e.description ?? '',
    academicYear: { id: e.academicYear.id, name: e.academicYear.name, status: status(e.academicYear.status) },
    period: e.academicPeriod ? { id: e.academicPeriod.id, name: e.academicPeriod.name } : null,
    examType: { id: e.examType.id, name: e.examType.name },
    level: e.branchId ? 'branch' : 'school',
    branch: brief(e.branch),
    startDate: plainDates.startDate,
    endDate: plainDates.endDate,
    days: daysBetween(plainDates.startDate, plainDates.endDate) + 1,
    stopsLessons: e.stopsLessons,
    status: status(e.status),
    state: examState(plainDates, today),
    classes: e.classes.map((c) => c.class).sort((a, b) => a.sequence - b.sequence).map(brief),
    papers: e._count.papers,
    cancelReason: e.cancelReason ?? null,
    scheduledAt: e.scheduledAt?.toISOString() ?? null,
    cancelledAt: e.cancelledAt?.toISOString() ?? null,
    createdBy: e.createdByName ?? null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    actions: examActions(plainDates, today, manage),
  };
}

const stateWhere = (state, today) => {
  const t = asDbDay(today);
  switch (state) {
    case 'draft':
      return { status: 'DRAFT' };
    case 'cancelled':
      return { status: 'CANCELLED' };
    case 'planned':
      return { status: 'SCHEDULED', startDate: { gt: t } };
    case 'active':
      return { status: 'SCHEDULED', startDate: { lte: t }, endDate: { gte: t } };
    case 'completed':
      return { status: 'SCHEDULED', endDate: { lt: t } };
    default:
      return {};
  }
};

/**
 * The examinations of a year (default the current one) the scope sees, filtered:
 * { academicYear, today, canCreate, counts: { draft, planned, active, completed, cancelled }, items }.
 */
export async function listExaminations(scope, { academicYear, period, scope: level, branch, state, q }) {
  const prisma = getPrisma();
  const [year, today, managersCreate] = await Promise.all([findYear(prisma, scope, academicYear), calendarToday(), managerMayCreate(scope, prisma)]);
  const counts = { draft: 0, planned: 0, active: 0, completed: 0, cancelled: 0 };
  if (!year) return { academicYear: null, today, canCreate: false, counts, items: [] };
  // Level: school-wide only, branch examinations only (the Owner: of one branch when chosen), or all
  // (the Owner choosing a branch: school-wide ones and that branch's — what applies to it).
  const levelWhere =
    level === 'school'
      ? { branchId: null }
      : level === 'branch'
        ? { branchId: scope.branch ? scope.branch.id : (branch ?? { not: null }) }
        : branch && !scope.branch
          ? { OR: [{ branchId: null }, { branchId: branch }] }
          : {};
  const where = {
    AND: [visible(scope), levelWhere],
    academicYearId: year.id,
    ...(period && { academicPeriodId: period }),
    ...(q && { name: { contains: q, mode: 'insensitive' } }),
  };
  const rows = await prisma.examination.findMany({ where, include: examInclude, orderBy: [{ startDate: 'asc' }, { nameKey: 'asc' }] });
  const items = rows.map((r) => toExamination(r, today, canManage(scope, r, managersCreate)));
  for (const i of items) counts[i.state] += 1;
  return {
    academicYear: { id: year.id, name: year.name, status: status(year.status), startDate: toDay(year.startDate), endDate: toDay(year.endDate) },
    today,
    canCreate: year.status !== 'CLOSED' && managersCreate,
    counts,
    items: state === 'all' ? items : items.filter((i) => i.state === state),
  };
}

export async function findExam(client, scope, id) {
  const row = isUuid(id) ? await client.examination.findFirst({ where: { id, ...visible(scope) }, include: examInclude }) : null;
  if (!row) throw notFound('Examination not found.');
  return row;
}

/**
 * One examination with its papers and, per class, its sections and students now enrolled in the
 * branches holding it: { examination, classes: [{ id, name, sections, students, papers }] }.
 */
export async function getExamination(scope, id) {
  const prisma = getPrisma();
  const [row, today, managersCreate] = await Promise.all([findExam(prisma, scope, id), calendarToday(), managerMayCreate(scope, prisma)]);
  const classIds = row.classes.map((c) => c.class.id);
  const branchWhere = row.branchId ? { branchId: row.branchId } : scope.branch ? { branchId: scope.branch.id } : {};
  const [papers, sections, enrolled] = await Promise.all([
    prisma.examPaper.findMany({
      where: { examinationId: row.id },
      select: { id: true, classId: true, maxMarks: true, durationMinutes: true, subject: { select: { id: true, name: true, code: true, status: true } } },
      orderBy: [{ subject: { name: 'asc' } }],
    }),
    prisma.section.groupBy({ by: ['classId'], where: { classId: { in: classIds }, academicYearId: row.academicYearId, status: 'ACTIVE', ...branchWhere }, _count: { _all: true } }),
    prisma.enrollment.findMany({ where: { status: 'ACTIVE', section: { classId: { in: classIds }, academicYearId: row.academicYearId, ...branchWhere } }, select: { section: { select: { classId: true } } } }),
  ]);
  const exam = toExamination(row, today, canManage(scope, row, managersCreate));
  return {
    examination: exam,
    // A Manager sees their branch's sections and students of a school-wide examination.
    countsFor: row.branchId ? 'branch' : scope.branch ? 'your_branch' : 'school',
    classes: exam.classes.map((c) => ({
      ...c,
      sections: sections.find((s) => s.classId === c.id)?._count._all ?? 0,
      students: enrolled.filter((e) => e.section.classId === c.id).length,
      papers: papers
        .filter((p) => p.classId === c.id)
        .map((p) => ({ id: p.id, subject: { id: p.subject.id, name: p.subject.name, code: p.subject.code ?? null, status: status(p.subject.status) }, maxMarks: p.maxMarks, durationMinutes: p.durationMinutes })),
    })),
  };
}

/** What the forms offer: the year's active periods, active types, classes, subjects and (Owner) branches, and paper limits. */
export async function examinationOptions(scope, { academicYear }) {
  const prisma = getPrisma();
  const year = await findYear(prisma, scope, academicYear);
  const [periods, types, classes, subjects, branches, settings, today] = await Promise.all([
    year ? prisma.academicPeriod.findMany({ where: { academicYearId: year.id, status: 'ACTIVE' }, orderBy: { startDate: 'asc' }, select: { id: true, name: true, startDate: true, endDate: true } }) : [],
    prisma.examType.findMany({ where: { schoolId: scope.school.id, status: 'ACTIVE' }, orderBy: { nameKey: 'asc' }, select: { id: true, name: true, stopsLessons: true, defaultMaxMarks: true } }),
    prisma.schoolClass.findMany({ where: { schoolId: scope.school.id, status: 'ACTIVE' }, orderBy: { sequence: 'asc' }, select: { id: true, name: true, _count: { select: { subjects: true } } } }),
    prisma.subject.findMany({ where: { schoolId: scope.school.id, status: 'ACTIVE' }, orderBy: { nameKey: 'asc' }, select: { id: true, name: true, code: true } }),
    scope.branch ? [] : prisma.branch.findMany({ where: { schoolId: scope.school.id, status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } }),
    effectiveExamSettings(scope.school.id, scope.branch?.id ?? null, prisma),
    calendarToday(),
  ]);
  return {
    academicYear: year && { id: year.id, name: year.name, status: status(year.status), startDate: toDay(year.startDate), endDate: toDay(year.endDate) },
    today,
    periods: periods.map((p) => ({ ...p, startDate: toDay(p.startDate), endDate: toDay(p.endDate) })),
    types,
    classes: classes.map((c) => ({ id: c.id, name: c.name, curriculumSubjects: c._count.subjects })),
    subjects,
    branches,
    limits: { maxMarks: settings.maxMarksLimit, paperMinutes: settings.paperMinutes },
  };
}

// ---- writing ----------------------------------------------------------------------------------

export async function withExamLock(scope, work) {
  try {
    return await getPrisma().$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`examinations:${scope.school.id}`}))`;
      if (scope.branch) await lockOperatingBranch(tx, scope, 'examinations');
      else await lockActiveSchool(tx, scope.school);
      return work(tx);
    }, TX);
  } catch (error) {
    if (isUnique(error)) throw NAME_TAKEN();
    throw error;
  }
}

const audit = (tx, scope, user, req, action, exam, description, change) =>
  recordAuditEvent({
    client: tx,
    action,
    actor: { id: user.id, name: user.name, role: user.role },
    target: { type: 'examination', id: exam.id, name: exam.name },
    schoolId: scope.school.id,
    description,
    change,
    req,
  });

/** The examination for a write, refusing what the scope may not change (403) and cancelled ones (409). */
async function findForWrite(tx, scope, id) {
  const row = await findExam(tx, scope, id);
  if (scope.branch) {
    if (!row.branchId) throw forbidden('Only the School Owner changes school-wide examinations.');
    if (!(await managerMayCreate(scope, tx))) throw forbidden('Your school lets only the School Owner manage examinations.');
  }
  if (row.status === 'CANCELLED') throw conflict('EXAM_CANCELLED', `${row.name} was cancelled. It is kept as it is.`);
  return row;
}

function writableYear(year) {
  if (year.status === 'CLOSED') throw conflict('YEAR_CLOSED', `${year.name} is closed. Its examinations are kept as they are.`);
}

/** Dates inside the year and the period (when one). `fromToday`: the first day cannot be before today. */
function checkDates(year, period, { startDate, endDate }, today, { fromToday }) {
  const ys = toDay(year.startDate);
  const ye = toDay(year.endDate);
  if (startDate < ys || endDate > ye) throw badRequest('Check the highlighted fields.', { [startDate < ys ? 'startDate' : 'endDate']: `Inside ${year.name}: ${ys} to ${ye}.` });
  if (period) {
    const ps = toDay(period.startDate);
    const pe = toDay(period.endDate);
    if (startDate < ps || endDate > pe) throw badRequest('Check the highlighted fields.', { [startDate < ps ? 'startDate' : 'endDate']: `Inside ${period.name}: ${ps} to ${pe}.` });
  }
  if (fromToday && startDate < today) throw badRequest('Check the highlighted fields.', { startDate: `Days before today are fixed. Choose ${today} or later.` });
}

async function resolveType(tx, scope, id, current) {
  const type = await tx.examType.findFirst({ where: { id, schoolId: scope.school.id } });
  if (!type) throw badRequest('Check the highlighted fields.', { examType: 'Choose one of your examination types.' });
  if (type.status !== 'ACTIVE' && type.id !== current) throw badRequest('Check the highlighted fields.', { examType: `${type.name} is inactive.` });
  return type;
}

async function resolvePeriod(tx, year, id, current) {
  if (!id) return null;
  const period = await tx.academicPeriod.findFirst({ where: { id, academicYearId: year.id } });
  if (!period) throw badRequest('Check the highlighted fields.', { period: `Choose one of ${year.name}’s periods.` });
  if (period.status !== 'ACTIVE' && period.id !== current) throw badRequest('Check the highlighted fields.', { period: `${period.name} is inactive.` });
  return period;
}

async function resolveBranch(tx, scope, id) {
  if (scope.branch) return scope.branch.id;
  if (!id) return null;
  const branch = await tx.branch.findFirst({ where: { id, schoolId: scope.school.id }, select: { id: true, status: true, name: true } });
  if (!branch) throw badRequest('Check the highlighted fields.', { branch: 'Choose one of your branches.' });
  return branch.id;
}

async function resolveClasses(tx, scope, ids, current = []) {
  if (!ids.length) return [];
  const rows = await tx.schoolClass.findMany({ where: { id: { in: ids }, schoolId: scope.school.id }, select: { id: true, name: true, status: true } });
  if (rows.length !== ids.length) throw badRequest('Check the highlighted fields.', { classes: 'Choose your school’s classes.' });
  const inactive = rows.filter((r) => r.status !== 'ACTIVE' && !current.includes(r.id));
  if (inactive.length) throw badRequest('Check the highlighted fields.', { classes: `${inactive.map((r) => r.name).join(', ')}: inactive.` });
  return rows;
}

/** Another scheduled examination sat by one of the classes, in an overlapping branch, on an overlapping day → 409. */
async function checkOverlap(tx, scope, { id, branchId, startDate, endDate, classIds }) {
  if (!classIds.length) return;
  const other = await tx.examination.findFirst({
    where: {
      schoolId: scope.school.id,
      status: 'SCHEDULED',
      ...(id && { id: { not: id } }),
      startDate: { lte: asDbDay(endDate) },
      endDate: { gte: asDbDay(startDate) },
      ...(branchId && { OR: [{ branchId: null }, { branchId }] }),
      classes: { some: { classId: { in: classIds } } },
    },
    select: { name: true, startDate: true, endDate: true, classes: { where: { classId: { in: classIds } }, select: { class: { select: { name: true } } } } },
  });
  if (other) {
    const names = other.classes.map((c) => c.class.name).join(', ');
    throw conflict('EXAM_OVERLAP', `${names} already sit ${other.name} (${toDay(other.startDate)} to ${toDay(other.endDate)}) on some of these days.`, {
      startDate: `Overlaps ${other.name}.`,
    });
  }
}

/** Papers for newly added classes, from each class's curriculum (active subjects). Returns how many. */
async function fillPapers(tx, scope, examId, classIds, type) {
  if (!classIds.length) return 0;
  const settings = await effectiveExamSettings(scope.school.id, scope.branch?.id ?? null, tx);
  const curriculum = await tx.classSubject.findMany({ where: { classId: { in: classIds }, subject: { status: 'ACTIVE' } }, select: { classId: true, subjectId: true } });
  if (!curriculum.length) return 0;
  const maxMarks = Math.min(type.defaultMaxMarks, settings.maxMarksLimit);
  await tx.examPaper.createMany({
    data: curriculum.map((c) => ({ schoolId: scope.school.id, examinationId: examId, classId: c.classId, subjectId: c.subjectId, maxMarks, durationMinutes: settings.paperMinutes })),
    skipDuplicates: true,
  });
  return curriculum.length;
}

const defaultName = (type, period) => (period ? `${type.name} – ${period.name}` : type.name);

/** Creates a draft examination (with papers from the classes' curricula). → getExamination. */
export async function createExamination(scope, values, user, req) {
  const prisma = getPrisma();
  if (!(await managerMayCreate(scope, prisma))) throw forbidden('Your school lets only the School Owner create examinations.');
  const year = await findYear(prisma, scope, values.academicYear);
  if (!year) throw conflict('NO_CURRENT_YEAR', 'There is no current academic year. Start one in Academic Years first.');
  writableYear(year);
  const today = await calendarToday();
  const id = await withExamLock(scope, async (tx) => {
    const type = await resolveType(tx, scope, values.examType);
    const period = await resolvePeriod(tx, year, values.period);
    const branchId = await resolveBranch(tx, scope, values.branch);
    const classes = await resolveClasses(tx, scope, values.classes ?? []);
    checkDates(year, period, values, today, { fromToday: true });
    const name = values.name ?? defaultName(type, period);
    const exam = await tx.examination.create({
      data: {
        schoolId: scope.school.id,
        academicYearId: year.id,
        academicPeriodId: period?.id ?? null,
        examTypeId: type.id,
        branchId,
        name,
        nameKey: examNameKey(name),
        description: values.description ?? null,
        startDate: asDbDay(values.startDate),
        endDate: asDbDay(values.endDate),
        stopsLessons: values.stopsLessons ?? type.stopsLessons,
        createdById: user.id,
        createdByName: user.name,
        classes: { create: classes.map((c) => ({ classId: c.id })) },
      },
    });
    const papers = await fillPapers(tx, scope, exam.id, classes.map((c) => c.id), type);
    await audit(tx, scope, user, req, AUDIT_ACTIONS.EXAMINATION_CREATED, exam, `Created the examination ${name} (${values.startDate} to ${values.endDate}) as a draft.`, {
      fields: ['name', 'examType', 'period', 'branch', 'startDate', 'endDate', 'stopsLessons', 'classes'],
      examType: type.name,
      period: period?.name ?? null,
      level: branchId ? 'branch' : 'school',
      classes: classes.map((c) => c.name),
      papers,
    });
    return exam.id;
  });
  return getExamination(scope, id);
}

/**
 * Changes an examination. A started one keeps its type, period, branches, classes, first day and
 * lessons setting (409 EXAM_STARTED); a completed one only its name and description. Classes added
 * get papers from their curriculum; classes removed lose their papers. → getExamination.
 */
export async function updateExamination(scope, id, values, user, req) {
  const today = await calendarToday();
  const changed = await withExamLock(scope, async (tx) => {
    const row = await findForWrite(tx, scope, id);
    const year = await tx.academicYear.findUnique({ where: { id: row.academicYearId } });
    writableYear(year);
    const current = { startDate: toDay(row.startDate), endDate: toDay(row.endDate), status: row.status };
    const { locked } = examActions(current, today, true);
    const currentClassIds = row.classes.map((c) => c.class.id);
    const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
    const asked = {
      examType: values.examType !== undefined && values.examType !== row.examTypeId,
      period: values.period !== undefined && (values.period ?? null) !== row.academicPeriodId,
      branch: !scope.branch && values.branch !== undefined && (values.branch ?? null) !== row.branchId,
      startDate: values.startDate !== undefined && values.startDate !== current.startDate,
      endDate: values.endDate !== undefined && values.endDate !== current.endDate,
      stopsLessons: values.stopsLessons !== undefined && values.stopsLessons !== row.stopsLessons,
      classes: values.classes !== undefined && !sameSet(values.classes, currentClassIds),
    };
    const refused = Object.keys(asked).filter((k) => asked[k] && locked.includes(k));
    if (refused.length) {
      const past = locked.includes('endDate');
      throw conflict(
        'EXAM_STARTED',
        past
          ? `${row.name} is over: only its name and description can change.`
          : `${row.name} has started, so its ${refused.map((k) => FIELD_LABELS[k] ?? k).join(', ')} stay as they are. It can end early instead.`,
        Object.fromEntries(refused.map((k) => [k, 'Fixed: the examination has started.'])),
      );
    }

    const type = asked.examType ? await resolveType(tx, scope, values.examType, row.examTypeId) : row.examType;
    const periodId = asked.period ? (values.period ?? null) : row.academicPeriodId;
    const period = await resolvePeriod(tx, year, periodId, row.academicPeriodId);
    const branchId = asked.branch ? await resolveBranch(tx, scope, values.branch) : row.branchId;
    const next = { startDate: values.startDate ?? current.startDate, endDate: values.endDate ?? current.endDate };
    if (next.endDate < next.startDate) throw badRequest('Check the highlighted fields.', { endDate: 'The last day is before the first day.' });
    const started = row.status === 'SCHEDULED' && current.startDate < today;
    if (asked.startDate || asked.endDate || asked.period) {
      checkDates(year, period, next, today, { fromToday: !started && (asked.startDate || row.status === 'SCHEDULED') });
      if (started && asked.endDate && next.endDate < addDays(today, -1)) throw badRequest('Check the highlighted fields.', { endDate: `Days before today are fixed. Choose ${addDays(today, -1)} or later.` });
    }
    let classIds = currentClassIds;
    let added = [];
    let removed = [];
    if (asked.classes) {
      await resolveClasses(tx, scope, values.classes, currentClassIds);
      added = values.classes.filter((c) => !currentClassIds.includes(c));
      removed = currentClassIds.filter((c) => !values.classes.includes(c));
      classIds = values.classes;
      if (row.status === 'SCHEDULED' && !classIds.length) throw badRequest('Check the highlighted fields.', { classes: 'A scheduled examination needs at least one class.' });
    }
    if (row.status === 'SCHEDULED') await checkOverlap(tx, scope, { id: row.id, branchId, ...next, classIds });
    // A timetable keeps its branches, and its sessions stay inside the examination's dates.
    if (asked.branch || asked.startDate || asked.endDate) {
      if (asked.branch && (await tx.examSession.findFirst({ where: { examinationId: row.id }, select: { id: true } }))) {
        throw conflict('TIMETABLE_EXISTS', `${row.name} has a timetable. Clear it before changing where the examination is held.`, { branch: 'Clear the timetable first.' });
      }
      const outside = await tx.examSession.findFirst({ where: { examinationId: row.id, OR: [{ date: { lt: asDbDay(next.startDate) } }, { date: { gt: asDbDay(next.endDate) } }] }, select: { date: true } });
      if (outside) throw conflict('TIMETABLE_OUTSIDE', `Its timetable has papers on ${toDay(outside.date)}, outside these dates. Move them or clear the timetable first.`, { startDate: 'Outside the timetable.' });
    }

    const data = {};
    const fields = [];
    if (values.name !== undefined && values.name !== row.name) {
      data.name = values.name;
      data.nameKey = examNameKey(values.name);
      fields.push('name');
    }
    if (values.description !== undefined && (values.description ?? null) !== (row.description ?? null)) {
      data.description = values.description;
      fields.push('description');
    }
    const set = { examType: ['examTypeId', type.id], period: ['academicPeriodId', periodId], branch: ['branchId', branchId], startDate: ['startDate', asDbDay(next.startDate)], endDate: ['endDate', asDbDay(next.endDate)], stopsLessons: ['stopsLessons', values.stopsLessons] };
    for (const [key, [column, value]] of Object.entries(set)) {
      if (!asked[key]) continue;
      data[column] = value;
      fields.push(key);
    }
    if (asked.classes) fields.push('classes');
    if (!fields.length) return false;

    if (removed.length) {
      const gone = await tx.examPaper.findMany({ where: { examinationId: row.id, classId: { in: removed } }, select: { id: true } });
      await dropPaperSittings(tx, gone.map((g) => g.id), today);
      await tx.examPaper.deleteMany({ where: { examinationId: row.id, classId: { in: removed } } });
      await tx.examinationClass.deleteMany({ where: { examinationId: row.id, classId: { in: removed } } });
    }
    if (added.length) await tx.examinationClass.createMany({ data: added.map((classId) => ({ examinationId: row.id, classId })) });
    const exam = Object.keys(data).length ? await tx.examination.update({ where: { id: row.id }, data }) : row;
    const papers = await fillPapers(tx, scope, row.id, added, type);
    await audit(tx, scope, user, req, AUDIT_ACTIONS.EXAMINATION_UPDATED, exam, `Updated the examination ${exam.name}: ${fields.join(', ')}.`, {
      fields,
      ...(asked.startDate || asked.endDate ? { from: `${current.startDate} to ${current.endDate}`, to: `${next.startDate} to ${next.endDate}` } : {}),
      ...(asked.classes && { classesAdded: added.length, classesRemoved: removed.length, papersAdded: papers }),
    });
    return true;
  });
  return { ...(await getExamination(scope, id)), changed };
}

/**
 * Puts a draft on the calendar: an active type, a first day from today, at least one class and a
 * paper for every class, no overlap. From then its days stop its classes' lessons (when it stops lessons).
 */
export async function scheduleExamination(scope, id, user, req) {
  const today = await calendarToday();
  await withExamLock(scope, async (tx) => {
    const row = await findForWrite(tx, scope, id);
    if (row.status !== 'DRAFT') throw conflict('NOT_A_DRAFT', `${row.name} is already scheduled.`);
    writableYear(row.academicYear);
    if (row.examType.status !== 'ACTIVE') throw conflict('TYPE_INACTIVE', `${row.examType.name} is inactive. Choose an active examination type first.`);
    if (row.academicPeriod && row.academicPeriod.status !== 'ACTIVE') throw conflict('PERIOD_INACTIVE', `${row.academicPeriod.name} is inactive. Choose an active period first.`);
    const dates = { startDate: toDay(row.startDate), endDate: toDay(row.endDate) };
    if (dates.startDate < today) throw conflict('EXAM_IN_PAST', `${row.name} starts on ${dates.startDate}, before today. Move its dates first.`, { startDate: `Choose ${today} or later.` });
    const classIds = row.classes.map((c) => c.class.id);
    if (!classIds.length) throw conflict('NO_CLASSES', `Choose the classes sitting ${row.name} first.`);
    const withPapers = await tx.examPaper.groupBy({ by: ['classId'], where: { examinationId: row.id }, _count: { _all: true } });
    const missing = row.classes.filter((c) => !withPapers.some((w) => w.classId === c.class.id)).map((c) => c.class.name);
    if (missing.length) throw conflict('NO_PAPERS', `Add papers for ${missing.join(', ')} first.`, { classes: missing });
    await checkOverlap(tx, scope, { id: row.id, branchId: row.branchId, ...dates, classIds });
    const exam = await tx.examination.update({ where: { id: row.id }, data: { status: 'SCHEDULED', scheduledAt: new Date() } });
    await audit(tx, scope, user, req, AUDIT_ACTIONS.EXAMINATION_SCHEDULED, exam, `Scheduled ${exam.name} (${dates.startDate} to ${dates.endDate})${exam.stopsLessons ? '; normal lessons of its classes stop on those days' : ''}.`, {
      fields: ['status'],
      from: 'draft',
      to: 'scheduled',
      stopsLessons: exam.stopsLessons,
    });
  });
  return getExamination(scope, id);
}

/** Takes a scheduled examination that has not started back to draft (off the calendar). */
export async function unscheduleExamination(scope, id, user, req) {
  const today = await calendarToday();
  await withExamLock(scope, async (tx) => {
    const row = await findForWrite(tx, scope, id);
    if (row.status !== 'SCHEDULED') throw conflict('NOT_SCHEDULED', `${row.name} is a draft already.`);
    if (toDay(row.startDate) < today) throw conflict('EXAM_STARTED', `${row.name} has started. It can end early instead.`);
    const exam = await tx.examination.update({ where: { id: row.id }, data: { status: 'DRAFT', scheduledAt: null } });
    await audit(tx, scope, user, req, AUDIT_ACTIONS.EXAMINATION_UNSCHEDULED, exam, `Returned ${exam.name} to draft: it is off the calendar and lessons are not stopped.`, { fields: ['status'], from: 'scheduled', to: 'draft' });
  });
  return getExamination(scope, id);
}

/** Cancels a draft, or a scheduled examination that has not started (kept, with the reason). */
export async function cancelExamination(scope, id, { reason }, user, req) {
  const today = await calendarToday();
  await withExamLock(scope, async (tx) => {
    const row = await findForWrite(tx, scope, id);
    const { cancel } = examActions({ status: row.status, startDate: toDay(row.startDate), endDate: toDay(row.endDate) }, today, true);
    if (cancel !== 'cancel') throw conflict('EXAM_STARTED', cancel === 'end' ? `${row.name} has started. End it early instead.` : `${row.name} is over and is kept as it is.`);
    const exam = await tx.examination.update({ where: { id: row.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } });
    await audit(tx, scope, user, req, AUDIT_ACTIONS.EXAMINATION_CANCELLED, exam, `Cancelled the examination ${exam.name}${reason ? `: ${reason}` : ''}.`, { fields: ['status'], from: status(row.status), to: 'cancelled', reason });
  });
  return getExamination(scope, id);
}

/** Ends a running examination early: its last day becomes yesterday (today's lessons are back). */
export async function endExamination(scope, id, { reason }, user, req) {
  const today = await calendarToday();
  await withExamLock(scope, async (tx) => {
    const row = await findForWrite(tx, scope, id);
    const { cancel } = examActions({ status: row.status, startDate: toDay(row.startDate), endDate: toDay(row.endDate) }, today, true);
    if (cancel !== 'end') throw conflict('EXAM_NOT_RUNNING', cancel === 'cancel' ? `${row.name} has not started. Cancel it instead.` : `${row.name} is over.`);
    const endDate = addDays(today, -1);
    const exam = await tx.examination.update({ where: { id: row.id }, data: { endDate: asDbDay(endDate) } });
    // Timetabled papers from today on are no longer sat (past sessions stay).
    const later = { examinationId: row.id, date: { gt: asDbDay(endDate) } };
    await refuseIfAttendance(tx, { session: later });
    await tx.examInvigilation.deleteMany({ where: { session: later } });
    await tx.examSeat.deleteMany({ where: { session: later } });
    await tx.examSitting.deleteMany({ where: { session: later } });
    await tx.examSession.deleteMany({ where: later });
    await audit(tx, scope, user, req, AUDIT_ACTIONS.EXAMINATION_ENDED, exam, `Ended ${exam.name} early: its last day is now ${endDate}${reason ? ` (${reason})` : ''}.`, {
      fields: ['endDate'],
      from: toDay(row.endDate),
      to: endDate,
      reason,
    });
  });
  return getExamination(scope, id);
}

// ---- papers -----------------------------------------------------------------------------------

async function paperLimit(tx, scope, maxMarks) {
  if (maxMarks === undefined) return;
  const values = await effectiveExamSettings(scope.school.id, scope.branch?.id ?? null, tx);
  if (maxMarks > values.maxMarksLimit) throw badRequest('Check the highlighted fields.', { maxMarks: `At most ${values.maxMarksLimit} (Settings → highest marks a paper can be out of).` });
}

const paperAudit = (tx, scope, user, req, exam, description, change) => audit(tx, scope, user, req, AUDIT_ACTIONS.EXAM_PAPERS_CHANGED, exam, description, change);

/** Adds a paper (a subject of a class sitting the examination). */
export async function addPaper(scope, examId, values, user, req) {
  await withExamLock(scope, async (tx) => {
    const exam = await findForWrite(tx, scope, examId);
    const cls = exam.classes.find((c) => c.class.id === values.class)?.class;
    if (!cls) throw badRequest('Check the highlighted fields.', { class: 'Choose a class sitting this examination.' });
    const subject = await tx.subject.findFirst({ where: { id: values.subject, schoolId: scope.school.id } });
    if (!subject || subject.status !== 'ACTIVE') throw badRequest('Check the highlighted fields.', { subject: 'Choose one of your active subjects.' });
    await paperLimit(tx, scope, values.maxMarks);
    const settings = await effectiveExamSettings(scope.school.id, scope.branch?.id ?? null, tx);
    const exists = await tx.examPaper.findFirst({ where: { examinationId: exam.id, classId: cls.id, subjectId: subject.id } });
    if (exists) throw conflict('PAPER_EXISTS', `${cls.name} already has a ${subject.name} paper.`, { subject: 'Already a paper of this class.' });
    const paper = await tx.examPaper.create({
      data: {
        schoolId: scope.school.id,
        examinationId: exam.id,
        classId: cls.id,
        subjectId: subject.id,
        maxMarks: values.maxMarks ?? Math.min(exam.examType.defaultMaxMarks, settings.maxMarksLimit),
        durationMinutes: values.durationMinutes ?? settings.paperMinutes,
      },
    });
    await paperAudit(tx, scope, user, req, exam, `Added the ${subject.name} paper of ${cls.name} to ${exam.name} (out of ${paper.maxMarks}, ${paper.durationMinutes} minutes).`, {
      fields: ['papers'],
      added: { class: cls.name, subject: subject.name, maxMarks: paper.maxMarks, durationMinutes: paper.durationMinutes },
    });
  });
  return getExamination(scope, examId);
}

async function findPaper(tx, exam, paperId) {
  const paper = isUuid(paperId) ? await tx.examPaper.findFirst({ where: { id: paperId, examinationId: exam.id }, include: { subject: { select: { name: true } }, class: { select: { name: true } } } }) : null;
  if (!paper) throw notFound('Paper not found.');
  return paper;
}

/** Changes a paper's marks out of and length. */
export async function updatePaper(scope, examId, paperId, values, user, req) {
  await withExamLock(scope, async (tx) => {
    const exam = await findForWrite(tx, scope, examId);
    const paper = await findPaper(tx, exam, paperId);
    await paperLimit(tx, scope, values.maxMarks);
    const data = {};
    if (values.maxMarks !== undefined && values.maxMarks !== paper.maxMarks) data.maxMarks = values.maxMarks;
    if (values.durationMinutes !== undefined && values.durationMinutes !== paper.durationMinutes) data.durationMinutes = values.durationMinutes;
    if (!Object.keys(data).length) return;
    await tx.examPaper.update({ where: { id: paper.id }, data });
    if (data.durationMinutes !== undefined) await refitPaperSessions(tx, paper.id, await calendarToday());
    await paperAudit(tx, scope, user, req, exam, `Changed the ${paper.subject.name} paper of ${paper.class.name} in ${exam.name}.`, {
      fields: Object.keys(data),
      paper: `${paper.class.name} · ${paper.subject.name}`,
      from: { maxMarks: paper.maxMarks, durationMinutes: paper.durationMinutes },
      to: { maxMarks: data.maxMarks ?? paper.maxMarks, durationMinutes: data.durationMinutes ?? paper.durationMinutes },
    });
  });
  return getExamination(scope, examId);
}

/** Removes a paper (nothing refers to papers yet). A scheduled examination keeps one paper per class at least. */
export async function removePaper(scope, examId, paperId, user, req) {
  await withExamLock(scope, async (tx) => {
    const exam = await findForWrite(tx, scope, examId);
    const paper = await findPaper(tx, exam, paperId);
    if (exam.status === 'SCHEDULED') {
      const left = await tx.examPaper.count({ where: { examinationId: exam.id, classId: paper.classId } });
      if (left <= 1) throw conflict('LAST_PAPER', `${paper.class.name} needs at least one paper while ${exam.name} is scheduled. Remove the class instead.`);
    }
    await dropPaperSittings(tx, [paper.id], await calendarToday());
    await tx.examPaper.delete({ where: { id: paper.id } });
    await paperAudit(tx, scope, user, req, exam, `Removed the ${paper.subject.name} paper of ${paper.class.name} from ${exam.name}.`, {
      fields: ['papers'],
      removed: { class: paper.class.name, subject: paper.subject.name },
    });
  });
  return getExamination(scope, examId);
}

// ---- overview and calendar ---------------------------------------------------------------------

/** For the overview: counts of the current year's examinations by state and the one to show first. */
export async function examinationSummary(scope, yearId, client = getPrisma()) {
  const today = await calendarToday();
  const rows = yearId ? await client.examination.findMany({ where: { ...visible(scope), academicYearId: yearId, status: { not: 'CANCELLED' } }, include: examInclude, orderBy: { startDate: 'asc' } }) : [];
  const items = rows.map((r) => toExamination(r, today, false));
  const count = (s) => items.filter((i) => i.state === s).length;
  const current = items.find((i) => i.state === 'active') ?? items.find((i) => i.state === 'planned') ?? null;
  return { draft: count('draft'), planned: count('planned'), active: count('active'), completed: count('completed'), current };
}
