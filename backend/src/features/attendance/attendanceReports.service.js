import { badRequest, HttpError, notFound } from '../../common/httpError.js';
import { fromDbStatus, pageWindow } from '../../common/listQuery.js';
import { getPrisma } from '../../config/prisma.js';
import { platformTimeZone } from '../platform-settings/settings.service.js';
import { toTime } from '../schedules/scheduleInput.js';
import { addDays, localDate } from '../schedules/schedules.service.js';

/*
 * Attendance reports for School Owners and Managers (approved Phase 1: docs/reports/). Read only.
 *
 * A report row is one accepted check-in (AttendanceEvent CHECK_IN) with its check-out, if any. The
 * status is the one stored at check-in; shift, times, time zone and the check-out setting come from
 * the event's own schedule version, never the current one. Nothing is recalculated, assumed or
 * stored; absence is not calculated.
 *
 * Scope: { schoolId, branchId? }, always built by the server from the signed-in account (the
 * Owner's school; the Manager's current branch). Every query is limited to it; a branch or staff
 * member outside it is reported as not found. Coordinates are never selected.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** A received time more than this after the event time is shown as "Uploaded later" (D12; display only). */
export const UPLOADED_LATER_MS = 5 * 60 * 1000;

const asDbDate = (date) => new Date(`${date}T00:00:00Z`);
const fromDbDate = (value) => value.toISOString().slice(0, 10);
const round1 = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : null);

/** Today's date in the platform time zone (the zone schedules are saved in): the default and latest report day. */
export async function reportToday(now = new Date()) {
  return localDate(await platformTimeZone(), now);
}

// ---- time zones ----------------------------------------------------------------------------

