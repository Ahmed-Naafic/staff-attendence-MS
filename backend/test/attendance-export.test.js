/*
 * Attendance report exports: CSV (data only), Excel (.xlsx, Overview + Attendance Records), PDF, and
 * the export preview,
 * approved in Phase 2 and the Excel design request (docs/reports/). Owners export within their own
 * school (combined or one branch), Managers within their current branch; the same filters, dates and
 * definitions as the records report; every matching row in the records order; at most 10,000 rows,
 * refused (never truncated) beyond; formula-injection protection and RFC 4180 quoting; no
 * coordinates; read only. Fixtures are written directly (as in attendance-reports.test.js); school C
 * holds exactly 10,000 check-ins for the size limit. Runs on the Neon dev branch (`npm test`);
 * everything it creates is removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { localMoment } from '../src/features/attendance/attendance.service.js';
import { EXPORT_MAX_ROWS } from '../src/features/attendance/attendanceReports.service.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { platformTimeZone } from '../src/features/platform-settings/settings.service.js';
import { addDays } from '../src/features/schedules/schedules.service.js';
import { readPdf } from './support/pdfReader.js';
import { readXlsx, rowValues, styleColours } from './support/xlsxReader.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Attendance export tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const phoneBase = 95_000_000_000 + (parseInt(randomBytes(3).toString('hex'), 16) % 1_000_000) * 1000;
const PASSWORD = 'export-password-123';
const ALL_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const POS = { latitude: 2.046934, longitude: 45.318162 };
const BIG_STAFF = 200;
const BIG_DAYS = 50; // 200 staff × 50 days = exactly 10,000 check-ins
const schools = {};
const branches = {};
const people = {};
const versions = {};
let server;
let base;
let zone;
let D;
let counter = 0;

async function call(path, { cookie } = {}) {
  const response = await fetch(base + path, { headers: cookie ? { cookie, origin: ORIGIN } : {} });
  // Decode the bytes as sent: keep the byte-order mark (response.text() would drop it).
  const buffer = Buffer.from(await response.arrayBuffer());
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(buffer);
  return { status: response.status, headers: response.headers, text, buffer, json: () => JSON.parse(text) };
}
const qs = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined)).toString();
const exportAs = (who, role, params = {}, format = 'csv') => call(`/api/${role}/attendance/export.${format}?${qs(params)}`, { cookie: people[who].cookie });
const xlsxAs = (who, role, params = {}) => exportAs(who, role, params, 'xlsx');
const pdfAs = (who, role, params = {}) => exportAs(who, role, params, 'pdf');
const previewAs = (who, role, params = {}) => call(`/api/${role}/attendance/export/preview?${qs(params)}`, { cookie: people[who].cookie });

/** RFC 4180 parser for the tests: rows of fields (quotes, doubled quotes, commas and line breaks inside quotes). */
function parseCsv(text) {
  const body = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && body[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
    } else field += c;
  }
  assert.equal(field, '', 'the file ends with CRLF');
  assert.equal(row.length, 0);
  const [header, ...data] = rows;
  return { header, data, objects: data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]))) };
}

function zoned(date, seconds) {
  const guess = new Date(Date.parse(`${date}T00:00:00Z`) + seconds * 1000);
  const local = localMoment(guess, zone);
  return new Date(guess.getTime() - (Date.parse(`${local.date}T00:00:00Z`) + Math.round(local.minutes * 60) * 1000 - guess.getTime()));
}

async function account(role, extra = {}) {
  counter += 1;
  const user = await prisma.user.create({
    data: { name: `Export ${role} ${counter} ${tag}`, email: `test-exp-${counter}-${lower}@test.edutrack.example`, role, passwordHash: await hashPassword(PASSWORD), ...extra },
  });
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password: PASSWORD }) });
  assert.equal(login.status, 200);
  return { ...user, cookie: login.headers.get('set-cookie').split(';')[0] };
}

const staffData = (branch, n, name, extra = {}) => ({
  name,
  email: `test-exp-s${n}-${lower}@test.edutrack.example`,
  role: 'STAFF',
  branchId: branch.id,
  staffId: `${branch.code}-ST${String(n).padStart(4, '0')}`,
  phone: `+${phoneBase + n}`,
  phoneKey: `+${phoneBase + n}`,
  jobTitle: 'Teacher',
  ...extra,
});

async function staff(branchKey, name, shiftKeys, extra = {}) {
  counter += 1;
  const user = await prisma.user.create({ data: staffData(branches[branchKey], counter, name, extra) });
  user.assignment = await prisma.staffAssignment.create({
    data: { staffUserId: user.id, branchId: branches[branchKey].id, effectiveFrom: new Date(`${addDays(D, -60)}T00:00:00Z`), timeZone: zone, shifts: { create: shiftKeys.map((shiftKey) => ({ shiftKey, days: ALL_DAYS })) } },
  });
  return user;
}

const eventData = (who, version, location, shiftKey, workDate, seconds, status) => {
  const occurredAt = zoned(workDate, seconds);
  return {
    staffUserId: who.id,
    branchId: version.branchId,
    type: 'CHECK_IN',
    clientEventId: randomUUID(),
    occurredAt,
    sentAt: occurredAt,
    receivedAt: new Date(occurredAt.getTime() + 1500),
    workDate: new Date(`${workDate}T00:00:00Z`),
    shiftKey,
    scheduleId: version.id,
    assignmentId: who.assignmentId ?? who.assignment.id,
    locationId: location.id,
    ...POS,
    accuracyMeters: 9.6,
    distanceMeters: 23.4,
    status,
  };
};
const checkIn = (who, key, shiftKey, workDate, seconds, status) => prisma.attendanceEvent.create({ data: eventData(who, versions[key], branches[key].location, shiftKey, workDate, seconds, status) });
const checkOut = (who, inEvent, seconds) => {
  const occurredAt = zoned(inEvent.workDate.toISOString().slice(0, 10), seconds);
  return prisma.attendanceEvent.create({
    data: { ...eventData(who, { id: inEvent.scheduleId, branchId: inEvent.branchId }, { id: inEvent.locationId }, inEvent.shiftKey, inEvent.workDate.toISOString().slice(0, 10), seconds, null), type: 'CHECK_OUT', occurredAt, sentAt: occurredAt, receivedAt: new Date(occurredAt.getTime() + 1000), checkInEventId: inEvent.id, assignmentId: inEvent.assignmentId },
  });
};

