import { Prisma } from '@prisma/client';
import { badRequest, conflict, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { ACADEMIC_YEAR_ACTIONS, AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { listSchoolAudit, lockActiveSchool } from '../branches/branches.service.js';
import { academicYearNameKey, checkRange, daysInclusive } from './academicYearInput.js';

/*
 * Academic years (approved rules: docs/business-rules.md → Academic years). School level: a year
 * belongs to one school and applies to all its branches. Every function takes the school decided by
 * the server from the signed-in account — the owner's school (requireOwnerSchool) or the Manager's
 * branch's school (requireManagerBranch) — and only reads or writes that school's years.
 *
 * Lifecycle: PLANNED → CURRENT → CLOSED. At most one CURRENT year per school; years never overlap;
 * a CLOSED year is read only; only a PLANNED year can be deleted.
 *
 * Writes (School Owner only): one transaction takes a per-school advisory lock (so changes to one
 * school's years run one at a time) and locks the school row, which must be ACTIVE (409
 * SCHOOL_SUSPENDED). Each change and its audit event are written together; unchanged submissions
 * write and record nothing. The database enforces "one current" and "no overlap" as a backstop.
 */

export const ACADEMIC_YEAR_STATUSES = ['planned', 'current', 'closed'];

const day = (date) => date.toISOString().slice(0, 10);

/** The shape the web app uses (dates as 'YYYY-MM-DD'; status in lower case). */
export const toAcademicYear = (y) => ({
  id: y.id,
  name: y.name,
  startDate: day(y.startDate),
  endDate: day(y.endDate),
  days: daysInclusive(y.startDate, y.endDate),
  status: y.status.toLowerCase(),
  startedAt: y.startedAt?.toISOString() ?? null,
  closedAt: y.closedAt?.toISOString() ?? null,
  createdAt: y.createdAt.toISOString(),
});

const NAME_TAKEN = () =>
  conflict('NAME_TAKEN', 'An academic year with this name already exists in your school. Choose another name.', {
    name: 'An academic year with this name already exists in your school (names are compared without regard to capitalization).',
  });
const OVERLAP = (other) =>
  conflict(
    'DATES_OVERLAP',
    other
      ? `These dates overlap ${other.name} (${day(other.startDate)} to ${day(other.endDate)}). Academic years of a school cannot overlap.`
      : 'These dates overlap another academic year of your school. Academic years of a school cannot overlap.',
    { startDate: 'Overlaps another academic year.', endDate: 'Overlaps another academic year.' },
  );
const YEAR_CLOSED = () => conflict('YEAR_CLOSED', 'This academic year is closed. Closed years are kept as they are and cannot be changed.');
const INVALID_STATUS = (message) => conflict('INVALID_STATUS', message);

const isUniqueViolation = (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
// The exclusion constraint (23P01) and one-current index are backstops behind the checks below.
const mentions = (error, text) => {
  try {
    return `${error?.message ?? ''} ${JSON.stringify(error?.meta ?? {})}`.includes(text);
  } catch {
    return false;
  }
};

function translateDbError(error) {
  if (isUniqueViolation(error) && mentions(error, 'nameKey')) return NAME_TAKEN();
  if (mentions(error, 'AcademicYear_no_overlap') || mentions(error, '23P01')) return OVERLAP(null);
  if (mentions(error, 'AcademicYear_one_current')) return conflict('CURRENT_EXISTS', 'Your school already has a current academic year.');
  return error;
}

async function findOrFail(client, school, id) {
  const year = isUuid(id) ? await client.academicYear.findFirst({ where: { id, schoolId: school.id } }) : null;
  // A year of another school is reported exactly like one that does not exist.
  if (!year) throw notFound('Academic year not found.');
  return year;
}

/** Runs `work(tx)` with the school's academic years locked and the school required to be ACTIVE. */
async function withSchoolLock(school, work) {
  try {
    return await getPrisma().$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`academic-year:${school.id}`}))`;
      await lockActiveSchool(tx, school);
      return work(tx);
    }, { timeout: 20000, maxWait: 10000 });
  } catch (error) {
    throw translateDbError(error);
  }
}

/** The school's other year overlapping [startDate, endDate] (both inclusive), or null. */
const overlapping = (tx, school, { startDate, endDate }, exceptId) =>
  tx.academicYear.findFirst({
    where: { schoolId: school.id, ...(exceptId && { id: { not: exceptId } }), startDate: { lte: endDate }, endDate: { gte: startDate } },
    orderBy: { startDate: 'asc' },
  });

// ---- reads (School Owner and Manager) ---------------------------------------------------------

/** Every year of the school, newest first, and the current one (or null). */
export async function listAcademicYears(school) {
  const rows = await getPrisma().academicYear.findMany({ where: { schoolId: school.id }, orderBy: { startDate: 'desc' } });
  const items = rows.map(toAcademicYear);
  return { items, current: items.find((y) => y.status === 'current') ?? null };
}

export async function getAcademicYear(school, id) {
  return toAcademicYear(await findOrFail(getPrisma(), school, id));
}

/** The school's current year, or null (for other features, e.g. reports). */
export async function currentAcademicYear(schoolId, client = getPrisma()) {
  const year = await client.academicYear.findFirst({ where: { schoolId, status: 'CURRENT' } });
  return year && toAcademicYear(year);
}

// ---- audit values -----------------------------------------------------------------------------

const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const auditTarget = (year) => ({ type: 'academic_year', id: year.id, name: year.name });
const STATUS_LABELS = { PLANNED: 'Planned', CURRENT: 'Current', CLOSED: 'Closed' };
const LABELS = { name: 'Name', startDate: 'Start date', endDate: 'End date' };
const shownValue = (field, value) => (value instanceof Date ? day(value) : value);

function audit(tx, action, year, { school, user, req, description, fields }) {
  return recordAuditEvent({ client: tx, action, actor: actorOf(user), target: auditTarget(year), schoolId: school.id, description, change: { fields }, req });
}

async function closeYear(tx, year, ctx, description) {
  const closed = await tx.academicYear.update({ where: { id: year.id }, data: { status: 'CLOSED', closedAt: new Date() } });
  await audit(tx, AUDIT_ACTIONS.ACADEMIC_YEAR_CLOSED, closed, {
    ...ctx,
    description,
    fields: [{ field: 'Status', from: STATUS_LABELS[year.status], to: STATUS_LABELS.CLOSED }],
  });
  return closed;
}

// ---- changes (School Owner) -------------------------------------------------------------------

/** Creates a PLANNED year. The first year of a school is planned too: the owner starts it. */
export async function createAcademicYear(school, values, user, req) {
  const created = await withSchoolLock(school, async (tx) => {
    const other = await overlapping(tx, school, values);
    if (other) throw OVERLAP(other);
    const year = await tx.academicYear.create({
      data: { schoolId: school.id, ...values, nameKey: academicYearNameKey(values.name), status: 'PLANNED' },
    });
    await audit(tx, AUDIT_ACTIONS.ACADEMIC_YEAR_CREATED, year, {
      school,
      user,
      req,
      description: `Academic year ${year.name} planned: ${day(year.startDate)} to ${day(year.endDate)}.`,
      fields: [
        { field: 'Status', from: null, to: STATUS_LABELS.PLANNED },
        ...Object.keys(LABELS).map((f) => ({ field: LABELS[f], from: null, to: shownValue(f, year[f]) })),
      ],
    });
    return year;
  });
  return toAcademicYear(created);
}

/** Edits name and dates of a PLANNED or CURRENT year. Unchanged values are ignored; nothing changed → no event. */
export async function updateAcademicYear(school, id, values, user, req) {
  const result = await withSchoolLock(school, async (tx) => {
    const current = await findOrFail(tx, school, id);
    if (current.status === 'CLOSED') throw YEAR_CLOSED();
    const same = (f) => (values[f] instanceof Date ? values[f].getTime() === current[f].getTime() : values[f] === current[f]);
    const changed = Object.keys(values).filter((f) => !same(f));
    if (!changed.length) return current;

    const next = { ...current, ...values };
    checkRange(next.startDate, next.endDate);
    if (changed.includes('startDate') || changed.includes('endDate')) {
      const other = await overlapping(tx, school, next, current.id);
      if (other) throw OVERLAP(other);
    }
    const data = Object.fromEntries(changed.map((f) => [f, values[f]]));
    if (data.name) data.nameKey = academicYearNameKey(data.name);
    const updated = await tx.academicYear.update({ where: { id: current.id }, data });
    await audit(tx, AUDIT_ACTIONS.ACADEMIC_YEAR_UPDATED, updated, {
      school,
      user,
      req,
      description: `Academic year ${updated.name} updated: ${changed.map((f) => LABELS[f]).join(', ')}.`,
      fields: changed.map((f) => ({ field: LABELS[f], from: shownValue(f, current[f]), to: shownValue(f, updated[f]) })),
    });
    return updated;
  });
  return toAcademicYear(result);
}

/**
 * Makes a PLANNED year the school's CURRENT one. When the school already has a current year, the
 * request must confirm closing it (`closeCurrent: true`, else 409 CURRENT_EXISTS); both happen in one
 * transaction, so the school is never left with two current years or with none in between. Years
 * move forward: a year that starts before a closed year cannot be started (409 OUT_OF_ORDER).
 */
export async function startAcademicYear(school, id, { closeCurrent }, user, req) {
  const result = await withSchoolLock(school, async (tx) => {
    const year = await findOrFail(tx, school, id);
    if (year.status === 'CURRENT') return { year, closed: null };
    if (year.status !== 'PLANNED') throw INVALID_STATUS('Only a planned academic year can be started. Closed years stay closed.');

    const later = await tx.academicYear.findFirst({
      where: { schoolId: school.id, status: { in: ['CURRENT', 'CLOSED'] }, startDate: { gt: year.startDate } },
      orderBy: { startDate: 'desc' },
    });
    if (later) {
      const state = later.status === 'CURRENT' ? 'already current' : 'already closed';
      throw conflict('OUT_OF_ORDER', `${year.name} starts before ${later.name}, which is ${state}. Academic years are started in date order.`);
    }

    const ctx = { school, user, req };
    const previous = await tx.academicYear.findFirst({ where: { schoolId: school.id, status: 'CURRENT' } });
    let closed = null;
    if (previous) {
      if (!closeCurrent) {
        throw conflict('CURRENT_EXISTS', `${previous.name} is your school's current academic year. Starting ${year.name} closes it; confirm to continue.`, {
          current: previous.name,
        });
      }
      closed = await closeYear(tx, previous, ctx, `Academic year ${previous.name} closed when ${year.name} was started.`);
    }
    const started = await tx.academicYear.update({ where: { id: year.id }, data: { status: 'CURRENT', startedAt: new Date() } });
    await audit(tx, AUDIT_ACTIONS.ACADEMIC_YEAR_STARTED, started, {
      ...ctx,
      description: previous ? `Academic year ${started.name} started; ${previous.name} was closed.` : `Academic year ${started.name} started.`,
      fields: [{ field: 'Status', from: STATUS_LABELS.PLANNED, to: STATUS_LABELS.CURRENT }],
    });
    return { year: started, closed };
  });
  return { academicYear: toAcademicYear(result.year), closed: result.closed && toAcademicYear(result.closed) };
}

