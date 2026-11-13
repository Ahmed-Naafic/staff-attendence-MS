/*
 * Academic calendar tests (docs/business-rules.md → Academic calendar): weekly school days (school
 * default, branch override when the year allows it, versioned, never retroactive), school holidays,
 * branch closures and reopenings (days before today fixed, no overlaps even under simultaneous
 * requests), the one school-day rule (schoolDays.js), access and isolation between schools and
 * branches, suspension and closed years, audit, and the per-school Student Attendance switch.
 * Runs on the Neon dev branch (`npm test`); everything it creates is removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { calendarToday } from '../src/features/academic-calendar/calendar.service.js';
import { addDays, asDbDay, resolveDay, weekdayOf } from '../src/features/academic-calendar/schoolDays.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Academic calendar tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const cookies = {};
const schools = {};
const branches = {};
const years = {};
const ALL_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
let server;
let base;
let today;
let tomorrow;

async function call(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(method !== 'GET' && { origin: ORIGIN }),
      ...(cookie && { cookie }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const as = (who) => (path, options = {}) => call(path, { ...options, cookie: cookies[who] });
const ownerA = as('OWNER_A');
const ownerB = as('OWNER_B');
const managerA = as('MANAGER_A');
const managerA2 = as('MANAGER_A2');
const admin = as('SUPER_ADMIN');

const calendar = (who, yearId) => who(`/api/${who === ownerA || who === ownerB ? 'owner' : 'manager'}/academic-years/${yearId}/calendar`);
const setDays = (who, role, yearId, body) => who(`/api/${role}/academic-years/${yearId}/weekdays`, { method: 'PUT', body });
const addEntry = (who, role, yearId, body) => who(`/api/${role}/academic-years/${yearId}/calendar-entries`, { method: 'POST', body });
const patchEntry = (who, role, id, body) => who(`/api/${role}/calendar-entries/${id}`, { method: 'PATCH', body });
const cancel = (who, role, id) => who(`/api/${role}/calendar-entries/${id}/cancel`, { method: 'POST' });
const days = (who, role, query) => who(`/api/${role}/calendar/days?${new URLSearchParams(query)}`);
const calendarEvents = (action) => prisma.auditEvent.findMany({ where: { schoolId: schools.A.id, targetType: 'academic_calendar', ...(action && { action }) }, orderBy: { occurredAt: 'asc' } });

async function wipeCalendar(schoolId) {
  await prisma.calendarEntry.deleteMany({ where: { schoolId, holidayId: { not: null } } });
  await prisma.calendarEntry.deleteMany({ where: { schoolId } });
  await prisma.academicWeekdays.deleteMany({ where: { schoolId } });
}

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  today = await calendarToday();
  tomorrow = addDays(today, 1);

  for (const key of ['A', 'B']) {
    schools[key] = await prisma.school.create({
      data: { code: `TCAL${tag}-${key}`, name: `Calendar Test ${key} ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Test Road 1' },
    });
    branches[key] = await prisma.branch.create({
      data: { schoolId: schools[key].id, number: 1, code: `TCAL${tag}-${key}-B001`, name: `Main ${key}`, nameKey: `main ${lower}`, address: 'Test Road 1', city: 'Mogadishu' },
    });
  }
  branches.A2 = await prisma.branch.create({
    data: { schoolId: schools.A.id, number: 2, code: `TCAL${tag}-A-B002`, name: 'Second A', nameKey: `second ${lower}`, address: 'Test Road 2', city: 'Mogadishu' },
  });
  // A current year around today (school A), a planned later one, and school B's current year.
  years.A = await prisma.academicYear.create({
    data: { schoolId: schools.A.id, name: `Y1 ${tag}`, nameKey: `y1 ${lower}`, startDate: asDbDay(addDays(today, -60)), endDate: asDbDay(addDays(today, 240)), status: 'CURRENT', startedAt: new Date() },
  });
  years.A_NEXT = await prisma.academicYear.create({
    data: { schoolId: schools.A.id, name: `Y2 ${tag}`, nameKey: `y2 ${lower}`, startDate: asDbDay(addDays(today, 300)), endDate: asDbDay(addDays(today, 600)) },
  });
  years.B = await prisma.academicYear.create({
    data: { schoolId: schools.B.id, name: `Y1 ${tag}`, nameKey: `y1 ${lower}`, startDate: asDbDay(addDays(today, -60)), endDate: asDbDay(addDays(today, 240)), status: 'CURRENT', startedAt: new Date() },
  });

  const people = [
    ['SUPER_ADMIN', 'SUPER_ADMIN'],
    ['OWNER_A', 'OWNER', 'A'],
    ['OWNER_B', 'OWNER', 'B'],
    ['MANAGER_A', 'MANAGER', 'A'],
    ['MANAGER_A2', 'MANAGER', 'A2'],
    ['MANAGER_B', 'MANAGER', 'B'],
    ['STAFF', 'STAFF'],
  ];
  for (const [key, role, where] of people) {
    const password = randomBytes(12).toString('base64url');
    const email = `test-cal-${key.toLowerCase().replace('_', '-')}-${lower}@test.edutrack.example`;
    const scope = role === 'MANAGER' ? { branchId: branches[where].id } : await branchFor(role);
    const user = await prisma.user.create({ data: { name: `Test ${key} ${tag}`, email, role, ...scope, passwordHash: await hashPassword(password) } });
    if (role === 'OWNER') await prisma.school.update({ where: { id: schools[where].id }, data: { ownerId: user.id } });
    const res = await call('/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(res.status, 200, `${key} sign-in`);
    cookies[key] = res.cookie;
  }
});

after(async () => {
  const schoolIds = Object.values(schools).map((s) => s.id);
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  for (const id of schoolIds) await wipeCalendar(id);
  await prisma.auditEvent.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { actorId: { in: userIds } }] } });
  await prisma.academicYear.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await removeTestBranches();
  server.close();
  await prisma.$disconnect();
});

// ---- the school-day rule (pure) -----------------------------------------------------------------

describe('resolveDay: the one rule for "does this branch have school on this date"', () => {
  const year = (weekdays) => ({ id: 'y', name: 'Y', startDate: '2030-01-01', endDate: '2030-12-31', weekdays });
  const school = (days, effectiveFrom = '2030-01-01') => ({ days, followsSchool: false, effectiveFrom });
  const monday = '2030-01-07';
  const friday = '2030-01-11';

  test('weekly days decide; nothing set up → no_school_days; outside the year → no_academic_year', () => {
    const y = year({ schoolVersions: [school(['MON', 'TUE'])], branchVersions: [] });
    assert.equal(weekdayOf(monday), 'MON');
    assert.deepEqual([resolveDay(monday, { years: [y], entries: [] }).schoolDay, resolveDay(friday, { years: [y], entries: [] }).reason], [true, 'not_a_school_day']);
    assert.equal(resolveDay(monday, { years: [year({ schoolVersions: [], branchVersions: [] })], entries: [] }).reason, 'no_school_days');
    assert.equal(resolveDay('2031-01-06', { years: [y], entries: [] }).reason, 'no_academic_year');
  });

  test('versions apply from their date; a branch version wins until one follows the school again', () => {
    const y = year({
      schoolVersions: [school(['MON']), school(['FRI'], '2030-01-09')],
      branchVersions: [{ days: ['FRI'], followsSchool: false, effectiveFrom: '2030-01-01' }, { days: [], followsSchool: true, effectiveFrom: '2030-01-10' }],
    });
    assert.equal(resolveDay(monday, { years: [y], entries: [] }).weekdaySource, 'branch');
    assert.equal(resolveDay(monday, { years: [y], entries: [] }).schoolDay, false);
    assert.equal(resolveDay(friday, { years: [y], entries: [] }).weekdaySource, 'school');
    assert.equal(resolveDay(friday, { years: [y], entries: [] }).schoolDay, true);
  });

  test('closure beats everything; a holiday closes unless reopened; a reopening never adds a non-school weekday', () => {
    const y = year({ schoolVersions: [school(['MON', 'TUE', 'WED', 'THU'])], branchVersions: [] });
    const holiday = { id: 'h', type: 'HOLIDAY', name: 'Eid', startDate: '2030-01-07', endDate: '2030-01-11', holidayId: null };
    const reopening = { id: 'r', type: 'REOPENING', name: 'Open', startDate: '2030-01-08', endDate: '2030-01-11', holidayId: 'h' };
    const closure = { id: 'c', type: 'CLOSURE', name: 'Flood', startDate: '2030-01-09', endDate: '2030-01-09', holidayId: null };
    const entries = [holiday, reopening, closure];
    assert.equal(resolveDay('2030-01-07', { years: [y], entries }).reason, 'holiday');
    assert.equal(resolveDay('2030-01-08', { years: [y], entries }).schoolDay, true);
    assert.equal(resolveDay('2030-01-09', { years: [y], entries }).reason, 'closure');
    assert.equal(resolveDay(friday, { years: [y], entries }).reason, 'not_a_school_day');
  });
});

// ---- access and isolation -----------------------------------------------------------------------

describe('access: Owner and Manager only, each within their own school and branch', () => {
  test('signed out → 401; staff and Super Admins → 403; Managers → 403 on owner routes', async () => {
    const id = randomUUID();
    const ownerOnly = [
      ['GET', `/api/owner/academic-years/${id}/calendar`],
      ['PUT', `/api/owner/academic-years/${id}/weekday-policy`, { branchWeekdaysAllowed: true }],
      ['POST', `/api/owner/academic-years/${id}/calendar-entries`, {}],
      ['GET', '/api/owner/calendar/days'],
    ];
    const managerOnly = [
      ['GET', `/api/manager/academic-years/${id}/calendar`],
      ['PUT', `/api/manager/academic-years/${id}/weekdays`, {}],
      ['PATCH', `/api/manager/calendar-entries/${id}`, {}],
      ['GET', '/api/manager/calendar/days'],
    ];
    for (const [method, path, body] of [...ownerOnly, ...managerOnly]) {
      assert.equal((await call(path, { method, body })).status, 401, `${method} ${path}`);
      for (const who of ['STAFF', 'SUPER_ADMIN']) assert.equal((await as(who)(path, { method, body })).status, 403, `${who} ${method} ${path}`);
    }
    for (const [method, path, body] of ownerOnly) assert.equal((await managerA(path, { method, body })).status, 403, `manager ${method} ${path}`);
    for (const [method, path, body] of managerOnly) assert.equal((await ownerA(path, { method, body })).status, 403, `owner ${method} ${path}`);
  });

  test("another school's year, branch and entries are not found (404)", async () => {
    const holiday = (await addEntry(ownerA, 'owner', years.A.id, { type: 'holiday', name: 'Isolation check', startDate: addDays(today, 200), endDate: addDays(today, 200) })).body.entry;
    assert.equal((await calendar(ownerB, years.A.id)).status, 404);
    assert.equal((await as('MANAGER_B')(`/api/manager/academic-years/${years.A.id}/calendar`)).status, 404);
    assert.equal((await patchEntry(ownerB, 'owner', holiday.id, { name: 'Taken over' })).status, 404);
    assert.equal((await cancel(as('MANAGER_B'), 'manager', holiday.id)).status, 404);
    assert.equal((await days(ownerB, 'owner', { branch: branches.A.id })).status, 404);
    assert.equal((await addEntry(ownerB, 'owner', years.B.id, { type: 'closure', name: 'Not mine', branch: branches.A.id, startDate: tomorrow, endDate: tomorrow })).status, 404);
    // Managers see their branch's entries and school holidays, never another branch's.
    const closure = (await addEntry(managerA2, 'manager', years.A.id, { type: 'closure', name: 'A2 only', startDate: addDays(today, 201), endDate: addDays(today, 201) })).body.entry;
    const seen = (await calendar(managerA, years.A.id)).body.entries.map((e) => e.id);
    assert.ok(seen.includes(holiday.id));
    assert.ok(!seen.includes(closure.id));
    assert.equal((await patchEntry(managerA, 'manager', closure.id, { name: 'Not my branch' })).status, 404);
    await wipeCalendar(schools.A.id);
  });
});

// ---- weekly school days -------------------------------------------------------------------------

describe('weekly school days: school default, versioned, never retroactive', () => {
  test('validation and dates within the year', async () => {
    for (const [body, field] of [
      [{ days: [], effectiveFrom: today }, 'days'],
      [{ days: ['MON', 'XYZ'], effectiveFrom: today }, 'days'],
      [{ days: ['MON', 'MON'], effectiveFrom: today }, 'days'],
      [{ days: ['MON'], effectiveFrom: '2030-02-31' }, 'effectiveFrom'],
      [{ days: ['MON'], effectiveFrom: addDays(today, 400) }, 'effectiveFrom'],
    ]) {
      const res = await setDays(ownerA, 'owner', years.A.id, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.ok(res.body.details?.[field], field);
    }
    assert.equal((await setDays(ownerA, 'owner', years.A.id, { days: ['MON'], effectiveFrom: today, followsSchool: true })).status, 400, 'owners never follow');
    assert.equal((await setDays(ownerA, 'owner', years.A.id, { days: ['MON'], effectiveFrom: today, schoolId: schools.B.id })).status, 400);
  });

  test('the first days may start today; later changes start tomorrow at the earliest; same days → no change', async () => {
    const first = await setDays(ownerA, 'owner', years.A.id, { days: ['SAT', 'SUN', 'MON', 'TUE', 'WED'], effectiveFrom: today });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.weekdays.school.days, ['MON', 'TUE', 'WED', 'SAT', 'SUN']);
    assert.equal(first.body.weekdays.school.versions[0].state, 'current');

    const retro = await setDays(ownerA, 'owner', years.A.id, { days: ['MON'], effectiveFrom: today });
    assert.equal(retro.status, 400);
    assert.match(retro.body.details.effectiveFrom, new RegExp(tomorrow));

    const before = (await calendarEvents('ACADEMIC_WEEKDAYS_CHANGED')).length;
    assert.equal((await setDays(ownerA, 'owner', years.A.id, { days: ['WED', 'TUE', 'MON', 'SUN', 'SAT'], effectiveFrom: tomorrow })).status, 200);
    assert.equal((await calendarEvents('ACADEMIC_WEEKDAYS_CHANGED')).length, before, 'unchanged → nothing recorded');
  });

  test('a change for the same date replaces the scheduled one; scheduled changes can be cancelled, applied ones not', async () => {
    const change = addDays(today, 10);
    await setDays(ownerA, 'owner', years.A.id, { days: ['SAT', 'SUN'], effectiveFrom: change });
    const replaced = await setDays(ownerA, 'owner', years.A.id, { days: ['SAT', 'SUN', 'MON'], effectiveFrom: change });
    const versions = replaced.body.weekdays.school.versions;
    assert.deepEqual(versions.map((v) => v.state).sort(), ['cancelled', 'current', 'scheduled']);
    const scheduled = versions.find((v) => v.state === 'scheduled');
    const current = versions.find((v) => v.state === 'current');
    assert.deepEqual(scheduled.days, ['MON', 'SAT', 'SUN']);

    const inEffect = await ownerA(`/api/owner/academic-years/${years.A.id}/weekdays/${current.id}/cancel`, { method: 'POST' });
    assert.equal(inEffect.status, 409);
    assert.equal(inEffect.body.code, 'VERSION_IN_EFFECT');
    const cancelled = await ownerA(`/api/owner/academic-years/${years.A.id}/weekdays/${scheduled.id}/cancel`, { method: 'POST' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.weekdays.school.versions.filter((v) => v.state === 'scheduled').length, 0);
    // Rows are never deleted.
    assert.equal(await prisma.academicWeekdays.count({ where: { academicYearId: years.A.id } }), 3);
    const [event] = await calendarEvents('ACADEMIC_WEEKDAYS_CHANGE_CANCELLED');
    assert.equal(event.actorId !== null, true);
  });

  test('the database allows one active version per level and date', async () => {
    await assert.rejects(
      prisma.academicWeekdays.create({ data: { schoolId: schools.A.id, academicYearId: years.A.id, days: ['MON'], effectiveFrom: asDbDay(today) } }),
      /Unique constraint|AcademicWeekdays_one_school_version/,
    );
    await assert.rejects(
      prisma.academicWeekdays.create({ data: { schoolId: schools.A.id, academicYearId: years.A.id, days: [], effectiveFrom: asDbDay(addDays(today, 50)) } }),
      /check/i,
    );
  });
});

describe('branch school days: only while the Owner allows them; turning it off never reaches back', () => {
  test('a Manager needs permission; then sets their branch only, from tomorrow', async () => {
    const denied = await setDays(managerA, 'manager', years.A.id, { days: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'], effectiveFrom: tomorrow });
    assert.equal(denied.status, 409);
    assert.equal(denied.body.code, 'BRANCH_WEEKDAYS_NOT_ALLOWED');
    assert.equal((await setDays(managerA, 'manager', years.A.id, { days: ['MON'], effectiveFrom: tomorrow, branchId: branches.A2.id })).status, 400);

    const allow = await ownerA(`/api/owner/academic-years/${years.A.id}/weekday-policy`, { method: 'PUT', body: { branchWeekdaysAllowed: true } });
    assert.equal(allow.status, 200);
    assert.equal(allow.body.branchWeekdaysAllowed, true);
    // School days already apply to the branch today (the school's), so its own start tomorrow.
    assert.equal((await setDays(managerA, 'manager', years.A.id, { days: ['THU'], effectiveFrom: today })).status, 400);
    const own = await setDays(managerA, 'manager', years.A.id, { days: ALL_DAYS, effectiveFrom: tomorrow });
    assert.equal(own.status, 200);
    assert.equal(own.body.weekdays.branches.length, 1);

    const a = (await days(managerA, 'manager', { from: tomorrow, to: tomorrow })).body.days[0];
    const a2 = (await days(managerA2, 'manager', { from: tomorrow, to: tomorrow })).body.days[0];
    assert.equal(a.weekdaySource, 'branch');
    assert.equal(a.schoolDay, true);
    assert.equal(a2.weekdaySource, 'school');
  });

  test('turning permission off returns branches to the school days from tomorrow and cancels scheduled ones', async () => {
    await setDays(managerA, 'manager', years.A.id, { days: ['THU'], effectiveFrom: addDays(today, 20) });
    const off = await ownerA(`/api/owner/academic-years/${years.A.id}/weekday-policy`, { method: 'PUT', body: { branchWeekdaysAllowed: false } });
    assert.equal(off.status, 200);
    const branch = off.body.weekdays.branches.find((b) => b.branch.id === branches.A.id);
    const states = branch.versions.map((v) => `${v.followsSchool ? 'follow' : v.days.join('')}:${v.state}`);
    // The branch's own days (from tomorrow) were scheduled, so they are cancelled with the later one;
    // nothing was in effect today, so no "follow the school" version is needed.
    assert.ok(states.every((s) => s.endsWith(':cancelled')), states.join());
    const day = (await days(managerA, 'manager', { from: tomorrow, to: tomorrow })).body.days[0];
    assert.equal(day.weekdaySource, 'school');
    const [event] = await calendarEvents('BRANCH_WEEKDAYS_POLICY_CHANGED').then((e) => e.slice(-1));
    assert.deepEqual(event.change.fields[0], { field: 'Branches may set their own school days', from: 'Yes', to: 'No' });
  });

  test('a branch version already in effect today stays for today; the branch follows the school from tomorrow', async () => {
    // A branch version that took effect earlier (written directly: the API never back-dates).
    await prisma.academicYear.update({ where: { id: years.A.id }, data: { branchWeekdaysAllowed: true } });
    await prisma.academicWeekdays.create({ data: { schoolId: schools.A.id, academicYearId: years.A.id, branchId: branches.A2.id, days: ['THU'], effectiveFrom: asDbDay(addDays(today, -5)) } });
    await ownerA(`/api/owner/academic-years/${years.A.id}/weekday-policy`, { method: 'PUT', body: { branchWeekdaysAllowed: false } });
    const result = (await days(managerA2, 'manager', { from: today, to: tomorrow })).body.days;
    assert.deepEqual(result.map((d) => d.weekdaySource), ['branch', 'school']);
  });
});

// ---- calendar entries ---------------------------------------------------------------------------

describe('holidays, closures and reopenings', () => {
  const ids = {};

  test('school holidays: Owner only, within the year, from today, never overlapping', async () => {
    const res = await addEntry(ownerA, 'owner', years.A.id, { type: 'holiday', name: '  Eid   al-Fitr ', startDate: addDays(today, 30), endDate: addDays(today, 33), note: 'Four days' });
    assert.equal(res.status, 201);
    assert.equal(res.body.entry.name, 'Eid al-Fitr');
    assert.equal(res.body.entry.days, 4);
    assert.equal(res.body.entry.branch, null);
    ids.holiday = res.body.entry.id;

    for (const [body, field] of [
      [{ type: 'holiday', name: 'Past', startDate: addDays(today, -1), endDate: today }, 'startDate'],
      [{ type: 'holiday', name: 'Outside', startDate: addDays(today, 239), endDate: addDays(today, 250) }, 'endDate'],
      [{ type: 'holiday', name: 'Reversed', startDate: addDays(today, 40), endDate: addDays(today, 39) }, 'endDate'],
      [{ type: 'holiday', name: 'X', startDate: addDays(today, 40), endDate: addDays(today, 40) }, 'name'],
      [{ type: 'holiday', name: 'Branch', branch: branches.A.id, startDate: addDays(today, 40), endDate: addDays(today, 40) }, 'branch'],
      [{ type: 'other', name: 'Kind', startDate: addDays(today, 40), endDate: addDays(today, 40) }, 'type'],
    ]) {
      const bad = await addEntry(ownerA, 'owner', years.A.id, body);
      assert.equal(bad.status, 400, JSON.stringify(body));
      assert.ok(bad.body.details?.[field], `${field}: ${JSON.stringify(bad.body)}`);
    }
    const overlap = await addEntry(ownerA, 'owner', years.A.id, { type: 'holiday', name: 'Overlapping', startDate: addDays(today, 33), endDate: addDays(today, 35) });
    assert.equal(overlap.status, 409);
    assert.equal(overlap.body.code, 'DATES_OVERLAP');
    assert.match(overlap.body.error, /Eid al-Fitr/);

    const managerHoliday = await addEntry(managerA, 'manager', years.A.id, { type: 'holiday', name: 'Mine', startDate: addDays(today, 50), endDate: addDays(today, 50) });
    assert.equal(managerHoliday.status, 400);
    assert.equal((await patchEntry(managerA, 'manager', ids.holiday, { name: 'Renamed' })).status, 403);
    assert.equal((await cancel(managerA, 'manager', ids.holiday)).status, 403);
  });

  test('simultaneous overlapping holidays: exactly one is saved (database backstop)', async () => {
    const body = (n) => ({ type: 'holiday', name: `Race ${n}`, startDate: addDays(today, 60), endDate: addDays(today, 61) });
    const results = await Promise.all([1, 2, 3].map((n) => addEntry(ownerA, 'owner', years.A.id, body(n))));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
    assert.ok(results.filter((r) => r.status === 409).every((r) => r.body.code === 'DATES_OVERLAP'));
  });

  test('closures: a Manager closes their own branch; the Owner any branch; branches never clash', async () => {
    const own = await addEntry(managerA, 'manager', years.A.id, { type: 'closure', name: 'Road flooding', startDate: today, endDate: tomorrow });
    assert.equal(own.status, 201, 'today is allowed');
    assert.equal(own.body.entry.branch.id, branches.A.id);
    ids.closure = own.body.entry.id;
    assert.equal((await addEntry(managerA, 'manager', years.A.id, { type: 'closure', name: 'Other', branch: branches.A2.id, startDate: tomorrow, endDate: tomorrow })).status, 400);
    const other = await addEntry(ownerA, 'owner', years.A.id, { type: 'closure', name: 'Repairs', branch: branches.A2.id, startDate: today, endDate: tomorrow });
    assert.equal(other.status, 201, 'another branch may close the same days');
    assert.equal((await addEntry(ownerA, 'owner', years.A.id, { type: 'closure', name: 'Missing branch', startDate: tomorrow, endDate: tomorrow })).status, 400);
    const clash = await addEntry(ownerA, 'owner', years.A.id, { type: 'closure', name: 'Clash', branch: branches.A.id, startDate: tomorrow, endDate: addDays(today, 3) });
    assert.equal(clash.status, 409);

    const [d] = (await days(managerA, 'manager', { from: today, to: today })).body.days;
    assert.equal(d.reason, 'closure');
    assert.equal(d.closure.name, 'Road flooding');
  });

  test('reopenings: only when the holiday allows it, within the holiday, for the Manager\'s branch', async () => {
    const body = { type: 'reopening', holiday: ids.holiday, startDate: addDays(today, 31), endDate: addDays(today, 32) };
    const denied = await addEntry(managerA, 'manager', years.A.id, body);
    assert.equal(denied.status, 409);
    assert.equal(denied.body.code, 'REOPENING_NOT_ALLOWED');

    assert.equal((await patchEntry(ownerA, 'owner', ids.holiday, { allowBranchReopening: true })).status, 200);
    const outside = await addEntry(managerA, 'manager', years.A.id, { ...body, endDate: addDays(today, 34) });
    assert.equal(outside.status, 400);
    const ok = await addEntry(managerA, 'manager', years.A.id, body);
    assert.equal(ok.status, 201);
    assert.equal(ok.body.entry.name, 'School open during Eid al-Fitr');
    assert.equal(ok.body.entry.holiday.id, ids.holiday);
    ids.reopening = ok.body.entry.id;

    const result = (await days(managerA, 'manager', { from: addDays(today, 30), to: addDays(today, 33) })).body.days;
    // Branch A follows the school's days (Sat–Wed). The holiday closes days 30 and 33; the
    // reopening opens 31–32 where they are school weekdays.
    const schoolWeekdays = ['SAT', 'SUN', 'MON', 'TUE', 'WED'];
    assert.equal(result[0].reason, 'holiday');
    for (const d of result.slice(1, 3)) {
      assert.equal(d.reopening?.id, ids.reopening);
      assert.equal(d.schoolDay, schoolWeekdays.includes(d.weekday));
    }
    assert.equal(result[3].reason, 'holiday');
    const a2 = (await days(managerA2, 'manager', { from: addDays(today, 31), to: addDays(today, 31) })).body.days[0];
    assert.equal(a2.reason, 'holiday', 'other branches stay closed');
  });

  test('a holiday that stops allowing reopenings takes its future reopenings with it (audited)', async () => {
    assert.equal((await patchEntry(ownerA, 'owner', ids.holiday, { allowBranchReopening: false })).status, 200);
    const reopening = await prisma.calendarEntry.findUnique({ where: { id: ids.reopening } });
    assert.ok(reopening.cancelledAt, 'cancelled, not deleted');
    const events = await calendarEvents('CALENDAR_ENTRY_CANCELLED');
    assert.ok(events.some((e) => e.targetId === ids.reopening && /because the holiday changed/.test(e.description)));
  });

  test('past days are fixed: running entries only end early or change later days; finished ones are kept', async () => {
    const running = await prisma.calendarEntry.create({
      data: { schoolId: schools.A.id, academicYearId: years.A.id, type: 'HOLIDAY', name: 'Running', startDate: asDbDay(addDays(today, -3)), endDate: asDbDay(addDays(today, 3)) },
    });
    const finished = await prisma.calendarEntry.create({
      data: { schoolId: schools.A.id, academicYearId: years.A.id, type: 'HOLIDAY', name: 'Finished', startDate: asDbDay(addDays(today, -10)), endDate: asDbDay(addDays(today, -8)) },
    });
    assert.equal((await patchEntry(ownerA, 'owner', running.id, { startDate: addDays(today, -2) })).status, 400);
    assert.equal((await patchEntry(ownerA, 'owner', running.id, { endDate: addDays(today, -2) })).status, 400, 'would change yesterday');
    assert.equal((await patchEntry(ownerA, 'owner', running.id, { endDate: addDays(today, 5) })).status, 200, 'later days can change');
    assert.equal((await patchEntry(ownerA, 'owner', finished.id, { name: 'Finished holiday' })).status, 200, 'names can always be fixed');
    assert.equal((await patchEntry(ownerA, 'owner', finished.id, { endDate: addDays(today, -7) })).status, 400);

    const ended = await cancel(ownerA, 'owner', running.id);
    assert.equal(ended.status, 200);
    assert.equal(ended.body.entry.status, 'active');
    assert.equal(ended.body.entry.endDate, addDays(today, -1));
    const kept = await cancel(ownerA, 'owner', finished.id);
    assert.equal(kept.status, 409);
    assert.equal(kept.body.code, 'ENTRY_IN_PAST');

    const later = await cancel(managerA, 'manager', ids.closure);
    assert.equal(later.status, 200, 'today counts as changeable');
    assert.equal(later.body.entry.status, 'cancelled');
    assert.equal((await patchEntry(managerA, 'manager', ids.closure, { name: 'After cancel' })).status, 409);
  });

  test('every change is audited in the school, with old and new values', async () => {
    const events = await calendarEvents();
    const actions = new Set(events.map((e) => e.action));
    for (const action of ['CALENDAR_ENTRY_CREATED', 'CALENDAR_ENTRY_UPDATED', 'CALENDAR_ENTRY_CANCELLED', 'ACADEMIC_WEEKDAYS_CHANGED', 'BRANCH_WEEKDAYS_POLICY_CHANGED']) {
      assert.ok(actions.has(action), action);
    }
    const update = events.find((e) => e.action === 'CALENDAR_ENTRY_UPDATED' && e.targetId === ids.holiday);
    assert.deepEqual(update.change.fields, [{ field: 'Branches may reopen', from: 'No', to: 'Yes' }]);
    assert.ok(events.every((e) => e.schoolId === schools.A.id && e.result === 'SUCCESS'));
    // School activity is not part of the Super Admin dashboard's recent platform activity.
    const dashboard = await admin('/api/platform/dashboard');
    assert.equal(dashboard.status, 200);
    assert.ok(!JSON.stringify(dashboard.body).includes('CALENDAR_ENTRY_'));
  });
});

// ---- year status, suspension, deletion ---------------------------------------------------------

describe('closed years, suspensions and year deletion', () => {
  test("a closed year's calendar is read only (409 YEAR_CLOSED)", async () => {
    const closed = await prisma.academicYear.create({
      data: { schoolId: schools.B.id, name: `Old ${tag}`, nameKey: `old ${lower}`, startDate: asDbDay('2020-01-01'), endDate: asDbDay('2020-12-31'), status: 'CLOSED', closedAt: new Date() },
    });
    const res = await addEntry(ownerB, 'owner', closed.id, { type: 'holiday', name: 'Too late', startDate: '2020-05-01', endDate: '2020-05-01' });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'YEAR_CLOSED');
    assert.equal((await setDays(ownerB, 'owner', closed.id, { days: ['MON'], effectiveFrom: '2020-06-01' })).body.code, 'YEAR_CLOSED');
    assert.equal((await calendar(ownerB, closed.id)).status, 200, 'still readable');
  });

  test('a suspended school or branch can read but not change its calendar', async () => {
    await prisma.branch.update({ where: { id: branches.A2.id }, data: { status: 'SUSPENDED' } });
    try {
      const res = await addEntry(managerA2, 'manager', years.A.id, { type: 'closure', name: 'Suspended', startDate: tomorrow, endDate: tomorrow });
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'BRANCH_NOT_OPERATING');
      assert.equal((await calendar(managerA2, years.A.id)).status, 200);
      // The Owner manages the school's calendar while one branch is suspended.
      assert.equal((await addEntry(ownerA, 'owner', years.A.id, { type: 'closure', name: 'By owner', branch: branches.A2.id, startDate: addDays(today, 90), endDate: addDays(today, 90) })).status, 201);
    } finally {
      await prisma.branch.update({ where: { id: branches.A2.id }, data: { status: 'ACTIVE' } });
    }
    await prisma.school.update({ where: { id: schools.A.id }, data: { status: 'SUSPENDED' } });
    try {
      const res = await addEntry(ownerA, 'owner', years.A.id, { type: 'holiday', name: 'Suspended', startDate: addDays(today, 100), endDate: addDays(today, 100) });
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'SCHOOL_SUSPENDED');
      assert.equal((await addEntry(managerA, 'manager', years.A.id, { type: 'closure', name: 'Suspended', startDate: addDays(today, 100), endDate: addDays(today, 100) })).body.code, 'BRANCH_NOT_OPERATING');
      assert.equal((await calendar(ownerA, years.A.id)).status, 200);
    } finally {
      await prisma.school.update({ where: { id: schools.A.id }, data: { status: 'ACTIVE' } });
    }
  });

  test('a planned year with a calendar cannot be deleted (409 YEAR_IN_USE)', async () => {
    const res = await addEntry(ownerA, 'owner', years.A_NEXT.id, { type: 'holiday', name: 'Next year', startDate: addDays(today, 310), endDate: addDays(today, 311) });
    assert.equal(res.status, 201);
    const del = await ownerA(`/api/owner/academic-years/${years.A_NEXT.id}`, { method: 'DELETE' });
    assert.equal(del.status, 409);
    assert.equal(del.body.code, 'YEAR_IN_USE');
  });
});

describe('school days query', () => {
  test('the Owner chooses a branch of the school; at most 366 days; Managers cannot name a branch', async () => {
    assert.equal((await days(ownerA, 'owner', {})).status, 400);
    assert.equal((await days(ownerA, 'owner', { branch: branches.B.id })).status, 404);
    assert.equal((await days(ownerA, 'owner', { branch: branches.A.id, from: today, to: addDays(today, 366) })).status, 400);
    assert.equal((await days(managerA, 'manager', { branch: branches.A2.id })).status, 400);
    const res = await days(ownerA, 'owner', { branch: branches.A2.id, from: today, to: addDays(today, 6) });
    assert.equal(res.status, 200);
    assert.equal(res.body.days.length, 7);
    assert.equal(res.body.branch.id, branches.A2.id);
    assert.equal(res.body.days[0].academicYear.id, years.A.id);
  });
});

// ---- per-school Student Attendance switch -------------------------------------------------------

describe('Student Attendance switch (Super Admin, per school)', () => {
  test('off by default; Super Admin turns it on and off; audited; others cannot', async () => {
    const path = `/api/platform/schools/${schools.B.id}/features`;
    const initial = await admin(`/api/platform/schools/${schools.B.id}`);
    assert.equal(initial.body.school.features.studentAttendance, false);
    assert.equal((await ownerB(path, { method: 'PUT', body: { studentAttendance: true } })).status, 403);
    assert.equal((await admin(path, { method: 'PUT', body: { studentAttendance: 'yes' } })).status, 400);
    assert.equal((await admin(path, { method: 'PUT', body: { studentAttendance: true, other: 1 } })).status, 400);
    assert.equal((await admin(`/api/platform/schools/${randomUUID()}/features`, { method: 'PUT', body: { studentAttendance: true } })).status, 404);

    const on = await admin(path, { method: 'PUT', body: { studentAttendance: true } });
    assert.equal(on.status, 200);
    assert.equal(on.body.school.features.studentAttendance, true);
    assert.equal((await admin(path, { method: 'PUT', body: { studentAttendance: true } })).status, 200);
    const events = await prisma.auditEvent.findMany({ where: { schoolId: schools.B.id, action: 'SCHOOL_FEATURES_UPDATED' } });
    assert.equal(events.length, 1, 'unchanged → nothing recorded');
    assert.deepEqual(events[0].change, { field: 'Student Attendance', from: 'Off', to: 'On' });
  });
});
