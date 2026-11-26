/*
 * Examinations, phase 0–1 (docs/business-rules.md → Examinations): the per-school switch (Super
 * Admin, audited), academic periods, examination types, grading scales, the result formula, layered
 * settings and examination rooms (no location). The School Owner configures; Managers read the
 * configuration and manage their own branch's rooms and the settings the school lets branches set.
 * Isolation between schools and branches; audit; nothing deleted.
 * Runs on the Neon dev branch (`npm test`); everything it creates is removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { calendarToday } from '../src/features/academic-calendar/calendar.service.js';
import { addDays, asDbDay } from '../src/features/academic-calendar/schoolDays.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { checkBands, gradeOf } from '../src/features/examinations/examInput.js';
import { resolveExamSettings } from '../src/features/examinations/examSettings.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Examination tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const cookies = {};
const schools = {};
const branches = {};
let year;
let server;
let base;
let today;

async function call(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(method !== 'GET' && { origin: ORIGIN }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const as = (who) => (path, options = {}) => call(path, { ...options, cookie: cookies[who] });
const owner = as('OWNER_A');
const ownerB = as('OWNER_B');
const manager1 = as('MANAGER_A1');
const manager2 = as('MANAGER_A2');
const admin = as('SUPER_ADMIN');
const O = '/api/owner/exams';
const M = '/api/manager/exams';
const SCALE = [
  { label: 'A', minPercent: 80, maxPercent: 100, passes: true, points: 4 },
  { label: 'B', minPercent: 70, maxPercent: 79, passes: true, points: 3 },
  { label: 'C', minPercent: 50, maxPercent: 69, passes: true, points: 2 },
  { label: 'F', minPercent: 0, maxPercent: 49, passes: false, points: 0 },
];

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  today = await calendarToday();
  for (const key of ['A', 'B']) {
    schools[key] = await prisma.school.create({ data: { code: `TEXM${tag}-${key}`, name: `Exam Test ${key} ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Road 1' } });
  }
  const branch = (key, school, number) =>
    prisma.branch.create({ data: { schoolId: schools[school].id, number, code: `TEXM${tag}-${key}`, name: `Branch ${key}`, nameKey: `branch ${key.toLowerCase()} ${lower}`, address: 'Road', city: 'Mogadishu' } });
  branches.A1 = await branch('A1', 'A', 1);
  branches.A2 = await branch('A2', 'A', 2);
  branches.B = await branch('B1', 'B', 1);
  year = await prisma.academicYear.create({
    data: { schoolId: schools.A.id, name: `Y ${tag}`, nameKey: `y ${lower}`, startDate: asDbDay(addDays(today, -30)), endDate: asDbDay(addDays(today, 300)), status: 'CURRENT', startedAt: new Date() },
  });
  for (const [key, role, where] of [['OWNER_A', 'OWNER', 'A'], ['OWNER_B', 'OWNER', 'B'], ['MANAGER_A1', 'MANAGER', 'A1'], ['MANAGER_A2', 'MANAGER', 'A2'], ['SUPER_ADMIN', 'SUPER_ADMIN'], ['STAFF', 'STAFF']]) {
    const password = randomBytes(12).toString('base64url');
    const email = `test-exam-${key.toLowerCase().replace('_', '-')}-${lower}@test.edutrack.example`;
    const scope = role === 'MANAGER' ? { branchId: branches[where].id } : await branchFor(role);
    const user = await prisma.user.create({ data: { name: `Test ${key} ${tag}`, email, role, ...scope, passwordHash: await hashPassword(password) } });
    if (role === 'OWNER') await prisma.school.update({ where: { id: schools[where].id }, data: { ownerId: user.id } });
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200, `${key} sign-in`);
    cookies[key] = login.headers.get('set-cookie')?.split(';')[0];
  }
});

after(async () => {
  const schoolIds = Object.values(schools).map((s) => s.id);
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  await prisma.examRoom.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.examSettings.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.resultFormula.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.examType.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.gradeBand.deleteMany({ where: { scale: { schoolId: { in: schoolIds } } } });
  await prisma.gradingScale.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.academicPeriod.deleteMany({ where: { schoolId: { in: schoolIds } } });
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

describe('rules (pure)', () => {
  test('grading bands cover 0–100 once; grades by the highest band reached', () => {
    assert.ok(checkBands(SCALE).bands);
    assert.match(checkBands([{ label: 'A', minPercent: 50, maxPercent: 100, passes: true }, { label: 'F', minPercent: 0, maxPercent: 45, passes: false }]).error, /without gaps/);
    assert.match(checkBands([{ label: 'A', minPercent: 50, maxPercent: 100, passes: true }, { label: 'F', minPercent: 0, maxPercent: 60, passes: false }]).error, /without gaps/);
    assert.ok(checkBands([{ label: 'A', minPercent: 60, maxPercent: 90, passes: true }, { label: 'F', minPercent: 0, maxPercent: 59, passes: false }]).error, 'the top must reach 100');
    assert.match(checkBands([{ label: 'A', minPercent: 50, maxPercent: 100, passes: false }, { label: 'F', minPercent: 0, maxPercent: 49, passes: true }]).error, /below the passing/);
    assert.ok(checkBands([{ label: 'A', minPercent: 50, maxPercent: 100, passes: true }, { label: 'a', minPercent: 0, maxPercent: 49, passes: false }]).error, 'labels once');
    assert.ok(checkBands([{ label: 'A', minPercent: 79.5, maxPercent: 100, passes: true }, { label: 'F', minPercent: 0, maxPercent: 79.49, passes: false }]).bands, 'decimals');
    assert.equal(gradeOf(SCALE, 79.6).label, 'B');
    assert.equal(gradeOf(SCALE, 80).label, 'A');
    assert.equal(gradeOf(SCALE, 0).label, 'F');
  });

  test('settings: platform defaults, then the school, then a branch only for what the school allows', () => {
    const school = { values: { passPercent: 40, studentsPerInvigilator: 25 }, branchOverridable: ['studentsPerInvigilator'] };
    const branch = { values: { studentsPerInvigilator: 20, passPercent: 10 } };
    const { values, sources } = resolveExamSettings(school, branch);
    assert.equal(values.passPercent, 40, 'not overridable: the school decides');
    assert.equal(sources.studentsPerInvigilator, 'branch');
    assert.equal(values.studentsPerInvigilator, 20);
    assert.equal(values.maxMarksLimit, 100);
    assert.equal(sources.maxMarksLimit, 'platform');
    assert.equal(resolveExamSettings({ values: { passPercent: 'x' } }, null).values.passPercent, 50, 'invalid stored values are ignored');
  });
});

describe('the switch', () => {
  test('off by default: everything but the overview is refused; the Super Admin turns it on (audited)', async () => {
    const overview = await owner(`${O}/overview`);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.featureEnabled, false);
    assert.equal((await owner(`${O}/types`)).body.code, 'FEATURE_DISABLED');
    assert.equal((await manager1(`${M}/rooms`)).status, 403);
    const on = await admin(`/api/platform/schools/${schools.A.id}/features`, { method: 'PUT', body: { examinations: true } });
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.deepEqual(on.body.school.features, { studentAttendance: false, examinations: true, fees: false });
    const event = await prisma.auditEvent.findFirst({ where: { action: 'SCHOOL_FEATURES_UPDATED', targetId: schools.A.id }, orderBy: { occurredAt: 'desc' } });
    assert.match(event.description, /Examinations turned on/);
    assert.equal((await owner(`${O}/overview`)).body.featureEnabled, true);
    assert.equal((await ownerB(`/api/owner/exams/types`)).status, 403, 'school B is still off');
    assert.equal((await admin(`/api/platform/schools/${schools.A.id}/features`, { method: 'PUT', body: { examinations: 'yes' } })).status, 400);
  });
});

describe('configuration (School Owner; Managers read)', () => {
  test('academic periods: inside the year, no overlaps, numbered by date, deactivated not deleted', async () => {
    const add = (name, s, e) => owner(`${O}/periods`, { method: 'POST', body: { academicYear: year.id, name, startDate: addDays(today, s), endDate: addDays(today, e) } });
    const t2 = await add('Term 2', 100, 190);
    assert.equal(t2.status, 201, JSON.stringify(t2.body));
    const t1 = await add('Term 1', -20, 90);
    assert.equal(t1.status, 201);
    assert.equal((await add('term 1', 200, 250)).body.code, 'NAME_TAKEN', 'names regardless of capitalization');
    assert.equal((await add('Overlap', 80, 120)).body.code, 'PERIOD_OVERLAP');
    assert.equal((await add('Outside', 290, 400)).status, 400, 'inside the year');
    const list = await manager1(`${M}/periods`);
    assert.deepEqual(list.body.items.map((p) => [p.name, p.sequence]), [['Term 1', 1], ['Term 2', 2]]);
    assert.equal((await manager1(`${M}/periods`, { method: 'POST', body: { academicYear: year.id, name: 'X', startDate: addDays(today, 260), endDate: addDays(today, 270) } })).status, 403, 'Managers read only');
    const off = await owner(`${O}/periods/${t1.body.period.id}/deactivate`, { method: 'POST' });
    assert.equal(off.body.period.status, 'inactive');
    assert.deepEqual((await owner(`${O}/periods`)).body.items.map((p) => p.name), ['Term 2']);
    assert.equal((await owner(`${O}/periods/${t1.body.period.id}/reactivate`, { method: 'POST' })).body.period.sequence, 1);
  });

  test('grading scales: the first is the default; bands checked; default cannot be deactivated', async () => {
    const bad = await owner(`${O}/grading-scales`, { method: 'POST', body: { name: 'Broken', bands: [{ label: 'A', minPercent: 60, maxPercent: 100, passes: true }, { label: 'F', minPercent: 0, maxPercent: 50, passes: false }] } });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.details.bands);
    const first = await owner(`${O}/grading-scales`, { method: 'POST', body: { name: 'Letter (A–F)', bands: SCALE } });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.scale.isDefault, true);
    assert.deepEqual(first.body.scale.bands.map((b) => b.label), ['A', 'B', 'C', 'F']);
    const second = await owner(`${O}/grading-scales`, { method: 'POST', body: { name: 'Pass/Fail', isDefault: true, bands: [{ label: 'P', minPercent: 50, maxPercent: 100, passes: true }, { label: 'F', minPercent: 0, maxPercent: 49, passes: false }] } });
    assert.equal(second.body.scale.isDefault, true);
    const scales = (await manager1(`${M}/grading-scales`)).body.items;
    assert.deepEqual(scales.filter((s) => s.isDefault).map((s) => s.name), ['Pass/Fail'], 'one default');
    assert.equal((await owner(`${O}/grading-scales/${second.body.scale.id}/deactivate`, { method: 'POST' })).body.code, 'DEFAULT_REQUIRED');
    const edited = await owner(`${O}/grading-scales/${first.body.scale.id}`, { method: 'PATCH', body: { isDefault: true, bands: SCALE.map((b) => (b.label === 'C' ? { ...b, minPercent: 55 } : b.label === 'F' ? { ...b, maxPercent: 54 } : b)) } });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.scale.bands.find((b) => b.label === 'C').minPercent, 55);
    assert.equal((await manager1(`${M}/grading-scales`, { method: 'POST', body: { name: 'Mine', bands: SCALE } })).status, 403);
  });

  test('examination types: with or without their own scale; stop lessons by default', async () => {
    const scale = (await owner(`${O}/grading-scales`)).body.items.find((s) => s.name === 'Letter (A–F)');
    const mid = await owner(`${O}/types`, { method: 'POST', body: { name: 'Mid-Term', defaultMaxMarks: 100, gradingScale: scale.id } });
    assert.equal(mid.status, 201, JSON.stringify(mid.body));
    assert.equal(mid.body.type.stopsLessons, true);
    assert.equal(mid.body.type.gradingScale.name, 'Letter (A–F)');
    const unit = await owner(`${O}/types`, { method: 'POST', body: { name: 'Unit Test', defaultMaxMarks: 20, stopsLessons: false } });
    assert.equal(unit.body.type.gradingScale, null);
    assert.equal((await owner(`${O}/types`, { method: 'POST', body: { name: 'mid-term', defaultMaxMarks: 100 } })).body.code, 'NAME_TAKEN');
    assert.equal((await owner(`${O}/types`, { method: 'POST', body: { name: 'Big', defaultMaxMarks: 5000 } })).status, 400);
    assert.equal((await owner(`${O}/grading-scales/${scale.id}/deactivate`, { method: 'POST' })).body.code, 'DEFAULT_REQUIRED', 'the default scale stays active');
    const passFail = (await owner(`${O}/grading-scales`)).body.items.find((s) => s.name === 'Pass/Fail');
    const ch = await owner(`${O}/types/${unit.body.type.id}`, { method: 'PATCH', body: { defaultMaxMarks: 25, gradingScale: passFail.id } });
    assert.equal(ch.body.type.defaultMaxMarks, 25);
    assert.equal(ch.body.type.gradingScale.name, 'Pass/Fail');
    assert.equal((await owner(`${O}/grading-scales/${passFail.id}/deactivate`, { method: 'POST' })).body.code, 'SCALE_IN_USE', 'used by an active type');
    assert.equal((await owner(`${O}/types/${unit.body.type.id}`, { method: 'PATCH', body: { gradingScale: null } })).body.type.gradingScale, null);
    assert.equal((await manager1(`${M}/types`)).body.items.length, 2);
    assert.equal((await manager1(`${M}/types/${unit.body.type.id}`, { method: 'PATCH', body: { defaultMaxMarks: 30 } })).status, 403);
  });

  test('result formula: weights add up to 100 and name active types and periods of the year', async () => {
    const types = (await owner(`${O}/types`)).body.items;
    const periods = (await owner(`${O}/periods`)).body.items;
    assert.equal((await owner(`${O}/formula`, { method: 'PUT', body: { method: 'WEIGHTED', typeWeights: [{ examTypeId: types[0].id, weight: 30 }] } })).status, 400, 'not 100');
    assert.equal((await owner(`${O}/formula`, { method: 'PUT', body: { method: 'WEIGHTED', typeWeights: [{ examTypeId: randomUUID(), weight: 100 }] } })).status, 400, 'unknown type');
    const ok = await owner(`${O}/formula`, {
      method: 'PUT',
      body: { method: 'WEIGHTED', typeWeights: [{ examTypeId: types[0].id, weight: 40 }, { examTypeId: types[1].id, weight: 60 }], periodWeights: periods.map((p, i) => ({ periodId: p.id, weight: i ? 60 : 40 })) },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.formula.method, 'WEIGHTED');
    assert.equal((await manager1(`${M}/formula`)).body.formula.typeWeights.length, 2);
    const events = await prisma.auditEvent.count({ where: { action: 'RESULT_FORMULA_CHANGED', schoolId: schools.A.id } });
    await owner(`${O}/formula`, { method: 'PUT', body: ok.body.formula && { method: 'WEIGHTED', typeWeights: ok.body.formula.typeWeights, periodWeights: ok.body.formula.periodWeights } });
    assert.equal(await prisma.auditEvent.count({ where: { action: 'RESULT_FORMULA_CHANGED', schoolId: schools.A.id } }), events, 'the same formula records nothing');
  });
});

describe('rooms (no location)', () => {
  test('a Manager manages their branch’s rooms; the Owner any branch’s; names per branch; deactivated not deleted', async () => {
    const r1 = await manager1(`${M}/rooms`, { method: 'POST', body: { name: 'R1', defaultCapacity: 40 } });
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    assert.deepEqual(Object.keys(r1.body.room).sort(), ['branch', 'defaultCapacity', 'id', 'name', 'status'], 'no location');
    assert.equal((await manager1(`${M}/rooms`, { method: 'POST', body: { name: 'r1', defaultCapacity: 30 } })).body.code, 'NAME_TAKEN');
    assert.equal((await manager1(`${M}/rooms`, { method: 'POST', body: { name: 'R9', defaultCapacity: 30, location: 'Block A' } })).status, 400, 'location is refused');
    assert.equal((await manager1(`${M}/rooms`, { method: 'POST', body: { name: 'R2', defaultCapacity: 0 } })).status, 400);
    assert.equal((await manager2(`${M}/rooms`, { method: 'POST', body: { name: 'R1', defaultCapacity: 30 } })).status, 201, 'the same name in another branch');
    const byOwner = await owner(`${O}/rooms`, { method: 'POST', body: { name: 'Hall', defaultCapacity: 120, branch: branches.A1.id } });
    assert.equal(byOwner.status, 201);
    assert.equal((await owner(`${O}/rooms`, { method: 'POST', body: { name: 'Hall', defaultCapacity: 120 } })).status, 400, 'the Owner names the branch');
    assert.deepEqual((await manager1(`${M}/rooms`)).body.totals, { rooms: 2, seats: 160 });
    assert.equal((await manager2(`${M}/rooms/${r1.body.room.id}`, { method: 'PATCH', body: { defaultCapacity: 10 } })).status, 404, 'another branch’s room');
    const off = await manager1(`${M}/rooms/${r1.body.room.id}/deactivate`, { method: 'POST' });
    assert.equal(off.body.room.status, 'inactive');
    assert.equal((await manager1(`${M}/rooms`)).body.items.length, 1);
    assert.equal((await manager1(`${M}/rooms?status=all`)).body.items.length, 2);
    assert.equal((await owner(`${O}/rooms?branch=${branches.A2.id}`)).body.items.length, 1);
    assert.equal((await ownerB(`/api/owner/exams/rooms`)).status, 403, 'another school (switched off)');
    const audit = await prisma.auditEvent.count({ where: { schoolId: schools.A.id, action: { in: ['EXAM_ROOM_CREATED', 'EXAM_ROOM_DEACTIVATED'] } } });
    assert.equal(audit, 4);
  });
});

describe('settings (layered)', () => {
  test('the Owner sets school values and what branches may set; a Manager only those; changes audited once', async () => {
    const s = await owner(`${O}/settings`);
    assert.equal(s.status, 200);
    assert.equal(s.body.school.effective.passPercent, 50);
    assert.equal((await manager1(`${M}/settings`, { method: 'PUT', body: { values: { studentsPerInvigilator: 20 } } })).body.code, 'SETTING_LOCKED');
    const set = await owner(`${O}/settings`, { method: 'PUT', body: { values: { passPercent: 40, analyticsLevel: 'advanced' }, branchOverridable: ['studentsPerInvigilator', 'distributionMethod'] } });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body.school.effective.passPercent, 40);
    assert.equal((await owner(`${O}/settings`, { method: 'PUT', body: { values: { passPercent: 400 } } })).status, 400);
    assert.equal((await manager1(`${M}/settings`, { method: 'PUT', body: { values: { studentsPerInvigilator: 20 } } })).status, 200);
    const m = await manager1(`${M}/settings`);
    assert.equal(m.body.branch.effective.studentsPerInvigilator, 20);
    assert.equal(m.body.branch.sources.studentsPerInvigilator, 'branch');
    assert.equal(m.body.branch.effective.passPercent, 40, 'from the school');
    assert.equal((await manager1(`${M}/settings`, { method: 'PUT', body: { values: { passPercent: 30 } } })).body.code, 'SETTING_LOCKED');
    // Taking the permission back clears the branch value.
    await owner(`${O}/settings`, { method: 'PUT', body: { branchOverridable: ['distributionMethod'] } });
    assert.equal((await manager1(`${M}/settings`)).body.branch.effective.studentsPerInvigilator, 30);
    assert.ok(await prisma.auditEvent.count({ where: { action: 'EXAM_SETTINGS_CHANGED', schoolId: schools.A.id } }) >= 3);
  });

  test('the overview lists what is set up', async () => {
    const o = await manager1(`${M}/overview`);
    assert.equal(o.status, 200);
    assert.equal(o.body.featureEnabled, true);
    assert.deepEqual(o.body.setup.map((s) => [s.key, s.done]), [['year', true], ['periods', true], ['types', true], ['grading', true], ['formula', true], ['rooms', true]]);
    assert.deepEqual(o.body.counts, { periods: 2, types: 2, rooms: 1, seats: 120 });
  });

  test('signed out 401; staff 403; unknown ids 404', async () => {
    assert.equal((await call(`${O}/types`)).status, 401);
    assert.equal((await as('STAFF')(`${M}/rooms`)).status, 403);
    assert.equal((await owner(`${O}/types/${randomUUID()}`, { method: 'PATCH', body: { defaultMaxMarks: 10 } })).status, 404);
    assert.equal((await owner(`${O}/periods/not-an-id/deactivate`, { method: 'POST' })).status, 404);
  });
});