/** Closes the CURRENT year. Closed years are read only and cannot be reopened. */
export async function closeAcademicYear(school, id, user, req) {
  const result = await withSchoolLock(school, async (tx) => {
    const year = await findOrFail(tx, school, id);
    if (year.status === 'CLOSED') return year;
    if (year.status !== 'CURRENT') throw INVALID_STATUS('Only the current academic year can be closed. A planned year can be deleted instead.');
    return closeYear(tx, year, { school, user, req }, `Academic year ${year.name} closed.`);
  });
  return toAcademicYear(result);
}

/** Deletes a PLANNED year (a year that was never started). The audit event keeps its details. */
export async function deleteAcademicYear(school, id, user, req) {
  await withSchoolLock(school, async (tx) => {
    const year = await findOrFail(tx, school, id);
    if (year.status !== 'PLANNED') throw INVALID_STATUS('Only a planned academic year can be deleted. Current and closed years are kept.');
    const sections = await tx.section.count({ where: { academicYearId: year.id } });
    if (sections) {
      throw conflict('YEAR_IN_USE', `${year.name} has ${sections} section${sections === 1 ? '' : 's'}. A year with sections is kept; it cannot be deleted.`, { sections });
    }
    // Its calendar (school days, holidays, closures) is history too: such a year is kept.
    const [weekdays, entries] = await Promise.all([tx.academicWeekdays.count({ where: { academicYearId: year.id } }), tx.calendarEntry.count({ where: { academicYearId: year.id } })]);
    if (weekdays || entries) {
      throw conflict('YEAR_IN_USE', `${year.name} has a calendar (school days or calendar entries). A year with a calendar is kept; it cannot be deleted.`, { weekdays, entries });
    }
    await tx.academicYear.delete({ where: { id: year.id } });
    await audit(tx, AUDIT_ACTIONS.ACADEMIC_YEAR_DELETED, year, {
      school,
      user,
      req,
      description: `Planned academic year ${year.name} deleted.`,
      fields: [
        { field: 'Status', from: STATUS_LABELS.PLANNED, to: null },
        ...Object.keys(LABELS).map((f) => ({ field: LABELS[f], from: shownValue(f, year[f]), to: null })),
      ],
    });
  });
}

