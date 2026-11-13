import { Prisma } from '@prisma/client';
import { badRequest, conflict, forbidden, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockActiveSchool, lockOperatingBranch } from '../branches/branches.service.js';
import { platformTimeZone } from '../platform-settings/settings.service.js';
import { localDate } from '../schedules/schedules.service.js';
import { addDays, asDbDay, daysBetween, loadSchoolDays, toDay, versionOn, weekdaysOn } from './schoolDays.js';

/*
 * Academic calendar (docs/business-rules.md → Academic calendar): the weekly school days of each
 * academic year (school default, branch override when the year allows it) and the calendar's
 * exceptions (school holidays, branch closures, branch reopenings of a holiday). Whether a branch
 * has school on a date is decided only by schoolDays.js.
 *
 * Every function takes `scope`, decided by the server from the signed-in account: { school,
 * branch: null } for the School Owner (requireOwnerSchool) or { school, branch } for a Manager
 * (requireManagerBranch). Ids from the request are looked up inside that scope only; anything else
 * is reported like something that does not exist (404).
 *
 * Writes run in one transaction under the school's academic year lock (the same advisory lock as
 * academic year changes, so a year cannot be closed, re-dated or deleted halfway through a calendar
 * change), with the school ACTIVE (409 SCHOOL_SUSPENDED) and, for a Manager, their branch operating
 * (409 BRANCH_NOT_OPERATING). A CLOSED year's calendar is read only (409 YEAR_CLOSED). Each change
 * and its audit event are written together; unchanged submissions write and record nothing. Rows
 * are never deleted. The database also prevents overlapping entries and duplicate versions.
 */

