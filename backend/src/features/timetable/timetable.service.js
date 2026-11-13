import { badRequest, conflict, forbidden, notFound } from '../../common/httpError.js';
import { fromDbStatus } from '../../common/listQuery.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { addDays, asDbDay, toDay, versionOn } from '../academic-calendar/schoolDays.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockActiveSchool, lockOperatingBranch } from '../branches/branches.service.js';
import { sectionDisplayName } from '../classes/classInput.js';
import { WEEKDAYS } from '../schedules/scheduleInput.js';
import { describeClash, lessonNumbersByDay, minutesToTime, teacherClashes, withRanges } from './bellTimes.js';
import { loadSectionDays } from './lessons.js';
import { bellNameKey } from './timetableInput.js';

/*
 * Bell schedules and section timetables (docs/business-rules.md → Bell schedules; Timetables).
 *
 * Scope (from the account, never the request): { school, branch: null } for the School Owner —
 * school-wide bell schedules and every branch's, every section; { school, branch } for a Manager —
 * reads the school-wide bell schedules and their branch's, changes their branch's only (403 for
 * school-wide ones), and their branch's sections' timetables. Anything else is not found (404).
 *
 * Both are versioned by date and never edited: a change applies from a date (today at the earliest;
 * from tomorrow when the version in effect today started before today, so a day already under way
 * keeps its times and lessons). A version saved for the date of another replaces it; one that has
 * not started can be cancelled. Nothing is deleted.
 *
 * Writes share the school's class lock (`classes:<schoolId>`: sections, subjects, teaching and
 * timetables change one at a time), need the school ACTIVE (a Manager: their branch operating), and
 * are audited in the same transaction. A teacher is never booked in two sections at overlapping
 * times (checked against every timetable of the school, under the bell times of each date).
 */

const TX = { timeout: 30000, maxWait: 10000 };
const DAY_LABELS = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };
const invalid = (errors) => badRequest('Check the highlighted fields.', errors);
const YEAR_CLOSED = (year) => conflict('YEAR_CLOSED', `${year.name} is closed. Its timetables are kept as they are.`);
const SCHOOL_LEVEL = () => forbidden('School-wide bell schedules are managed by your School Owner. You can create your branch’s own.');

const mentions = (error, text) => {
  try {
    return `${error?.message ?? ''} ${JSON.stringify(error?.meta ?? {})}`.includes(text);
  } catch {
    return false;
  }
};
function translateDbError(error) {
  if (mentions(error, 'BellSchedule_school_name') || mentions(error, 'BellSchedule_branch_name')) return conflict('NAME_TAKEN', 'A bell schedule with this name already exists here.', { name: 'Already used.' });
  if (mentions(error, 'BellScheduleVersion_one_per_date') || mentions(error, 'TimetableVersion_one_per_date')) {
    return conflict('VERSION_EXISTS', 'This was changed for the same date at the same time. Reload and try again.');
  }
  return error;
}

