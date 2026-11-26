/*
 * School seed, part 1 — the school's structure, people and history, written directly (one
 * transaction), added to what the school already has. Nothing that exists is changed or deleted,
 * except the branches' staff/student number counters.
 *
 *   years       the previous academic year (CLOSED) before the current one, with its sections,
 *               enrollments, results and the promotion into the current year;
 *   curricula   primary classes (Grade …) follow the Grade 1 curriculum, secondary classes (Form …)
 *               the Form 4 curriculum; only missing class subjects are added;
 *   sections    every class gets sections A and B in its home branch (primary: the first branch,
 *               secondary: the second); existing sections are kept; every section is filled to at
 *               least 40 students;
 *   people      assistant Managers (one per branch), subject teachers sized to the timetable load,
 *               support staff; all with the seed password (SEED_PASSWORD);
 *   teaching    subject and class teachers for both years (sections that already have subject
 *               teachers are left as they are);
 *   calendar    weekdays from the start of each year, holidays and closures of both years;
 *   times       bell times and staff schedules from the previous year's start (the latest existing
 *               version's times and shifts, so the existing versions keep applying from their dates);
 *   timetables  a conflict-free timetable per section from the current year's start;
 *   settings    student attendance settings (once a day; twice a day in the second branch).
 *
 * Staff check-ins of both years are part 1b (seedStaffAttendance), written in chunks.
 */
import { localDateTime, zonedInstant } from '../../src/common/zonedTime.js';
import { nameKey } from '../../src/features/branches/branchInput.js';
import { phoneKey } from '../../src/features/schools/schoolInput.js';
import { studentNameKey } from '../../src/features/students/studentInput.js';
import { addDays, AREAS, dbDate, FAMILY, FEMALE, insertMany, iso, MALE, newId, pad, rngFrom, weekday } from './util.js';

const DAY_ORDER = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'];
const SCHOOL_WEEK = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'];
// Weekly lessons for class subjects the seed adds (by subject name); others get 3.
const WEEKLY = { xisaab: 5, math: 5, carabi: 4, arabic: 3, som: 4, eng: 4, saynis: 4, tarbiyo: 4, 'far-qurxin': 2, islamic: 3, phy: 3, chem: 3, bio: 3, bus: 3, tech: 3, juq: 3, tariikh: 3 };
const weeklyOf = (name) => WEEKLY[name.trim().toLowerCase()] ?? 3;

/** Seed phone numbers: +252 62 77NNNNN (staff; the prefix marks seeded staff). */
const staffPhone = (n) => `+252 62 77${pad(n, 5)}`;
export const SEED_STAFF_PHONE_KEY = '+25262770';