const TX = { timeout: 20000, maxWait: 10000 };
const DAY_LABELS = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };
const TYPE_LABELS = { HOLIDAY: 'School holiday', CLOSURE: 'Branch closure', REOPENING: 'Branch reopening', SCHOOL_DAY: 'Extra school day' };
const DAY_NAMES = { MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday', SUN: 'Sunday' };
const daysText = (days) => (days?.length ? days.map((d) => DAY_LABELS[d]).join(', ') : 'None');

/** Today's date in the platform time zone ('YYYY-MM-DD'). */
export const calendarToday = async () => localDate(await platformTimeZone());

/**
 * The first calendar day that can still be changed: days before it are fixed (no entry can be
 * added, cancelled or re-dated there). Today can still be changed, for an emergency closure.
 * Approved 2026-11-13 (calendar decision 1, Option A); this is the only place that encodes it.
 */
export const firstEditableDay = (today) => today;

// ---- errors -----------------------------------------------------------------------------------

const YEAR_CLOSED = (year) => conflict('YEAR_CLOSED', `${year.name} is closed. Its calendar is kept as it is and cannot be changed.`);
const ENTRY_NOT_FOUND = () => notFound('Calendar entry not found.');
const invalid = (errors) => badRequest('Check the highlighted fields.', errors);
const FIXED_DAYS = (fe) => `Calendar days before ${fe} are fixed and cannot be changed.`;
const OVERLAP = (type, other) =>
  conflict(
    'DATES_OVERLAP',
    other
      ? `These dates overlap ${other.name} (${toDay(other.startDate)} to ${toDay(other.endDate)}). ${TYPE_LABELS[type]}s cannot overlap.`
      : `These dates overlap another ${TYPE_LABELS[type].toLowerCase()}. ${TYPE_LABELS[type]}s cannot overlap.`,
    { startDate: 'Overlaps another entry.', endDate: 'Overlaps another entry.' },
  );

const mentions = (error, text) => {
  try {
    return `${error?.message ?? ''} ${JSON.stringify(error?.meta ?? {})}`.includes(text);
  } catch {
    return false;
  }
};

/** Database backstops (simultaneous requests) → the same answers as the checks made first. */
function translateDbError(error) {
  for (const [name, type] of [
    ['CalendarEntry_no_overlapping_holidays', 'HOLIDAY'],
    ['CalendarEntry_no_overlapping_closures', 'CLOSURE'],
    ['CalendarEntry_no_overlapping_reopenings', 'REOPENING'],
    ['CalendarEntry_no_overlapping_school_days', 'SCHOOL_DAY'],
    ['CalendarEntry_no_overlapping_branch_school_days', 'SCHOOL_DAY'],
  ]) {
    if (mentions(error, name)) return OVERLAP(type, null);
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && mentions(error, 'AcademicWeekdays')) {
    return conflict('VERSION_EXISTS', 'School days were changed for this date at the same time. Reload and try again.');
  }
  return error;
}

// ---- locking ----------------------------------------------------------------------------------

async function withCalendarLock(scope, work) {
  try {
    return await getPrisma().$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`academic-year:${scope.school.id}`}))`;
      if (scope.branch) await lockOperatingBranch(tx, scope, 'calendar');
      else await lockActiveSchool(tx, scope.school);
      return work(tx);
    }, TX);
  } catch (error) {
    throw translateDbError(error);
  }
}

async function findYear(client, scope, id) {
  const year = isUuid(id) ? await client.academicYear.findFirst({ where: { id, schoolId: scope.school.id } }) : null;
  if (!year) throw notFound('Academic year not found.');
  return year;
}

function writable(year) {
  if (year.status === 'CLOSED') throw YEAR_CLOSED(year);
  return year;
}

function withinYear(year, startDate, endDate) {
  const start = toDay(year.startDate);
  const end = toDay(year.endDate);
  const message = `Choose dates within ${year.name} (${start} to ${end}).`;
  const errors = {};
  if (startDate < start || startDate > end) errors.startDate = message;
  if (endDate < start || endDate > end) errors.endDate = message;
  if (Object.keys(errors).length) throw invalid(errors);
}

// ---- audit ------------------------------------------------------------------------------------

const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });

function audit(tx, action, { scope, user, req, target, description, fields, details }) {
  return recordAuditEvent({
    client: tx,
    action,
    actor: actorOf(user),
    target: { type: 'academic_calendar', id: target.id, name: target.name },
    schoolId: scope.school.id,
    description,
    change: { fields, ...details },
    req,
  });
}

// ---- shapes -----------------------------------------------------------------------------------

const brief = (b) => b && { id: b.id, name: b.name, code: b.code };
const toYear = (y) => ({ id: y.id, name: y.name, status: y.status.toLowerCase(), startDate: toDay(y.startDate), endDate: toDay(y.endDate) });

/** Versions of one level (any order) → their shapes, oldest first, each with its state on `refDay`. */
function toVersions(rows, refDay) {
  const sorted = [...rows].sort((a, b) => toDay(a.effectiveFrom).localeCompare(toDay(b.effectiveFrom)) || a.recordedAt - b.recordedAt);
  const active = sorted.filter((v) => !v.cancelledAt).map((v) => ({ row: v, effectiveFrom: toDay(v.effectiveFrom) }));
  const inEffect = versionOn(active, refDay)?.row;
  return sorted.map((v) => ({
    id: v.id,
    days: v.days,
    followsSchool: v.followsSchool,
    effectiveFrom: toDay(v.effectiveFrom),
    recordedAt: v.recordedAt.toISOString(),
    cancelledAt: v.cancelledAt?.toISOString() ?? null,
    state: v.cancelledAt ? 'cancelled' : v === inEffect ? 'current' : toDay(v.effectiveFrom) > refDay ? 'scheduled' : 'past',
  }));
}

const entryInclude = {
  branch: { select: { id: true, name: true, code: true } },
  holiday: { select: { id: true, name: true, startDate: true, endDate: true, allowBranchReopening: true, cancelledAt: true } },
};

export const toEntry = (e) => ({
  id: e.id,
  type: e.type.toLowerCase(),
  name: e.name,
  note: e.note ?? '',
  startDate: toDay(e.startDate),
  endDate: toDay(e.endDate),
  days: daysBetween(toDay(e.startDate), toDay(e.endDate)) + 1,
  branch: brief(e.branch),
  holiday: e.holiday ? { id: e.holiday.id, name: e.holiday.name } : null,
  allowBranchReopening: e.allowBranchReopening,
  timetableDay: e.timetableDay ?? null,
  status: e.cancelledAt ? 'cancelled' : 'active',
  cancelledAt: e.cancelledAt?.toISOString() ?? null,
  createdAt: e.createdAt.toISOString(),
  updatedAt: e.updatedAt.toISOString(),
});

// ---- reads (School Owner and Manager) ---------------------------------------------------------

/**
 * One academic year's calendar: the school's weekly school days (versions), the branches' own days
 * (the Owner: every branch that has set any; a Manager: their own branch), and the calendar entries
 * (the Owner: all; a Manager: school holidays and their branch's entries), cancelled ones included.
 */
export async function getCalendar(scope, yearId) {
  const prisma = getPrisma();
  const today = await calendarToday();
  const year = await findYear(prisma, scope, yearId);
  const levels = scope.branch ? { OR: [{ branchId: null }, { branchId: scope.branch.id }] } : {};
  const [versions, entries] = await Promise.all([
    prisma.academicWeekdays.findMany({ where: { academicYearId: year.id, ...levels }, include: { branch: { select: { id: true, name: true, code: true } } } }),
    prisma.calendarEntry.findMany({ where: { academicYearId: year.id, ...levels }, orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }], include: entryInclude }),
  ]);

  // Which day "current" means: today, kept within the year (a planned year shows its first day).
  const start = toDay(year.startDate);
  const end = toDay(year.endDate);
  const refDay = today < start ? start : today > end ? end : today;
  const active = (rows) => rows.filter((v) => !v.cancelledAt).map((v) => ({ ...v, effectiveFrom: toDay(v.effectiveFrom) }));
  const schoolRows = versions.filter((v) => !v.branchId);
  const byBranch = new Map();
  for (const v of versions.filter((x) => x.branchId)) byBranch.set(v.branchId, [...(byBranch.get(v.branchId) ?? []), v]);
  if (scope.branch && !byBranch.has(scope.branch.id)) byBranch.set(scope.branch.id, []);
  const branchInfo = (id, rows) => rows[0]?.branch ?? (scope.branch?.id === id ? brief(scope.branch) : { id });

  const schoolCurrent = versionOn(active(schoolRows), refDay);
  return {
    academicYear: toYear(year),
    today,
    firstEditableDate: firstEditableDay(today),
    referenceDate: refDay,
    branchWeekdaysAllowed: year.branchWeekdaysAllowed,
    weekdays: {
      school: { days: schoolCurrent?.days ?? null, versions: toVersions(schoolRows, refDay) },
      branches: [...byBranch.entries()].map(([id, rows]) => {
        const effective = weekdaysOn({ schoolVersions: active(schoolRows), branchVersions: active(rows) }, refDay);
        return { branch: brief(branchInfo(id, rows)), days: effective.source ? effective.days : null, source: effective.source, versions: toVersions(rows, refDay) };
      }),
    },
    entries: entries.map(toEntry),
  };
}

/** Each day from..to for one branch (the Owner chooses any branch of the school; a Manager has their own). */
export async function listSchoolDays(scope, { from, to, branch }) {
  const prisma = getPrisma();
  let target = scope.branch;
  if (!target) {
    target = isUuid(branch) ? await prisma.branch.findFirst({ where: { id: branch, schoolId: scope.school.id }, select: { id: true, name: true, code: true } }) : null;
    if (!target) throw notFound('Branch not found.');
  }
  const [days, today] = await Promise.all([loadSchoolDays({ id: target.id, schoolId: scope.school.id }, from, to, prisma), calendarToday()]);
  return { branch: brief(target), from, to, today, schoolDays: days.filter((d) => d.schoolDay).length, days };
}

// ---- weekly school days -----------------------------------------------------------------------

const sameVersion = (v, values) => Boolean(v) && v.followsSchool === values.followsSchool && v.days.join() === values.days.join();

/**
 * Sets the weekly school days from a date: the school's (School Owner) or the Manager's branch's
 * (while the year allows branch school days; 409 BRANCH_WEEKDAYS_NOT_ALLOWED otherwise). Changes
 * never reach back: when school days already apply today, the earliest date is tomorrow; the first
 * days of a level may start today. A version saved for the same date as a scheduled one replaces it.
 */
export async function saveWeekdays(scope, yearId, values, user, req) {
  const today = await calendarToday();
  await withCalendarLock(scope, async (tx) => {
    const year = writable(await findYear(tx, scope, yearId));
    if (scope.branch && !year.branchWeekdaysAllowed) {
      throw conflict('BRANCH_WEEKDAYS_NOT_ALLOWED', `Your School Owner has not allowed branches to set their own school days in ${year.name}. Your branch follows the school's days.`);
    }
    const start = toDay(year.startDate);
    const end = toDay(year.endDate);
    const from = values.effectiveFrom;
    if (from < start || from > end) throw invalid({ effectiveFrom: `Choose a date within ${year.name} (${start} to ${end}).` });

    const rows = await tx.academicWeekdays.findMany({
      where: { academicYearId: year.id, cancelledAt: null, OR: [{ branchId: null }, ...(scope.branch ? [{ branchId: scope.branch.id }] : [])] },
    });
    const plain = rows.map((v) => ({ ...v, effectiveFrom: toDay(v.effectiveFrom) }));
    const schoolVersions = plain.filter((v) => !v.branchId);
    const branchVersions = plain.filter((v) => v.branchId);
    const level = scope.branch ? branchVersions : schoolVersions;

    const appliesToday = scope.branch ? weekdaysOn({ schoolVersions, branchVersions }, today).source !== null : Boolean(versionOn(schoolVersions, today));
    const earliest = appliesToday ? addDays(today, 1) : today;
    if (from < earliest) {
      throw invalid({
        effectiveFrom: appliesToday
          ? `School days already apply today, so a change can start on ${earliest} at the earliest.`
          : `Choose today (${today}) or a later date.`,
      });
    }

    const replaced = level.find((v) => v.effectiveFrom === from) ?? null;
    const previous = versionOn(level.filter((v) => v !== replaced), addDays(from, -1));
    // Nothing changes: the same days already apply from that date at this level.
    if (replaced ? sameVersion(replaced, values) : sameVersion(previous, values) || (values.followsSchool && !previous)) return;

    const before = scope.branch ? weekdaysOn({ schoolVersions, branchVersions }, from) : { days: versionOn(schoolVersions, from)?.days ?? [] };
    if (replaced) await tx.academicWeekdays.update({ where: { id: replaced.id }, data: { cancelledAt: new Date() } });
    const created = await tx.academicWeekdays.create({
      data: {
        schoolId: scope.school.id,
        academicYearId: year.id,
        branchId: scope.branch?.id ?? null,
        days: values.days,
        followsSchool: values.followsSchool,
        effectiveFrom: asDbDay(from),
      },
    });
    const after = values.followsSchool ? { days: versionOn(schoolVersions, from)?.days ?? [] } : { days: values.days };
    const whose = scope.branch ? scope.branch.name : 'the school';
    await audit(tx, AUDIT_ACTIONS.ACADEMIC_WEEKDAYS_CHANGED, {
      scope,
      user,
      req,
      target: { id: created.id, name: `${year.name} school days (${whose})` },
      description: values.followsSchool
        ? `${scope.branch.name} follows the school's days in ${year.name} from ${from}.`
        : `School days of ${whose} in ${year.name} from ${from}: ${daysText(values.days)}.${replaced ? ' Replaces the change scheduled for that date.' : ''}`,
      fields: [
        { field: 'School days', from: daysText(before.days), to: values.followsSchool ? `School's days (${daysText(after.days)})` : daysText(after.days) },
        { field: 'Effective from', from: null, to: from },
      ],
      details: { academicYearId: year.id, branchId: scope.branch?.id ?? null },
    });
  });
  return getCalendar(scope, yearId);
}

