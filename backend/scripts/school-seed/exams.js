/*
 * School seed, part 3 — Examinations of the current year, through the API as the School Owner (so
 * every rule applies):
 *
 *   configuration  terms 1–3, grading scales, examination types, the final-result formula, and an
 *                  examination room per section in every branch;
 *   completed      "Monthly Test – October" and "Monthly Test – November": scheduled and timetabled,
 *                  then moved back whole weeks into the past (the API schedules from today only);
 *                  attendance, marks (approved) and published results;
 *   planned        "Mid-Term – Term 1" in the coming weeks, timetabled and published;
 *   draft          "End of Term – Term 1".
 *
 * The only direct writes: the module switch and the dates of the completed examinations. Safe to
 * run again: what exists (by name) is kept; a completed examination left half done is finished.
 */
import { calendarToday } from '../../src/features/academic-calendar/calendar.service.js';
import { addDays, asDbDay } from '../../src/features/academic-calendar/schoolDays.js';
import { apiAs, iso, key, rngFrom } from './util.js';

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
export const EXAM_TYPES = [
  { name: 'Monthly Test', description: 'A short test of the month’s work.', defaultMaxMarks: 20, stopsLessons: false },
  { name: 'Mid-Term', description: 'Halfway through the term.', defaultMaxMarks: 30, stopsLessons: true },
  { name: 'End of Term', description: 'The main examination of the term.', defaultMaxMarks: 50, stopsLessons: true },
];

async function ensure(list, name, create, log, what) {
  const found = list.find((x) => key(x.name) === key(name));
  if (found) return found;
  const created = await create();
  log(`  + ${what} ${name}`);
  return created;
}

async function context(prisma, school) {
  const owner = await prisma.user.findUnique({ where: { id: school.ownerId } });
  const year = await prisma.academicYear.findFirst({ where: { schoolId: school.id, status: 'CURRENT' } });
  const call = await apiAs(owner, 'owner/exams');
  return { owner, year, call };
}

export async function seedExamConfig(prisma, { school }, log) {
  if (!school.examinationsEnabled) {
    await prisma.school.update({ where: { id: school.id }, data: { examinationsEnabled: true } });
    log('Examinations: switched on.');
  }
  const { year, call } = await context(prisma, school);
  log('Examinations: configuration');
  const yStart = iso(year.startDate);
  const yEnd = iso(year.endDate);
  const periods = (await call('/periods', { query: { academicYear: year.id } })).items;
  const y = Number(yStart.slice(0, 4));
  const terms = [
    ['Term 1', yStart, `${y + 1}-01-16`],
    ['Term 2', `${y + 1}-01-17`, `${y + 1}-04-15`],
    ['Term 3', `${y + 1}-04-16`, yEnd],
  ].filter(([, s, e]) => s <= e && e <= yEnd);
  for (const [name, startDate, endDate] of terms) {
    try {
      await ensure(periods, name, async () => (await call('/periods', { method: 'POST', body: { academicYear: year.id, name, startDate, endDate } })).period, log, 'period');
    } catch (e) {
      log(`  · period ${name} skipped: ${e.message}`);
    }
  }
  const scales = (await call('/grading-scales')).items;
  const letters = await ensure(scales, 'Letter grades', async () => (await call('/grading-scales', { method: 'POST', body: { name: 'Letter grades', isDefault: !scales.some((s) => s.isDefault), bands: LETTERS } })).scale, log, 'grading scale');
  await ensure(scales, 'Pass / Fail', async () => (await call('/grading-scales', { method: 'POST', body: { name: 'Pass / Fail', bands: PASS_FAIL } })).scale, log, 'grading scale');
  const typeList = (await call('/types')).items;
  const type = {};
  for (const t of EXAM_TYPES) type[t.name] = await ensure(typeList, t.name, async () => (await call('/types', { method: 'POST', body: { ...t, gradingScale: letters.id } })).type, log, 'examination type');
  const formula = await call('/formula', { query: { academicYear: year.id } });
  if (!formula.formula) {
    const active = (await call('/types', { query: { status: 'active' } })).items;
    const fixed = { [type['End of Term'].id]: 50, [type['Mid-Term'].id]: 30 };
    const others = active.filter((t) => !(t.id in fixed));
    const share = others.length ? Math.floor(20 / others.length) : 0;
    const typeWeights = [
      ...Object.entries(fixed).map(([examTypeId, weight]) => ({ examTypeId, weight: others.length ? weight : weight + 10 })),
      ...others.map((t, i) => ({ examTypeId: t.id, weight: i === others.length - 1 ? 20 - share * (others.length - 1) : share })),
    ];
    await call('/formula', { method: 'PUT', query: { academicYear: year.id }, body: { method: 'WEIGHTED', typeWeights } });
    log('  + result formula (weighted by type)');
  }
  // Rooms: one per section of the branch (classrooms), 45 seats.
  const branches = await prisma.branch.findMany({ where: { schoolId: school.id, status: 'ACTIVE' }, orderBy: { number: 'asc' } });
  const rooms = (await call('/rooms', { query: { status: 'active' } })).items;
  for (const b of branches) {
    const want = await prisma.section.count({ where: { academicYearId: year.id, branchId: b.id } });
    const own = rooms.filter((r) => r.branch?.id === b.id);
    let added = 0;
    for (let n = 1; own.length + added < want; n += 1) {
      const name = `B${b.number}-R${String(n).padStart(2, '0')}`;
      if (own.some((r) => key(r.name) === key(name))) continue;
      await call('/rooms', { method: 'POST', body: { name, defaultCapacity: 45, branch: b.id } });
      added += 1;
    }
    if (added) log(`  + ${added} rooms in ${b.name}`);
  }
}