const KM = randomUUID();
const KD = randomUUID();
const KB = randomUUID();
const KC = randomUUID();
const LONG_NAME = 'Maryam Abdirahman Mohamed Abdullahi Hassan Abdi Warsame Ali Farah Yusuf Osman Ahmed Nur Ibrahim Jama Abdikarim';
const LONG_TITLE = 'Senior Mathematics and Physics Teacher for Grades Nine to Twelve and Examinations Coordinator';
const DANGEROUS = ['=HYPERLINK("http://evil.example","click")', '+1 Smith', ' -2 Lead', '@SUM(A1:A9)', '\tTab First', 'Comma, "Quoted"\nNewline'];

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  zone = await platformTimeZone();
  D = localMoment(new Date(), zone).date;

  for (const key of ['A', 'B', 'C']) schools[key] = await prisma.school.create({ data: { code: `X${tag}-${key}`, name: `Export School ${key} ${tag}`, location: 'Mogadishu' } });
  const branch = async (key, schoolKey, n) => {
    const b = await prisma.branch.create({
      data: { schoolId: schools[schoolKey].id, number: n, code: `X${tag}-${schoolKey}-B00${n}`, name: `Exp ${key}`, nameKey: `exp ${key.toLowerCase()}`, address: 'Road', city: 'Mogadishu' },
    });
    b.location = await prisma.branchLocation.create({ data: { branchId: b.id, ...POS, accuracyMeters: 8, effectiveFrom: new Date(Date.now() - 80 * 864e5) } });
    return b;
  };
  branches.A1 = await branch('A1', 'A', 1);
  branches.A2 = await branch('A2', 'A', 2);
  branches.B1 = await branch('B1', 'B', 1);
  branches.C1 = await branch('C1', 'C', 1);
  const shift = (key, name, start, end) => ({ shiftKey: key, name, days: ALL_DAYS, startMinute: start, endMinute: end, graceMinutes: 10, absenceCutoffMinutes: 40 });
  const version = (key, shifts, checkOutEnabled = true) =>
    prisma.branchSchedule.create({ data: { branchId: branches[key].id, effectiveFrom: new Date(`${addDays(D, -60)}T00:00:00Z`), timeZone: zone, checkOutEnabled, shifts: { create: shifts } } });
  versions.A1 = await version('A1', [shift(KM, 'Morning', 480, 840)]);
  versions.A2 = await version('A2', [shift(KD, 'Day', 420, 900)], false);
  versions.B1 = await version('B1', [shift(KB, 'Day', 420, 900)]);
  versions.C1 = await version('C1', [shift(KC, 'Day', 420, 900)]);

  people.ownerA = await account('OWNER');
  people.ownerB = await account('OWNER');
  people.ownerC = await account('OWNER');
  for (const k of ['A', 'B', 'C']) await prisma.school.update({ where: { id: schools[k].id }, data: { ownerId: people[`owner${k}`].id } });
  people.m1 = await account('MANAGER', { branchId: branches.A1.id });
  people.m2 = await account('MANAGER', { branchId: branches.A2.id });
  for (const m of [people.m1, people.m2]) await prisma.managerAssignment.create({ data: { managerId: m.id, branchId: m.branchId } });
  people.admin = await account('SUPER_ADMIN');

  // School A: staff with dangerous names and job titles (written directly; the API would accept them as text too).
  people.s = [];
  for (const [i, name] of DANGEROUS.entries()) people.s.push(await staff('A1', name, [KM], { jobTitle: DANGEROUS[(i + 1) % DANGEROUS.length], ...(i === 1 && { status: 'SUSPENDED', suspensionReason: 'Test', suspendedAt: new Date() }) }));
  people.a2 = await staff('A2', 'Cawo Export', [KD]);
  people.sb = await staff('B1', 'Other School Export', [KB]);
  people.events = [];
  for (const [i, s] of people.s.entries()) {
    for (let d = 1; d <= 3; d += 1) {
      const e = await checkIn(s, 'A1', KM, addDays(D, -d), 8 * 3600 + i * 120 + d * 60, d === 2 ? 'LATE' : 'PRESENT');
      people.events.push(e);
      if (d === 1) await checkOut(s, e, 14 * 3600);
    }
  }
  // Today, no check-out yet: Pending.
  people.pending = await checkIn(people.s[0], 'A1', KM, D, 9 * 3600, 'PRESENT');
  for (let d = 1; d <= 3; d += 1) await checkIn(people.a2, 'A2', KD, addDays(D, -d), 7 * 3600, 'PRESENT');
  await checkIn(people.sb, 'B1', KB, addDays(D, -1), 7 * 3600, 'PRESENT');
  // School B: very long text (for the PDF layout).
  people.long = await staff('B1', LONG_NAME, [KB], { jobTitle: LONG_TITLE });
  await checkIn(people.long, 'B1', KB, addDays(D, -2), 7 * 3600 + 300, 'LATE');

  // School C: exactly 10,000 check-ins (200 staff × 50 days), written in bulk.
  const bigStaff = await prisma.user.createManyAndReturn({
    data: Array.from({ length: BIG_STAFF }, (_, i) => staffData(branches.C1, 1000 + i, `Big Staff ${String(i).padStart(3, '0')} ${tag}`)),
    select: { id: true },
  });
  const sets = await prisma.staffAssignment.createManyAndReturn({
    data: bigStaff.map((u) => ({ staffUserId: u.id, branchId: branches.C1.id, effectiveFrom: new Date(`${addDays(D, -60)}T00:00:00Z`), timeZone: zone })),
    select: { id: true, staffUserId: true },
  });
  await prisma.staffAssignmentShift.createMany({ data: sets.map((s) => ({ assignmentId: s.id, shiftKey: KC, days: ALL_DAYS })) });
  people.big = sets.map((s) => ({ id: s.staffUserId, assignmentId: s.id }));
  const rows = [];
  for (const who of people.big) for (let d = 1; d <= BIG_DAYS; d += 1) rows.push(eventData(who, versions.C1, branches.C1.location, KC, addDays(D, -d), 7 * 3600, 'PRESENT'));
  for (let i = 0; i < rows.length; i += 2500) await prisma.attendanceEvent.createMany({ data: rows.slice(i, i + 2500) });
});

