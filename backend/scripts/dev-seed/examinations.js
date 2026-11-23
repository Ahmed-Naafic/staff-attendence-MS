/*
 * DEV BRANCH ONLY — examination sample data for the demo school (the dev Owner's school), covering
 * every part of the Examinations module:
 *
 *   configuration  the module switched on; academic periods (Term 1–3 of the current year), examination
 *                  types (Monthly Test, Mid-Term, End of Term), grading scales (letters, pass / fail),
 *                  the final-result formula, examination rooms in every active branch;
 *   a completed    "Monthly Test – Term 1": timetabled in every branch and published, then moved a few
 *   examination    weeks into the past (whole weeks, so weekdays stay the same); attendance taken,
 *                  marks entered and approved for every paper and section, results approved and
 *                  published (report cards, analytics and final results have data);
 *   a planned      "Mid-Term – Term 1" in the coming weeks: timetable generated and published in every
 *   examination    branch (sessions, seats, invigilators, the invigilator matrix);
 *   a draft        "End of Term – Term 1": classes and papers, not scheduled.
 *
 *   npm run seed:dev-exams --workspace backend     (also run by `npm run seed:dev`)
 *
 * It goes through the API as the dev Owner (in-process, like the tests), so every rule and validation
 * applies and nothing is written that the application itself would not write. The only direct writes:
 * switching the module on for the school (a Super Admin switch) and moving the completed examination's
 * dates into the past (the API only schedules examinations from today on).
 *
 * Safe to run again: what exists (matched by name) is kept and reused, never changed or deleted; an
 * examination that already exists is skipped. Refuses to run unless EDUTRACK_DB_BRANCH is "dev".
 */
import { calendarToday } from '../../src/features/academic-calendar/calendar.service.js';
import { addDays, asDbDay } from '../../src/features/academic-calendar/schoolDays.js';
import { OWNER_EMAIL } from './accounts.js';

const ORIGIN = 'http://localhost:5173';
const O = '/api/owner/exams';
const toDay = (d) => d.toISOString().slice(0, 10);
const key = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Deterministic random numbers (mulberry32), so a reseed gives the same picture. */
function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LETTERS = [
  { label: 'A', minPercent: 80, maxPercent: 100, points: 4, passes: true, remark: 'Excellent' },
  { label: 'B', minPercent: 70, maxPercent: 79.99, points: 3, passes: true, remark: 'Very good' },
  { label: 'C', minPercent: 60, maxPercent: 69.99, points: 2, passes: true, remark: 'Good' },
  { label: 'D', minPercent: 50, maxPercent: 59.99, points: 1, passes: true, remark: 'Pass' },
  { label: 'F', minPercent: 0, maxPercent: 49.99, points: 0, passes: false, remark: 'Needs support' },
];
const PASS_FAIL = [
  { label: 'Pass', minPercent: 50, maxPercent: 100, passes: true },
  { label: 'Fail', minPercent: 0, maxPercent: 49.99, passes: false },
];
const TYPES = [
  { name: 'Monthly Test', description: 'A short test of the month’s work.', defaultMaxMarks: 20, stopsLessons: false },
  { name: 'Mid-Term', description: 'Halfway through the term.', defaultMaxMarks: 30, stopsLessons: true },
  { name: 'End of Term', description: 'The main examination of the term.', defaultMaxMarks: 50, stopsLessons: true },
];