export async function seedExamRuns(prisma, { school }, log) {
  const { year, call } = await context(prisma, school);
  const rng = rngFrom(20261125);
  const today = await calendarToday();
  const yStart = iso(year.startDate);
  const branches = await prisma.branch.findMany({ where: { schoolId: school.id, status: 'ACTIVE' }, orderBy: { number: 'asc' } });
  const type = Object.fromEntries((await call('/types')).items.map((t) => [t.name, t]));
  const periods = (await call('/periods', { query: { academicYear: year.id } })).items;
  const periodOf = (date) => periods.find((p) => p.startDate <= date && p.endDate >= date)?.id ?? null;
  const classes = (await call('/examinations/options', { query: { academicYear: year.id } })).classes.map((c) => c.id);
  const existing = (await call('/examinations', { query: { academicYear: year.id } })).items;
  const SPAN = 9; // days: papers of every class fit in every branch's school days

  async function freeWindow(from, days = SPAN + 1) {
    const scheduled = await prisma.examination.findMany({ where: { schoolId: school.id, status: 'SCHEDULED' }, select: { startDate: true, endDate: true } });
    let start = from;
    while (scheduled.some((e) => iso(e.startDate) <= addDays(start, days - 1) && iso(e.endDate) >= start)) start = addDays(start, 7);
    return { startDate: start, endDate: addDays(start, days - 1) };
  }
  async function create(name, examType, dates, extra = {}) {
    const { examination } = await call('/examinations', { method: 'POST', body: { academicYear: year.id, name, examType, ...dates, period: periodOf(dates.startDate), classes, ...extra } });
    log(`  + examination ${name} (${dates.startDate} to ${dates.endDate})`);
    return examination;
  }
  async function timetable(examId) {
    for (const b of branches) {
      const options = await call(`/examinations/${examId}/timetable/options`, { query: { branch: b.id } });
      if (!options.rooms.length || !options.students) continue;
      const d = options.defaults;
      const chosen = d.rooms.length ? d.rooms.map((r) => ({ room: r.roomId, ...(r.capacity && { capacity: r.capacity }) })) : options.rooms.map((r) => ({ room: r.id }));
      const body = { shifts: d.shifts, gapMinutes: d.gapMinutes, rooms: chosen, useAllRooms: false, excludedStaff: d.excludedStaff ?? [], distribution: d.distribution ?? 'alphabetical', maxPapersPerDay: 2 };
      const generated = await call(`/examinations/${examId}/timetable/generate`, { method: 'POST', query: { branch: b.id }, body });
      const r = generated.report ?? {};
      log(`    timetable ${b.name}: ${generated.sessions?.length ?? '?'} sessions${r.unplaced?.length ? `, ${r.unplaced.length} papers not placed` : ''}${r.shortfall ? `, ${r.shortfall} invigilators short` : ''}`);
      try {
        await call(`/examinations/${examId}/timetable/publish`, { method: 'POST', query: { branch: b.id } });
      } catch (e) {
        log(`    not published in ${b.name}: ${e.message}`);
      }
    }
  }

  /** A completed examination: scheduled ahead, then moved back whole weeks to start near `target`. */
  async function completed(name, examType, target) {
    const done = existing.find((e) => key(e.name) === key(name));
    if (done) {
      if (done.status === 'scheduled' && done.endDate < today) await sitAndMark(call, prisma, done.id, branches, rng, log);
      else log(`  · ${name} exists`);
      return;
    }
    const ahead = await freeWindow(addDays(today, 14));
    const exam = await create(name, examType, ahead, { stopsLessons: false, description: 'A completed examination with marks and published results.' });
    await call(`/examinations/${exam.id}/schedule`, { method: 'POST' });
    await timetable(exam.id);
    const back = Math.ceil((Date.parse(ahead.startDate) - Date.parse(target)) / 86_400_000 / 7) * 7;
    const startDate = addDays(ahead.startDate, -back);
    const endDate = addDays(ahead.endDate, -back);
    const others = await prisma.examination.findMany({ where: { schoolId: school.id, status: 'SCHEDULED', id: { not: exam.id } }, select: { startDate: true, endDate: true } });
    if (startDate < yStart || endDate >= today || others.some((e) => iso(e.startDate) <= endDate && iso(e.endDate) >= startDate)) {
      log(`    could not move ${name} into the past; it stays planned.`);
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.examination.update({ where: { id: exam.id }, data: { startDate: asDbDay(startDate), endDate: asDbDay(endDate), academicPeriodId: periodOf(startDate) } });
      const sessions = await tx.examSession.findMany({ where: { examinationId: exam.id }, select: { id: true, date: true } });
      for (const s of sessions) await tx.examSession.update({ where: { id: s.id }, data: { date: asDbDay(addDays(iso(s.date), -back)) } });
    });
    log(`    moved to ${startDate} to ${endDate}`);
    await sitAndMark(call, prisma, exam.id, branches, rng, log);
  }

  log('Examinations: examinations');
  const y = Number(yStart.slice(0, 4));
  await completed('Monthly Test – October', type['Monthly Test'].id, `${y}-10-24`);
  await completed('Monthly Test – November', type['Monthly Test'].id, `${y}-11-10`);
  const has = (name) => existing.some((e) => key(e.name) === key(name));
  if (has('Mid-Term – Term 1')) log('  · Mid-Term – Term 1 exists');
  else {
    const exam = await create('Mid-Term – Term 1', type['Mid-Term'].id, await freeWindow(addDays(today, 18)), { description: 'Planned, with a published timetable.' });
    await call(`/examinations/${exam.id}/schedule`, { method: 'POST' });
    await timetable(exam.id);
  }
  if (has('End of Term – Term 1')) log('  · End of Term – Term 1 exists');
  else await create('End of Term – Term 1', type['End of Term'].id, await freeWindow(addDays(today, 33)), { description: 'Draft: classes and papers, not scheduled yet.' });
}