const formatters = new Map();
/** { date: 'YYYY-MM-DD', time: 'HH:MM:SS' } of an instant in a time zone. */
export function localParts(instant, timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }),
    );
  }
  const p = Object.fromEntries(formatters.get(timeZone).formatToParts(instant).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

/**
 * The last work date whose check-out deadline has passed at `now` in a time zone (D9). A check-out
 * must happen by the end of its work day and may be uploaded up to 24 hours later, so the deadline is
 * the start of the next day + 24 h. now ≥ start(D + 1) + 24 h ⟺ local date of (now − 24 h) ≥ D + 1.
 */
export const lastClosedWorkDate = (timeZone, now) => addDays(localDate(timeZone, new Date(now.getTime() - DAY_MS)), -1);

/** Check-out state of a check-in row (D9): recorded, not_required, missing (deadline passed) or open. */
export function checkOutState({ hasCheckOut, checkOutEnabled, workDate, timeZone }, now) {
  if (hasCheckOut) return 'recorded';
  if (!checkOutEnabled) return 'not_required';
  return workDate <= lastClosedWorkDate(timeZone, now) ? 'missing' : 'open';
}

// ---- scope and filters ---------------------------------------------------------------------

/** Checks the requested branch, staff member and shift against the scope; returns the effective scope. */
async function resolveScope(base, filters, client) {
  const scope = { schoolId: base.schoolId, branchId: base.branchId ?? null };
  if (filters.branch) {
    const branch = await client.branch.findFirst({ where: { id: filters.branch, schoolId: scope.schoolId }, select: { id: true } });
    if (!branch) throw notFound('Branch not found.');
    scope.branchId = branch.id;
  }
  if (filters.staff) {
    const staff = await client.user.findFirst({ where: { id: filters.staff, role: 'STAFF', ...inScope(scope) }, select: { id: true } });
    if (!staff) throw notFound('Staff member not found.');
  }
  if (filters.shift) {
    const shift = await client.branchShift.findFirst({ where: { shiftKey: filters.shift, schedule: { branchId: scope.branchId } }, select: { id: true } });
    if (!shift) throw badRequest('This shift is not one of the branch’s shifts.', { shift: 'Choose a shift from the list.' });
  }
  return scope;
}

/** Users (staff) and events in scope: the school, and the branch when there is one. */
const inScope = (scope) => ({ branch: { schoolId: scope.schoolId }, ...(scope.branchId && { branchId: scope.branchId }) });

const checkInWhere = (scope, f) => ({
  type: 'CHECK_IN',
  workDate: { gte: asDbDate(f.from), lte: asDbDate(f.to) },
  ...inScope(scope),
  ...(f.staff && { staffUserId: f.staff }),
  ...(f.shift && { shiftKey: f.shift }),
});

/** The time zones of every schedule version in scope (normally one: the platform zone). */
async function scopeZones(scope, client) {
  const rows = await client.branchSchedule.findMany({ where: inScope(scope), distinct: ['timeZone'], select: { timeZone: true } });
  return rows.map((r) => r.timeZone).sort();
}

/** Prisma conditions for each check-out state, consistent with checkOutState(). */
function stateWheres(zones, now) {
  const noCheckOut = { checkOut: { is: null } };
  const closed = zones.length
    ? { OR: zones.map((timeZone) => ({ schedule: { timeZone }, workDate: { lte: asDbDate(lastClosedWorkDate(timeZone, now)) } })) }
    : { id: { in: [] } };
  return {
    recorded: { checkOut: { isNot: null } },
    not_required: { AND: [noCheckOut, { schedule: { checkOutEnabled: false } }] },
    missing: { AND: [noCheckOut, { schedule: { checkOutEnabled: true } }, closed] },
    open: { AND: [noCheckOut, { schedule: { checkOutEnabled: true } }, { NOT: closed }] },
  };
}

function datesBetween(from, to) {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

// ---- summary -------------------------------------------------------------------------------

const emptyCounts = () => ({ checkIns: 0, present: 0, late: 0, checkedOut: 0, checkOutOpen: 0, checkOutMissing: 0, checkOutNotRequired: 0, staffCheckedIn: 0 });

/**
 * Dashboard figures. Every figure is a count of accepted check-ins (or distinct staff with one).
 * checkIns = present + late = checkedOut + checkOutOpen + checkOutMissing + checkOutNotRequired.
 * `compareBranches` (Owner, no branch chosen): the same counts for every branch of the school.
 *
 * Three grouped queries (check-ins and check-outs by branch, work date and schedule version; staff by
 * branch), then each group's check-out state from its version's setting and time zone with the same
 * rule as the records (checkOutState). A check-out has its check-in's branch, staff member, work
 * date, shift and version, so the same filters select exactly the check-outs of the check-ins counted.
 */
export async function attendanceSummary(base, filters, { compareBranches = false, now = new Date(), today } = {}) {
  const prisma = getPrisma();
  const scope = await resolveScope(base, filters, prisma);
  const where = checkInWhere(scope, filters);
  const byBranchToo = compareBranches && !scope.branchId;
  const keys = ['branchId', 'workDate', 'scheduleId'];

  const [checkIns, checkOuts, staffGroups] = await Promise.all([
    prisma.attendanceEvent.groupBy({ by: [...keys, 'status'], where, _count: { _all: true } }),
    prisma.attendanceEvent.groupBy({ by: keys, where: { ...where, type: 'CHECK_OUT' }, _count: { _all: true } }),
    prisma.attendanceEvent.groupBy({ by: ['branchId', 'staffUserId'], where }),
  ]);
  const versionIds = [...new Set(checkIns.map((g) => g.scheduleId))];
  const versions = new Map(
    (await prisma.branchSchedule.findMany({ where: { id: { in: versionIds } }, select: { id: true, timeZone: true, checkOutEnabled: true } })).map((v) => [v.id, v]),
  );

  const perBranch = new Map();
  const totals = emptyCounts();
  const countsFor = (branchId) => [totals, ...(byBranchToo ? [perBranch.get(branchId) ?? perBranch.set(branchId, emptyCounts()).get(branchId)] : [])];
  const groupKey = (g) => `${g.branchId}|${fromDbDate(g.workDate)}|${g.scheduleId}`;
  const days = new Map(datesBetween(filters.from, filters.to).map((d) => [d, { date: d, present: 0, late: 0 }]));
  const groups = new Map(); // check-ins per branch, work date and version (for the check-out states)

  for (const g of checkIns) {
    const n = g._count._all;
    const field = g.status === 'LATE' ? 'late' : 'present';
    for (const c of countsFor(g.branchId)) {
      c.checkIns += n;
      c[field] += n;
    }
    const day = days.get(fromDbDate(g.workDate));
    if (day) day[field] += n;
    const key = groupKey(g);
    if (!groups.has(key)) groups.set(key, { branchId: g.branchId, workDate: fromDbDate(g.workDate), scheduleId: g.scheduleId, checkIns: 0, checkOuts: 0 });
    groups.get(key).checkIns += n;
  }
  for (const g of checkOuts) {
    const group = groups.get(groupKey(g));
    if (group) group.checkOuts += g._count._all;
  }
  for (const group of groups.values()) {
    const version = versions.get(group.scheduleId);
    const recorded = Math.min(group.checkOuts, group.checkIns);
    const without = group.checkIns - recorded;
    const state = checkOutState({ hasCheckOut: false, checkOutEnabled: version.checkOutEnabled, workDate: group.workDate, timeZone: version.timeZone }, now);
    const field = { open: 'checkOutOpen', missing: 'checkOutMissing', not_required: 'checkOutNotRequired' }[state];
    for (const c of countsFor(group.branchId)) {
      c.checkedOut += recorded;
      c[field] += without;
    }
  }
  // Distinct staff with a check-in (a staff member belongs to one branch, so branch counts add up).
  for (const g of staffGroups) for (const c of countsFor(g.branchId)) c.staffCheckedIn += 1;

  let byBranch = null;
  if (byBranchToo) {
    const branches = await prisma.branch.findMany({ where: { schoolId: scope.schoolId }, orderBy: { number: 'asc' }, select: { id: true, code: true, name: true, status: true } });
    byBranch = branches.map((b) => ({ branch: { id: b.id, code: b.code, name: b.name, status: fromDbStatus(b.status) }, ...(perBranch.get(b.id) ?? emptyCounts()) }));
  }

  const eventZones = [...new Set([...versions.values()].map((v) => v.timeZone))].sort();
  const timeZones = eventZones.length ? eventZones : await scopeZones(scope, prisma).then((z) => (z.length ? z : platformTimeZone().then((tz) => [tz])));
  return {
    filters: { from: filters.from, to: filters.to, branch: filters.branch ?? null, staff: filters.staff ?? null, shift: filters.shift ?? null },
    today,
    timeZones,
    totals,
    absence: { available: false, reason: 'NOT_APPROVED' },
    byDay: [...days.values()],
    byBranch,
  };
}

// ---- records -------------------------------------------------------------------------------

const ORDER = {
  date: (o) => [{ workDate: o }, { occurredAt: o }],
  checkIn: (o) => [{ occurredAt: o }],
  staffName: (o) => [{ staff: { name: o } }, { occurredAt: o }],
  staffId: (o) => [{ staff: { staffId: o } }, { occurredAt: o }],
  branch: (o) => [{ branch: { code: o } }, { occurredAt: o }],
  status: (o) => [{ status: o }, { occurredAt: o }],
};

// The event fields a report may show: never latitude or longitude (D11).
const eventFields = { id: true, occurredAt: true, receivedAt: true, distanceMeters: true, accuracyMeters: true };

/** Recorded facts of one event in its time zone: event and received times, and GPS distance and accuracy. */
function eventFacts(e, timeZone) {
  const local = localParts(e.occurredAt, timeZone);
  return {
    occurredAt: e.occurredAt.toISOString(),
    date: local.date,
    time: local.time,
    receivedAt: e.receivedAt.toISOString(),
    received: localParts(e.receivedAt, timeZone),
    uploadedLater: e.receivedAt.getTime() - e.occurredAt.getTime() > UPLOADED_LATER_MS,
    distanceMeters: round1(e.distanceMeters),
    accuracyMeters: round1(e.accuracyMeters),
  };
}

/** The records conditions for a resolved scope and the filters (status, check-out state, search). */
async function recordsWhere(scope, filters, now, client) {
  const conditions = [checkInWhere(scope, filters)];
  if (filters.status) conditions.push({ status: filters.status.toUpperCase() });
  if (filters.checkOut) conditions.push(stateWheres(await scopeZones(scope, client), now)[filters.checkOut]);
  if (filters.q) conditions.push({ staff: { OR: [{ name: { contains: filters.q, mode: 'insensitive' } }, { staffId: { contains: filters.q, mode: 'insensitive' } }] } });
  return { AND: conditions };
}

/** The chosen sort, ending with the event id, so the order is total and the same on every request. */
const recordOrder = (filters) => [...ORDER[filters.sort](filters.order), { id: filters.order }];

// Every field a record row needs (never coordinates).
const recordSelect = {
  ...eventFields,
  workDate: true,
  shiftKey: true,
  scheduleId: true,
  status: true,
  staff: { select: { id: true, staffId: true, name: true, jobTitle: true, status: true } },
  branch: { select: { id: true, code: true, name: true } },
  checkOut: { select: eventFields },
};

/** Schedule versions of the rows (each read once; `cache` keeps them across batches). */
async function versionsFor(rows, client, cache = new Map()) {
  const missing = [...new Set(rows.map((r) => r.scheduleId))].filter((id) => !cache.has(id));
  if (missing.length) {
    for (const v of await client.branchSchedule.findMany({ where: { id: { in: missing } }, include: { shifts: true } })) cache.set(v.id, v);
  }
  return cache;
}

/** Report rows from event rows: the shift as it was that day, the version's time zone and check-out setting. */
function toRecords(rows, versions, now, withBranch) {
  return rows.map((r) => {
    const version = versions.get(r.scheduleId);
    const shift = version.shifts.find((s) => s.shiftKey === r.shiftKey);
    const workDate = fromDbDate(r.workDate);
    const state = checkOutState({ hasCheckOut: Boolean(r.checkOut), checkOutEnabled: version.checkOutEnabled, workDate, timeZone: version.timeZone }, now);
    const worked = r.checkOut ? Math.floor((r.checkOut.occurredAt.getTime() - r.occurredAt.getTime()) / 60000) : null;
    return {
      id: r.id,
      workDate,
      timeZone: version.timeZone,
      ...(withBranch && { branch: r.branch }),
      staff: { id: r.staff.id, staffId: r.staff.staffId, name: r.staff.name, jobTitle: r.staff.jobTitle ?? '', status: fromDbStatus(r.staff.status) },
      shift: shift
        ? { key: shift.shiftKey, name: shift.name, start: toTime(shift.startMinute), end: toTime(shift.endMinute), graceMinutes: shift.graceMinutes }
        : { key: r.shiftKey, name: null, start: null, end: null, graceMinutes: null },
      checkOutEnabled: version.checkOutEnabled,
      status: r.status,
      checkIn: eventFacts(r, version.timeZone),
      checkOutState: state,
      checkOut: r.checkOut ? eventFacts(r.checkOut, version.timeZone) : null,
      workedMinutes: worked !== null && worked >= 0 ? worked : null,
    };
  });
}

/**
 * One page of records: accepted check-ins in scope and range, with their check-out. Filters:
 * status, check-out state, staff, shift and a name / Staff ID search. Sorted with a final tie-break
 * on the event id, so pages never repeat or skip a row. `withBranch` adds each row's branch (Owner).
 */
export async function attendanceRecords(base, filters, { withBranch = false, now = new Date(), today } = {}) {
  const prisma = getPrisma();
  const scope = await resolveScope(base, filters, prisma);
  const where = await recordsWhere(scope, filters, now, prisma);
  const total = await prisma.attendanceEvent.count({ where });
  const { skip, take, meta } = pageWindow(total, filters.page, filters.pageSize);
  const rows = await prisma.attendanceEvent.findMany({ where, orderBy: recordOrder(filters), skip, take, select: recordSelect });
  const items = toRecords(rows, await versionsFor(rows, prisma), now, withBranch);

  return {
    items,
    ...meta,
    filters: {
      from: filters.from,
      to: filters.to,
      branch: filters.branch ?? null,
      staff: filters.staff ?? null,
      shift: filters.shift ?? null,
      status: filters.status ?? null,
      checkOut: filters.checkOut ?? null,
      q: filters.q ?? null,
      sort: filters.sort,
      order: filters.order,
    },
    today,
  };
}

// ---- exports (CSV and Excel) ---------------------------------------------------------------

/** Most data rows one export may contain; more is refused (never truncated). */
export const EXPORT_MAX_ROWS = 10_000;
/** Rows read per batch, so an export never reads every row in one query. */
export const EXPORT_BATCH = 2_000;

export const exportTooLarge = (total) =>
  new HttpError(
    400,
    'EXPORT_TOO_LARGE',
    `These filters match ${total.toLocaleString('en')} records; an export can contain at most ${EXPORT_MAX_ROWS.toLocaleString('en')}. Narrow the dates or filters and export again.`,
    { total, limit: EXPORT_MAX_ROWS },
  );

/** attendance_<school or branch code>_<from>_to_<to>.<ext> — built from server values only, reduced to [A-Za-z0-9-]. */
export function exportFilename(code, { from, to }, extension = 'csv') {
  const safe = (value) => String(value ?? '').replace(/[^A-Za-z0-9-]/g, '');
  return `attendance_${safe(code) || 'report'}_${safe(from)}_to_${safe(to)}.${extension}`;
}

/** What an export or preview describes: the school, the branch in scope, and the names of the chosen staff member and shift. */
async function exportContext(scope, filters, client, now) {
  const [school, branch, staff, shift] = await Promise.all([
    client.school.findUnique({ where: { id: scope.schoolId }, select: { code: true, name: true } }),
    scope.branchId ? client.branch.findUnique({ where: { id: scope.branchId }, select: { code: true, name: true } }) : null,
    filters.staff ? client.user.findUnique({ where: { id: filters.staff }, select: { name: true, staffId: true } }) : null,
    filters.shift
      ? client.branchShift.findFirst({ where: { shiftKey: filters.shift, schedule: { branchId: scope.branchId } }, orderBy: { schedule: { effectiveFrom: 'desc' } }, select: { name: true } })
      : null,
  ]);
  return { school, branch, staff, shift: shift?.name ?? null, now };
}

/**
 * Summary of the records matching `where` (the same rows an export contains), counted by the
 * database without reading the rows: check-ins, Present, Late, checked out, missing (no check-out
 * after the deadline), pending (not checked out yet), not required, distinct staff; and the time
 * zones of their schedule versions (the scope's zones, or the platform zone, when there are none).
 * At most three queries run at once (a slow database must not exhaust the connection pool).
 */
async function recordsSummary(where, scope, now, client) {
  const zones = await scopeZones(scope, client);
  const states = stateWheres(zones, now);
  const [statusGroups, staffGroups, eventZones] = await Promise.all([
    client.attendanceEvent.groupBy({ by: ['status'], where, _count: { _all: true } }),
    client.attendanceEvent.groupBy({ by: ['staffUserId'], where }),
    client.branchSchedule.findMany({ where: { attendanceEvents: { some: where } }, distinct: ['timeZone'], select: { timeZone: true } }),
  ]);
  const [recorded, missing, open, notRequired] = await Promise.all(
    ['recorded', 'missing', 'open', 'not_required'].map((state) => client.attendanceEvent.count({ where: { AND: [where, states[state]] } })),
  );
  const count = (status) => statusGroups.find((g) => g.status === status)?._count._all ?? 0;
  const summary = {
    checkIns: count('PRESENT') + count('LATE'),
    present: count('PRESENT'),
    late: count('LATE'),
    checkedOut: recorded,
    missing,
    pending: open,
    notRequired,
    staff: staffGroups.length,
  };
  const timeZones = eventZones.length ? eventZones.map((z) => z.timeZone).sort() : zones.length ? zones : [await platformTimeZone()];
  return { summary, timeZones };
}

/**
 * Reads every record matching the filters for an export (all pages; the records sort, ending with
 * the event id), in batches. The scope is checked first (outside scope → 404, as for the report).
 * One REPEATABLE READ transaction gives the count, the summary and every batch the same snapshot, so
 * rows added meanwhile cannot shift batches. More than EXPORT_MAX_ROWS rows → 400 EXPORT_TOO_LARGE
 * before `start` is called. Read only.
 *
 * handlers.start({ total, context, summary?, timeZones? }) — after the size check; context: { school,
 *   branch, staff, shift, now }; summary and timeZones only with `withSummary` (recordsSummary).
 * handlers.batch(records) — each batch, as report rows (with their branch).
 * handlers.stop() — true to stop early (the client has gone).
 */
export async function readExportBatches(base, filters, { now = new Date(), withSummary = false } = {}, { start, batch, stop = () => false }) {
  const prisma = getPrisma();
  const scope = await resolveScope(base, filters, prisma);
  const context = await exportContext(scope, filters, prisma, now);

  await prisma.$transaction(
    async (tx) => {
      const where = await recordsWhere(scope, filters, now, tx);
      const total = await tx.attendanceEvent.count({ where });
      if (total > EXPORT_MAX_ROWS) throw exportTooLarge(total);
      await start({ total, context, ...(withSummary && (await recordsSummary(where, scope, now, tx))) });
      const versions = new Map();
      const orderBy = recordOrder(filters);
      for (let skip = 0; skip < total && !stop(); skip += EXPORT_BATCH) {
        const rows = await tx.attendanceEvent.findMany({ where, orderBy, skip, take: EXPORT_BATCH, select: recordSelect });
        await versionsFor(rows, tx, versions);
        await batch(toRecords(rows, versions, now, true));
      }
    },
    { isolationLevel: 'RepeatableRead', maxWait: 10_000, timeout: 120_000 },
  );
}

/** Rows a preview shows (the first ones, in the export's order). */
export const PREVIEW_ROWS = 50;

/**
 * The data of an export preview: the context, the total and summary of every matching row (database
 * counts, as in the export), the time zones, and only the first PREVIEW_ROWS rows in the export's
 * order. Not a file and not the export's data: a download reads everything again and checks the
 * scope, dates and row limit itself. More than EXPORT_MAX_ROWS rows is reported (overLimit), not
 * refused, so the preview can explain it. Read only.
 */
export async function exportPreview(base, filters, { now = new Date(), limit = PREVIEW_ROWS } = {}) {
  const prisma = getPrisma();
  const scope = await resolveScope(base, filters, prisma);
  const context = await exportContext(scope, filters, prisma, now);
  return prisma.$transaction(
    async (tx) => {
      const where = await recordsWhere(scope, filters, now, tx);
      const total = await tx.attendanceEvent.count({ where });
      const { summary, timeZones } = await recordsSummary(where, scope, now, tx);
      const rows = await tx.attendanceEvent.findMany({ where, orderBy: recordOrder(filters), take: limit, select: recordSelect });
      const records = toRecords(rows, await versionsFor(rows, tx), now, true);
      return { context, total, summary, timeZones, records, limit: EXPORT_MAX_ROWS, overLimit: total > EXPORT_MAX_ROWS };
    },
    { isolationLevel: 'RepeatableRead', maxWait: 10_000, timeout: 60_000 },
  );
}

// ---- filter options ------------------------------------------------------------------------

export const STAFF_OPTIONS_LIMIT = 20;

/**
 * Filter choices: the school's branches (Owner), the shifts of the branch in scope in effect at any
 * time in the range (named as in the latest of those versions), and up to 20 staff in scope matching
 * `staffQuery` (name or Staff ID), suspended staff included. Staff identity is limited to name,
 * Staff ID, job title, status and branch code (D1).
 */
export async function attendanceOptions(base, { from, to, branch, staffQuery }, { listBranches = false, today } = {}) {
  const prisma = getPrisma();
  const scope = await resolveScope(base, { branch }, prisma);

  const [branches, versions, staff] = await Promise.all([
    listBranches
      ? prisma.branch.findMany({ where: { schoolId: scope.schoolId }, orderBy: { number: 'asc' }, select: { id: true, code: true, name: true, status: true } })
      : null,
    scope.branchId
      ? prisma.branchSchedule.findMany({
          where: { branchId: scope.branchId, cancelledAt: null, effectiveFrom: { lte: asDbDate(to) } },
          orderBy: [{ effectiveFrom: 'asc' }, { recordedAt: 'asc' }],
          include: { shifts: true },
        })
      : [],
    prisma.user.findMany({
      where: {
        role: 'STAFF',
        ...inScope(scope),
        ...(staffQuery && { OR: [{ name: { contains: staffQuery, mode: 'insensitive' } }, { staffId: { contains: staffQuery, mode: 'insensitive' } }] }),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: STAFF_OPTIONS_LIMIT,
      select: { id: true, staffId: true, name: true, jobTitle: true, status: true, branch: { select: { code: true } } },
    }),
  ]);

  // A version applies from its date until the next one starts; keep those overlapping the range.
  const shifts = new Map();
  versions.forEach((v, i) => {
    const next = versions[i + 1];
    if (next && fromDbDate(next.effectiveFrom) <= from) return;
    for (const s of v.shifts) shifts.set(s.shiftKey, { key: s.shiftKey, name: s.name, start: toTime(s.startMinute), end: toTime(s.endMinute) });
  });

  return {
    today,
    branches: branches?.map((b) => ({ id: b.id, code: b.code, name: b.name, status: fromDbStatus(b.status) })) ?? null,
    shifts: [...shifts.values()].sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name)),
    staff: staff.map((s) => ({ id: s.id, staffId: s.staffId, name: s.name, jobTitle: s.jobTitle ?? '', status: fromDbStatus(s.status), branchCode: s.branch.code })),
  };
}