/** A small client for the in-process API, signed in as the dev Owner (cookie session). */
async function ownerClient(prisma) {
  const { default: app } = await import('../../src/app.js');
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const password = process.env.DEV_OWNER_PASSWORD;
  if (!password) throw new Error('DEV_OWNER_PASSWORD is not set in backend/.env.dev.');
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email: OWNER_EMAIL, password }) });
  if (!login.ok) throw new Error(`The dev Owner could not sign in (${login.status}). Run npm run seed:dev-accounts first.`);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  async function call(path, { method = 'GET', body, query } = {}) {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, v);
    const response = await fetch(url, {
      method,
      headers: { cookie, ...(body !== undefined && { 'content-type': 'application/json' }), ...(method !== 'GET' && { origin: ORIGIN }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = new Error(`${method} ${path} → ${response.status} ${data?.code ?? ''}: ${data?.error ?? text}${data?.details ? ` ${JSON.stringify(data.details)}` : ''}`);
      error.status = response.status;
      error.code = data?.code;
      throw error;
    }
    return data;
  }
  return { call, close: () => new Promise((resolve) => server.close(resolve)), prisma };
}

/** Finds by name in a list, or creates (POST) and returns the new record. */
async function ensure(list, name, create, log, what) {
  const found = list.find((x) => key(x.name) === key(name));
  if (found) return found;
  const created = await create();
  log(`  + ${what} ${name}`);
  return created;
}

export async function seedExaminations(prisma, log = console.log) {
  const owner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL }, select: { id: true } });
  const school = owner && (await prisma.school.findFirst({ where: { ownerId: owner.id } }));
  if (!school) {
    log('Examinations: no demo school (run npm run seed:dev first).');
    return;
  }
  const year = await prisma.academicYear.findFirst({ where: { schoolId: school.id, status: 'CURRENT' } });
  if (!year) {
    log('Examinations: the demo school has no current academic year.');
    return;
  }
  if (!school.examinationsEnabled) {
    await prisma.school.update({ where: { id: school.id }, data: { examinationsEnabled: true } });
    log('Examinations: switched on for the demo school.');
  }
  const today = await calendarToday();
  const api = await ownerClient(prisma);
  const { call } = api;
  const rng = rngFrom(20261123);
  try {
    log('Examinations: configuration');
    // Periods: three terms of the current year (an existing period with the same name is kept).
    const yStart = toDay(year.startDate);
    const yEnd = toDay(year.endDate);
    const periods = (await call(`${O}/periods`, { query: { academicYear: year.id } })).items;
    const t1End = periods.find((p) => key(p.name) === 'term 1')?.endDate ?? addDays(yStart, 136);
    const t2End = addDays(t1End, 105);
    const terms = [
      ['Term 1', yStart, t1End],
      ['Term 2', addDays(t1End, 1), t2End < yEnd ? t2End : yEnd],
      ['Term 3', addDays(t2End, 1), yEnd],
    ].filter(([, s, e]) => s <= e);
    const term = {};
    for (const [name, startDate, endDate] of terms) {
      // A period overlapping one made by hand is skipped (periods of a year never overlap).
      try {
        term[name] = await ensure(periods, name, async () => (await call(`${O}/periods`, { method: 'POST', body: { academicYear: year.id, name, startDate, endDate } })).period, log, 'period');
      } catch (e) {
        log(`  · period ${name} skipped: ${e.message}`);
      }
    }

    // Grading scales: letters (the default when there is none) and pass / fail.
    const scales = (await call(`${O}/grading-scales`)).items;
    const letters = await ensure(scales, 'Letter grades', async () => (await call(`${O}/grading-scales`, { method: 'POST', body: { name: 'Letter grades', isDefault: !scales.some((s) => s.isDefault), bands: LETTERS } })).scale, log, 'grading scale');
    await ensure(scales, 'Pass / Fail', async () => (await call(`${O}/grading-scales`, { method: 'POST', body: { name: 'Pass / Fail', bands: PASS_FAIL } })).scale, log, 'grading scale');

    // Examination types.
    const typeList = (await call(`${O}/types`)).items;
    const type = {};
    for (const t of TYPES) {
      type[t.name] = await ensure(typeList, t.name, async () => (await call(`${O}/types`, { method: 'POST', body: { ...t, gradingScale: letters.id } })).type, log, 'examination type');
    }

    // The final-result formula of the year, when none is set: End of Term 40%, Mid-Term 30%, the rest
    // of the active types share 30%.
    const formula = await call(`${O}/formula`, { query: { academicYear: year.id } });
    if (!formula.formula) {
      const active = (await call(`${O}/types`, { query: { status: 'active' } })).items;
      const fixed = { [type['End of Term'].id]: 40, [type['Mid-Term'].id]: 30 };
      const others = active.filter((t) => !(t.id in fixed));
      const share = others.length ? Math.floor(30 / others.length) : 0;
      const typeWeights = [
        ...Object.entries(fixed).map(([examTypeId, weight]) => ({ examTypeId, weight: others.length ? weight : weight + 15 })),
        ...others.map((t, i) => ({ examTypeId: t.id, weight: i === others.length - 1 ? 30 - share * (others.length - 1) : share })),
      ];
      await call(`${O}/formula`, { method: 'PUT', query: { academicYear: year.id }, body: { method: 'WEIGHTED', typeWeights } });
      log('  + result formula (weighted by type)');
    }

    // Rooms: every active branch gets rooms for its largest class, when it has fewer than four.
    const branches = await prisma.branch.findMany({ where: { schoolId: school.id, status: 'ACTIVE' }, select: { id: true, name: true, number: true }, orderBy: { number: 'asc' } });
    const rooms = (await call(`${O}/rooms`, { query: { status: 'active' } })).items;
    for (const b of branches) {
      const own = rooms.filter((r) => r.branch?.id === b.id);
      const prefix = b.number > 1 ? `B${b.number}-R` : 'R';
      for (let n = 1; own.length + n - 1 < 4; n += 1) {
        const name = `${prefix}${String(n).padStart(2, '0')}`;
        if (own.some((r) => key(r.name) === key(name))) continue;
        await call(`${O}/rooms`, { method: 'POST', body: { name, defaultCapacity: 30, branch: b.id } });
        log(`  + room ${name} (${b.name})`);
      }
    }

    const classes = (await call(`${O}/examinations/options`, { query: { academicYear: year.id } })).classes.map((c) => c.id);
    const existing = (await call(`${O}/examinations`, { query: { academicYear: year.id } })).items;
    const has = (name) => existing.some((e) => key(e.name) === key(name));

    /** The first 7-day window from `from` (stepping a week) that no scheduled examination of the school touches. */
    async function freeWindow(from, days = 7) {
      const scheduled = await prisma.examination.findMany({ where: { schoolId: school.id, status: 'SCHEDULED' }, select: { startDate: true, endDate: true } });
      let start = from;
      while (scheduled.some((e) => toDay(e.startDate) <= addDays(start, days - 1) && toDay(e.endDate) >= start)) start = addDays(start, 7);
      return { startDate: start, endDate: addDays(start, days - 1) };
    }
    const periodOf = (date) => Object.values(term).find((p) => p.startDate <= date && p.endDate >= date)?.id ?? null;

    /** Creates a school-wide examination of every class; papers come from the curricula. */
    async function create(name, examType, dates, extra = {}) {
      const body = { academicYear: year.id, name, examType, ...dates, period: periodOf(dates.startDate), classes, ...extra };
      const { examination } = await call(`${O}/examinations`, { method: 'POST', body });
      log(`  + examination ${name} (${dates.startDate} to ${dates.endDate})`);
      return examination;
    }

    /** Generates (with each branch's own defaults and rooms) and publishes the timetable of every branch. */
    async function timetable(examId) {
      for (const b of branches) {
        const options = await call(`${O}/examinations/${examId}/timetable/options`, { query: { branch: b.id } });
        if (!options.rooms.length || !options.students) continue;
        const d = options.defaults;
        const chosen = d.rooms.length ? d.rooms.map((r) => ({ room: r.roomId, ...(r.capacity && { capacity: r.capacity }) })) : options.rooms.map((r) => ({ room: r.id }));
        const body = { shifts: d.shifts, gapMinutes: d.gapMinutes, rooms: chosen, useAllRooms: false, excludedStaff: d.excludedStaff ?? [], distribution: d.distribution ?? 'alphabetical', maxPapersPerDay: d.maxPapersPerDay ?? 2 };
        const generated = await call(`${O}/examinations/${examId}/timetable/generate`, { method: 'POST', query: { branch: b.id }, body });
        const r = generated.report ?? {};
        log(`    timetable ${b.name}: ${generated.sessions?.length ?? '?'} sessions${r.unplaced?.length ? `, ${r.unplaced.length} papers not placed` : ''}${r.shortfall ? `, ${r.shortfall} invigilators short` : ''}`);
        try {
          await call(`${O}/examinations/${examId}/timetable/publish`, { method: 'POST', query: { branch: b.id } });
        } catch (e) {
          log(`    not published in ${b.name}: ${e.message}`);
        }
      }
    }

    log('Examinations: sample examinations');
    // 1. Completed: scheduled in a free window ahead, then moved back whole weeks into the past.
    const completedName = 'Monthly Test – Term 1';
    const done = existing.find((e) => key(e.name) === key(completedName));
    if (done) {
      // Finish what an interrupted run left (attendance, marks and results are each resumable).
      if (done.status === 'scheduled' && done.endDate < today) {
        log(`  · ${completedName} exists: completing its attendance, marks and results`);
        await sitAndMark(api, done.id, branches, rng, log);
      } else log(`  · ${completedName} exists`);
    } else {
      const ahead = await freeWindow(addDays(today, 28));
      const exam = await create(completedName, type['Monthly Test'].id, ahead, { stopsLessons: false, description: 'Sample data: a completed examination with marks and published results.' });
      await call(`${O}/examinations/${exam.id}/schedule`, { method: 'POST' });
      await timetable(exam.id);
      // Back into the past: about five weeks before today, never before the year starts, clear of
      // other scheduled examinations.
      const scheduled = await prisma.examination.findMany({ where: { schoolId: school.id, status: 'SCHEDULED', id: { not: exam.id } }, select: { startDate: true, endDate: true } });
      const span = (Date.parse(ahead.endDate) - Date.parse(ahead.startDate)) / 86_400_000;
      let back = Math.ceil((Date.parse(ahead.startDate) - Date.parse(addDays(today, -35))) / 86_400_000 / 7) * 7;
      const clash = (b) => scheduled.some((e) => toDay(e.startDate) <= addDays(ahead.endDate, -b) && toDay(e.endDate) >= addDays(ahead.startDate, -b));
      while (clash(back) && addDays(ahead.startDate, -(back + 7)) >= yStart) back += 7;
      while (addDays(ahead.startDate, -back) < yStart) back -= 7;
      if (addDays(ahead.endDate, -back) >= today || clash(back)) {
        log('    could not move it into the past (no free weeks this year): it stays planned.');
      } else {
        const startDate = addDays(ahead.startDate, -back);
        const period = periodOf(startDate);
        await prisma.$transaction(async (tx) => {
          await tx.examination.update({ where: { id: exam.id }, data: { startDate: asDbDay(startDate), endDate: asDbDay(addDays(startDate, span)), academicPeriodId: period } });
          const sessions = await tx.examSession.findMany({ where: { examinationId: exam.id }, select: { id: true, date: true } });
          for (const s of sessions) await tx.examSession.update({ where: { id: s.id }, data: { date: asDbDay(addDays(toDay(s.date), -back)) } });
        });
        log(`    moved to ${startDate} to ${addDays(startDate, span)}`);
        await sitAndMark(api, exam.id, branches, rng, log);
      }
    }

    // 2. Planned: the next free week from two weeks ahead, timetabled and published.
    const plannedName = 'Mid-Term – Term 1';
    if (has(plannedName)) log(`  · ${plannedName} exists`);
    else {
      const exam = await create(plannedName, type['Mid-Term'].id, await freeWindow(addDays(today, 14)), { description: 'Sample data: a planned examination with a published timetable.' });
      await call(`${O}/examinations/${exam.id}/schedule`, { method: 'POST' });
      await timetable(exam.id);
    }

    // 3. Draft: at the end of Term 1 (or six weeks ahead), classes and papers only.
    const draftName = 'End of Term – Term 1';
    if (has(draftName)) log(`  · ${draftName} exists`);
    else {
      const t1 = term['Term 1'];
      const from = t1 && addDays(t1.endDate, -9) > addDays(today, 21) ? addDays(t1.endDate, -9) : addDays(today, 42);
      await create(draftName, type['End of Term'].id, await freeWindow(from), { description: 'Sample data: a draft examination, not scheduled yet.' });
    }
  } finally {
    await api.close();
  }
}