after(async () => {
  const branchIds = Object.values(branches).map((b) => b.id);
  const schoolIds = Object.values(schools).map((s) => s.id);
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  await prisma.attendanceEvent.deleteMany({ where: { branchId: { in: branchIds }, type: 'CHECK_OUT' } });
  await prisma.attendanceEvent.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.suspensionPeriod.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { branchId: { in: branchIds } }] } });
  await prisma.auditEvent.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { actorId: { in: userIds } }, { targetId: { in: [...userIds, ...branchIds] } }] } });
  const sets = (await prisma.staffAssignment.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((s) => s.id);
  await prisma.staffAssignmentShift.deleteMany({ where: { assignmentId: { in: sets } } });
  await prisma.staffAssignment.deleteMany({ where: { id: { in: sets } } });
  const versionIds = (await prisma.branchSchedule.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((v) => v.id);
  await prisma.branchShift.deleteMany({ where: { scheduleId: { in: versionIds } } });
  await prisma.branchSchedule.deleteMany({ where: { id: { in: versionIds } } });
  await prisma.branchLocation.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.managerAssignment.deleteMany({ where: { OR: [{ managerId: { in: userIds } }, { branchId: { in: branchIds } }] } });
  await prisma.user.deleteMany({ where: { id: { in: userIds }, role: { in: ['STAFF', 'MANAGER'] } } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  server.close();
  await prisma.$disconnect();
});

const RANGE = () => ({ from: addDays(D, -10), to: D });
const FILENAME = (ext) => new RegExp(`^attachment; filename="attendance_[A-Za-z0-9-]+_\\d{4}-\\d{2}-\\d{2}_to_\\d{4}-\\d{2}-\\d{2}\\.${ext}"$`);
const OWNER_COLUMNS = ['Date', 'Branch', 'Staff ID', 'Staff Name', 'Job Title', 'Shift', 'Scheduled Start', 'Check-in', 'Status', 'Check-out', 'Worked Time'];
const MANAGER_COLUMNS = OWNER_COLUMNS.filter((c) => c !== 'Branch');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const formulaLike = /^(?:[\t\r\n]|\s*[=+\-@])/;
// What the standard exports must never contain: coordinates, GPS distance and accuracy, received times
// and ISO timestamps, staff status, emails, phone numbers, ids, passwords and tokens.
const forbiddenIn = () => [
  'latitude', 'longitude', String(POS.latitude), String(POS.longitude), '23.4', '9.6', ...(zone === 'UTC' ? [] : ['UTC']), 'Suspended', 'Uploaded',
  '@test.edutrack.example', people.s[0].phone, PASSWORD, 'passwordHash', people.ownerA.cookie.split('=')[1], people.s[0].id, people.events[0].id,
];
const assertClean = (text) => {
  for (const value of forbiddenIn()) assert.ok(!text.includes(value), `must not contain ${JSON.stringify(value)}`);
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:/.test(text), 'no ISO timestamps');
};
// The records report in export order, keyed like the export rows.
const recordsKeys = async (params) => {
  const all = [];
  for (let page = 1; ; page += 1) {
    const res = await fetch(`${base}/api/owner/attendance/records?${qs({ ...params, page, pageSize: 7 })}`, { headers: { cookie: people.ownerA.cookie } });
    const body = await res.json();
    all.push(...body.items.map((r) => `${r.workDate}|${r.staff.staffId}|${r.checkIn.time.slice(0, 5)}`));
    if (page >= body.pageCount) return all;
  }
};
const dateOfSerial = (serial) => new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
/** The Attendance Records sheet as objects (header row 2, data from row 3; dates back to YYYY-MM-DD). */
function workbookRecords(res, columns) {
  const book = readXlsx(res.buffer);
  const sheet = book.sheets['Attendance Records'];
  const last = String.fromCharCode(64 + columns.length);
  const rows = [];
  for (let n = 3; sheet.cells.has(`A${n}`) && typeof sheet.cells.get(`A${n}`).value === 'number'; n += 1) {
    const values = rowValues(sheet, n, last);
    rows.push(Object.fromEntries(columns.map((c, i) => [c, c === 'Date' ? dateOfSerial(values[i]) : (values[i] ?? '')])));
  }
  return { book, sheet, rows, last };
}

describe('CSV: data only, the standard columns', () => {
  test('headers, a safe .csv name, the Owner columns in order, and every row of the school', async () => {
    const res = await exportAs('ownerA', 'owner', RANGE());
    assert.equal(res.status, 200, res.text);
    assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.match(res.headers.get('content-disposition'), FILENAME('csv'));
    assert.equal(res.headers.get('content-disposition'), `attachment; filename="attendance_X${tag}-A_${addDays(D, -10)}_to_${D}.csv"`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-export-rows'), '22');
    assert.ok(res.text.startsWith('\uFEFF'));
    const csv = parseCsv(res.text);
    assert.deepEqual(csv.header, OWNER_COLUMNS);
    assert.equal(csv.data.length, 6 * 3 + 1 + 3);
    assert.deepEqual([...new Set(csv.objects.map((r) => r.Branch))].sort(), ['Exp A1', 'Exp A2']);
  });

  test('Manager: the same columns without Branch', async () => {
    const csv = parseCsv((await exportAs('m1', 'manager', RANGE())).text);
    assert.deepEqual(csv.header, MANAGER_COLUMNS);
    assert.equal(csv.data.length, 19);
  });

  test('values: dates, HH:MM times, Present/Late, check-out time or Pending / Missing >24h / Not required, worked time or blank', async () => {
    const rows = parseCsv((await exportAs('ownerA', 'owner', { ...RANGE(), sort: 'date', order: 'asc' })).text).objects;
    const s0 = rows.filter((r) => r['Staff ID'] === people.s[0].staffId);
    assert.deepEqual(s0.map((r) => r.Date), [addDays(D, -3), addDays(D, -2), addDays(D, -1), D]);
    const [d3, d2, d1, today] = s0;
    assert.deepEqual(d1, {
      Date: addDays(D, -1), Branch: 'Exp A1', 'Staff ID': people.s[0].staffId, 'Staff Name': `'${DANGEROUS[0]}`, 'Job Title': `'${DANGEROUS[1]}`,
      Shift: 'Morning', 'Scheduled Start': '08:00', 'Check-in': '08:01', Status: 'Present', 'Check-out': '14:00', 'Worked Time': '5h 59m',
    });
    assert.equal(d2.Status, 'Late');
    assert.deepEqual([d3['Check-out'], d3['Worked Time']], ['Missing >24h', '']);
    assert.deepEqual([today['Check-out'], today['Worked Time']], ['Pending', '']);
    const a2 = rows.filter((r) => r.Branch === 'Exp A2');
    assert.ok(a2.length === 3 && a2.every((r) => r['Check-out'] === 'Not required' && r['Worked Time'] === ''));
  });

  test('formula-like text gets a leading apostrophe; commas, quotes and line breaks are quoted and round-trip', async () => {
    const csv = parseCsv((await exportAs('ownerA', 'owner', { ...RANGE(), branch: branches.A1.id })).text);
    const names = new Set(csv.objects.map((r) => r['Staff Name']));
    const titles = new Set(csv.objects.map((r) => r['Job Title']));
    for (const value of DANGEROUS) {
      const expected = formulaLike.test(value) ? `'${value}` : value;
      assert.ok(names.has(expected), `name ${JSON.stringify(value)}`);
      assert.ok(titles.has(expected), `job title ${JSON.stringify(value)}`);
    }
    assert.ok(names.has('Comma, "Quoted"\nNewline'));
    for (const row of csv.data) for (const cell of row) assert.ok(!formulaLike.test(cell), JSON.stringify(cell));
  });

  test('no technical fields: no coordinates, GPS values, received times, status, contact data, ids or secrets', async () => {
    const res = await exportAs('ownerA', 'owner', RANGE());
    assertClean(res.text.replace(/^\uFEFF/, ''));
  });

  test('user input never reaches the headers; an empty result is a header-only file', async () => {
    const res = await exportAs('ownerA', 'owner', { ...RANGE(), q: 'x"\r\nX-Injected: 1' });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), FILENAME('csv'));
    assert.equal(res.headers.get('x-injected'), null);
    const csv = parseCsv(res.text);
    assert.deepEqual([csv.header, csv.data.length, res.headers.get('x-export-rows')], [OWNER_COLUMNS, 0, '0']);
  });
});