async function withTimetableLock(scope, what, work) {
  try {
    return await getPrisma().$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`classes:${scope.school.id}`}))`;
      if (scope.branch) await lockOperatingBranch(tx, scope, what);
      else await lockActiveSchool(tx, scope.school);
      return work(tx);
    }, TX);
  } catch (error) {
    throw translateDbError(error);
  }
}

const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const audit = (tx, action, scope, { user, req, target, description, fields, details }) =>
  recordAuditEvent({
    client: tx,
    action,
    actor: actorOf(user),
    target,
    schoolId: scope.school.id,
    description,
    change: { fields, ...details },
    req,
  });

/**
 * The first date a new version can start, given the active versions of one owner: today, or
 * tomorrow when the version in effect today started before today (that day is under way).
 */
function earliestStart(activeVersions, today) {
  const inEffect = versionOn(activeVersions, today);
  return inEffect && inEffect.effectiveFrom < today ? addDays(today, 1) : today;
}

const plainVersions = (rows) => rows.filter((v) => !v.cancelledAt).map((v) => ({ ...v, effectiveFrom: toDay(v.effectiveFrom) }));

function versionState(v, active, today) {
  if (v.cancelledAt) return 'cancelled';
  const inEffect = versionOn(active, today);
  if (inEffect && inEffect.id === v.id) return 'current';
  return toDay(v.effectiveFrom) > today ? 'scheduled' : 'past';
}

// ---- shapes -----------------------------------------------------------------------------------

const brief = (b) => b && { id: b.id, name: b.name, code: b.code };
const toPeriod = (p) => ({
  kind: p.kind === 'LESSON' ? 'lesson' : 'break',
  number: p.number,
  name: p.name ?? null,
  days: p.days,
  start: minutesToTime(p.startMinute),
  end: minutesToTime(p.endMinute),
  mainBreak: p.mainBreak,
});
const periodOrder = (a, b) => a.startMinute - b.startMinute || WEEKDAYS.indexOf(a.days[0]) - WEEKDAYS.indexOf(b.days[0]);

/** Per weekday: lessons, first start, last end, and whether a main break splits it. */
function bellSummary(periods) {
  const byDay = {};
  for (const day of WEEKDAYS) {
    const items = periods.filter((p) => p.days.includes(day));
    if (!items.length) continue;
    byDay[day] = {
      lessons: items.filter((p) => p.kind === 'LESSON').length,
      start: minutesToTime(Math.min(...items.map((p) => p.startMinute))),
      end: minutesToTime(Math.max(...items.map((p) => p.endMinute))),
      halves: items.some((p) => p.kind === 'BREAK' && p.mainBreak) ? 2 : 1,
    };
  }
  return byDay;
}

function summaryText(periods) {
  const byDay = bellSummary(periods);
  const groups = new Map();
  for (const [day, s] of Object.entries(byDay)) {
    const key = `${s.lessons} lessons, ${s.start}–${s.end}${s.halves === 2 ? ', main break' : ''}`;
    groups.set(key, [...(groups.get(key) ?? []), DAY_LABELS[day]]);
  }
  return [...groups.entries()].map(([text, days]) => `${days.join(', ')}: ${text}`).join('; ') || 'No periods';
}

function toBellVersion(v, active, today) {
  const periods = [...v.periods].sort(periodOrder);
  return {
    id: v.id,
    effectiveFrom: toDay(v.effectiveFrom),
    recordedAt: v.recordedAt.toISOString(),
    cancelledAt: v.cancelledAt?.toISOString() ?? null,
    state: versionState(v, active, today),
    periods: periods.map(toPeriod),
    summary: bellSummary(periods),
    lessonNumbers: lessonNumbersByDay(periods),
  };
}

function toBell(b, today, scope, { withVersions = false } = {}) {
  const active = plainVersions(b.versions ?? []);
  const sorted = [...(b.versions ?? [])].sort((x, y) => toDay(x.effectiveFrom).localeCompare(toDay(y.effectiveFrom)) || x.recordedAt - y.recordedAt);
  const current = versionOn(active, today) ?? active.filter((v) => v.effectiveFrom > today).sort((x, y) => x.effectiveFrom.localeCompare(y.effectiveFrom))[0] ?? null;
  return {
    id: b.id,
    name: b.name,
    description: b.description ?? '',
    level: b.branchId ? 'branch' : 'school',
    branch: brief(b.branch),
    status: fromDbStatus(b.status),
    // The times in effect today (or, before the first starts, the first scheduled ones).
    current: current ? toBellVersion(b.versions.find((v) => v.id === current.id), active, today) : null,
    scheduledChanges: active.filter((v) => v.effectiveFrom > today).length,
    sectionsUsing: b._count?.timetables,
    canManage: !scope.branch || b.branchId === scope.branch.id,
    ...(withVersions && { versions: sorted.map((v) => toBellVersion(v, active, today)) }),
  };
}

const bellInclude = {
  branch: { select: { id: true, name: true, code: true } },
  versions: { include: { periods: true } },
  _count: { select: { timetables: { where: { cancelledAt: null } } } },
};

const bellScopeWhere = (scope) => ({ schoolId: scope.school.id, ...(scope.branch && { OR: [{ branchId: null }, { branchId: scope.branch.id }] }) });

async function findBell(client, scope, id, { forWrite = false } = {}) {
  const bell = isUuid(id) ? await client.bellSchedule.findFirst({ where: { id, ...bellScopeWhere(scope) }, include: bellInclude }) : null;
  if (!bell) throw notFound('Bell schedule not found.');
  if (forWrite && scope.branch && !bell.branchId) throw SCHOOL_LEVEL();
  return bell;
}

// ---- bell schedules: reads ------------------------------------------------------------------

/**
 * Bell schedules in scope with their current times. Owner filters: branch ('school' for the
 * school-wide ones, or a branch id: that branch's own). Status: active (default), inactive, all.
 */
export async function listBellSchedules(scope, { status, branch }) {
  const prisma = getPrisma();
  const today = await calendarToday();
  const rows = await prisma.bellSchedule.findMany({
    where: {
      ...bellScopeWhere(scope),
      ...(status !== 'all' && { status: status === 'inactive' ? 'INACTIVE' : 'ACTIVE' }),
      ...(branch === 'school' ? { branchId: null } : branch ? { branchId: branch } : {}),
    },
    include: bellInclude,
    orderBy: [{ branchId: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
  });
  return { today, items: rows.map((b) => toBell(b, today, scope)) };
}

/** One bell schedule with every version (cancelled ones too) and its periods. */
export async function getBellSchedule(scope, id) {
  const prisma = getPrisma();
  const [today, bell] = await Promise.all([calendarToday(), findBell(prisma, scope, id)]);
  const active = plainVersions(bell.versions);
  return { today, firstEditableDate: earliestStart(active, today), bellSchedule: toBell(bell, today, scope, { withVersions: true }) };
}

// ---- bell schedules: changes ----------------------------------------------------------------

/** Creates a bell schedule (no times yet): school-wide or one branch's (Owner), the Manager's branch's. */
export async function createBellSchedule(scope, values, user, req) {
  const today = await calendarToday();
  const created = await withTimetableLock(scope, 'bell schedules', async (tx) => {
    let branch = null;
    if (scope.branch) branch = brief(scope.branch);
    else if (values.branchId) {
      branch = await tx.branch.findFirst({ where: { id: values.branchId, schoolId: scope.school.id }, select: { id: true, name: true, code: true } });
      if (!branch) throw notFound('Branch not found.');
    }
    const key = bellNameKey(values.name);
    const taken = await tx.bellSchedule.findFirst({ where: { schoolId: scope.school.id, branchId: branch?.id ?? null, nameKey: key } });
    if (taken) throw conflict('NAME_TAKEN', `${branch ? branch.name : 'The school'} already has a bell schedule named ${taken.name}.`, { name: 'Already used.' });
    const row = await tx.bellSchedule.create({
      data: { schoolId: scope.school.id, branchId: branch?.id ?? null, name: values.name, nameKey: key, description: values.description ?? null },
      include: bellInclude,
    });
    await audit(tx, AUDIT_ACTIONS.BELL_SCHEDULE_CREATED, scope, {
      user,
      req,
      target: { type: 'bell_schedule', id: row.id, name: row.name },
      description: `Bell schedule ${row.name} created for ${branch ? branch.name : 'the whole school'}.`,
      fields: [
        { field: 'Name', from: null, to: row.name },
        { field: 'For', from: null, to: branch ? branch.name : 'Whole school' },
        ...(row.description ? [{ field: 'Description', from: null, to: row.description }] : []),
      ],
      details: { branchId: branch?.id ?? null },
    });
    return row;
  });
  return toBell(created, today, scope, { withVersions: true });
}

/** Renames a bell schedule or changes its description. */
export async function updateBellSchedule(scope, id, values, user, req) {
  const today = await calendarToday();
  const saved = await withTimetableLock(scope, 'bell schedules', async (tx) => {
    const bell = await findBell(tx, scope, id, { forWrite: true });
    const current = { name: bell.name, description: bell.description ?? null };
    const changed = Object.keys(values).filter((f) => values[f] !== current[f]);
    if (!changed.length) return bell;
    const data = { ...values };
    if (changed.includes('name')) {
      data.nameKey = bellNameKey(values.name);
      const taken = await tx.bellSchedule.findFirst({ where: { schoolId: bell.schoolId, branchId: bell.branchId, nameKey: data.nameKey, id: { not: bell.id } } });
      if (taken) throw conflict('NAME_TAKEN', `There is already a bell schedule named ${taken.name} here.`, { name: 'Already used.' });
    }
    const row = await tx.bellSchedule.update({ where: { id: bell.id }, data, include: bellInclude });
    await audit(tx, AUDIT_ACTIONS.BELL_SCHEDULE_UPDATED, scope, {
      user,
      req,
      target: { type: 'bell_schedule', id: row.id, name: row.name },
      description: `Bell schedule ${row.name} updated.`,
      fields: changed.map((f) => ({ field: f === 'name' ? 'Name' : 'Description', from: current[f], to: values[f] })),
      details: { branchId: row.branchId },
    });
    return row;
  });
  return toBell(saved, today, scope, { withVersions: true });
}

/**
 * Deactivates a bell schedule no section's timetable uses today or later (409 BELL_SCHEDULE_IN_USE),
 * or reactivates it. Inactive schedules cannot be chosen for timetables or given new times.
 */
export async function setBellScheduleStatus(scope, id, active, user, req) {
  const today = await calendarToday();
  const saved = await withTimetableLock(scope, 'bell schedules', async (tx) => {
    const bell = await findBell(tx, scope, id, { forWrite: true });
    if ((bell.status === 'ACTIVE') === active) return bell;
    if (!active) {
      const versions = await tx.timetableVersion.findMany({
        where: { cancelledAt: null, section: { timetableVersions: { some: { bellScheduleId: bell.id, cancelledAt: null } } } },
        select: { id: true, sectionId: true, bellScheduleId: true, effectiveFrom: true, academicYear: { select: { endDate: true } }, section: { select: { name: true, class: { select: { name: true } } } } },
      });
      const users = [];
      const bySection = groupBy(versions, (v) => v.sectionId);
      for (const rows of bySection.values()) {
        const ranged = withRanges(rows.map((v) => ({ ...v, effectiveFrom: toDay(v.effectiveFrom) })), toDay(rows[0].academicYear.endDate));
        const live = ranged.find((v) => v.bellScheduleId === bell.id && v.to >= today);
        if (live) users.push(sectionDisplayName(live.section.class.name, live.section.name));
      }
      if (users.length) {
        throw conflict('BELL_SCHEDULE_IN_USE', `${bell.name} is used by ${users.length} section timetable${users.length === 1 ? '' : 's'} (${users.slice(0, 5).join(', ')}${users.length > 5 ? ', …' : ''}). Move them to another bell schedule first.`, { sections: users });
      }
    }
    const row = await tx.bellSchedule.update({ where: { id: bell.id }, data: active ? { status: 'ACTIVE', deactivatedAt: null } : { status: 'INACTIVE', deactivatedAt: new Date() }, include: bellInclude });
    await audit(tx, active ? AUDIT_ACTIONS.BELL_SCHEDULE_REACTIVATED : AUDIT_ACTIONS.BELL_SCHEDULE_DEACTIVATED, scope, {
      user,
      req,
      target: { type: 'bell_schedule', id: row.id, name: row.name },
      description: `Bell schedule ${row.name} ${active ? 'reactivated' : 'deactivated'}.`,
      fields: [{ field: 'Status', from: active ? 'Inactive' : 'Active', to: active ? 'Active' : 'Inactive' }],
      details: { branchId: row.branchId },
    });
    return row;
  });
  return toBell(saved, today, scope, { withVersions: true });
}

function groupBy(rows, keyOf) {
  const map = new Map();
  for (const row of rows) map.set(keyOf(row), [...(map.get(keyOf(row)) ?? []), row]);
  return map;
}

const samePeriods = (a, b) => {
  const norm = (ps) =>
    ps
      .map((p) => `${p.kind}|${p.number ?? ''}|${p.name ?? ''}|${p.days.join(',')}|${p.startMinute}|${p.endMinute}|${p.mainBreak ? 1 : 0}`)
      .sort()
      .join(';');
  return norm(a) === norm(b);
};

/**
 * Sets a bell schedule's times from a date (see the header for the earliest date). Refused when a
 * teacher would then teach two sections at overlapping times (409 TEACHER_CLASH). Timetable lessons
 * in periods the new times do not have are kept but do not take place; they are listed in
 * `warnings`.
 */
export async function saveBellTimes(scope, id, values, user, req) {
  const today = await calendarToday();
  const warnings = await withTimetableLock(scope, 'bell schedules', async (tx) => {
    const bell = await findBell(tx, scope, id, { forWrite: true });
    if (bell.status !== 'ACTIVE') throw conflict('BELL_SCHEDULE_INACTIVE', `${bell.name} is inactive. Reactivate it to change its times.`);
    const active = plainVersions(bell.versions);
    const from = values.effectiveFrom;
    const earliest = earliestStart(active, today);
    if (from < earliest) {
      throw invalid({ effectiveFrom: earliest > today ? `These times already apply today, so a change can start on ${earliest} at the earliest.` : `Choose today (${today}) or a later date.` });
    }
    const replaced = active.find((v) => v.effectiveFrom === from) ?? null;
    const previous = versionOn(active.filter((v) => v !== replaced), addDays(from, -1));
    if (replaced ? samePeriods(replaced.periods, values.periods) : previous && samePeriods(previous.periods, values.periods)) return [];

    // The schedule's versions as they will be, for the clash check from `from` on.
    const next = [...active.filter((v) => v !== replaced), { id: 'new', effectiveFrom: from, periods: values.periods }];
    await assertNoClashesForBell(tx, scope, bell, next, from);
    const found = await lessonsOutsideTimes(tx, bell.id, next, from);

    if (replaced) await tx.bellScheduleVersion.update({ where: { id: replaced.id }, data: { cancelledAt: new Date() } });
    const version = await tx.bellScheduleVersion.create({ data: { bellScheduleId: bell.id, effectiveFrom: asDbDay(from) } });
    await tx.bellPeriod.createMany({ data: values.periods.map((p) => ({ ...p, versionId: version.id })) });
    await audit(tx, AUDIT_ACTIONS.BELL_TIMES_CHANGED, scope, {
      user,
      req,
      target: { type: 'bell_schedule', id: bell.id, name: bell.name },
      description: `Times of ${bell.name} from ${from}: ${summaryText(values.periods)}.${replaced ? ' Replaces the change scheduled for that date.' : ''}`,
      fields: [
        { field: 'Times', from: previous || replaced ? summaryText((replaced ?? previous).periods) : null, to: summaryText(values.periods) },
        { field: 'Effective from', from: null, to: from },
      ],
      details: { bellScheduleId: bell.id, branchId: bell.branchId, versionId: version.id },
    });
    return found;
  });
  return { ...(await getBellSchedule(scope, id)), warnings };
}

/** Cancels scheduled times (not started; 409 VERSION_IN_EFFECT otherwise). The times before them apply again. */
export async function cancelBellTimes(scope, id, versionId, user, req) {
  const today = await calendarToday();
  await withTimetableLock(scope, 'bell schedules', async (tx) => {
    const bell = await findBell(tx, scope, id, { forWrite: true });
    const version = bell.versions.find((v) => v.id === versionId);
    if (!version) throw notFound('Bell times change not found.');
    if (version.cancelledAt) return;
    const from = toDay(version.effectiveFrom);
    if (from <= today) throw conflict('VERSION_IN_EFFECT', `These times have applied since ${from}. Set new times from a later date instead.`);
    const next = plainVersions(bell.versions).filter((v) => v.id !== version.id);
    if (!versionOn(next, from)) {
      const using = await tx.timetableVersion.count({ where: { bellScheduleId: bell.id, cancelledAt: null } });
      if (using) throw conflict('BELL_TIMES_IN_USE', `Timetables use ${bell.name} from ${from}; without these times it would have none. Set other times for that date instead.`);
    }
    await assertNoClashesForBell(tx, scope, bell, next, from);
    await tx.bellScheduleVersion.update({ where: { id: version.id }, data: { cancelledAt: new Date() } });
    await audit(tx, AUDIT_ACTIONS.BELL_TIMES_CHANGE_CANCELLED, scope, {
      user,
      req,
      target: { type: 'bell_schedule', id: bell.id, name: bell.name },
      description: `Scheduled times of ${bell.name} from ${from} cancelled.`,
      fields: [{ field: 'Times', from: summaryText(version.periods), to: null }],
      details: { bellScheduleId: bell.id, branchId: bell.branchId, versionId: version.id },
    });
  });
  return getBellSchedule(scope, id);
}

// ---- teacher clashes ----------------------------------------------------------------------------

const clashVersionSelect = {
  id: true,
  sectionId: true,
  academicYearId: true,
  bellScheduleId: true,
  effectiveFrom: true,
  academicYear: { select: { endDate: true } },
  section: { select: { name: true, class: { select: { name: true } } } },
  slots: { select: { weekday: true, periodNumber: true, teacherId: true, teacher: { select: { name: true } }, subject: { select: { name: true } } } },
};

const toClashVersion = (v) => ({
  id: v.id,
  sectionId: v.sectionId,
  sectionName: v.sectionName ?? sectionDisplayName(v.section.class.name, v.section.name),
  bellScheduleId: v.bellScheduleId,
  effectiveFrom: typeof v.effectiveFrom === 'string' ? v.effectiveFrom : toDay(v.effectiveFrom),
  yearEnd: v.yearEnd ?? toDay(v.academicYear.endDate),
  slots: v.slots.map((s) => ({ weekday: s.weekday, periodNumber: s.periodNumber, teacherId: s.teacherId, teacherName: s.teacherName ?? s.teacher?.name ?? 'A teacher', subjectName: s.subjectName ?? s.subject?.name ?? '' })),
});

/**
 * Throws 409 TEACHER_CLASH when, after a change, a teacher would be in two sections at overlapping
 * times. `changes`: { add: [timetable versions (toClashVersion shape)], remove: Set of version ids,
 * bells: Map bellScheduleId → active versions to use instead of the stored ones, candidates:
 * (version) => boolean — which versions changed and must be checked, clipFrom: dates before it are
 * not checked }. Only the timetables of the teachers involved are read (two to three queries).
 */
async function assertNoClashes(tx, scope, { add = [], remove = new Set(), bells = new Map(), candidates, clipFrom, teacherIds }) {
  if (!teacherIds.size) return;
  const sectionRows = await tx.timetableVersion.findMany({
    where: { schoolId: scope.school.id, cancelledAt: null, slots: { some: { teacherId: { in: [...teacherIds] } } } },
    select: { sectionId: true },
    distinct: ['sectionId'],
  });
  const sectionIds = [...new Set([...sectionRows.map((r) => r.sectionId), ...add.map((v) => v.sectionId)])];
  const stored = await tx.timetableVersion.findMany({ where: { sectionId: { in: sectionIds }, cancelledAt: null }, select: clashVersionSelect });
  const all = [...stored.filter((v) => !remove.has(v.id)).map(toClashVersion), ...add];

  const ranged = [];
  for (const rows of groupBy(all, (v) => v.sectionId).values()) ranged.push(...withRanges(rows, rows[0].yearEnd).map((v) => ({ ...v, from: v.effectiveFrom })));
  const clipped = ranged.map((v) => ({ ...v, from: v.from < clipFrom ? clipFrom : v.from })).filter((v) => v.from <= v.to);
  const checked = clipped.filter(candidates);
  if (!checked.length) return;

  const bellIds = [...new Set(clipped.map((v) => v.bellScheduleId))].filter((id) => !bells.has(id));
  const bellRows = bellIds.length
    ? await tx.bellScheduleVersion.findMany({ where: { bellScheduleId: { in: bellIds }, cancelledAt: null }, select: { bellScheduleId: true, effectiveFrom: true, periods: true } })
    : [];
  const bellVersions = new Map(bells);
  for (const [id, rows] of groupBy(bellRows, (b) => b.bellScheduleId)) bellVersions.set(id, rows.map((b) => ({ ...b, effectiveFrom: toDay(b.effectiveFrom) })));

  const others = clipped.filter((v) => !candidates(v));
  const clashes = teacherClashes(checked, others, bellVersions);
  if (clashes.length) throw conflict('TEACHER_CLASH', describeClash(clashes[0]), { clashes: clashes.map((x) => ({ ...x, message: describeClash(x) })) });
}

/** Clash check after a bell schedule's versions change from `from` on: every timetable using it is a candidate. */
async function assertNoClashesForBell(tx, scope, bell, nextVersions, from) {
  const users = await tx.timetableVersion.findMany({ where: { bellScheduleId: bell.id, cancelledAt: null }, select: { slots: { select: { teacherId: true } } } });
  const teacherIds = new Set(users.flatMap((v) => v.slots.map((s) => s.teacherId)).filter(Boolean));
  await assertNoClashes(tx, scope, {
    bells: new Map([[bell.id, nextVersions.map((v) => ({ effectiveFrom: v.effectiveFrom, periods: v.periods }))]]),
    candidates: (v) => v.bellScheduleId === bell.id,
    clipFrom: from,
    teacherIds,
  });
}

/** Lessons of timetables using the schedule that the new times would not have (from `from` on). */
async function lessonsOutsideTimes(tx, bellId, nextVersions, from) {
  const users = await tx.timetableVersion.findMany({
    where: { bellScheduleId: bellId, cancelledAt: null },
    select: { ...clashVersionSelect, slots: { select: { weekday: true, periodNumber: true, subject: { select: { name: true } } } } },
  });
  const warnings = [];
  for (const v of users) {
    const name = sectionDisplayName(v.section.class.name, v.section.name);
    const times = versionOn(nextVersions, from);
    if (!times) continue;
    const numbers = lessonNumbersByDay(times.periods);
    const missing = v.slots.filter((s) => !(numbers[s.weekday] ?? []).includes(s.periodNumber));
    if (missing.length) warnings.push({ sectionId: v.sectionId, section: name, lessons: missing.length, message: `${name}: ${missing.length} lesson${missing.length === 1 ? '' : 's'} in periods these times do not have (they will not take place).` });
  }
  return warnings.slice(0, 20);
}

// ---- timetables: reads --------------------------------------------------------------------------

const sectionInclude = {
  class: { select: { id: true, name: true, sequence: true, status: true } },
  branch: { select: { id: true, name: true, code: true } },
  academicYear: true,
};

async function findSection(client, scope, id) {
  const section = isUuid(id)
    ? await client.section.findFirst({ where: { id, schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) }, include: sectionInclude })
    : null;
  if (!section) throw notFound('Section not found.');
  return section;
}

const toSection = (s) => ({
  id: s.id,
  name: s.name,
  displayName: sectionDisplayName(s.class.name, s.name),
  room: s.room ?? '',
  status: fromDbStatus(s.status),
  class: { id: s.class.id, name: s.class.name, status: fromDbStatus(s.class.status) },
  branch: brief(s.branch),
  academicYear: { id: s.academicYear.id, name: s.academicYear.name, status: s.academicYear.status.toLowerCase(), startDate: toDay(s.academicYear.startDate), endDate: toDay(s.academicYear.endDate) },
});

const timetableInclude = {
  bellSchedule: { select: { id: true, name: true, branchId: true, status: true } },
  slots: {
    include: {
      subject: { select: { id: true, name: true, code: true, status: true } },
      teacher: { select: { id: true, name: true, staffId: true, status: true } },
    },
  },
};

const toSlot = (s) => ({
  weekday: s.weekday,
  period: s.periodNumber,
  subject: { id: s.subject.id, name: s.subject.name, code: s.subject.code ?? '', status: fromDbStatus(s.subject.status) },
  teacher: s.teacher ? { id: s.teacher.id, name: s.teacher.name, staffId: s.teacher.staffId, status: fromDbStatus(s.teacher.status) } : null,
  room: s.room ?? '',
});
const slotOrder = (a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) || a.periodNumber - b.periodNumber;

/**
 * A section's timetable: every version (with its dates and state), the chosen one (default: the one
 * in effect today, else the first scheduled) with its lessons, the subjects of the class with lessons
 * per week planned and timetabled, and the section's live subject teachers (who can be named).
 */
export async function getTimetable(scope, sectionId, { versionId }) {
  const prisma = getPrisma();
  const [today, section] = await Promise.all([calendarToday(), findSection(prisma, scope, sectionId)]);
  const yearEnd = toDay(section.academicYear.endDate);
  const [versions, curriculum, assignments] = await Promise.all([
    prisma.timetableVersion.findMany({ where: { sectionId: section.id }, include: timetableInclude, orderBy: [{ effectiveFrom: 'asc' }, { recordedAt: 'asc' }] }),
    prisma.classSubject.findMany({ where: { classId: section.classId }, include: { subject: true }, orderBy: { subject: { name: 'asc' } } }),
    prisma.teachingAssignment.findMany({
      where: { sectionId: section.id, role: 'SUBJECT_TEACHER', cancelledAt: null, OR: [{ endDate: null }, { endDate: { gte: asDbDay(today) } }] },
      include: { teacher: { select: { id: true, name: true, staffId: true, status: true } }, subject: { select: { id: true, name: true } } },
      orderBy: { startDate: 'asc' },
    }),
  ]);
  const active = plainVersions(versions);
  const ranges = new Map(withRanges(active, yearEnd).map((v) => [v.id, v.to]));
  let selected = versionId ? versions.find((v) => v.id === versionId) : null;
  if (versionId && !selected) throw notFound('Timetable version not found.');
  if (!selected) {
    const pick = versionOn(active, today) ?? active.find((v) => v.effectiveFrom > today) ?? null;
    selected = pick ? versions.find((v) => v.id === pick.id) : null;
  }

  const open = curriculum.length === 0;
  const subjects = open ? await prisma.subject.findMany({ where: { schoolId: scope.school.id, status: 'ACTIVE' }, orderBy: { name: 'asc' } }) : curriculum.map((c) => c.subject);
  const counts = new Map();
  for (const s of selected?.slots ?? []) counts.set(s.subjectId, (counts.get(s.subjectId) ?? 0) + 1);

  return {
    today,
    firstEditableDate: maxDay(earliestStart(active, today), toDay(section.academicYear.startDate)),
    section: toSection(section),
    versions: versions.map((v) => ({
      id: v.id,
      effectiveFrom: toDay(v.effectiveFrom),
      to: ranges.get(v.id) ?? null,
      state: versionState(v, active, today),
      recordedAt: v.recordedAt.toISOString(),
      cancelledAt: v.cancelledAt?.toISOString() ?? null,
      bellSchedule: { id: v.bellSchedule.id, name: v.bellSchedule.name },
      lessons: v.slots.length,
    })),
    selected: selected && {
      id: selected.id,
      effectiveFrom: toDay(selected.effectiveFrom),
      to: ranges.get(selected.id) ?? null,
      state: versionState(selected, active, today),
      bellSchedule: { id: selected.bellSchedule.id, name: selected.bellSchedule.name, level: selected.bellSchedule.branchId ? 'branch' : 'school', status: fromDbStatus(selected.bellSchedule.status) },
      lessons: [...selected.slots].sort(slotOrder).map(toSlot),
    },
    curriculumSet: !open,
    subjects: subjects.map((s) => ({
      subject: { id: s.id, name: s.name, code: s.code ?? '', status: fromDbStatus(s.status) },
      weeklyLessons: curriculum.find((c) => c.subjectId === s.id)?.weeklyLessons ?? null,
      timetabled: counts.get(s.id) ?? 0,
    })),
    teachers: assignments.map((a) => ({
      teacher: { id: a.teacher.id, name: a.teacher.name, staffId: a.teacher.staffId, status: fromDbStatus(a.teacher.status) },
      subject: a.subject,
      startDate: toDay(a.startDate),
      endDate: a.endDate ? toDay(a.endDate) : null,
    })),
  };
}

const maxDay = (a, b) => (a > b ? a : b);

/**
 * The sections of a year (default: the current one) in scope with their timetable today: bell
 * schedule, lessons, and the next scheduled change. Owner filter: branch.
 */
export async function listTimetables(scope, { academicYear, branch }) {
  const prisma = getPrisma();
  const today = await calendarToday();
  const year = await prisma.academicYear.findFirst({ where: academicYear === 'current' ? { schoolId: scope.school.id, status: 'CURRENT' } : { id: academicYear, schoolId: scope.school.id } });
  if (!year) {
    if (academicYear !== 'current') throw notFound('Academic year not found.');
    return { today, academicYear: null, items: [] };
  }
  const sections = await prisma.section.findMany({
    where: { schoolId: scope.school.id, academicYearId: year.id, ...(scope.branch ? { branchId: scope.branch.id } : branch && { branchId: branch }) },
    include: sectionInclude,
    orderBy: [{ branch: { name: 'asc' } }, { class: { sequence: 'asc' } }, { nameKey: 'asc' }],
  });
  const versions = sections.length
    ? await prisma.timetableVersion.findMany({
        where: { sectionId: { in: sections.map((s) => s.id) }, cancelledAt: null },
        select: { id: true, sectionId: true, effectiveFrom: true, bellSchedule: { select: { id: true, name: true } }, _count: { select: { slots: true } } },
      })
    : [];
  const bySection = groupBy(versions.map((v) => ({ ...v, effectiveFrom: toDay(v.effectiveFrom) })), (v) => v.sectionId);
  return {
    today,
    academicYear: { id: year.id, name: year.name, status: year.status.toLowerCase(), startDate: toDay(year.startDate), endDate: toDay(year.endDate) },
    items: sections.map((s) => {
      const own = bySection.get(s.id) ?? [];
      const current = versionOn(own, today);
      const next = own.filter((v) => v.effectiveFrom > today).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0] ?? null;
      const shown = current ?? next;
      return {
        section: toSection(s),
        timetable: shown ? { effectiveFrom: shown.effectiveFrom, bellSchedule: shown.bellSchedule, lessons: shown._count.slots, state: current ? 'current' : 'scheduled' } : null,
        nextChange: current && next ? next.effectiveFrom : null,
      };
    }),
  };
}

/** The days of a section from..to: school or not, its bell times, halves and lessons (lessons.js). */
export async function sectionLessons(scope, sectionId, { from, to }) {
  const prisma = getPrisma();
  const section = await findSection(prisma, scope, sectionId);
  const days = await loadSectionDays(scope.school.id, [{ id: section.id, branchId: section.branchId }], from, to, prisma);
  return { section: toSection(section), from, to, days: days.get(section.id) };
}

/**
 * A teacher's lessons from..to, in every section of the scope: lessons naming them, and lessons
 * without a named teacher in subjects they teach there (on the dates of that assignment). Owner:
 * any staff member of the school; Manager: their branch's staff, lessons in their branch.
 */
export async function teacherLessons(scope, teacherId, { from, to }) {
  const prisma = getPrisma();
  const teacher = isUuid(teacherId)
    ? await prisma.user.findFirst({
        where: { id: teacherId, role: 'STAFF', ...(scope.branch ? { branchId: scope.branch.id } : { branch: { schoolId: scope.school.id } }) },
        select: { id: true, name: true, staffId: true, status: true },
      })
    : null;
  if (!teacher) throw notFound('Teacher not found.');
  const branchWhere = scope.branch ? { branchId: scope.branch.id } : {};
  const [named, assignments] = await Promise.all([
    prisma.timetableVersion.findMany({ where: { schoolId: scope.school.id, cancelledAt: null, ...branchWhere, slots: { some: { teacherId: teacher.id } } }, select: { sectionId: true }, distinct: ['sectionId'] }),
    prisma.teachingAssignment.findMany({
      where: { schoolId: scope.school.id, teacherId: teacher.id, role: 'SUBJECT_TEACHER', cancelledAt: null, ...branchWhere, startDate: { lte: asDbDay(to) }, OR: [{ endDate: null }, { endDate: { gte: asDbDay(from) } }] },
      select: { sectionId: true, subjectId: true, startDate: true, endDate: true },
    }),
  ]);
  const sectionIds = [...new Set([...named.map((r) => r.sectionId), ...assignments.map((a) => a.sectionId)])];
  const sections = sectionIds.length ? await prisma.section.findMany({ where: { id: { in: sectionIds } }, include: sectionInclude }) : [];
  const days = await loadSectionDays(scope.school.id, sections.map((s) => ({ id: s.id, branchId: s.branchId })), from, to, prisma);

  const teaches = (sectionId, subjectId, date) =>
    assignments.some((a) => a.sectionId === sectionId && a.subjectId === subjectId && toDay(a.startDate) <= date && (!a.endDate || toDay(a.endDate) >= date));
  const lessons = [];
  for (const s of sections) {
    for (const day of days.get(s.id) ?? []) {
      for (const p of day.periods) {
        if (!p.lesson) continue;
        const mine = p.lesson.teacher ? p.lesson.teacher.id === teacher.id : teaches(s.id, p.lesson.subject.id, day.date);
        if (!mine) continue;
        lessons.push({
          date: day.date,
          weekday: day.weekday,
          timetableDay: day.timetableDay,
          period: p.number,
          start: p.start,
          end: p.end,
          half: p.half,
          section: { id: s.id, displayName: sectionDisplayName(s.class.name, s.name), branch: brief(s.branch) },
          subject: p.lesson.subject,
          room: p.lesson.room ?? s.room ?? '',
          named: Boolean(p.lesson.teacher),
        });
      }
    }
  }
  lessons.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  return { teacher: { ...teacher, status: fromDbStatus(teacher.status) }, from, to, lessons };
}

// ---- timetables: changes ------------------------------------------------------------------------

const lessonKey = (l) => `${l.weekday}|${l.periodNumber}|${l.subjectId}|${l.teacherId ?? ''}|${l.room ?? ''}`;
const sameLessons = (a, b) => a.map(lessonKey).sort().join(';') === b.map(lessonKey).sort().join(';');

/**
 * Sets a section's timetable from a date: its bell schedule (school-wide or the section's branch's,
 * active, with times on that date) and its lessons. Each lesson's period must be in the bell times
 * of that date and weekday; its subject active and on the class's list (when it has one); a named
 * teacher must teach that subject in the section during the version's dates (a teaching
 * assignment). Refused when a teacher would be in two places at once (409 TEACHER_CLASH).
 * → the timetable, with `warnings` (e.g. a teacher whose assignment ends before the timetable does).
 */
export async function saveTimetable(scope, sectionId, values, user, req) {
  const today = await calendarToday();
  const result = await withTimetableLock(scope, 'timetables', async (tx) => {
    const section = await findSection(tx, scope, sectionId);
    const year = section.academicYear;
    const name = sectionDisplayName(section.class.name, section.name);
    if (year.status === 'CLOSED') throw YEAR_CLOSED(year);
    if (section.status !== 'ACTIVE' || section.class.status !== 'ACTIVE') throw conflict('SECTION_INACTIVE', `${name} is inactive. Reactivate it before changing its timetable.`);

    const yearStart = toDay(year.startDate);
    const yearEnd = toDay(year.endDate);
    const existing = await tx.timetableVersion.findMany({ where: { sectionId: section.id, cancelledAt: null }, include: timetableInclude });
    const active = plainVersions(existing);
    const from = values.effectiveFrom;
    const earliest = maxDay(earliestStart(active, today), yearStart);
    if (from < earliest || from > yearEnd) {
      throw invalid({
        effectiveFrom:
          from > yearEnd || from < yearStart
            ? `Choose a date within ${year.name} (${yearStart} to ${yearEnd}).`
            : earliest > today
              ? `The timetable in effect today started earlier, so a change can start on ${earliest} at the earliest.`
              : `Choose today (${today}) or a later date.`,
      });
    }

    const bell = await tx.bellSchedule.findFirst({
      where: { id: values.bellScheduleId, schoolId: scope.school.id, OR: [{ branchId: null }, { branchId: section.branchId }] },
      include: { versions: { where: { cancelledAt: null }, include: { periods: true } } },
    });
    if (!bell) throw notFound('Bell schedule not found.');
    if (bell.status !== 'ACTIVE') throw conflict('BELL_SCHEDULE_INACTIVE', `${bell.name} is inactive. Choose another bell schedule or reactivate it.`);
    const times = versionOn(plainVersions(bell.versions), from);
    if (!times) throw conflict('BELL_TIMES_MISSING', `${bell.name} has no times on ${from}. Set its times first.`);

    const replaced = active.find((v) => v.effectiveFrom === from) ?? null;
    const others = active.filter((v) => v !== replaced);
    const nextStart = others.filter((v) => v.effectiveFrom > from).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0]?.effectiveFrom;
    const to = nextStart ? addDays(nextStart, -1) : yearEnd;
    const previous = versionOn(others, addDays(from, -1));
    const base = replaced ?? previous;
    if (base && base.bellScheduleId === bell.id && sameLessons(base.slots, values.lessons)) return { unchanged: true };

    // Periods, subjects and teachers.
    const errors = {};
    const numbers = lessonNumbersByDay(times.periods);
    for (const l of values.lessons) {
      if (!(numbers[l.weekday] ?? []).includes(l.periodNumber)) errors[`lessons.${l.index}`] = `${bell.name} has no period ${l.periodNumber} on ${DAY_LABELS[l.weekday]} (from ${from}).`;
    }
    const subjectIds = [...new Set(values.lessons.map((l) => l.subjectId))];
    const teacherIds = [...new Set(values.lessons.map((l) => l.teacherId).filter(Boolean))];
    const [subjects, curriculum, assignments, teachers] = await Promise.all([
      subjectIds.length ? tx.subject.findMany({ where: { id: { in: subjectIds }, schoolId: scope.school.id } }) : [],
      tx.classSubject.findMany({ where: { classId: section.classId }, select: { subjectId: true } }),
      teacherIds.length
        ? tx.teachingAssignment.findMany({
            where: { sectionId: section.id, role: 'SUBJECT_TEACHER', cancelledAt: null, teacherId: { in: teacherIds }, startDate: { lte: asDbDay(to) }, OR: [{ endDate: null }, { endDate: { gte: asDbDay(from) } }] },
          })
        : [],
      teacherIds.length ? tx.user.findMany({ where: { id: { in: teacherIds } }, select: { id: true, name: true } }) : [],
    ]);
    const subjectById = new Map(subjects.map((s) => [s.id, s]));
    const teacherName = new Map(teachers.map((t) => [t.id, t.name]));
    const listed = new Set(curriculum.map((c) => c.subjectId));
    const warnings = [];
    for (const l of values.lessons) {
      const at = `lessons.${l.index}`;
      if (errors[at]) continue;
      const subject = subjectById.get(l.subjectId);
      if (!subject) errors[at] = 'Subject not found.';
      else if (subject.status !== 'ACTIVE') errors[at] = `${subject.name} is inactive.`;
      else if (listed.size && !listed.has(subject.id)) errors[at] = `${subject.name} is not one of ${section.class.name}'s subjects.`;
      else if (l.teacherId) {
        const own = assignments.filter((a) => a.teacherId === l.teacherId && a.subjectId === l.subjectId);
        if (!own.length) errors[at] = `${teacherName.get(l.teacherId) ?? 'This teacher'} does not teach ${subject.name} in ${name} on these dates. Assign the teaching first.`;
        else if (!own.some((a) => toDay(a.startDate) <= from && (!a.endDate || toDay(a.endDate) >= to))) {
          const key = `${l.teacherId}|${l.subjectId}`;
          if (!warnings.some((w) => w.key === key)) {
            warnings.push({ key, message: `${teacherName.get(l.teacherId)}'s ${subject.name} assignment does not cover every day of this timetable (${from} to ${to}); on the other days the lessons have no teacher.` });
          }
        }
      }
    }
    if (Object.keys(errors).length) throw invalid(errors);

    const candidate = {
      id: 'new',
      sectionId: section.id,
      sectionName: name,
      bellScheduleId: bell.id,
      effectiveFrom: from,
      yearEnd,
      slots: values.lessons.map((l) => ({ weekday: l.weekday, periodNumber: l.periodNumber, teacherId: l.teacherId, teacherName: teacherName.get(l.teacherId), subjectName: subjectById.get(l.subjectId).name })),
    };
    await assertNoClashes(tx, scope, {
      add: [candidate],
      remove: new Set(replaced ? [replaced.id] : []),
      candidates: (v) => v.id === 'new',
      clipFrom: from,
      teacherIds: new Set(teacherIds),
    });

    if (replaced) await tx.timetableVersion.update({ where: { id: replaced.id }, data: { cancelledAt: new Date() } });
    const version = await tx.timetableVersion.create({
      data: { schoolId: scope.school.id, academicYearId: year.id, branchId: section.branchId, sectionId: section.id, bellScheduleId: bell.id, effectiveFrom: asDbDay(from) },
    });
    if (values.lessons.length) {
      await tx.timetableSlot.createMany({
        data: values.lessons.map((l) => ({ versionId: version.id, weekday: l.weekday, periodNumber: l.periodNumber, subjectId: l.subjectId, teacherId: l.teacherId, room: l.room })),
      });
    }
    const before = base ? new Set(base.slots.map(lessonKey)) : new Set();
    const after = new Set(values.lessons.map(lessonKey));
    const changedLessons = [...after].filter((k) => !before.has(k)).length + [...before].filter((k) => !after.has(k)).length;
    await audit(tx, AUDIT_ACTIONS.TIMETABLE_CHANGED, scope, {
      user,
      req,
      target: { type: 'timetable', id: section.id, name: `${name} (${year.name})` },
      description: `Timetable of ${name} (${year.name}) from ${from}: ${bell.name}, ${values.lessons.length} lessons a week.${replaced ? ' Replaces the change scheduled for that date.' : ''}`,
      fields: [
        { field: 'Bell schedule', from: base?.bellSchedule?.name ?? null, to: bell.name },
        { field: 'Lessons a week', from: base ? String(base.slots.length) : null, to: String(values.lessons.length) },
        { field: 'Lessons changed', from: null, to: String(changedLessons) },
        { field: 'Effective from', from: null, to: from },
      ],
      details: { academicYearId: year.id, branchId: section.branchId, sectionId: section.id, versionId: version.id, bellScheduleId: bell.id },
    });
    return { versionId: version.id, warnings: warnings.map((w) => w.message) };
  });
  if (result.unchanged) return { ...(await getTimetable(scope, sectionId, {})), warnings: [], unchanged: true };
  return { ...(await getTimetable(scope, sectionId, { versionId: result.versionId })), warnings: result.warnings };
}