/** Cancels a scheduled change of weekly school days (one that has not started); in-effect ones are kept (409 VERSION_IN_EFFECT). */
export async function cancelWeekdays(scope, yearId, versionId, user, req) {
  const today = await calendarToday();
  await withCalendarLock(scope, async (tx) => {
    const year = writable(await findYear(tx, scope, yearId));
    const version = isUuid(versionId)
      ? await tx.academicWeekdays.findFirst({ where: { id: versionId, academicYearId: year.id, branchId: scope.branch?.id ?? null } })
      : null;
    if (!version) throw notFound('School days change not found.');
    if (version.cancelledAt) return;
    const from = toDay(version.effectiveFrom);
    if (from <= today) throw conflict('VERSION_IN_EFFECT', `These school days have applied since ${from}. Set new days from a later date instead.`);
    await tx.academicWeekdays.update({ where: { id: version.id }, data: { cancelledAt: new Date() } });
    const whose = scope.branch ? scope.branch.name : 'the school';
    await audit(tx, AUDIT_ACTIONS.ACADEMIC_WEEKDAYS_CHANGE_CANCELLED, {
      scope,
      user,
      req,
      target: { id: version.id, name: `${year.name} school days (${whose})` },
      description: `Scheduled school days of ${whose} in ${year.name} from ${from} cancelled.`,
      fields: [{ field: 'School days', from: version.followsSchool ? "School's days" : daysText(version.days), to: null }],
      details: { academicYearId: year.id, branchId: scope.branch?.id ?? null },
    });
  });
  return getCalendar(scope, yearId);
}