export async function seedBase(prisma, ctx, log) {
  const { school, tz, today, now, passwordHash } = ctx;
  const at = (date, minute = 0) => zonedInstant(date, minute, tz);
  const rng = rngFrom(20260901);
  const { pick, between } = rng;

  const current = await prisma.academicYear.findFirst({ where: { schoolId: school.id, status: 'CURRENT' } });
  if (!current) throw new Error(`${school.name} has no current academic year.`);
  const cur = { id: current.id, name: current.name, start: iso(current.startDate), end: iso(current.endDate) };
  const y = Number(cur.start.slice(0, 4));
  const prevName = `${y - 1}/${y}`;
  const existingPrev = await prisma.academicYear.findFirst({ where: { schoolId: school.id, nameKey: nameKey(prevName) } });
  if (existingPrev && (await prisma.section.count({ where: { academicYearId: existingPrev.id } }))) {
    log(`Base: ${prevName} already has sections — the base data is there; nothing changed.`);
    return;
  }
  const prev = { id: existingPrev?.id ?? newId(), name: prevName, start: existingPrev ? iso(existingPrev.startDate) : `${y - 1}-09-01`, end: existingPrev ? iso(existingPrev.endDate) : `${y}-06-30` };

  const owner = await prisma.user.findUnique({ where: { id: school.ownerId } });
  const branches = await prisma.branch.findMany({ where: { schoolId: school.id, status: 'ACTIVE' }, orderBy: { number: 'asc' }, include: { locations: { where: { cancelledAt: null }, orderBy: { effectiveFrom: 'asc' } } } });
  if (!branches.length) throw new Error('The school has no active branch.');
  const primaryBranch = branches[0];
  const secondaryBranch = branches[1] ?? branches[0];
  const classes = await prisma.schoolClass.findMany({ where: { schoolId: school.id, status: 'ACTIVE' }, orderBy: { sequence: 'asc' } });
  const isPrimary = (c) => /^grade/i.test(c.name);
  const homeOf = (c) => (isPrimary(c) ? primaryBranch : secondaryBranch);
  const subjects = await prisma.subject.findMany({ where: { schoolId: school.id, status: 'ACTIVE' } });
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const classSubjects = await prisma.classSubject.findMany({ where: { schoolId: school.id } });

  const audit = [];
  const auditAs = (actor, action, target, description, occurredAt) =>
    audit.push({ id: newId(), occurredAt, action, result: 'SUCCESS', actorId: actor.id, actorName: actor.name, actorRole: actor.role, targetType: target.type, targetId: target.id ?? null, targetName: target.name ?? null, schoolId: school.id, description, ipAddress: '127.0.0.1', userAgent: 'EduTrack school seed' });

  // ---- curricula ----------------------------------------------------------------------------------
  const curriculumOf = (className) => {
    const c = classes.find((x) => x.name.toLowerCase() === className.toLowerCase());
    return c ? classSubjects.filter((cs) => cs.classId === c.id).map((cs) => cs.subjectId) : [];
  };
  const primaryTemplate = curriculumOf('Grade 1');
  const secondaryTemplate = curriculumOf('Form 4');
  if (!primaryTemplate.length || !secondaryTemplate.length) throw new Error('Grade 1 and Form 4 need a curriculum (the templates for primary and secondary classes).');
  const newClassSubjects = [];
  for (const c of classes) {
    const template = isPrimary(c) ? primaryTemplate : secondaryTemplate;
    for (const subjectId of template) {
      if (classSubjects.some((cs) => cs.classId === c.id && cs.subjectId === subjectId)) continue;
      newClassSubjects.push({ id: newId(), schoolId: school.id, classId: c.id, subjectId, weeklyLessons: weeklyOf(subjectById.get(subjectId).name) });
    }
  }
  const curriculum = new Map(classes.map((c) => [c.id, [...classSubjects.filter((cs) => cs.classId === c.id), ...newClassSubjects.filter((cs) => cs.classId === c.id)].filter((cs) => subjectById.has(cs.subjectId)).map((cs) => ({ subjectId: cs.subjectId, weekly: cs.weeklyLessons ?? weeklyOf(subjectById.get(cs.subjectId).name) }))]));

  // ---- sections ------------------------------------------------------------------------------------
  const existingSections = await prisma.section.findMany({ where: { academicYearId: cur.id } });
  const newSections = [];
  const sectionRow = (yearId, branch, cls, letter, createdOn) => ({ id: newId(), schoolId: school.id, branchId: branch.id, classId: cls.id, academicYearId: yearId, name: letter, nameKey: nameKey(letter), capacity: 50, room: `${branch.number === primaryBranch.number ? 'R' : `B${branch.number}-R`}${cls.sequence}${letter}`, createdAt: at(createdOn, 600) });
  for (const c of classes) {
    for (const letter of ['A', 'B']) {
      const home = homeOf(c);
      if (existingSections.some((s) => s.classId === c.id && s.branchId === home.id && s.nameKey === nameKey(letter))) continue;
      newSections.push(sectionRow(cur.id, home, c, letter, addDays(cur.start, -20)));
    }
  }
  const curSections = [...existingSections, ...newSections];
  // Last year: sections A and B of every class in its home branch.
  const prevSections = classes.flatMap((c) => ['A', 'B'].map((l) => sectionRow(prev.id, homeOf(c), c, l, addDays(prev.start, -20))));
  const classOf = new Map(classes.map((c) => [c.id, c]));
  const label = (s) => `${classOf.get(s.classId).name} ${s.name}${branches.length > 1 ? ` (${branches.find((b) => b.id === s.branchId).name})` : ''}`;

  // Sections that already have subject teachers are left to the school (no seeded teaching/timetable).
  const taught = await prisma.teachingAssignment.findMany({ where: { academicYearId: cur.id, cancelledAt: null }, select: { sectionId: true, role: true } });
  const frozen = new Set(taught.filter((t) => t.role === 'SUBJECT_TEACHER').map((t) => t.sectionId));
  const hasClassTeacher = new Set(taught.filter((t) => t.role === 'CLASS_TEACHER').map((t) => t.sectionId));

  // ---- bell times per branch (latest version) -----------------------------------------------------------
  const bells = await prisma.bellSchedule.findMany({ where: { schoolId: school.id, status: 'ACTIVE' }, include: { versions: { where: { cancelledAt: null }, orderBy: { effectiveFrom: 'asc' }, include: { periods: true } } }, orderBy: { createdAt: 'asc' } });
  const bellOf = (branch) => bells.find((b) => b.branchId === branch.id && b.versions.length) ?? bells.find((b) => !b.branchId && b.versions.length);
  const slotsOf = (branch) => {
    const bell = bellOf(branch);
    if (!bell) return [];
    const periods = bell.versions.at(-1).periods.filter((p) => p.kind === 'LESSON');
    return DAY_ORDER.flatMap((day) => periods.filter((p) => p.days.includes(day)).sort((a, b) => a.number - b.number).map((p) => ({ day, period: p.number })));
  };

  // ---- teachers: sized to the lessons of each branch and subject ------------------------------------------
  const staff = [];
  const staffSeq = Object.fromEntries(branches.map((b) => [b.id, b.staffSequence]));
  const usedNames = new Set((await prisma.user.findMany({ where: { branch: { schoolId: school.id } }, select: { name: true } })).map((u) => u.name));
  const personName = (gender) => {
    for (;;) {
      const name = `${pick(gender === 'F' ? FEMALE : MALE)} ${pick(MALE)} ${pick(FAMILY)}`;
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
    }
  };
  let phoneN = 0;
  const addStaff = (branch, jobTitle, joined) => {
    staffSeq[branch.id] += 1;
    phoneN += 1;
    const phone = staffPhone(phoneN);
    const person = { id: newId(), name: personName(rng() < 0.3 ? 'F' : 'M'), phone, phoneKey: phoneKey(phone), role: 'STAFF', status: 'ACTIVE', branchId: branch.id, staffId: `${branch.code}-ST${pad(staffSeq[branch.id], 3)}`, jobTitle, passwordHash, mustChangePassword: false, createdAt: at(joined, 540) };
    staff.push(person);
    return person;
  };
  const prevJoin = addDays(prev.start, -14);
  const curJoin = addDays(cur.start, -14);
  const prevCounterpart = (s) => prevSections.find((p) => p.classId === s.classId && p.branchId === s.branchId && p.nameKey === s.nameKey);

  const teacherOf = new Map(); // `${sectionId}|${subjectId}` → teacher
  const loads = new Map(); // teacher id → lessons a week
  for (const branch of branches) {
    const slots = slotsOf(branch).length || 30;
    const maxLoad = Math.min(24, Math.floor(slots * 0.72));
    const sections = curSections.filter((s) => s.branchId === branch.id && !frozen.has(s.id));
    const bySubject = new Map();
    for (const s of sections) for (const l of curriculum.get(s.classId)) bySubject.set(l.subjectId, [...(bySubject.get(l.subjectId) ?? []), { section: s, weekly: l.weekly }]);
    let first = true;
    for (const [subjectId, items] of bySubject) {
      const total = items.reduce((n, i) => n + i.weekly, 0);
      const count = Math.max(1, Math.ceil(total / maxLoad));
      const team = Array.from({ length: count }, () => {
        // Teachers of sections that exist only this year joined this year.
        const t = addStaff(branch, first ? 'Head Teacher' : 'Teacher', prevJoin);
        first = false;
        loads.set(t.id, 0);
        return t;
      });
      for (const item of items.sort((a, b) => b.weekly - a.weekly)) {
        const t = team.reduce((a, b) => (loads.get(a.id) <= loads.get(b.id) ? a : b));
        loads.set(t.id, loads.get(t.id) + item.weekly);
        teacherOf.set(`${item.section.id}|${subjectId}`, t);
      }
      for (const t of team) {
        const mine = items.filter((i) => teacherOf.get(`${i.section.id}|${subjectId}`) === t);
        if (mine.length && mine.every((i) => !prevCounterpart(i.section))) t.createdAt = at(curJoin, 540);
      }
    }
  }
  const teachers = [...staff];
  // Support staff and a deputy in every branch.
  const support = [];
  for (const branch of branches) {
    const deputy = teachers.find((t) => t.branchId === branch.id && t.jobTitle === 'Teacher');
    if (deputy) deputy.jobTitle = 'Deputy Head Teacher';
    for (const title of ['Secretary', 'Security Guard', 'Security Guard', 'Cleaner', 'Cleaner', ...(branch === secondaryBranch ? ['Librarian', 'Lab Technician'] : [])]) support.push(addStaff(branch, title, prevJoin));
  }
  // One cleaner moved from the first branch to the second in the middle of last year.
  const movedCleaner = branches.length > 1 ? support.find((s) => s.branchId === primaryBranch.id && s.jobTitle === 'Cleaner') : null;
  const moveDate = `${y}-02-01`;
  if (movedCleaner) movedCleaner.branchId = secondaryBranch.id;
  // One guard left the school at the end of last year (suspended account).
  const leftGuard = support.find((s) => s.branchId === primaryBranch.id && s.jobTitle === 'Security Guard');
  Object.assign(leftGuard, { status: 'SUSPENDED', suspendedAt: at(addDays(prev.end, 1), 600), suspensionReason: 'Left the school at the end of the year.' });

  // Assistant Managers (sign in with email and the seed password).
  const codeSlug = school.code.toLowerCase();
  const managers = branches.map((b, i) => ({ id: newId(), name: personName(i % 2 ? 'F' : 'M'), email: `deputy.b${b.number}@${codeSlug}.seed.example`, phone: `+252 61 98${pad(i + 1, 5)}`, role: 'MANAGER', status: 'ACTIVE', branchId: b.id, passwordHash, mustChangePassword: false, createdAt: at(prevJoin, 600) }));
  const takenEmails = await prisma.user.findMany({ where: { email: { in: managers.map((m) => m.email) } }, select: { email: true } });
  if (takenEmails.length) throw new Error(`Seed emails already in use: ${takenEmails.map((t) => t.email).join(', ')}`);
  const takenPhones = await prisma.user.findMany({ where: { role: 'STAFF', phoneKey: { in: staff.map((s) => s.phoneKey) } }, select: { phone: true } });
  if (takenPhones.length) throw new Error(`Seed staff phone numbers already in use: ${takenPhones.map((t) => t.phone).join(', ')}`);

  // ---- students ----------------------------------------------------------------------------------------------
  const existingEnrollments = await prisma.enrollment.findMany({ where: { academicYearId: cur.id } });
  const students = [];
  const enrollments = [];
  const studentSeq = Object.fromEntries(branches.map((b) => [b.id, b.studentSequence]));
  const addStudent = (branch, cls, registeredOn, ageAt, extra = {}) => {
    studentSeq[branch.id] += 1;
    const gender = rng() < 0.5 ? 'MALE' : 'FEMALE';
    const firstName = pick(gender === 'MALE' ? MALE : FEMALE);
    const middleName = pick(MALE);
    const lastName = pick(FAMILY);
    const birthYear = Number(registeredOn.slice(0, 4)) - ageAt;
    const s = {
      id: newId(),
      schoolId: school.id,
      branchId: branch.id,
      studentNumber: `${branch.code}-S${pad(studentSeq[branch.id], 4)}`,
      firstName,
      middleName,
      lastName,
      nameKey: studentNameKey({ firstName, middleName, lastName }),
      gender,
      dateOfBirth: dbDate(`${birthYear}-${pad(between(1, 12), 2)}-${pad(between(1, 28), 2)}`),
      address: `${pick(AREAS)}, Mogadishu`,
      guardianName: `${middleName} ${lastName}`,
      guardianPhone: `+252 61 5${pad(between(0, 999999), 6)}`,
      guardianRelationship: rng() < 0.8 ? 'Father' : 'Mother',
      emergencyContactName: `${pick(FEMALE)} ${pick(MALE)} ${lastName}`,
      emergencyContactPhone: `+252 61 6${pad(between(0, 999999), 6)}`,
      status: 'ENROLLED',
      registeredAt: at(registeredOn, 600),
      createdAt: at(registeredOn, 600),
      ...extra,
    };
    students.push(s);
    return s;
  };
  const enroll = (student, sec, yearStart, data) => {
    const e = { id: newId(), schoolId: school.id, branchId: sec.branchId, studentId: student.id, academicYearId: sec.academicYearId, sectionId: sec.id, status: 'ACTIVE', entry: 'NEW', enrolledAt: at(yearStart, 480), ...data };
    enrollments.push(e);
    return e;
  };
  const ageFor = (cls) => 5 + cls.sequence; // Grade 1 ≈ 6 years old

  // Last year: 42–46 students a section; results and decisions at the end of the year.
  const yearEnd = at(addDays(prev.end, 1), 420);
  const promotionByBranch = new Map(branches.map((b) => [b.id, []]));
  const carried = new Map(curSections.map((s) => [s.id, existingEnrollments.filter((e) => e.sectionId === s.id).length]));
  const lastSeq = classes.at(-1).sequence;
  for (const ps of prevSections) {
    const cls = classOf.get(ps.classId);
    const branch = branches.find((b) => b.id === ps.branchId);
    const n = between(42, 46);
    for (let i = 0; i < n; i++) {
      const student = addStudent(branch, cls, addDays(prev.start, -between(5, 40)), ageFor(cls));
      const r = rng();
      const final = cls.sequence === lastSeq;
      const decision = final ? (r < 0.95 ? 'GRADUATE' : 'REPEAT') : r < 0.92 ? 'PROMOTE' : r < 0.96 ? 'REPEAT' : 'TRANSFER_OUT';
      const result = decision === 'REPEAT' ? 'FAILED' : 'PASSED';
      const from = enroll(student, ps, prev.start, { status: { GRADUATE: 'GRADUATED', TRANSFER_OUT: 'TRANSFERRED_OUT' }[decision] ?? 'COMPLETED', result, endedAt: yearEnd });
      let target = null;
      let next = null;
      if (decision === 'PROMOTE' || decision === 'REPEAT') {
        const nextClass = decision === 'PROMOTE' ? classes.find((c) => c.sequence > cls.sequence) : cls;
        const home = homeOf(nextClass);
        target = curSections.find((s) => s.classId === nextClass.id && s.branchId === home.id && s.nameKey === ps.nameKey) ?? curSections.find((s) => s.classId === nextClass.id && s.branchId === home.id);
        next = enroll(student, target, cur.start, { entry: decision === 'PROMOTE' ? 'PROMOTED' : 'REPEATED', previousEnrollmentId: from.id });
        carried.set(target.id, carried.get(target.id) + 1);
        student.branchId = target.branchId; // Grade 8 → Form 1 moves to the secondary branch
      } else {
        Object.assign(student, { status: decision === 'GRADUATE' ? 'GRADUATED' : 'TRANSFERRED_OUT', statusReason: decision === 'GRADUATE' ? `Completed ${cls.name}.` : pick(['Family moved to Hargeisa.', 'Family moved to Kismaayo.', 'Moved to another school nearby.']), statusChangedAt: yearEnd });
      }
      promotionByBranch.get(ps.branchId).push({ id: newId(), studentId: student.id, fromEnrollmentId: from.id, fromSectionId: ps.id, recommendation: final ? 'GRADUATE' : result === 'PASSED' ? 'PROMOTE' : 'REPEAT', recommendationNote: final ? 'Final class' : result === 'PASSED' ? 'Passed' : 'Failed', decision, targetSectionId: target?.id ?? null, status: 'DONE', attempts: 1, resultEnrollmentId: next?.id ?? null });
    }
  }
  // This year: new students until every section has 41–46.
  for (const s of curSections) {
    const target = between(41, 46);
    const cls = classOf.get(s.classId);
    const branch = branches.find((b) => b.id === s.branchId);
    for (let n = carried.get(s.id); n < target; n++) enroll(addStudent(branch, cls, addDays(cur.start, -between(3, 25)), ageFor(cls)), s, cur.start, {});
  }
  // Three students left during this year; three are registered and waiting for a class.
  const leaving = enrollments.filter((e) => e.academicYearId === cur.id && e.entry === 'NEW').filter((_, i) => i % 97 === 5).slice(0, 3);
  for (const [i, e] of leaving.entries()) {
    const left = addDays(cur.start, 30 + i * 17);
    Object.assign(e, { status: 'TRANSFERRED_OUT', endedAt: at(left, 600) });
    Object.assign(students.find((s) => s.id === e.studentId), { status: 'TRANSFERRED_OUT', statusReason: 'Family moved away.', statusChangedAt: at(left, 600) });
  }
  for (const [i, cls] of [classes[0], classes[2], classes.at(-4)].entries()) addStudent(homeOf(cls), cls, addDays(today, -(i + 1)), ageFor(cls), { status: 'PENDING_ENROLLMENT' });

  // ---- teaching assignments ---------------------------------------------------------------------------------
  const teaching = [];
  const teach = (yearId, sec, teacher, role, subjectId, start, end) => teaching.push({ id: newId(), schoolId: school.id, academicYearId: yearId, sectionId: sec.id, branchId: sec.branchId, teacherId: teacher.id, role, subjectId: subjectId ?? null, startDate: dbDate(start), endDate: end ? dbDate(end) : null });
  const classTeacherUsed = new Set();
  for (const s of curSections.filter((x) => !frozen.has(x.id))) {
    const own = curriculum.get(s.classId).map((l) => ({ l, t: teacherOf.get(`${s.id}|${l.subjectId}`) })).filter((x) => x.t);
    const past = prevCounterpart(s);
    for (const { l, t } of own) {
      teach(cur.id, s, t, 'SUBJECT_TEACHER', l.subjectId, cur.start);
      if (past && t.createdAt <= at(prev.start)) teach(prev.id, past, t, 'SUBJECT_TEACHER', l.subjectId, prev.start, prev.end);
    }
    if (!hasClassTeacher.has(s.id)) {
      const ct = own.map((x) => x.t).find((t) => !classTeacherUsed.has(t.id));
      if (ct) {
        classTeacherUsed.add(ct.id);
        teach(cur.id, s, ct, 'CLASS_TEACHER', null, cur.start);
        if (past && ct.createdAt <= at(prev.start)) teach(prev.id, past, ct, 'CLASS_TEACHER', null, prev.start, prev.end);
      }
    }
  }

  // ---- timetables --------------------------------------------------------------------------------------------
  const timetable = new Map(); // sectionId → [{ day, period, subjectId, teacherId }]
  let unplaced = 0;
  for (const branch of branches) {
    const slots = slotsOf(branch);
    const sections = curSections.filter((s) => s.branchId === branch.id && !frozen.has(s.id));
    if (!slots.length || !sections.length) continue;
    const days = [...new Set(slots.map((s) => s.day))].length;
    const needs = sections.map((s) => ({ id: s.id, lessons: curriculum.get(s.classId).filter((l) => teacherOf.has(`${s.id}|${l.subjectId}`)).map((l) => ({ ...l, teacherId: teacherOf.get(`${s.id}|${l.subjectId}`).id })) }));
    let best = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      const remaining = new Map(needs.map((n) => [n.id, new Map(n.lessons.map((l) => [l.subjectId, l.weekly]))]));
      const placed = new Map(needs.map((n) => [n.id, []]));
      const perDay = new Map();
      for (const slot of slots) {
        const busy = new Set();
        for (const n of [...needs].sort(() => rng() - 0.5)) {
          const rem = remaining.get(n.id);
          const options = n.lessons
            .filter((l) => rem.get(l.subjectId) > 0 && !busy.has(l.teacherId) && (perDay.get(`${n.id}|${slot.day}|${l.subjectId}`) ?? 0) < (l.weekly > days ? 2 : 1))
            .map((l) => ({ l, w: rem.get(l.subjectId) + rng() * 1.5 }))
            .sort((a, b) => b.w - a.w);
          if (!options.length) continue;
          const l = options[0].l;
          busy.add(l.teacherId);
          rem.set(l.subjectId, rem.get(l.subjectId) - 1);
          const k = `${n.id}|${slot.day}|${l.subjectId}`;
          perDay.set(k, (perDay.get(k) ?? 0) + 1);
          placed.get(n.id).push({ day: slot.day, period: slot.period, subjectId: l.subjectId, teacherId: l.teacherId });
        }
      }
      const missing = [...remaining.values()].reduce((n, m) => n + [...m.values()].reduce((a, b) => a + b, 0), 0);
      if (!best || missing < best.missing) best = { missing, placed };
      if (missing === 0) break;
    }
    for (const [id, lessons] of best.placed) timetable.set(id, lessons);
    unplaced += best.missing;
  }

  // ---- write -------------------------------------------------------------------------------------------------
  const counts = {};
  await prisma.$transaction(
    async (tx) => {
      const createMany = async (model, data) => {
        if (!data.length) return;
        await insertMany(tx, model, data);
        counts[model] = (counts[model] ?? 0) + data.length;
      };

      // Years.
      if (!existingPrev) {
        await createMany('academicYear', [{ id: prev.id, schoolId: school.id, name: prev.name, nameKey: nameKey(prev.name), startDate: dbDate(prev.start), endDate: dbDate(prev.end), status: 'CLOSED', startedAt: at(prev.start, 420), closedAt: yearEnd, branchWeekdaysAllowed: true, createdAt: at(addDays(prev.start, -60), 600) }]);
        auditAs(owner, 'ACADEMIC_YEAR_STARTED', { type: 'academicYear', id: prev.id, name: prev.name }, `Academic year ${prev.name} started.`, at(prev.start, 420));
        auditAs(owner, 'ACADEMIC_YEAR_CLOSED', { type: 'academicYear', id: prev.id, name: prev.name }, `Academic year ${prev.name} closed.`, yearEnd);
      }
      await createMany('classSubject', newClassSubjects);
      await createMany('section', [...prevSections, ...newSections]);

      // People.
      await createMany('user', [...managers, ...staff]);
      await createMany('managerAssignment', managers.map((m) => ({ id: newId(), managerId: m.id, branchId: m.branchId, startedAt: m.createdAt })));
      for (const b of branches) await tx.branch.update({ where: { id: b.id }, data: { staffSequence: staffSeq[b.id], studentSequence: studentSeq[b.id] } });

      // Students, enrollments, promotion.
      await createMany('student', students);
      await createMany('enrollment', enrollments.filter((e) => !e.previousEnrollmentId));
      await createMany('enrollment', enrollments.filter((e) => e.previousEnrollmentId));
      for (const branch of branches) {
        const items = promotionByBranch.get(branch.id);
        if (!items.length) continue;
        const manager = managers.find((m) => m.branchId === branch.id);
        const done = at(addDays(cur.start, -6), 605);
        const batch = { id: newId(), schoolId: school.id, branchId: branch.id, fromYearId: prev.id, toYearId: cur.id, status: 'COMPLETED', createdById: manager.id, createdByName: manager.name, confirmedById: manager.id, confirmedByName: manager.name, confirmedAt: at(addDays(cur.start, -6), 600), completedAt: done, createdAt: at(addDays(cur.start, -8), 600) };
        await createMany('promotionBatch', [batch]);
        await createMany('promotionItem', items.map((i) => ({ ...i, batchId: batch.id, processedAt: done })));
        auditAs(manager, 'PROMOTION_PROCESSED', { type: 'promotion', id: batch.id, name: `${prev.name} → ${cur.name}` }, `Promotion of ${items.length} students processed.`, done);
      }

      // Teaching.
      await createMany('teachingAssignment', teaching);

      // Weekdays and calendar.
      const weekdayRows = await tx.academicWeekdays.findMany({ where: { academicYearId: { in: [prev.id, cur.id] }, branchId: null, cancelledAt: null } });
      const wd = [];
      if (!weekdayRows.some((w) => w.academicYearId === prev.id)) wd.push({ id: newId(), schoolId: school.id, academicYearId: prev.id, days: SCHOOL_WEEK, effectiveFrom: dbDate(prev.start) });
      const firstCur = weekdayRows.filter((w) => w.academicYearId === cur.id).sort((a, b) => a.effectiveFrom - b.effectiveFrom)[0];
      if (!firstCur || iso(firstCur.effectiveFrom) > cur.start) wd.push({ id: newId(), schoolId: school.id, academicYearId: cur.id, days: firstCur?.days ?? SCHOOL_WEEK, effectiveFrom: dbDate(cur.start) });
      await createMany('academicWeekdays', wd);
      const cal = (yearId, type, name, start, end, extra = {}) => ({ id: newId(), schoolId: school.id, academicYearId: yearId, type, name, startDate: dbDate(start), endDate: dbDate(end), ...extra });
      const entries = [
        cal(prev.id, 'HOLIDAY', 'Mawlid an-Nabi', `${y - 1}-09-04`, `${y - 1}-09-04`),
        cal(prev.id, 'HOLIDAY', 'Mid-year break', `${y}-01-10`, `${y}-01-17`),
        cal(prev.id, 'HOLIDAY', 'Eid al-Fitr', `${y}-03-19`, `${y}-03-23`, { note: 'End of Ramadan.' }),
        cal(prev.id, 'HOLIDAY', 'Eid al-Adha', `${y}-05-26`, `${y}-05-29`),
        cal(prev.id, 'HOLIDAY', 'Independence Day', `${y}-06-26`, `${y}-06-26`),
        cal(cur.id, 'CLOSURE', 'Closed: heavy rains', `${y}-10-14`, `${y}-10-15`, { branchId: secondaryBranch.id, note: 'Roads to the branch flooded.' }),
        cal(cur.id, 'HOLIDAY', 'Mid-year break', `${y + 1}-01-09`, `${y + 1}-01-16`, { allowBranchReopening: true }),
        cal(cur.id, 'HOLIDAY', 'Eid al-Fitr', `${y + 1}-03-09`, `${y + 1}-03-12`, { note: 'End of Ramadan.' }),
        cal(cur.id, 'HOLIDAY', 'Eid al-Adha', `${y + 1}-05-16`, `${y + 1}-05-19`),
        cal(cur.id, 'HOLIDAY', 'Independence Day', `${y + 1}-06-26`, `${y + 1}-06-26`),
        cal(cur.id, 'HOLIDAY', 'Independence Day', `${y + 1}-07-01`, `${y + 1}-07-01`),
      ].filter((e) => iso(e.endDate) <= (e.academicYearId === prev.id ? prev.end : cur.end));
      const existingCal = await tx.calendarEntry.findMany({ where: { schoolId: school.id, cancelledAt: null }, select: { type: true, startDate: true, endDate: true } });
      await createMany('calendarEntry', entries.filter((e) => !existingCal.some((x) => x.type === e.type && x.startDate <= e.endDate && x.endDate >= e.startDate)));

      // Bell times from last year's start (the latest times).
      const bellVersions = [];
      for (const b of bells.filter((x) => x.versions.length)) {
        if (iso(b.versions[0].effectiveFrom) <= prev.start) continue;
        const v = { id: newId(), bellScheduleId: b.id, effectiveFrom: dbDate(prev.start), recordedAt: at(addDays(prev.start, -10), 600) };
        bellVersions.push({ v, periods: b.versions.at(-1).periods.map(({ id, versionId, ...p }) => ({ ...p, id: newId(), versionId: v.id })) });
      }
      await createMany('bellScheduleVersion', bellVersions.map((x) => x.v));
      await createMany('bellPeriod', bellVersions.flatMap((x) => x.periods));

      // Branch locations and staff schedules from last year's start (the latest location and shifts).
      const locations = [];
      for (const b of branches) {
        const first = b.locations[0];
        const latest = b.locations.at(-1);
        if (latest && iso(first.effectiveFrom) > addDays(prev.start, -30)) locations.push({ id: newId(), branchId: b.id, latitude: latest.latitude, longitude: latest.longitude, accuracyMeters: latest.accuracyMeters, effectiveFrom: at(addDays(prev.start, -30), 600), recordedAt: at(addDays(prev.start, -30), 600) });
      }
      await createMany('branchLocation', locations);
      const schedules = await tx.branchSchedule.findMany({ where: { branchId: { in: branches.map((b) => b.id) }, cancelledAt: null }, include: { shifts: true }, orderBy: [{ effectiveFrom: 'asc' }, { effectiveAt: 'asc' }] });
      const morningKey = {};
      for (const b of branches) {
        const own = schedules.filter((s) => s.branchId === b.id);
        let latest = own.at(-1);
        if (!latest) {
          // A branch without a schedule gets one: a morning shift.
          latest = { id: newId(), branchId: b.id, effectiveFrom: dbDate(prev.start), effectiveAt: at(prev.start), timeZone: tz, checkOutEnabled: false, recordedAt: at(addDays(prev.start, -10), 600), shifts: [{ shiftKey: newId(), name: 'Morning shift', days: SCHOOL_WEEK, startMinute: 420, endMinute: 720, graceMinutes: 15, absenceCutoffMinutes: 60 }] };
          const { shifts, ...row } = latest;
          await createMany('branchSchedule', [row]);
          await createMany('branchShift', shifts.map((s) => ({ ...s, id: newId(), scheduleId: row.id })));
        } else if (iso(own[0].effectiveFrom) > prev.start) {
          const row = { id: newId(), branchId: b.id, effectiveFrom: dbDate(prev.start), effectiveAt: at(prev.start), timeZone: tz, checkOutEnabled: latest.checkOutEnabled, recordedAt: at(addDays(prev.start, -10), 600) };
          await createMany('branchSchedule', [row]);
          await createMany('branchShift', latest.shifts.map(({ id, scheduleId, ...s }) => ({ ...s, id: newId(), scheduleId: row.id })));
        }
        morningKey[b.id] = latest.shifts.reduce((a, s) => (s.startMinute < a.startMinute ? s : a)).shiftKey;
      }
      const workDays = (branch) => {
        const bellDays = new Set(slotsOf(branch).map((s) => s.day));
        return SCHOOL_WEEK.filter((d) => !bellDays.size || bellDays.has(d));
      };
      const assignments = [];
      const assign = (person, branchId, from, days) => assignments.push({ id: newId(), staffUserId: person.id, branchId, effectiveFrom: dbDate(from), effectiveAt: at(from), timeZone: tz, recordedAt: at(addDays(from, -5), 600), shifts: [{ shiftKey: morningKey[branchId], days }] });
      for (const person of staff) {
        const joined = localDateTime(person.createdAt, tz).date;
        const from = joined < prev.start ? prev.start : cur.start;
        const home = person === movedCleaner ? primaryBranch : branches.find((b) => b.id === person.branchId);
        const days = /Guard/.test(person.jobTitle) ? SCHOOL_WEEK : workDays(home);
        assign(person, home.id, from, days);
        if (person === movedCleaner) assign(person, secondaryBranch.id, moveDate, workDays(secondaryBranch));
      }
      await createMany('staffAssignment', assignments.map(({ shifts, ...a }) => a));
      await createMany('staffAssignmentShift', assignments.flatMap((a) => a.shifts.map((s) => ({ id: newId(), assignmentId: a.id, ...s }))));
      if (movedCleaner) {
        const to = assignments.find((a) => a.staffUserId === movedCleaner.id && a.branchId === secondaryBranch.id);
        await createMany('staffTransfer', [{ id: newId(), staffUserId: movedCleaner.id, schoolId: school.id, fromBranchId: primaryBranch.id, toBranchId: secondaryBranch.id, effectiveFrom: dbDate(moveDate), effectiveAt: at(moveDate), timeZone: tz, assignmentId: to.id, status: 'COMPLETED', requestedById: owner.id, createdAt: at(addDays(moveDate, -7), 600), completedAt: at(moveDate) }]);
        auditAs(owner, 'STAFF_TRANSFERRED', { type: 'staff', id: movedCleaner.id, name: movedCleaner.name }, `${movedCleaner.name} moved from ${primaryBranch.name} to ${secondaryBranch.name} on ${moveDate}.`, at(moveDate));
      }

      // Timetables from the current year's start.
      const versions = [];
      const slotRows = [];
      for (const s of curSections) {
        const bell = bellOf(branches.find((b) => b.id === s.branchId));
        if (!bell) continue;
        if (timetable.has(s.id)) {
          const v = { id: newId(), schoolId: school.id, academicYearId: cur.id, branchId: s.branchId, sectionId: s.id, bellScheduleId: bell.id, effectiveFrom: dbDate(cur.start), recordedAt: at(addDays(cur.start, -2), 660) };
          versions.push(v);
          for (const l of timetable.get(s.id)) slotRows.push({ id: newId(), versionId: v.id, weekday: l.day, periodNumber: l.period, subjectId: l.subjectId, teacherId: l.teacherId });
        } else {
          // A section the school set up itself: its own timetable also from the year's start.
          const own = await tx.timetableVersion.findMany({ where: { sectionId: s.id, cancelledAt: null }, include: { slots: true }, orderBy: { effectiveFrom: 'asc' } });
          if (!own.length || iso(own[0].effectiveFrom) <= cur.start) continue;
          const v = { id: newId(), schoolId: school.id, academicYearId: cur.id, branchId: s.branchId, sectionId: s.id, bellScheduleId: own[0].bellScheduleId, effectiveFrom: dbDate(cur.start), recordedAt: at(addDays(cur.start, -2), 660) };
          versions.push(v);
          for (const l of own.at(-1).slots) slotRows.push({ id: newId(), versionId: v.id, weekday: l.weekday, periodNumber: l.periodNumber, subjectId: l.subjectId, teacherId: l.teacherId, room: l.room });
        }
      }
      await createMany('timetableVersion', versions);
      await createMany('timetableSlot', slotRows);
      for (const b of branches) auditAs(managers.find((m) => m.branchId === b.id), 'TIMETABLE_PUBLISHED', { type: 'timetable', name: b.name }, `Timetables of ${b.name} published from ${cur.start}.`, at(addDays(cur.start, -2), 660));

      // Student attendance settings (only when the school has none).
      if (!(await tx.studentAttendanceSettings.count({ where: { schoolId: school.id } }))) {
        await createMany('studentAttendanceSettings', [
          { id: newId(), schoolId: school.id, halfDayFrequency: 'ONCE_DAILY', halfDayOpensBeforeMinutes: 15, halfDayDeadlineAfterMinutes: 60, lessonOpensBeforeMinutes: 5, lessonDeadlineAfterMinutes: 30, managerEditDays: 7, correctionReasonRequired: true, teacherCorrectionMinutes: 60, offlineGraceMinutes: 1440, teacherReminders: true, managerAlerts: true, branchOverridable: ['halfDayFrequency', 'managerEditDays'], updatedById: owner.id, updatedByName: owner.name },
          ...(branches.length > 1 ? [{ id: newId(), schoolId: school.id, branchId: secondaryBranch.id, halfDayFrequency: 'TWICE_DAILY', updatedById: managers[1].id, updatedByName: managers[1].name }] : []),
        ]);
      }
      if (!school.studentAttendanceEnabled) await tx.school.update({ where: { id: school.id }, data: { studentAttendanceEnabled: true } });

      auditAs(owner, 'STAFF_CREATED', { type: 'school', id: school.id, name: school.name }, `${staff.length} staff and ${managers.length} Managers added.`, at(prevJoin, 600));
      await createMany('auditEvent', audit);
    },
    { timeout: 600_000, maxWait: 30_000 },
  );

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  log(`Base: ${total} rows (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}).`);
  log(`  sections this year: ${curSections.length} (${curSections.map((s) => `${label(s)}`).join('; ')})`);
  log(`  timetables: ${timetable.size} sections, ${unplaced} weekly lessons did not fit (curricula longer than the bell times allow).`);
  log(`  frozen (school's own teaching kept): ${[...frozen].map((id) => label(curSections.find((s) => s.id === id))).join(', ') || 'none'}`);
}