describe('Excel: Overview and Attendance Records', () => {
  test('Owner workbook: two named sheets; records header, order, frozen header, autofilter, widths, date and status formatting', async () => {
    const res = await xlsxAs('ownerA', 'owner', { ...RANGE(), sort: 'date', order: 'asc' });
    assert.equal(res.status, 200, res.text.slice(0, 200));
    assert.equal(res.headers.get('content-type'), XLSX);
    assert.match(res.headers.get('content-disposition'), FILENAME('xlsx'));
    assert.equal(res.headers.get('x-export-rows'), '22');
    const { book, sheet, rows } = workbookRecords(res, OWNER_COLUMNS);
    assert.deepEqual(book.sheetNames, ['Overview', 'Attendance Records']);
    assert.match(sheet.cells.get('A1').value, new RegExp(`^Attendance Records — Export School A ${tag} · All branches · `));
    assert.deepEqual(rowValues(sheet, 2, 'K'), OWNER_COLUMNS);
    assert.equal(rows.length, 22);
    assert.match(sheet.xml, /<pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"\/>/);
    assert.match(sheet.xml, /<autoFilter ref="A2:K24"\/>/);
    assert.equal((sheet.xml.match(/<col /g) ?? []).length, 11);
    assert.match(book.files['xl/workbook.xml'], /'Attendance Records'!\$A\$2:\$K\$24/);
    // Header: navy with white text; dates are real dates shown as yyyy-mm-dd.
    const header = styleColours(book.files, sheet.cells.get('A2').style);
    assert.deepEqual([header.fill, header.font], ['001D31', 'FFFFFF']);
    assert.equal(sheet.cells.get('A3').type, 'n');
    assert.match(book.files['xl/styles.xml'], new RegExp(`<numFmt numFmtId="${styleColours(book.files, sheet.cells.get('A3').style).numFmt}" formatCode="yyyy-mm-dd"/>`));
    // Restrained status colours: Present green, Late amber; Missing >24h dark red text on a pale fill.
    const colourOf = (column, value) => {
      const index = rows.findIndex((r) => r[column] === value);
      const col = String.fromCharCode(65 + OWNER_COLUMNS.indexOf(column));
      return styleColours(book.files, sheet.cells.get(`${col}${index + 3}`).style);
    };
    assert.equal(colourOf('Status', 'Present').fill, 'D6F5E8');
    assert.equal(colourOf('Status', 'Late').fill, 'FDECC7');
    assert.equal(colourOf('Check-out', 'Missing >24h').font, 'B42318');
    assert.ok(rows.some((r) => r['Check-out'] === 'Pending') && rows.some((r) => r['Check-out'] === 'Not required'));
    // The same rows and values as the CSV (apart from the CSV's formula apostrophes).
    const csv = parseCsv((await exportAs('ownerA', 'owner', { ...RANGE(), sort: 'date', order: 'asc' })).text).objects;
    assert.deepEqual(rows.map((r) => ({ ...r, 'Staff Name': r['Staff Name'], 'Job Title': r['Job Title'] })), csv.map((r) => ({ ...r, 'Staff Name': r['Staff Name'].replace(/^'/, ''), 'Job Title': r['Job Title'].replace(/^'/, '') })));
  });

  test('Overview: title, school, period, scope, filters, generation, summary of the exported rows, absence note', async () => {
    const res = await xlsxAs('ownerA', 'owner', RANGE());
    const { book } = workbookRecords(res, OWNER_COLUMNS);
    const overview = book.sheets.Overview;
    const texts = [...overview.cells.values()].map((c) => c.value).filter((v) => v !== null);
    assert.equal(overview.cells.get('A1').value, 'EduTrack – Attendance Report');
    assert.equal(overview.cells.get('A2').value, `Export School A ${tag}`);
    assert.match(overview.cells.get('A3').value, new RegExp(`^Period: .* – .*\\| {3}Time zone: ${zone}$`));
    const detail = (label) => {
      const ref = [...overview.cells].find(([, c]) => c.value === label)[0];
      return overview.cells.get(`B${ref.slice(1)}`).value;
    };
    assert.equal(detail('Scope'), 'All branches');
    assert.equal(detail('Filters'), 'None');
    assert.equal(detail('Generated by'), 'School Owner');
    assert.match(detail('Generated on'), new RegExp(`^\\d{2} [A-Z][a-z]{2} \\d{4}, \\d{2}:\\d{2} \\(${zone}\\)$`));
    const labelsRow = Number([...overview.cells].find(([, c]) => c.value === 'Check-ins')[0].slice(1));
    assert.deepEqual(rowValues(overview, labelsRow, 'E'), ['Check-ins', 'Present', 'Late', 'Checked out', 'No check-out (>24h)']);
    assert.deepEqual(rowValues(overview, labelsRow + 1, 'E'), [22, 16, 6, 6, 12]);
    assert.ok(texts.includes('Also: pending check-out 1 · check-out not required 3 · staff with records 7'));
    assert.ok(texts.some((t) => String(t).startsWith('Absence is not calculated yet.')));
    assert.ok(texts.includes('22 rows (an export contains at most 10,000).'));
    // No absence, rates, percentages or expected/scheduled totals (only the note that absence is not calculated).
    for (const banned of [/Absent/, /rates?/i, /%/, /Expected/i, /scheduled shifts/i]) {
      assert.ok(!texts.some((t) => banned.test(String(t)) && !String(t).startsWith('Absence is not calculated')), String(banned));
    }
  });

  test('Manager workbook: no Branch column; the branch named as scope; filters described', async () => {
    const res = await xlsxAs('m1', 'manager', { ...RANGE(), status: 'late' });
    const { book, sheet, rows } = workbookRecords(res, MANAGER_COLUMNS);
    assert.deepEqual(rowValues(sheet, 2, 'J'), MANAGER_COLUMNS);
    assert.equal(sheet.cells.get('K2'), undefined);
    assert.equal(rows.length, 6);
    assert.ok(rows.every((r) => r.Status === 'Late'));
    assert.match(sheet.xml, /<autoFilter ref="A2:J8"\/>/);
    const texts = [...book.sheets.Overview.cells.values()].map((c) => c.value);
    assert.ok(texts.includes(`Branch: Exp A1 (${branches.A1.code})`));
    assert.ok(texts.includes('Status: Late'));
    assert.ok(texts.includes('Manager'));
    assert.match(res.headers.get('content-disposition'), new RegExp(`attendance_${branches.A1.code}_`));
  });

  test('text is stored as text: formula-like names verbatim, no formulas anywhere; no technical fields in any part', async () => {
    const res = await xlsxAs('ownerA', 'owner', { ...RANGE(), branch: branches.A1.id });
    const { book, rows } = workbookRecords(res, OWNER_COLUMNS);
    const names = new Set(rows.map((r) => r['Staff Name']));
    for (const value of DANGEROUS) assert.ok(names.has(value), JSON.stringify(value));
    for (const [name, xml] of Object.entries(book.files)) {
      assert.ok(!/<f[ >]/.test(xml), `no formula in ${name}`);
      if (name.startsWith('xl/worksheets/')) assertClean(xml);
    }
  });

  test('an empty report: both sheets, the header row, a "no records" line, zero summary', async () => {
    const res = await xlsxAs('ownerA', 'owner', { from: addDays(D, -30), to: addDays(D, -30) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-export-rows'), '0');
    const { book, sheet, rows } = workbookRecords(res, OWNER_COLUMNS);
    assert.equal(rows.length, 0);
    assert.deepEqual(rowValues(sheet, 2, 'K'), OWNER_COLUMNS);
    assert.equal(sheet.cells.get('A3').value, 'No attendance records match these filters.');
    assert.match(sheet.xml, /<autoFilter ref="A2:K2"\/>/);
    const texts = [...book.sheets.Overview.cells.values()].map((c) => c.value);
    assert.ok(texts.includes('0 rows (an export contains at most 10,000).'));
  });
});

describe('scope and authorization (both formats)', () => {
  test('owner: own school only; another school’s branch or staff is not found, as JSON without a file', async () => {
    for (const format of ['csv', 'xlsx', 'pdf']) {
      const b = await exportAs('ownerB', 'owner', RANGE(), format);
      if (format === 'pdf') {
        const text = readPdf(b.buffer).pages.map((page) => page.text).join('\n');
        assert.ok(text.includes('Exp B1') && !text.includes('Exp A1') && !text.includes('Exp A2'), 'pdf');
      } else {
        const rows = format === 'csv' ? parseCsv(b.text).objects : workbookRecords(b, OWNER_COLUMNS).rows;
        assert.equal(rows.length, 2, format);
        assert.ok(rows.every((r) => r.Branch === 'Exp B1'), format);
      }
      for (const params of [{ branch: branches.B1.id }, { staff: people.sb.id }, { branch: randomUUID() }]) {
        const res = await exportAs('ownerA', 'owner', { ...RANGE(), ...params }, format);
        assert.equal(res.status, 404, `${format} ${JSON.stringify(params)}`);
        assert.equal(res.json().code, 'NOT_FOUND');
        assert.equal(res.headers.get('content-disposition'), null);
        assert.match(res.headers.get('content-type'), /application\/json/);
      }
    }
  });

  test('manager: current branch only; a branch in the request is refused; after a transfer only the new branch', async () => {
    for (const format of ['csv', 'xlsx']) {
      assert.equal((await exportAs('m1', 'manager', { ...RANGE(), branch: branches.A1.id }, format)).status, 400, format);
      assert.equal((await exportAs('m1', 'manager', { ...RANGE(), staff: people.a2.id }, format)).status, 404, format);
    }
    assert.equal((await previewAs('m1', 'manager', { ...RANGE(), branch: branches.A1.id })).status, 400);
    assert.equal((await previewAs('m1', 'manager', { ...RANGE(), staff: people.a2.id })).status, 404);
    const before = parseCsv((await exportAs('m2', 'manager', RANGE())).text);
    assert.equal(before.data.length, 3);
    const transfer = await fetch(`${base}/api/owner/managers/${people.m2.id}/transfer`, {
      method: 'POST',
      headers: { cookie: people.ownerA.cookie, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ branchId: branches.A1.id }),
    });
    assert.equal(transfer.status, 200);
    const csv = await exportAs('m2', 'manager', RANGE());
    assert.match(csv.headers.get('content-disposition'), new RegExp(`attendance_${branches.A1.code}_`));
    assert.equal(parseCsv(csv.text).data.length, 19);
    const xlsx = await xlsxAs('m2', 'manager', RANGE());
    assert.match(xlsx.headers.get('content-disposition'), new RegExp(`attendance_${branches.A1.code}_.*\\.xlsx`));
    const { rows } = workbookRecords(xlsx, MANAGER_COLUMNS);
    assert.equal(rows.length, 19);
    assert.ok(!rows.some((r) => r['Staff ID'] === people.a2.staffId));
    assert.equal((await xlsxAs('m2', 'manager', { ...RANGE(), staff: people.a2.id })).status, 404);
    const pdf = await pdfAs('m2', 'manager', RANGE());
    assert.match(pdf.headers.get('content-disposition'), new RegExp(`attendance_${branches.A1.code}_.*\\.pdf`));
    // Line breaks removed: a Staff ID wider than its column wraps at a hyphen.
    const pdfText = readPdf(pdf.buffer).pages.map((page) => page.text).join('').replace(/\n/g, '');
    assert.ok(pdfText.includes(people.s[2].staffId) && !pdfText.includes(people.a2.staffId));
    const preview = (await previewAs('m2', 'manager', RANGE())).json();
    assert.equal(preview.total, 19);
    assert.ok(!preview.rows.some((row) => row.includes(people.a2.staffId)));
  });

  test('unauthenticated 401; other roles 403 (every format and the preview)', async () => {
    for (const format of ['csv', 'xlsx', 'pdf', 'preview']) {
      if (format === 'preview') {
        assert.equal((await call('/api/owner/attendance/export/preview')).status, 401);
        assert.equal((await call('/api/manager/attendance/export/preview')).status, 401);
        for (const [who, role] of [['m1', 'owner'], ['ownerA', 'manager'], ['admin', 'owner'], ['admin', 'manager']]) assert.equal((await previewAs(who, role, RANGE())).status, 403);
        for (const params of [{ branch: branches.B1.id }, { staff: people.sb.id }]) assert.equal((await previewAs('ownerA', 'owner', { ...RANGE(), ...params })).status, 404);
        continue;
      }
      assert.equal((await call(`/api/owner/attendance/export.${format}`)).status, 401);
      assert.equal((await call(`/api/manager/attendance/export.${format}`)).status, 401);
      assert.equal((await exportAs('m1', 'owner', RANGE(), format)).status, 403);
      assert.equal((await exportAs('ownerA', 'manager', RANGE(), format)).status, 403);
      assert.equal((await exportAs('admin', 'owner', RANGE(), format)).status, 403);
      assert.equal((await exportAs('admin', 'manager', RANGE(), format)).status, 403);
    }
  });
});

describe('dates, filters and order', () => {
  test('the same date rules as the report: inclusive, at most 62 days, not reversed or future, strict (both formats)', async () => {
    const one = parseCsv((await exportAs('ownerA', 'owner', { from: addDays(D, -1), to: addDays(D, -1) })).text);
    assert.equal(one.data.length, 7);
    assert.ok(one.objects.every((r) => r.Date === addDays(D, -1)));
    for (const format of ['csv', 'xlsx', 'pdf']) {
      assert.equal((await exportAs('ownerA', 'owner', { from: addDays(D, -61), to: D }, format)).status, 200, format);
      for (const params of [{ from: addDays(D, -62), to: D }, { from: D, to: addDays(D, -1) }, { from: D, to: addDays(D, 1) }, { from: '2026-02-30' }, { to: '20261028' }]) {
        const res = await exportAs('ownerA', 'owner', params, format);
        assert.equal(res.status, 400, `${format} ${JSON.stringify(params)}`);
        assert.equal(res.json().code, 'VALIDATION_ERROR');
        assert.equal(res.headers.get('content-disposition'), null);
      }
    }
    assert.equal((await previewAs('ownerA', 'owner', { from: addDays(D, -61), to: D })).status, 200);
    for (const params of [{ from: addDays(D, -62), to: D }, { from: D, to: addDays(D, 1) }, { from: '2026-02-30' }]) {
      const res = await previewAs('ownerA', 'owner', params);
      assert.deepEqual([res.status, res.json().code], [400, 'VALIDATION_ERROR'], JSON.stringify(params));
    }
  });

  test('filters select the same rows as the records report, every page, in the records order (both formats)', async () => {
    for (const params of [
      { ...RANGE() },
      { ...RANGE(), status: 'late' },
      { ...RANGE(), checkOut: 'missing' },
      { ...RANGE(), checkOut: 'open' },
      { ...RANGE(), checkOut: 'not_required' },
      { ...RANGE(), q: people.s[3].staffId.toLowerCase() },
      { ...RANGE(), staff: people.s[2].id },
      { ...RANGE(), branch: branches.A1.id, shift: KM, sort: 'staffName', order: 'asc' },
      { ...RANGE(), sort: 'checkIn', order: 'asc' },
      { ...RANGE(), sort: 'status', order: 'desc' },
    ]) {
      const expected = await recordsKeys(params);
      const key = (r) => `${r.Date}|${r['Staff ID']}|${r['Check-in']}`;
      const csv = parseCsv((await exportAs('ownerA', 'owner', { ...params, page: 3, pageSize: 1 })).text);
      assert.deepEqual(csv.objects.map(key), expected, `csv ${JSON.stringify(params)}`);
      const { rows } = workbookRecords(await xlsxAs('ownerA', 'owner', { ...params, page: 3, pageSize: 1 }), OWNER_COLUMNS);
      assert.deepEqual(rows.map(key), expected, `xlsx ${JSON.stringify(params)}`);
    }
  });

  test('deterministic: the same request gives the same CSV', async () => {
    const [a, b] = [await exportAs('ownerA', 'owner', RANGE()), await exportAs('ownerA', 'owner', RANGE())];
    assert.equal(a.text, b.text);
  });
});

describe('PDF', () => {
  const pdfText = (res) => readPdf(res.buffer).pages.map((page) => page.text).join('\n');

  test('Owner PDF: a valid file with title, school, period, scope, summary, absence note, table headers and records', async () => {
    const res = await pdfAs('ownerA', 'owner', { ...RANGE(), sort: 'date', order: 'asc' });
    assert.equal(res.status, 200, res.text.slice(0, 200));
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition'), FILENAME('pdf'));
    assert.equal(res.headers.get('x-export-rows'), '22');
    const pdf = readPdf(res.buffer);
    const first = pdf.pages[0].lines;
    assert.equal(first[0], 'EduTrack – Attendance Report');
    assert.ok(first.includes(`Export School A ${tag}`));
    assert.ok(first.some((l) => new RegExp(`^Period: .* – .*\\| {3}Time zone: ${zone}$`).test(l)));
    assert.ok(first.includes('All branches') && first.includes('None'));
    assert.ok(first.includes('Generated by: School Owner'));
    for (const [label, value] of [['Check-ins', '22'], ['Present', '16'], ['Late', '6'], ['Checked out', '6'], ['No check-out (>24h)', '12']]) {
      assert.equal(first[first.indexOf(label) + 1], value, label);
    }
    assert.ok(first.includes('Absence is not calculated yet. Days without a check-in are not listed and are not counted as absent.'));
    const headerStart = first.indexOf('Date');
    assert.deepEqual(first.slice(headerStart, headerStart + 3), ['Date', 'Branch', 'Staff ID']);
    const text = pdfText(res);
    const flat = text.replace(/\n/g, ''); // wrapped cells (e.g. a long Staff ID) joined again
    for (const value of [people.s[0].staffId, 'Missing >24h', 'Pending', 'Not required', '5h 59m', 'Present', 'Late']) assert.ok(flat.includes(value), value);
    pdf.pages.forEach((page, i) => assert.ok(page.lines.includes(`Page ${i + 1} of ${pdf.pageCount}`)));
    assert.ok(text.includes('22 rows (an export contains at most 10,000).'));
    // Formula-like names are plain text in a PDF (shown as written; a word wider than its column is split across lines).
    assert.ok(text.replace(/\n/g, '').includes(DANGEROUS[0]));
  });

  test('Manager PDF: no Branch column; the branch as scope', async () => {
    const res = await pdfAs('m1', 'manager', RANGE());
    const first = readPdf(res.buffer).pages[0].lines;
    const headerStart = first.indexOf('Date');
    assert.deepEqual(first.slice(headerStart, headerStart + 3), ['Date', 'Staff ID', 'Staff Name']);
    assert.ok(first.includes(`Branch: Exp A1 (${branches.A1.code})`));
    assert.ok(first.includes('Generated by: Manager'));
  });

  test('long names and job titles are kept in full (wrapped, nothing cut or replaced)', async () => {
    const text = pdfText(await pdfAs('ownerB', 'owner', RANGE()));
    for (const word of [...LONG_NAME.split(' '), ...LONG_TITLE.split(' ')]) assert.ok(text.includes(word), word);
    assert.ok(!text.includes('cannot be shown'));
  });

  test('an empty PDF says so; no technical fields in any PDF', async () => {
    const empty = await pdfAs('ownerA', 'owner', { from: addDays(D, -30), to: addDays(D, -30) });
    assert.equal(empty.status, 200);
    assert.equal(empty.headers.get('x-export-rows'), '0');
    const text = pdfText(empty);
    assert.ok(text.includes('No attendance records match these filters.'));
    assert.ok(text.includes('0 rows (an export contains at most 10,000).'));
    assertClean(pdfText(await pdfAs('ownerA', 'owner', RANGE())));
  });
});

describe('export preview', () => {
  test('Owner: heading, notes, the summary of every row, the columns, and the rows exactly as the CSV writes them', async () => {
    const res = await previewAs('ownerA', 'owner', { ...RANGE(), sort: 'date', order: 'asc' });
    assert.equal(res.status, 200, res.text);
    const p = res.json();
    assert.equal(p.head.title, 'EduTrack – Attendance Report');
    assert.equal(p.head.school, `Export School A ${tag}`);
    assert.equal(p.head.scope, 'All branches');
    assert.equal(p.head.filters, 'None');
    assert.equal(p.head.generatedBy, 'School Owner');
    assert.deepEqual(p.head.timeZones, [zone]);
    assert.deepEqual(p.summary, { checkIns: 22, present: 16, late: 6, checkedOut: 6, missing: 12, pending: 1, notRequired: 3, staff: 7 });
    assert.deepEqual([p.total, p.shown, p.limit, p.overLimit], [22, 22, 10_000, false]);
    assert.deepEqual(p.columns.map((c) => c.header), OWNER_COLUMNS);
    assert.ok(p.notes[0].startsWith('Absence is not calculated yet.'));
    // The preview's rows and CSV text are the CSV export's (the export adds only the byte-order mark).
    const csv = await exportAs('ownerA', 'owner', { ...RANGE(), sort: 'date', order: 'asc' });
    assert.equal(p.csv, csv.text.replace(/^\uFEFF/, ''));
    const fromCsv = parseCsv(csv.text).data.map((row) => row.map((cell) => cell.replace(/^'/, '')));
    assert.deepEqual(p.rows, fromCsv);
    assert.deepEqual(Object.keys(p.files), ['pdf', 'xlsx', 'csv']);
    assert.match(p.files.pdf, /^attendance_[A-Za-z0-9-]+_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.pdf$/);
    assertClean(JSON.stringify({ rows: p.rows, csv: p.csv }));
  });

  test('Manager: 10 columns, the branch as scope; filters and sort as in the records report', async () => {
    const p = (await previewAs('m1', 'manager', { ...RANGE(), status: 'late' })).json();
    assert.deepEqual(p.columns.map((c) => c.header), MANAGER_COLUMNS);
    assert.equal(p.head.scope, `Branch: Exp A1 (${branches.A1.code})`);
    assert.equal(p.head.filters, 'Status: Late');
    assert.equal(p.total, 6);
    assert.ok(p.rows.every((row) => row[MANAGER_COLUMNS.indexOf('Status')] === 'Late'));
    for (const params of [{ ...RANGE(), checkOut: 'missing' }, { ...RANGE(), sort: 'staffName', order: 'asc' }, { ...RANGE(), q: people.s[3].staffId.toLowerCase() }]) {
      const preview = (await previewAs('ownerA', 'owner', params)).json();
      const keys = preview.rows.map((row) => `${row[0]}|${row[2]}|${row[7]}`);
      assert.deepEqual(keys, await recordsKeys(params), JSON.stringify(params));
    }
  });

  test('an empty preview: no rows, zero summary', async () => {
    const p = (await previewAs('ownerA', 'owner', { from: addDays(D, -30), to: addDays(D, -30) })).json();
    assert.deepEqual([p.total, p.shown, p.rows], [0, 0, []]);
    assert.deepEqual(p.summary, { checkIns: 0, present: 0, late: 0, checkedOut: 0, missing: 0, pending: 0, notRequired: 0, staff: 0 });
    assert.equal(p.csv, `${OWNER_COLUMNS.join(',')}\r\n`);
  });
});

describe('size limit (10,000 rows) and read only', () => {
  test('exactly 10,000 rows export in both formats; 10,001 are refused with a clear error and no file', async () => {
    assert.equal(EXPORT_MAX_ROWS, 10_000);
    const range = { from: addDays(D, -BIG_DAYS), to: addDays(D, -1) };
    const csv = await exportAs('ownerC', 'owner', range);
    assert.equal(csv.status, 200, csv.text.slice(0, 300));
    assert.equal(csv.headers.get('x-export-rows'), '10000');
    const parsed = parseCsv(csv.text);
    assert.equal(parsed.data.length, 10_000);
    assert.equal(new Set(parsed.objects.map((r) => `${r['Staff ID']}|${r.Date}`)).size, 10_000, 'no row repeated across batches');
    const xlsx = await xlsxAs('ownerC', 'owner', range);
    assert.equal(xlsx.status, 200);
    assert.equal(xlsx.headers.get('x-export-rows'), '10000');
    const book = workbookRecords(xlsx, OWNER_COLUMNS);
    assert.equal(book.rows.length, 10_000);
    assert.match(book.sheet.xml, /<autoFilter ref="A2:K10002"\/>/);
    const pdf = await pdfAs('ownerC', 'owner', range);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('x-export-rows'), '10000');
    const pages = readPdf(pdf.buffer).pages;
    assert.ok(pages.length > 100, `${pages.length} pages`);
    pages.forEach((page, i) => {
      assert.ok(page.lines.includes('Staff ID'), `header on page ${i + 1}`);
      assert.ok(page.lines.includes(`Page ${i + 1} of ${pages.length}`), `page number on page ${i + 1}`);
    });
    // One date cell per row (a date never wraps).
    const rowsInPdf = pages.flatMap((page) => page.lines.filter((line) => /^\d{4}-\d{2}-\d{2}$/.test(line)));
    assert.equal(rowsInPdf.length, 10_000, 'every row in the PDF');
    const preview = (await previewAs('ownerC', 'owner', range)).json();
    assert.deepEqual([preview.total, preview.shown, preview.overLimit, preview.limit], [10_000, 50, false, 10_000]);

    const extra = await prisma.attendanceEvent.create({ data: eventData(people.big[0], versions.C1, branches.C1.location, KC, addDays(D, -(BIG_DAYS + 1)), 7 * 3600, 'PRESENT') });
    try {
      const overPreview = (await previewAs('ownerC', 'owner', { from: addDays(D, -(BIG_DAYS + 1)), to: addDays(D, -1) })).json();
      assert.deepEqual([overPreview.total, overPreview.overLimit, overPreview.shown], [10_001, true, 50]);
      for (const format of ['csv', 'xlsx', 'pdf']) {
        const over = await exportAs('ownerC', 'owner', { from: addDays(D, -(BIG_DAYS + 1)), to: addDays(D, -1) }, format);
        assert.equal(over.status, 400, format);
        assert.match(over.headers.get('content-type'), /application\/json/);
        assert.equal(over.headers.get('content-disposition'), null);
        assert.equal(over.headers.get('x-export-rows'), null);
        const body = over.json();
        assert.equal(body.code, 'EXPORT_TOO_LARGE');
        assert.deepEqual(body.details, { total: 10_001, limit: 10_000 });
        assert.match(body.error, /10,001 records.*at most 10,000.*Narrow the dates or filters/);
      }
      assert.equal((await exportAs('ownerC', 'owner', range)).status, 200);
    } finally {
      await prisma.attendanceEvent.delete({ where: { id: extra.id } });
    }
  });

  test('exports and refused exports change nothing (no events, no audit entries)', async () => {
    const counts = () =>
      Promise.all([prisma.attendanceEvent.count({ where: { branchId: { in: Object.values(branches).map((b) => b.id) } } }), prisma.auditEvent.count({ where: { schoolId: { in: Object.values(schools).map((s) => s.id) } } })]);
    const before = await counts();
    for (const format of ['csv', 'xlsx', 'pdf']) {
      await previewAs('ownerA', 'owner', RANGE());
      await exportAs('ownerA', 'owner', RANGE(), format);
      await exportAs('m1', 'manager', RANGE(), format);
      await exportAs('ownerA', 'owner', { from: addDays(D, -62), to: D }, format);
      await exportAs('ownerA', 'owner', { ...RANGE(), branch: branches.B1.id }, format);
    }
    assert.deepEqual(await counts(), before);
  });
});