/**
 * Whether Managers may set their branch's own school days in a year (School Owner). Turning it off
 * never changes past days: scheduled branch changes are cancelled and every branch with its own days
 * follows the school's days from tomorrow (within the year).
 */
export async function setBranchWeekdaysAllowed(school, yearId, { branchWeekdaysAllowed }, user, req) {
  const scope = { school, branch: null };
  const today = await calendarToday();
  await withCalendarLock(scope, async (tx) => {
    const year = writable(await findYear(tx, scope, yearId));
    if (year.branchWeekdaysAllowed === branchWeekdaysAllowed) return;

    const returned = [];
    if (!branchWeekdaysAllowed) {
      const tomorrow = addDays(today, 1);
      const start = toDay(year.startDate);
      const end = toDay(year.endDate);
      const rows = await tx.academicWeekdays.findMany({
        where: { academicYearId: year.id, branchId: { not: null }, cancelledAt: null },
        include: { branch: { select: { id: true, name: true } } },
      });
      const scheduled = rows.filter((v) => toDay(v.effectiveFrom) >= tomorrow);
      if (scheduled.length) await tx.academicWeekdays.updateMany({ where: { id: { in: scheduled.map((v) => v.id) } }, data: { cancelledAt: new Date() } });
      const followFrom = tomorrow < start ? start : tomorrow;
      const branches = new Map(rows.map((v) => [v.branchId, v.branch]));
      for (const [branchId, branch] of branches) {
        const kept = rows.filter((v) => v.branchId === branchId && toDay(v.effectiveFrom) < tomorrow).map((v) => ({ ...v, effectiveFrom: toDay(v.effectiveFrom) }));
        const own = versionOn(kept, today);
        if (own && !own.followsSchool && followFrom <= end) {
          await tx.academicWeekdays.create({
            data: { schoolId: school.id, academicYearId: year.id, branchId, days: [], followsSchool: true, effectiveFrom: asDbDay(followFrom) },
          });
        }
        if ((own && !own.followsSchool) || scheduled.some((v) => v.branchId === branchId)) returned.push(branch.name);
      }
    }
    await tx.academicYear.update({ where: { id: year.id }, data: { branchWeekdaysAllowed } });
    await audit(tx, AUDIT_ACTIONS.BRANCH_WEEKDAYS_POLICY_CHANGED, {
      scope,
      user,
      req,
      target: { id: year.id, name: year.name },
      description: branchWeekdaysAllowed
        ? `Managers may set their branch's own school days in ${year.name}.`
        : `Managers may no longer set their branch's own school days in ${year.name}.${returned.length ? ` Following the school's days from tomorrow: ${returned.join(', ')}.` : ''}`,
      fields: [{ field: 'Branches may set their own school days', from: year.branchWeekdaysAllowed ? 'Yes' : 'No', to: branchWeekdaysAllowed ? 'Yes' : 'No' }],
      details: { academicYearId: year.id, branchesReturned: returned },
    });
  });
  return getCalendar(scope, yearId);
}