/** Academic year audit events of this school (School Owner view), newest first. */
export const listAcademicYearAudit = (school, { year, page, pageSize }) =>
  listSchoolAudit(school, { targetType: 'academic_year', action: { in: ACADEMIC_YEAR_ACTIONS }, ...(year && { targetId: year }) }, { page, pageSize });

// ---- attendance reports by academic year (School Owner and Manager) ----------------------------

const REPORT_WINDOW_DAYS = 62;
const addDayStrings = (dayString, n) => new Date(Date.parse(`${dayString}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * Applies an `academicYear` report filter (an id of the school's year, or 'current') to a report
 * query: chosen dates must lie inside the year (400 otherwise); missing dates default to the year's
 * latest days up to today (at most the report's 62 days). Returns { query, academicYear } — the
 * query without `academicYear` and with from/to set, ready for the report readers, which check the
 * usual rules (at most 62 days, never after today) again. Without the filter: { query, academicYear: null }.
 */
export async function applyAcademicYearFilter(query, schoolId, today) {
  const { academicYear: raw, ...rest } = query;
  if (raw === undefined || raw === '') return { query: rest, academicYear: null };
  if (typeof raw !== 'string' || (raw !== 'current' && !isUuid(raw))) {
    throw badRequest('"academicYear" must be an id or "current".', { academicYear: 'Choose an academic year from the list.' });
  }
  const year = await getPrisma().academicYear.findFirst({ where: raw === 'current' ? { schoolId, status: 'CURRENT' } : { id: raw, schoolId } });
  if (!year) {
    if (raw === 'current') throw badRequest('Your school has no current academic year.', { academicYear: 'Your school has no current academic year.' });
    throw notFound('Academic year not found.');
  }
  const start = day(year.startDate);
  const end = day(year.endDate);
  if (start > today) throw badRequest(`${year.name} has not started yet (it starts on ${start}).`, { academicYear: `${year.name} starts on ${start}.` });

  const single = (v) => (Array.isArray(v) ? v[0] : v);
  let from = single(rest.from) || undefined;
  let to = single(rest.to) || undefined;
  const last = end < today ? end : today;
  if (!from && !to) to = last;
  if (!to) to = [addDayStrings(from, REPORT_WINDOW_DAYS - 1), last].sort()[0];
  if (!from) from = [addDayStrings(to, -(REPORT_WINDOW_DAYS - 1)), start].sort().at(-1);

  const outside = (value) => typeof value === 'string' && (value < start || value > end);
  if (outside(from) || outside(to)) {
    const message = `Choose dates within ${year.name} (${start} to ${end}).`;
    throw badRequest(message, { ...(outside(from) && { from: message }), ...(outside(to) && { to: message }) });
  }
  return { query: { ...rest, from, to }, academicYear: toAcademicYear(year) };
}