/** Attendance of every room and session, marks of every paper and section (approved), results published. */
async function sitAndMark(call, prisma, examId, branches, rng, log) {
  const statusOf = () => {
    const x = rng();
    return x < 0.9 ? 'present' : x < 0.94 ? 'late' : x < 0.97 ? 'absent' : 'excused';
  };
  let taken = 0;
  for (const b of branches) {
    let t = null;
    try {
      t = await call(`/examinations/${examId}/timetable`, { query: { branch: b.id } });
    } catch {
      continue;
    }
    for (const s of t?.sessions ?? []) {
      const seats = await call(`/examinations/${examId}/timetable/sessions/${s.id}/seats`, { query: { branch: b.id } });
      for (const r of seats.rooms) {
        if (await prisma.examSeat.count({ where: { sessionId: s.id, roomId: r.room.id, attendance: { not: null } } })) continue;
        await call(`/examinations/${examId}/sessions/${s.id}/attendance`, { method: 'PUT', body: { room: r.room.id, marks: r.seats.map((x) => ({ student: x.student.id, status: statusOf() })) } });
        taken += r.seats.length;
      }
    }
  }
  log(`    attendance: ${taken} seats`);
  // A student's level stays about the same from paper to paper.
  const ability = new Map();
  const abilityOf = (id) => {
    if (!ability.has(id)) ability.set(id, Math.min(0.95, Math.max(0.3, 0.68 + (rng() + rng() + rng() - 1.5) * 0.35)));
    return ability.get(id);
  };
  const sheets = (await call(`/examinations/${examId}/marks`)).items;
  let approved = sheets.filter((i) => i.status === 'approved').length;
  for (const item of sheets.filter((i) => i.status !== 'approved')) {
    const sheet = await call(`/marks/${item.paper.id}/${item.section.id}`);
    if (!sheet.students.length || !sheet.actions.edit) continue;
    const max = sheet.paper.maxMarks;
    const marks = sheet.students.map((row) => {
      if (row.lockedByAttendance) return { student: row.student.id, marks: null, absent: false };
      const pct = Math.min(1, Math.max(0.1, abilityOf(row.student.id) + (rng() - 0.5) * 0.25));
      return { student: row.student.id, marks: Math.round(pct * max * 2) / 2, absent: false };
    });
    await call(`/marks/${item.paper.id}/${item.section.id}`, { method: 'PUT', body: { marks } });
    await call(`/marks/${item.paper.id}/${item.section.id}/approve`, { method: 'POST' });
    approved += 1;
  }
  log(`    marks: ${approved} of ${sheets.length} sheets approved`);
  const results = (await call(`/examinations/${examId}/results`)).items;
  let published = results.filter((r) => r.status === 'published').length;
  for (const r of results.filter((x) => x.status !== 'published')) {
    try {
      if (r.status === 'draft') await call(`/examinations/${examId}/results/${r.section.id}/approve`, { method: 'POST' });
      await call(`/examinations/${examId}/results/${r.section.id}/publish`, { method: 'POST' });
      published += 1;
    } catch (e) {
      log(`    results ${r.section.name}: ${e.message}`);
    }
  }
  log(`    results: ${published} of ${results.length} sections published`);
}