// ---- calendar entries -------------------------------------------------------------------------

/** The active entry of the same type and level overlapping the dates, or null. */
const overlapping = (tx, { schoolId, type, branchId, startDate, endDate }, exceptId) =>
  tx.calendarEntry.findFirst({
    where: {
      type,
      cancelledAt: null,
      ...(branchId ? { branchId } : { schoolId, branchId: null }),
      ...(exceptId && { id: { not: exceptId } }),
      startDate: { lte: asDbDay(endDate) },
      endDate: { gte: asDbDay(startDate) },
    },
    orderBy: { startDate: 'asc' },
  });

function insideHoliday(holiday, startDate, endDate) {
  const hs = toDay(holiday.startDate);
  const he = toDay(holiday.endDate);
  if (startDate < hs || endDate > he) {
    const message = `A reopening lies within its holiday (${holiday.name}: ${hs} to ${he}).`;
    throw invalid({ ...(startDate < hs && { startDate: message }), ...(endDate > he && { endDate: message }) });
  }
}

async function findEntry(tx, scope, id, { forWrite = false } = {}) {
  const entry = isUuid(id)
    ? await tx.calendarEntry.findFirst({
        where: { id, schoolId: scope.school.id, ...(scope.branch && { OR: [{ branchId: null }, { branchId: scope.branch.id }] }) },
        include: entryInclude,
      })
    : null;
  if (!entry) throw ENTRY_NOT_FOUND();
  if (forWrite && scope.branch && !entry.branchId) {
    throw forbidden(
      entry.type === 'HOLIDAY'
        ? 'School holidays are set by your School Owner. You can reopen a holiday for your branch when the holiday allows it.'
        : 'School-wide extra school days are set by your School Owner. You can add your branch’s own.',
    );
  }
  return entry;
}