/** Cancels a scheduled timetable change (not started; 409 VERSION_IN_EFFECT otherwise). The timetable before it applies again. */
export async function cancelTimetableVersion(scope, sectionId, versionId, user, req) {
  const today = await calendarToday();
  await withTimetableLock(scope, 'timetables', async (tx) => {
    const section = await findSection(tx, scope, sectionId);
    if (section.academicYear.status === 'CLOSED') throw YEAR_CLOSED(section.academicYear);
    const version = isUuid(versionId) ? await tx.timetableVersion.findFirst({ where: { id: versionId, sectionId: section.id }, include: timetableInclude }) : null;
    if (!version) throw notFound('Timetable version not found.');
    if (version.cancelledAt) return;
    const from = toDay(version.effectiveFrom);
    if (from <= today) throw conflict('VERSION_IN_EFFECT', `This timetable has applied since ${from}. Set a new one from a later date instead.`);

    // The version before it now runs longer: check it again from this date.
    const stored = await tx.timetableVersion.findMany({ where: { sectionId: section.id, cancelledAt: null, id: { not: version.id } }, select: { id: true, effectiveFrom: true, slots: { select: { teacherId: true } } } });
    const previous = versionOn(stored.map((v) => ({ ...v, effectiveFrom: toDay(v.effectiveFrom) })), from);
    if (previous) {
      await assertNoClashes(tx, scope, {
        remove: new Set([version.id]),
        candidates: (v) => v.id === previous.id,
        clipFrom: from,
        teacherIds: new Set(previous.slots.map((s) => s.teacherId).filter(Boolean)),
      });
    }
    await tx.timetableVersion.update({ where: { id: version.id }, data: { cancelledAt: new Date() } });
    const name = sectionDisplayName(section.class.name, section.name);
    await audit(tx, AUDIT_ACTIONS.TIMETABLE_CHANGE_CANCELLED, scope, {
      user,
      req,
      target: { type: 'timetable', id: section.id, name: `${name} (${section.academicYear.name})` },
      description: `Scheduled timetable of ${name} from ${from} cancelled.`,
      fields: [{ field: 'Timetable', from: `${version.bellSchedule.name}, ${version.slots.length} lessons a week, from ${from}`, to: null }],
      details: { academicYearId: section.academicYearId, branchId: section.branchId, sectionId: section.id, versionId: version.id },
    });
  });
  return getTimetable(scope, sectionId, {});
}