/**
 * Attendance of every session, marks of every paper and section (approved), results approved and
 * published. Resumable: rooms with attendance, approved sheets and published results are left as they are.
 */
async function sitAndMark({ call, prisma }, examId, branches, rng, log) {
  const timetable = async (b) => {
    try {
      return await call(`${O}/examinations/${examId}/timetable`, { query: { branch: b.id } });
    } catch {
      return null;
    }
  };
  const statusOf = () => {
    const x = rng();
    return x < 0.9 ? 'present' : x < 0.94 ? 'late' : x < 0.97 ? 'absent' : 'excused';
  };
  let taken = 0;
  for (const b of branches) {
    const t = await timetable(b);
    for (const s of t?.sessions ?? []) {
      const seats = await call(`${O}/examinations/${examId}/timetable/sessions/${s.id}/seats`, { query: { branch: b.id } });
      for (const r of seats.rooms) {
        if (await prisma.examSeat.count({ where: { sessionId: s.id, roomId: r.room.id, attendance: { not: null } } })) continue;
        await call(`${O}/examinations/${examId}/sessions/${s.id}/attendance`, { method: 'PUT', body: { room: r.room.id, marks: r.seats.map((x) => ({ student: x.student.id, status: statusOf() })) } });
        taken += r.seats.length;
      }
    }
  }
  log(`    attendance: ${taken} seats`);

  const sheets = (await call(`${O}/examinations/${examId}/marks`)).items;
  let approved = sheets.filter((i) => i.status === 'approved').length;
  for (const item of sheets.filter((i) => i.status !== 'approved')) {
    const sheet = await call(`${O}/marks/${item.paper.id}/${item.section.id}`);
    if (!sheet.students.length || !sheet.actions.edit) continue;
    const max = sheet.paper.maxMarks;
    // Marks around 70% with a spread; a student absent on the day gets none (attendance decides).
    const marks = sheet.students.map((row) => {
      if (row.lockedByAttendance) return { student: row.student.id, marks: null, absent: false };
      const pct = Math.min(1, Math.max(0.15, 0.7 + (rng() + rng() + rng() - 1.5) * 0.45));
      return { student: row.student.id, marks: Math.round(pct * max * 2) / 2, absent: false };
    });
    await call(`${O}/marks/${item.paper.id}/${item.section.id}`, { method: 'PUT', body: { marks } });
    await call(`${O}/marks/${item.paper.id}/${item.section.id}/approve`, { method: 'POST' });
    approved += 1;
  }
  log(`    marks: ${approved} of ${sheets.length} sheets entered and approved`);

  const results = (await call(`${O}/examinations/${examId}/results`)).items;
  let published = results.filter((r) => r.status === 'published').length;
  for (const r of results.filter((x) => x.status !== 'published')) {
    try {
      if (r.status === 'draft') await call(`${O}/examinations/${examId}/results/${r.section.id}/approve`, { method: 'POST' });
      await call(`${O}/examinations/${examId}/results/${r.section.id}/publish`, { method: 'POST' });
      published += 1;
    } catch (e) {
      log(`    results ${r.section.name}: ${e.message}`);
    }
  }
  log(`    results: ${published} of ${results.length} sections approved and published`);
}