/**
 * After a holiday changes (dates, cancellation, or no longer allowing reopenings), its reopenings
 * keep their fixed (past) days and lose the later days the holiday no longer offers: shortened, or
 * cancelled when nothing is left. Each change is audited.
 */
async function trimReopenings(tx, holiday, fe, ctx) {
  const reopenings = await tx.calendarEntry.findMany({ where: { holidayId: holiday.id, cancelledAt: null }, include: entryInclude });
  const hs = toDay(holiday.startDate);
  const he = toDay(holiday.endDate);
  const offered = !holiday.cancelledAt && holiday.allowBranchReopening;
  for (const r of reopenings) {
    const rs = toDay(r.startDate);
    const re = toDay(r.endDate);
    const futureStart = rs > fe ? rs : fe;
    if (futureStart > re) continue; // entirely fixed
    let keep = offered ? [futureStart > hs ? futureStart : hs, re < he ? re : he] : null;
    if (keep && keep[0] > keep[1]) keep = null;
    let data;
    if (rs < fe) data = { endDate: keep ? keep[1] : addDays(fe, -1) };
    else if (!keep) data = { cancelledAt: new Date() };
    else data = { startDate: keep[0], endDate: keep[1] };
    if (!data.cancelledAt && (data.startDate ?? rs) === rs && data.endDate === re) continue;

    const dbData = { ...data, ...(data.startDate && { startDate: asDbDay(data.startDate) }), ...(data.endDate && { endDate: asDbDay(data.endDate) }) };
    await tx.calendarEntry.update({ where: { id: r.id }, data: dbData });
    await audit(tx, data.cancelledAt ? AUDIT_ACTIONS.CALENDAR_ENTRY_CANCELLED : AUDIT_ACTIONS.CALENDAR_ENTRY_UPDATED, {
      ...ctx,
      target: { id: r.id, name: r.name },
      description: data.cancelledAt
        ? `Reopening of ${holiday.name} at ${r.branch?.name ?? 'a branch'} cancelled because the holiday changed.`
        : `Reopening of ${holiday.name} at ${r.branch?.name ?? 'a branch'} shortened because the holiday changed.`,
      fields: data.cancelledAt
        ? [{ field: 'Status', from: 'Active', to: 'Cancelled' }]
        : [
            ...(data.startDate && data.startDate !== rs ? [{ field: 'Start date', from: rs, to: data.startDate }] : []),
            ...(data.endDate !== re ? [{ field: 'End date', from: re, to: data.endDate }] : []),
          ],
      details: { academicYearId: r.academicYearId, branchId: r.branchId, type: 'REOPENING', holidayId: holiday.id },
    });
  }
}

/**
 * Adds a calendar entry to an academic year. School Owner: school holidays, and closures and
 * reopenings of any branch of the school. Manager: closures and reopenings of their own branch.
 * Entries start on the first editable day or later. A reopening lies within its holiday, which
 * must allow reopenings (409 REOPENING_NOT_ALLOWED).
 */