/**
 * Part 1b — staff check-ins of seeded staff on their work days, from their assignment to yesterday,
 * skipping the summer and school holidays/closures. Resumable: staff who already have check-ins are skipped.
 */
export async function seedStaffAttendance(prisma, ctx, log) {
  const { school, tz, today } = ctx;
  const rng = rngFrom(20250901);
  const people = await prisma.user.findMany({ where: { role: 'STAFF', phoneKey: { startsWith: SEED_STAFF_PHONE_KEY }, branch: { schoolId: school.id } }, select: { id: true, name: true, suspendedAt: true } });
  if (!people.length) return log('Staff attendance: no seeded staff.');
  const done = new Set((await prisma.attendanceEvent.groupBy({ by: ['staffUserId'], where: { staffUserId: { in: people.map((p) => p.id) } } })).map((r) => r.staffUserId));
  const todo = people.filter((p) => !done.has(p.id));
  if (!todo.length) return log('Staff attendance: already there.');
  const assignments = await prisma.staffAssignment.findMany({ where: { staffUserId: { in: todo.map((p) => p.id) }, cancelledAt: null }, include: { shifts: true }, orderBy: { effectiveFrom: 'asc' } });
  const branchIds = [...new Set(assignments.map((a) => a.branchId))];
  const schedules = await prisma.branchSchedule.findMany({ where: { branchId: { in: branchIds }, cancelledAt: null }, include: { shifts: true }, orderBy: [{ effectiveAt: 'asc' }] });
  const locations = await prisma.branchLocation.findMany({ where: { branchId: { in: branchIds }, cancelledAt: null }, orderBy: { effectiveFrom: 'asc' } });
  const years = await prisma.academicYear.findMany({ where: { schoolId: school.id }, orderBy: { startDate: 'asc' } });
  const calendar = await prisma.calendarEntry.findMany({ where: { schoolId: school.id, cancelledAt: null, type: { in: ['HOLIDAY', 'CLOSURE'] } } });
  const suspensions = await prisma.suspensionPeriod.findMany({ where: { branchId: { in: branchIds } } });
  const inYear = (d) => years.some((y) => iso(y.startDate) <= d && d <= iso(y.endDate));
  const closed = (d, branchId) => calendar.some((c) => iso(c.startDate) <= d && d <= iso(c.endDate) && (!c.branchId || c.branchId === branchId));
  const start = iso(assignments[0].effectiveFrom);
  const rows = [];
  for (let d = start; d < today; d = addDays(d, 1)) {
    if (!inYear(d)) continue;
    const wd = weekday(d);
    for (const person of todo) {
      const a = assignments.filter((x) => x.staffUserId === person.id && iso(x.effectiveFrom) <= d).at(-1);
      if (!a || closed(d, a.branchId)) continue;
      if (person.suspendedAt && person.suspendedAt <= zonedInstant(d, 0, tz)) continue;
      const at0 = zonedInstant(d, 0, tz);
      if (suspensions.some((s) => s.branchId === a.branchId && s.startedAt <= at0 && (!s.endedAt || s.endedAt > at0))) continue;
      const schedule = schedules.filter((s) => s.branchId === a.branchId && s.effectiveAt <= zonedInstant(d, 1439, tz)).at(-1);
      if (!schedule) continue;
      for (const as of a.shifts) {
        if (!as.days.includes(wd)) continue;
        const shift = schedule.shifts.find((s) => s.shiftKey === as.shiftKey);
        if (!shift || !shift.days.includes(wd)) continue;
        if (rng() < 0.06) continue; // absent
        const late = rng() < 0.1;
        const occurredAt = zonedInstant(d, shift.startMinute + (late ? rng.between(shift.graceMinutes + 1, shift.graceMinutes + 30) : rng.between(-20, Math.min(8, shift.graceMinutes))), tz);
        const loc = locations.filter((l) => l.branchId === a.branchId && l.effectiveFrom <= occurredAt).at(-1) ?? locations.find((l) => l.branchId === a.branchId);
        if (!loc) continue;
        rows.push({ id: newId(), staffUserId: person.id, branchId: a.branchId, type: 'CHECK_IN', clientEventId: newId(), occurredAt, sentAt: new Date(occurredAt.getTime() + 2000), receivedAt: new Date(occurredAt.getTime() + 3000), workDate: dbDate(d), shiftKey: shift.shiftKey, scheduleId: schedule.id, assignmentId: a.id, locationId: loc.id, latitude: loc.latitude + (rng() - 0.5) * 0.0005, longitude: loc.longitude + (rng() - 0.5) * 0.0005, accuracyMeters: rng.between(5, 25), distanceMeters: rng.between(3, 60), status: late ? 'LATE' : 'PRESENT' });
      }
    }
  }
  await insertMany(prisma, 'attendanceEvent', rows, 3000);
  log(`Staff attendance: ${rows.length} check-ins for ${todo.length} staff (${start} to yesterday).`);
}