export async function createEntry(scope, yearId, values, user, req) {
  const fe = firstEditableDay(await calendarToday());
  const created = await withCalendarLock(scope, async (tx) => {
    const year = writable(await findYear(tx, scope, yearId));
    withinYear(year, values.startDate, values.endDate);
    if (values.startDate < fe) throw invalid({ startDate: FIXED_DAYS(fe) });

    let branch = null;
    // Holidays are school level; an extra school day is school level when the Owner names no branch.
    if (values.type !== 'HOLIDAY' && (scope.branch || values.branchId)) {
      branch = scope.branch
        ? brief(scope.branch)
        : await tx.branch.findFirst({ where: { id: values.branchId, schoolId: scope.school.id }, select: { id: true, name: true, code: true } });
      if (!branch) throw notFound('Branch not found.');
    }
    let holiday = null;
    if (values.type === 'REOPENING') {
      holiday = await tx.calendarEntry.findFirst({ where: { id: values.holidayId, schoolId: scope.school.id, type: 'HOLIDAY' } });
      if (!holiday) throw notFound('Holiday not found.');
      if (holiday.cancelledAt) throw conflict('HOLIDAY_CANCELLED', `${holiday.name} was cancelled; there is nothing to reopen.`);
      if (holiday.academicYearId !== year.id) throw invalid({ holiday: `Choose a holiday of ${year.name}.` });
      if (!holiday.allowBranchReopening) throw conflict('REOPENING_NOT_ALLOWED', `${holiday.name} does not allow branches to reopen. The School Owner can allow it.`);
      insideHoliday(holiday, values.startDate, values.endDate);
    }

    const name = values.name ?? `School open during ${holiday.name}`.slice(0, 80);
    const level = { schoolId: scope.school.id, type: values.type, branchId: branch?.id ?? null, startDate: values.startDate, endDate: values.endDate };
    const other = await overlapping(tx, level);
    if (other) throw OVERLAP(values.type, other);

    const entry = await tx.calendarEntry.create({
      data: {
        schoolId: scope.school.id,
        academicYearId: year.id,
        branchId: branch?.id ?? null,
        type: values.type,
        name,
        note: values.note,
        startDate: asDbDay(values.startDate),
        endDate: asDbDay(values.endDate),
        allowBranchReopening: values.allowBranchReopening,
        holidayId: holiday?.id ?? null,
        timetableDay: values.timetableDay ?? null,
      },
      include: entryInclude,
    });
    const where = branch ? ` at ${branch.name}` : '';
    await audit(tx, AUDIT_ACTIONS.CALENDAR_ENTRY_CREATED, {
      scope,
      user,
      req,
      target: { id: entry.id, name: entry.name },
      description: `${TYPE_LABELS[entry.type]} added${where}: ${entry.name}, ${values.startDate} to ${values.endDate}.`,
      fields: [
        { field: 'Type', from: null, to: TYPE_LABELS[entry.type] },
        { field: 'Name', from: null, to: entry.name },
        { field: 'Start date', from: null, to: values.startDate },
        { field: 'End date', from: null, to: values.endDate },
        ...(branch ? [{ field: 'Branch', from: null, to: branch.name }] : []),
        ...(holiday ? [{ field: 'Holiday', from: null, to: holiday.name }] : []),
        ...(entry.type === 'HOLIDAY' ? [{ field: 'Branches may reopen', from: null, to: entry.allowBranchReopening ? 'Yes' : 'No' }] : []),
        ...(entry.timetableDay ? [{ field: 'Follows the timetable of', from: null, to: DAY_NAMES[entry.timetableDay] }] : []),
        ...(entry.note ? [{ field: 'Note', from: null, to: entry.note }] : []),
      ],
      details: { academicYearId: year.id, branchId: branch?.id ?? null, type: entry.type },
    });
    return entry;
  });
  return toEntry(created);
}

const ENTRY_LABELS = { name: 'Name', note: 'Note', startDate: 'Start date', endDate: 'End date', allowBranchReopening: 'Branches may reopen', timetableDay: 'Follows the timetable of' };
const shownEntryValue = (field, value) =>
  field === 'allowBranchReopening' ? (value ? 'Yes' : 'No') : field === 'timetableDay' ? (DAY_NAMES[value] ?? null) : (value ?? null);

/**
 * Edits an entry. Name and note can always change; dates only where the days added or removed are
 * on or after the first editable day (days before it are fixed). Reopenings of a changed holiday
 * follow it (trimReopenings).
 */
export async function updateEntry(scope, entryId, values, user, req) {
  const fe = firstEditableDay(await calendarToday());
  const updated = await withCalendarLock(scope, async (tx) => {
    const entry = await findEntry(tx, scope, entryId, { forWrite: true });
    const year = writable(await tx.academicYear.findUnique({ where: { id: entry.academicYearId } }));
    if (entry.cancelledAt) throw conflict('ENTRY_CANCELLED', 'This entry was cancelled. Add a new one instead.');
    if ('allowBranchReopening' in values && entry.type !== 'HOLIDAY') throw invalid({ allowBranchReopening: 'Only a school holiday can allow branches to reopen.' });
    if ('timetableDay' in values && entry.type !== 'SCHOOL_DAY') throw invalid({ timetableDay: 'Only an extra school day follows a weekday’s timetable.' });

    const current = { name: entry.name, note: entry.note ?? null, startDate: toDay(entry.startDate), endDate: toDay(entry.endDate), allowBranchReopening: entry.allowBranchReopening, timetableDay: entry.timetableDay };
    const next = { ...current, ...values };
    const changed = Object.keys(values).filter((f) => next[f] !== current[f]);
    if (!changed.length) return entry;
    // The weekday it follows applies to every one of its days: only while none of them is fixed.
    if (changed.includes('timetableDay') && current.startDate < fe) {
      throw invalid({ timetableDay: `This extra school day started on ${current.startDate}; its days before ${fe} are fixed. End it and add a new one instead.` });
    }

    const datesChanged = changed.includes('startDate') || changed.includes('endDate');
    if (datesChanged) {
      if (next.endDate < next.startDate) throw invalid({ endDate: 'End date cannot be before the start date.' });
      const errors = {};
      // The days added or removed must all be on or after the first editable day.
      if (next.startDate !== current.startDate && (next.startDate < current.startDate ? next.startDate : current.startDate) < fe) errors.startDate = FIXED_DAYS(fe);
      if (next.endDate !== current.endDate && (next.endDate < current.endDate ? next.endDate : current.endDate) < addDays(fe, -1)) errors.endDate = FIXED_DAYS(fe);
      if (Object.keys(errors).length) throw invalid(errors);
      withinYear(year, next.startDate, next.endDate);
      if (entry.type === 'REOPENING') insideHoliday(entry.holiday, next.startDate, next.endDate);
      const other = await overlapping(tx, { schoolId: entry.schoolId, type: entry.type, branchId: entry.branchId, startDate: next.startDate, endDate: next.endDate }, entry.id);
      if (other) throw OVERLAP(entry.type, other);
    }

    const data = Object.fromEntries(changed.map((f) => [f, f === 'startDate' || f === 'endDate' ? asDbDay(next[f]) : next[f]]));
    const saved = await tx.calendarEntry.update({ where: { id: entry.id }, data, include: entryInclude });
    const ctx = { scope, user, req };
    await audit(tx, AUDIT_ACTIONS.CALENDAR_ENTRY_UPDATED, {
      ...ctx,
      target: { id: saved.id, name: saved.name },
      description: `${TYPE_LABELS[saved.type]} ${saved.name}${saved.branch ? ` at ${saved.branch.name}` : ''} updated: ${changed.map((f) => ENTRY_LABELS[f]).join(', ')}.`,
      fields: changed.map((f) => ({ field: ENTRY_LABELS[f], from: shownEntryValue(f, current[f]), to: shownEntryValue(f, next[f]) })),
      details: { academicYearId: saved.academicYearId, branchId: saved.branchId, type: saved.type },
    });
    if (saved.type === 'HOLIDAY' && (datesChanged || changed.includes('allowBranchReopening'))) await trimReopenings(tx, saved, fe, ctx);
    return saved;
  });
  return toEntry(updated);
}

/**
 * Cancels an entry that has not started; a running one ends the day before the first editable day
 * (its past days stay); an entry entirely in the past is kept (409 ENTRY_IN_PAST). A holiday's
 * reopenings follow it.
 */
export async function cancelEntry(scope, entryId, user, req) {
  const fe = firstEditableDay(await calendarToday());
  const result = await withCalendarLock(scope, async (tx) => {
    const entry = await findEntry(tx, scope, entryId, { forWrite: true });
    writable(await tx.academicYear.findUnique({ where: { id: entry.academicYearId } }));
    if (entry.cancelledAt) return entry;
    const start = toDay(entry.startDate);
    const end = toDay(entry.endDate);
    if (end < fe) throw conflict('ENTRY_IN_PAST', `This entry ended on ${end}. Past calendar days are kept as they are.`);

    const ended = start < fe;
    const saved = await tx.calendarEntry.update({
      where: { id: entry.id },
      data: ended ? { endDate: asDbDay(addDays(fe, -1)) } : { cancelledAt: new Date() },
      include: entryInclude,
    });
    const ctx = { scope, user, req };
    const where = saved.branch ? ` at ${saved.branch.name}` : '';
    await audit(tx, AUDIT_ACTIONS.CALENDAR_ENTRY_CANCELLED, {
      ...ctx,
      target: { id: saved.id, name: saved.name },
      description: ended
        ? `${TYPE_LABELS[saved.type]} ${saved.name}${where} ended early: its last day is now ${addDays(fe, -1)}.`
        : `${TYPE_LABELS[saved.type]} ${saved.name}${where} (${start} to ${end}) cancelled.`,
      fields: ended ? [{ field: 'End date', from: end, to: addDays(fe, -1) }] : [{ field: 'Status', from: 'Active', to: 'Cancelled' }],
      details: { academicYearId: saved.academicYearId, branchId: saved.branchId, type: saved.type },
    });
    if (saved.type === 'HOLIDAY') await trimReopenings(tx, saved, fe, ctx);
    return saved;
  });
  return toEntry(result);
}
