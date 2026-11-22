/*
 * DEV BRANCH ONLY — fills the dev Owner's school (the demo school) with consistent sample data for
 * every part of the system, so every page and every table has something to show:
 *
 *   branches (a second one, with an ended suspension), Managers, staff with shifts and two weeks of
 *   check-ins and check-outs, staff transfers (one done, one scheduled), three academic years,
 *   classes, subjects and curricula, sections, students with last year's results and the promotion
 *   into this year, the academic calendar, bell schedules, a conflict-free published timetable (with
 *   its builder setup, draft, fixed lesson and teacher limits), teaching assignments, student
 *   attendance (Manager half days and teacher lessons, with corrections), excuses, notifications and
 *   their outbox, push devices and messages, announcements, backups and audit events.
 *
 * Dates are relative to today (platform time zone), so the data stays current whenever it is seeded.
 * Everything is written in one transaction. Does nothing when the school already has an academic year.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { localDateTime, zonedInstant, zonedMidnight } from '../../src/common/zonedTime.js';
import { hashPassword } from '../../src/features/auth/password.js';
import { nameKey } from '../../src/features/branches/branchInput.js';
import { phoneKey } from '../../src/features/schools/schoolInput.js';
import { studentNameKey } from '../../src/features/students/studentInput.js';
import { ADMIN_EMAIL, MANAGER_EMAIL, OWNER_EMAIL, STAFF_PHONE } from './accounts.js';

// ---- small helpers ------------------------------------------------------------------------------

const WEEKDAY_OF = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const SCHOOL_DAYS = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'];
const weekday = (date) => WEEKDAY_OF[new Date(`${date}T00:00:00Z`).getUTCDay()];
const dbDate = (date) => new Date(`${date}T00:00:00Z`);
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const pad = (n, size) => String(n).padStart(size, '0');
const hhmm = (minutes) => `${pad(Math.floor(minutes / 60), 2)}:${pad(minutes % 60, 2)}`;
const minutes = (n) => n * 60_000;

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

const MALE = ['Maxamed', 'Axmed', 'Cali', 'Xasan', 'Xuseen', 'Cabdi', 'Yuusuf', 'Ibraahim', 'Cumar', 'Mahad', 'Cabdiraxmaan', 'Cabdullaahi', 'Bashiir', 'Faarax', 'Liibaan', 'Saciid', 'Khaalid', 'Nuur'];
const FEMALE = ['Faadumo', 'Caasha', 'Maryan', 'Hodan', 'Sahra', 'Ifrax', 'Hibo', 'Nimco', 'Ayaan', 'Khadra', 'Ubax', 'Ilhaan', 'Deeqa', 'Sagal', 'Hamdi', 'Fardowsa', 'Muna', 'Xaliimo'];
const FAMILY = ['Warsame', 'Jaamac', 'Nuur', 'Aadan', 'Faarax', 'Cismaan', 'Yuusuf', 'Ciise', 'Muuse', 'Daahir', 'Guuleed', 'Shire', 'Samatar', 'Xirsi', 'Cilmi', 'Siciid', 'Barre', 'Gacal'];

const SUBJECTS = [
  { name: 'Mathematics', code: 'MATH', weekly: 6 },
  { name: 'English', code: 'ENG', weekly: 5 },
  { name: 'Somali', code: 'SOM', weekly: 5 },
  { name: 'Arabic', code: 'ARB', weekly: 4 },
  { name: 'Science', code: 'SCI', weekly: 5 },
  { name: 'Islamic Studies', code: 'ISL', weekly: 4 },
  { name: 'Social Studies', code: 'SOC', weekly: 4 },
  { name: 'Physical Education', code: 'PE', weekly: 3 },
]; // 36 lessons a week = 6 school days × 6 lesson periods
const CLASSES = ['Grade 5', 'Grade 6', 'Grade 7', 'Grade 8'];

// Main branch bell times: 6 lessons with the main break after lesson 3.
const MAIN_BELLS = [
  { kind: 'LESSON', number: 1, start: 450, end: 495 },
  { kind: 'LESSON', number: 2, start: 495, end: 540 },
  { kind: 'LESSON', number: 3, start: 540, end: 585 },
  { kind: 'BREAK', name: 'Break', start: 585, end: 615, mainBreak: true },
  { kind: 'LESSON', number: 4, start: 615, end: 660 },
  { kind: 'LESSON', number: 5, start: 660, end: 705 },
  { kind: 'LESSON', number: 6, start: 705, end: 750 },
];
const NORTH_BELLS = [
  { kind: 'LESSON', number: 1, start: 480, end: 525 },
  { kind: 'LESSON', number: 2, start: 525, end: 570 },
  { kind: 'LESSON', number: 3, start: 570, end: 615 },
  { kind: 'BREAK', name: 'Break', start: 615, end: 640, mainBreak: true },
  { kind: 'LESSON', number: 4, start: 640, end: 685 },
  { kind: 'LESSON', number: 5, start: 685, end: 730 },
];
const halfOfPeriod = (bells, number) => {
  const lesson = bells.find((b) => b.number === number);
  const brk = bells.find((b) => b.mainBreak);
  return lesson.start < brk.start ? 'BEFORE_BREAK' : 'AFTER_BREAK';
};
const halvesOf = (bells) => {
  const brk = bells.find((b) => b.mainBreak);
  const lessons = bells.filter((b) => b.kind === 'LESSON');
  const before = lessons.filter((l) => l.start < brk.start);
  const after = lessons.filter((l) => l.start > brk.start);
  return {
    BEFORE_BREAK: { start: before[0].start, end: before.at(-1).end },
    AFTER_BREAK: { start: after[0].start, end: after.at(-1).end },
    WHOLE_DAY: { start: lessons[0].start, end: lessons.at(-1).end },
  };
};

/**
 * A week of lessons for sections that share their teachers (one teacher per subject for the whole
 * group): in every period the group's sections have different subjects, each section gets every
 * subject's weekly lessons, and no subject more than twice a day. Greedy with restarts.
 */
function buildTimetable(sectionIds, subjects, slots, rng) {
  for (let attempt = 0; attempt < 20_000; attempt++) {
    const remaining = new Map(sectionIds.map((s) => [s, new Map(subjects.map((x) => [x.id, x.weekly]))]));
    const perDay = new Map();
    const lessons = new Map(sectionIds.map((s) => [s, []]));
    let ok = true;
    for (const slot of slots) {
      const used = new Set();
      const order = [...sectionIds].sort(() => rng() - 0.5);
      for (const sectionId of order) {
        const rem = remaining.get(sectionId);
        const options = subjects
          .filter((x) => rem.get(x.id) > 0 && !used.has(x.id) && (perDay.get(`${sectionId}|${slot.day}|${x.id}`) ?? 0) < 2)
          .map((x) => ({ x, weight: rem.get(x.id) + rng() * 0.9 }))
          .sort((a, b) => b.weight - a.weight);
        if (!options.length) {
          ok = false;
          break;
        }
        const pick = options[0].x;
        used.add(pick.id);
        rem.set(pick.id, rem.get(pick.id) - 1);
        const key = `${sectionId}|${slot.day}|${pick.id}`;
        perDay.set(key, (perDay.get(key) ?? 0) + 1);
        lessons.get(sectionId).push({ day: slot.day, period: slot.period, subjectId: pick.id });
      }
      if (!ok) break;
    }
    if (ok) return lessons;
  }
  throw new Error('Could not build a conflict-free sample timetable.');
}

// ---- the seed -----------------------------------------------------------------------------------

export async function seedDemoSchool(prisma, log = console.log) {
  const manager = await prisma.user.findUnique({ where: { email: MANAGER_EMAIL }, include: { branch: { include: { school: true, locations: true } } } });
  const owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!manager || !owner || !admin) throw new Error('Create the dev accounts first (seedAccounts).');
  const school = manager.branch.school;
  if (school.ownerId !== owner.id) throw new Error(`${OWNER_EMAIL} does not own the dev Manager's school (${school.name}).`);
  if (await prisma.user.count({ where: { role: 'STAFF', phoneKey: phoneKey(STAFF_PHONE) } })) {
    log(`Demo school ${school.name} already has its sample data (the demo teacher exists); nothing was changed.`);
    return;
  }

  const settings = await prisma.platformSettings.findUnique({ where: { id: 'platform' } });
  const tz = settings?.timezone ?? 'Africa/Mogadishu';
  const now = new Date();
  const today = localDateTime(now, tz).date;
  const at = (date, minute = 0) => zonedInstant(date, minute, tz);
  const rng = rngFrom(20261120);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const between = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const audit = [];
  const auditAs = (actor, action, target, description, occurredAt, extra = {}) =>
    audit.push({ id: randomUUID(), occurredAt, action, result: 'SUCCESS', actorId: actor.id, actorName: actor.name, actorRole: actor.role, targetType: target.type, targetId: target.id ?? null, targetName: target.name ?? null, schoolId: school.id, description, change: extra.change ?? undefined, ipAddress: '127.0.0.1', userAgent: 'EduTrack dev seed' });

  // Dates (all relative to today).
  const [year, month] = today.split('-').map(Number);
  const yStart = month >= 8 ? year : year - 1;
  const years = {
    prev: { name: `${yStart - 1}/${yStart}`, start: `${yStart - 1}-09-01`, end: `${yStart}-06-30` },
    current: { name: `${yStart}/${yStart + 1}`, start: `${yStart}-09-01`, end: `${yStart + 1}-06-30` },
    next: { name: `${yStart + 1}/${yStart + 2}`, start: `${yStart + 1}-09-01`, end: `${yStart + 2}-06-30` },
  };
  // Years the school already has (same name) are used as they are, with their own dates and status.
  const existingYears = await prisma.academicYear.findMany({ where: { schoolId: school.id } });
  const iso = (d) => d.toISOString().slice(0, 10);
  for (const y of Object.values(years)) {
    const found = existingYears.find((e) => e.nameKey === nameKey(y.name));
    if (found) Object.assign(y, { existing: found, start: iso(found.startDate), end: iso(found.endDate) });
  }
  if (years.prev.end >= years.current.start) years.prev.end = addDays(years.current.start, -1);
  if (years.next.start <= years.current.end) years.next.start = addDays(years.current.end, 1);
  const scheduleStart = addDays(today, -120);
  const suspension = { from: addDays(today, -160), to: addDays(today, -150) };
  const doneTransferDate = addDays(today, -30);
  const scheduledTransferDate = addDays(today, 14);

  const mainBranch = manager.branch;
  const mainLocation = mainBranch.locations.find((l) => !l.cancelledAt) ?? mainBranch.locations[0];

  const counts = {};
  await prisma.$transaction(
    async (tx) => {
      const createMany = async (model, data) => {
        if (!data.length) return;
        await tx[model].createMany({ data });
        counts[model] = (counts[model] ?? 0) + data.length;
      };

      // ---- school and branches ----------------------------------------------------------------
      await tx.school.update({
        where: { id: school.id },
        data: {
          studentAttendanceEnabled: true,
          phone: school.phone ?? '+252 61 5550100',
          address: school.address ?? 'Maka Al-Mukarama Road, Hodan',
          email: school.email ?? 'info@aflax.edutrack.example',
          website: school.website ?? 'https://aflax.edutrack.example',
        },
      });
      if (mainBranch.name !== 'Main Branch') await tx.branch.update({ where: { id: mainBranch.id }, data: { name: 'Main Branch', nameKey: nameKey('Main Branch') } });
      mainBranch.name = 'Main Branch';
      auditAs(admin, 'SCHOOL_FEATURES_UPDATED', { type: 'school', id: school.id, name: school.name }, 'Student Attendance turned on.', at(years.current.start, 420), { change: { field: 'studentAttendanceEnabled', from: false, to: true } });

      const [seqRow] = await tx.$queryRaw`
        UPDATE "School" SET "branchSequence" = "branchSequence" + 1
        WHERE "id" = ${school.id} RETURNING "branchSequence", "code"`;
      const northNumber = Number(seqRow.branchSequence);
      const north = {
        id: randomUUID(),
        schoolId: school.id,
        number: northNumber,
        code: `${seqRow.code}-B${pad(northNumber, 3)}`,
        name: 'North Branch',
        nameKey: nameKey('North Branch'),
        address: 'Wadada Afgooye, Kaaraan',
        city: 'Mogadishu',
        phone: '+252 61 5550200',
        status: 'ACTIVE',
        createdAt: at(addDays(today, -200), 540),
      };
      await createMany('branch', [north]);
      const northLocation = { id: randomUUID(), branchId: north.id, latitude: 2.0712, longitude: 45.3521, accuracyMeters: 8, effectiveFrom: north.createdAt, recordedAt: north.createdAt };
      await createMany('branchLocation', [northLocation]);
      auditAs(owner, 'BRANCH_CREATED', { type: 'branch', id: north.id, name: north.name }, `Branch ${north.name} (${north.code}) created.`, north.createdAt);

      // An ended suspension of the North Branch (before any of its attendance).
      const suspensionId = randomUUID();
      await createMany('suspensionPeriod', [{ id: suspensionId, branchId: north.id, startedAt: at(suspension.from, 600), endedAt: at(suspension.to, 600), reason: 'Building repairs after the rains.', startedById: owner.id, endedById: owner.id }]);

      // A second Manager for the North Branch (no password: cannot sign in).
      const northManager = { id: randomUUID(), name: 'Sahra Cali Jaamac', email: 'manager.north@edutrack.example', phone: '+252 61 0000003', role: 'MANAGER', status: 'ACTIVE', branchId: north.id, createdAt: north.createdAt };
      await createMany('user', [northManager]);
      await createMany('managerAssignment', [{ id: randomUUID(), managerId: northManager.id, branchId: north.id, startedAt: north.createdAt }]);

      // ---- staff ------------------------------------------------------------------------------
      const phoneKeys = [];
      const usedNames = new Set();
      const personName = () => {
        for (;;) {
          const name = `${pick(rng() < 0.5 ? MALE : FEMALE)} ${pick(MALE)} ${pick(FAMILY)}`;
          if (!usedNames.has(name)) {
            usedNames.add(name);
            return name;
          }
        }
      };
      const staff = [];
      const staffSeq = { [mainBranch.id]: mainBranch.staffSequence, [north.id]: 0 };
      const addStaff = (homeBranch, jobTitle, extra = {}) => {
        staffSeq[homeBranch.id] += 1;
        const n = staff.length + 1;
        const phone = extra.phone ?? `+252 61 70${pad(n, 5)}`;
        phoneKeys.push(phoneKey(phone));
        const person = {
          id: randomUUID(),
          name: extra.name ?? personName(),
          phone,
          phoneKey: phoneKey(phone),
          role: 'STAFF',
          status: 'ACTIVE',
          branchId: homeBranch.id,
          staffId: `${homeBranch.code}-ST${pad(staffSeq[homeBranch.id], 3)}`,
          jobTitle,
          createdAt: at(addDays(scheduleStart, -7), 540),
        };
        usedNames.add(person.name);
        staff.push(person);
        return person;
      };
      const demoTeacher = addStaff(mainBranch, 'Teacher', { name: 'Maxamed Cali Warsame', phone: STAFF_PHONE });
      demoTeacher.passwordHash = await hashPassword(process.env.DEV_STAFF_PASSWORD);
      demoTeacher.mustChangePassword = false;
      // Two teachers per subject in the Main Branch: group A teaches the A sections, group B the B sections.
      const teachersBySubject = SUBJECTS.map((s, i) => [i === 0 ? demoTeacher : addStaff(mainBranch, 'Teacher'), addStaff(mainBranch, i === 0 ? 'Head Teacher' : 'Teacher')]);
      const accountant = addStaff(mainBranch, 'Accountant');
      const secretary = addStaff(mainBranch, 'Secretary');
      const guard = addStaff(mainBranch, 'Security Guard'); // transfer to the North Branch scheduled
      const cleaner = addStaff(mainBranch, 'Cleaner'); // transferred to the North Branch 30 days ago
      const northTeachers = [addStaff(north, 'Teacher'), addStaff(north, 'Teacher'), addStaff(north, 'Deputy Head Teacher')];
      const northGuard = addStaff(north, 'Security Guard');

      const taken = await tx.user.findMany({ where: { role: 'STAFF', phoneKey: { in: phoneKeys } }, select: { phone: true } });
      if (taken.length) throw new Error(`Sample staff phone numbers already in use: ${taken.map((t) => t.phone).join(', ')}`);
      cleaner.branchId = north.id; // home branch after the completed transfer (the Staff ID keeps its origin)
      await createMany('user', staff);
      await tx.branch.update({ where: { id: mainBranch.id }, data: { staffSequence: staffSeq[mainBranch.id] } });
      await tx.branch.update({ where: { id: north.id }, data: { staffSequence: staffSeq[north.id] } });

      // ---- staff schedules, assignments and transfers ---------------------------------------------
      const shiftDefs = {
        mainMorning: { shiftKey: randomUUID(), name: 'Morning', days: SCHOOL_DAYS, startMinute: 420, endMinute: 780, graceMinutes: 10, absenceCutoffMinutes: 60 },
        mainAfternoon: { shiftKey: randomUUID(), name: 'Afternoon', days: ['SAT', 'SUN', 'MON', 'TUE', 'WED'], startMinute: 780, endMinute: 1020, graceMinutes: 10, absenceCutoffMinutes: 60 },
        northMorning: { shiftKey: randomUUID(), name: 'Morning', days: SCHOOL_DAYS, startMinute: 450, endMinute: 780, graceMinutes: 10, absenceCutoffMinutes: 60 },
      };
      const schedules = {
        [mainBranch.id]: { id: randomUUID(), branchId: mainBranch.id, shifts: [shiftDefs.mainMorning, shiftDefs.mainAfternoon], location: mainLocation },
        [north.id]: { id: randomUUID(), branchId: north.id, shifts: [shiftDefs.northMorning], location: northLocation },
      };
      await createMany(
        'branchSchedule',
        Object.values(schedules).map((s) => ({ id: s.id, branchId: s.branchId, effectiveFrom: dbDate(scheduleStart), effectiveAt: at(scheduleStart), timeZone: tz, checkOutEnabled: true, recordedAt: at(addDays(scheduleStart, -3), 600) })),
      );
      await createMany(
        'branchShift',
        Object.values(schedules).flatMap((s) => s.shifts.map((sh) => ({ id: randomUUID(), scheduleId: s.id, ...sh }))),
      );
      auditAs(manager, 'BRANCH_SCHEDULE_CHANGED', { type: 'branch', id: mainBranch.id, name: mainBranch.name }, `Schedule from ${scheduleStart}: Morning and Afternoon shifts.`, at(addDays(scheduleStart, -3), 600));

      const assignments = []; // { id, staffUserId, branchId, effectiveFrom, shifts: [{ shiftKey, days }] }
      const assign = (person, branchId, effectiveFrom, shifts) => {
        const a = { id: randomUUID(), staffUserId: person.id, branchId, effectiveFrom, shifts };
        assignments.push(a);
        return a;
      };
      const morning = { shiftKey: shiftDefs.mainMorning.shiftKey, days: SCHOOL_DAYS };
      const afternoon = { shiftKey: shiftDefs.mainAfternoon.shiftKey, days: shiftDefs.mainAfternoon.days };
      const northMorning = { shiftKey: shiftDefs.northMorning.shiftKey, days: SCHOOL_DAYS };
      for (const t of teachersBySubject.flat()) assign(t, mainBranch.id, scheduleStart, [morning]);
      assign(accountant, mainBranch.id, scheduleStart, [morning]);
      assign(secretary, mainBranch.id, scheduleStart, [{ ...morning, days: ['SAT', 'SUN', 'MON', 'TUE', 'WED'] }]);
      assign(guard, mainBranch.id, scheduleStart, [morning, afternoon]);
      assign(cleaner, mainBranch.id, scheduleStart, [afternoon]);
      const cleanerNorth = assign(cleaner, north.id, doneTransferDate, [northMorning]);
      const guardNorth = assign(guard, north.id, scheduledTransferDate, [northMorning]);
      for (const t of [...northTeachers, northGuard]) assign(t, north.id, scheduleStart, [northMorning]);
      await createMany(
        'staffAssignment',
        assignments.map((a) => ({ id: a.id, staffUserId: a.staffUserId, branchId: a.branchId, effectiveFrom: dbDate(a.effectiveFrom), effectiveAt: at(a.effectiveFrom), timeZone: tz, recordedAt: at(addDays(a.effectiveFrom, -5), 600) })),
      );
      await createMany(
        'staffAssignmentShift',
        assignments.flatMap((a) => a.shifts.map((s) => ({ id: randomUUID(), assignmentId: a.id, shiftKey: s.shiftKey, days: s.days }))),
      );

      const doneTransfer = { id: randomUUID(), staffUserId: cleaner.id, schoolId: school.id, fromBranchId: mainBranch.id, toBranchId: north.id, effectiveFrom: dbDate(doneTransferDate), effectiveAt: at(doneTransferDate), timeZone: tz, assignmentId: cleanerNorth.id, status: 'COMPLETED', requestedById: owner.id, createdAt: at(addDays(doneTransferDate, -5), 600), completedAt: at(doneTransferDate) };
      const scheduledTransfer = { id: randomUUID(), staffUserId: guard.id, schoolId: school.id, fromBranchId: mainBranch.id, toBranchId: north.id, effectiveFrom: dbDate(scheduledTransferDate), effectiveAt: at(scheduledTransferDate), timeZone: tz, assignmentId: guardNorth.id, status: 'SCHEDULED', requestedById: owner.id, createdAt: new Date(now.getTime() - minutes(90)) };
      await createMany('staffTransfer', [doneTransfer, scheduledTransfer]);
      auditAs(owner, 'STAFF_TRANSFERRED', { type: 'staff', id: cleaner.id, name: cleaner.name }, `${cleaner.name} moved from ${mainBranch.name} to ${north.name} on ${doneTransferDate}.`, doneTransfer.completedAt);
      auditAs(owner, 'STAFF_TRANSFER_SCHEDULED', { type: 'staff', id: guard.id, name: guard.name }, `${guard.name} moves from ${mainBranch.name} to ${north.name} on ${scheduledTransferDate}.`, scheduledTransfer.createdAt);

      // ---- staff attendance: the last 14 days -----------------------------------------------------
      const shiftByKey = new Map(Object.values(shiftDefs).map((s) => [s.shiftKey, s]));
      const events = [];
      const lateEvents = [];
      for (let back = 14; back >= 1; back--) {
        const date = addDays(today, -back);
        const wd = weekday(date);
        for (const person of staff) {
          const current = assignments
            .filter((a) => a.staffUserId === person.id && a.effectiveFrom <= date)
            .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
          if (!current) continue;
          const schedule = schedules[current.branchId];
          for (const assigned of current.shifts) {
            if (!assigned.days.includes(wd)) continue;
            if (rng() < 0.07) continue; // absent
            const shift = shiftByKey.get(assigned.shiftKey);
            const late = rng() < 0.12;
            const offset = late ? between(12, 35) : between(-15, 8);
            const occurredAt = at(date, shift.startMinute + offset);
            const where = () => ({ latitude: schedule.location.latitude + (rng() - 0.5) * 0.0006, longitude: schedule.location.longitude + (rng() - 0.5) * 0.0006, accuracyMeters: between(5, 25), distanceMeters: between(3, 60) });
            const checkIn = {
              id: randomUUID(),
              staffUserId: person.id,
              branchId: current.branchId,
              type: 'CHECK_IN',
              clientEventId: randomUUID(),
              occurredAt,
              sentAt: new Date(occurredAt.getTime() + 2000),
              receivedAt: new Date(occurredAt.getTime() + 3000),
              workDate: dbDate(date),
              shiftKey: shift.shiftKey,
              scheduleId: schedule.id,
              assignmentId: current.id,
              locationId: schedule.location.id,
              ...where(),
              status: late ? 'LATE' : 'PRESENT',
            };
            events.push(checkIn);
            if (late) lateEvents.push({ event: checkIn, person, shift, date });
            if (rng() < 0.95) {
              const out = at(date, shift.endMinute + between(0, 25));
              events.push({ ...checkIn, id: randomUUID(), type: 'CHECK_OUT', clientEventId: randomUUID(), occurredAt: out, sentAt: new Date(out.getTime() + 2000), receivedAt: new Date(out.getTime() + 3000), ...where(), status: null, checkInEventId: checkIn.id });
            }
          }
        }
      }
      // Check-ins first: check-outs point to them.
      await createMany('attendanceEvent', events.filter((e) => e.type === 'CHECK_IN'));
      await createMany('attendanceEvent', events.filter((e) => e.type === 'CHECK_OUT'));

      // ---- academic years, classes, subjects --------------------------------------------------------
      const yearRows = {
        prev: { id: randomUUID(), status: 'CLOSED', startedAt: at(years.prev.start, 420), closedAt: at(addDays(years.prev.end, 1), 420), branchWeekdaysAllowed: false },
        current: { id: randomUUID(), status: 'CURRENT', startedAt: at(years.current.start, 420), closedAt: null, branchWeekdaysAllowed: true },
        next: { id: randomUUID(), status: 'PLANNED', startedAt: null, closedAt: null, branchWeekdaysAllowed: false },
      };
      for (const [k, y] of Object.entries(yearRows)) {
        const found = years[k].existing;
        if (!found) continue;
        y.id = found.id;
        if (y.branchWeekdaysAllowed && !found.branchWeekdaysAllowed) await tx.academicYear.update({ where: { id: found.id }, data: { branchWeekdaysAllowed: true } });
      }
      await createMany(
        'academicYear',
        Object.entries(yearRows)
          .filter(([k]) => !years[k].existing)
          .map(([k, y]) => ({ ...y, schoolId: school.id, name: years[k].name, nameKey: nameKey(years[k].name), startDate: dbDate(years[k].start), endDate: dbDate(years[k].end), createdAt: at(addDays(years[k].start, -60), 600) })),
      );
      auditAs(owner, 'ACADEMIC_YEAR_STARTED', { type: 'academicYear', id: yearRows.current.id, name: years.current.name }, `Academic year ${years.current.name} started.`, yearRows.current.startedAt);
      auditAs(owner, 'ACADEMIC_YEAR_CLOSED', { type: 'academicYear', id: yearRows.prev.id, name: years.prev.name }, `Academic year ${years.prev.name} closed.`, yearRows.prev.closedAt);

      const classes = CLASSES.map((name, i) => ({ id: randomUUID(), schoolId: school.id, name, nameKey: nameKey(name), sequence: i + 1, description: `${name} (primary)`, createdAt: at(addDays(years.prev.start, -90), 600) }));
      await createMany('schoolClass', classes);

      const subjects = SUBJECTS.map((s) => ({ id: randomUUID(), schoolId: school.id, name: s.name, nameKey: nameKey(s.name), code: s.code, createdAt: at(addDays(years.prev.start, -90), 600), weekly: s.weekly }));
      const french = { id: randomUUID(), schoolId: school.id, name: 'French', nameKey: nameKey('French'), code: 'FRE', description: 'No longer taught.', status: 'INACTIVE', deactivatedAt: at(years.current.start, 420) };
      await createMany('subject', [...subjects.map(({ weekly, ...s }) => s), french]);
      await createMany(
        'classSubject',
        classes.flatMap((c) => subjects.map((s) => ({ id: randomUUID(), schoolId: school.id, classId: c.id, subjectId: s.id, weeklyLessons: s.weekly }))),
      );

      // ---- sections ---------------------------------------------------------------------------------
      const section = (yearKey, branch, cls, letter) => ({
        id: randomUUID(),
        schoolId: school.id,
        branchId: branch.id,
        classId: cls.id,
        academicYearId: yearRows[yearKey].id,
        name: letter,
        nameKey: nameKey(letter),
        capacity: 40,
        room: `${branch === north ? 'N' : 'R'}${cls.sequence}${letter}`,
        createdAt: at(addDays(years[yearKey].start, -20), 600),
        // not stored:
        label: `${cls.name}${letter}`,
        cls,
        letter,
        branch,
        yearKey,
      });
      const prevSections = classes.flatMap((c) => ['A', 'B'].map((l) => section('prev', mainBranch, c, l)));
      const mainSections = classes.flatMap((c) => ['A', 'B'].map((l) => section('current', mainBranch, c, l)));
      const northSections = classes.map((c) => section('current', north, c, 'A'));
      const allSections = [...prevSections, ...mainSections, ...northSections];
      await createMany(
        'section',
        allSections.map(({ label, cls, letter, branch, yearKey, ...s }) => s),
      );
      const sectionFor = (list, cls, letter) => list.find((s) => s.cls === cls && s.letter === letter);

      // ---- students, enrollments and last year's promotion -----------------------------------------
      const students = [];
      const enrollments = [];
      const studentSeq = { [mainBranch.id]: mainBranch.studentSequence, [north.id]: 0 };
      const addStudent = (branch, cls, registeredOn, extra = {}) => {
        studentSeq[branch.id] += 1;
        const gender = rng() < 0.5 ? 'MALE' : 'FEMALE';
        const firstName = pick(gender === 'MALE' ? MALE : FEMALE);
        const middleName = pick(MALE);
        const lastName = pick(FAMILY);
        const birthYear = Number(registeredOn.slice(0, 4)) - (10 + cls.sequence);
        const s = {
          id: randomUUID(),
          schoolId: school.id,
          branchId: branch.id,
          studentNumber: `${branch.code}-S${pad(studentSeq[branch.id], 4)}`,
          firstName,
          middleName,
          lastName,
          nameKey: studentNameKey({ firstName, middleName, lastName }),
          gender,
          dateOfBirth: dbDate(`${birthYear}-${pad(between(1, 12), 2)}-${pad(between(1, 28), 2)}`),
          address: pick(['Hodan', 'Wadajir', 'Kaaraan', 'Hawl Wadaag', 'Yaaqshiid']) + ', Mogadishu',
          guardianName: `${middleName} ${lastName}`,
          guardianPhone: `+252 61 8${pad(between(0, 999999), 6)}`,
          guardianRelationship: 'Father',
          emergencyContactName: `${pick(FEMALE)} ${pick(MALE)} ${lastName}`,
          emergencyContactPhone: `+252 61 9${pad(between(0, 999999), 6)}`,
          status: 'ENROLLED',
          registeredAt: at(registeredOn, 600),
          createdAt: at(registeredOn, 600),
          ...extra,
        };
        students.push(s);
        return s;
      };
      const enroll = (student, sec, data) => {
        const e = { id: randomUUID(), schoolId: school.id, branchId: sec.branchId, studentId: student.id, academicYearId: sec.academicYearId, sectionId: sec.id, status: 'ACTIVE', entry: 'NEW', enrolledAt: at(years[sec.yearKey].start, 480), ...data };
        enrollments.push(e);
        return e;
      };

      const batch = { id: randomUUID(), schoolId: school.id, branchId: mainBranch.id, fromYearId: yearRows.prev.id, toYearId: yearRows.current.id, status: 'COMPLETED', createdById: manager.id, createdByName: manager.name, confirmedById: manager.id, confirmedByName: manager.name, confirmedAt: at(addDays(years.current.start, -6), 600), completedAt: at(addDays(years.current.start, -6), 605), createdAt: at(addDays(years.current.start, -8), 600) };
      const items = [];
      const yearEnd = at(addDays(years.prev.end, 1), 420);
      for (const prevSec of prevSections) {
        const final = prevSec.cls.sequence === CLASSES.length;
        for (let i = 0; i < (final ? 3 : 5); i++) {
          const student = addStudent(mainBranch, prevSec.cls, addDays(years.prev.start, -between(5, 30)));
          let decision = final ? 'GRADUATE' : 'PROMOTE';
          if (!final && prevSec.cls.sequence === 2 && prevSec.letter === 'B' && i === 4) decision = 'REPEAT';
          if (!final && prevSec.cls.sequence === 1 && prevSec.letter === 'A' && i === 3) decision = 'TRANSFER_OUT';
          const result = decision === 'REPEAT' ? 'FAILED' : 'PASSED';
          const prevStatus = { GRADUATE: 'GRADUATED', TRANSFER_OUT: 'TRANSFERRED_OUT' }[decision] ?? 'COMPLETED';
          const from = enroll(student, prevSec, { status: prevStatus, result, endedAt: yearEnd });
          let target = null;
          let next = null;
          if (decision === 'PROMOTE' || decision === 'REPEAT') {
            const nextClass = decision === 'PROMOTE' ? classes[prevSec.cls.sequence] : prevSec.cls;
            target = sectionFor(mainSections, nextClass, prevSec.letter);
            next = enroll(student, target, { entry: decision === 'PROMOTE' ? 'PROMOTED' : 'REPEATED', previousEnrollmentId: from.id });
          } else {
            Object.assign(student, {
              status: decision === 'GRADUATE' ? 'GRADUATED' : 'TRANSFERRED_OUT',
              statusReason: decision === 'GRADUATE' ? 'Completed Grade 8.' : 'Family moved to Hargeisa.',
              statusChangedAt: batch.completedAt,
            });
          }
          items.push({
            id: randomUUID(),
            batchId: batch.id,
            studentId: student.id,
            fromEnrollmentId: from.id,
            fromSectionId: prevSec.id,
            recommendation: final ? 'GRADUATE' : result === 'PASSED' ? 'PROMOTE' : 'REPEAT',
            recommendationNote: final ? 'Final class' : result === 'PASSED' ? 'Passed' : 'Failed',
            decision,
            targetSectionId: target?.id ?? null,
            status: 'DONE',
            attempts: 1,
            resultEnrollmentId: next?.id ?? null,
            processedAt: batch.completedAt,
          });
        }
      }
      // New students this year: full first-year sections, one newcomer in every other section.
      for (const sec of mainSections) {
        const count = sec.cls.sequence === 1 ? 6 : 1;
        for (let i = 0; i < count; i++) enroll(addStudent(mainBranch, sec.cls, addDays(years.current.start, -between(3, 20))), sec, {});
      }
      for (const sec of northSections) {
        for (let i = 0; i < 5; i++) enroll(addStudent(north, sec.cls, addDays(years.current.start, -between(3, 20))), sec, {});
      }
      // Registered, not enrolled yet.
      addStudent(mainBranch, classes[0], addDays(today, -3), { status: 'PENDING_ENROLLMENT' });
      addStudent(mainBranch, classes[2], addDays(today, -1), { status: 'PENDING_ENROLLMENT' });

      await createMany('student', students);
      await createMany('enrollment', enrollments.filter((e) => !e.previousEnrollmentId));
      await createMany('enrollment', enrollments.filter((e) => e.previousEnrollmentId));
      await createMany('promotionBatch', [batch]);
      await createMany('promotionItem', items);
      await tx.branch.update({ where: { id: mainBranch.id }, data: { studentSequence: studentSeq[mainBranch.id] } });
      await tx.branch.update({ where: { id: north.id }, data: { studentSequence: studentSeq[north.id] } });
      auditAs(manager, 'PROMOTION_PROCESSED', { type: 'promotion', id: batch.id, name: `${years.prev.name} → ${years.current.name}` }, `Promotion of ${items.length} students processed.`, batch.completedAt);
      auditAs(manager, 'STUDENT_REGISTERED', { type: 'student', id: students.at(-1).id, name: `${students.at(-1).firstName} ${students.at(-1).lastName}` }, `Student ${students.at(-1).studentNumber} registered.`, students.at(-1).registeredAt);

      // ---- academic calendar ------------------------------------------------------------------------
      await createMany('academicWeekdays', [
        { id: randomUUID(), schoolId: school.id, academicYearId: yearRows.prev.id, days: SCHOOL_DAYS, effectiveFrom: dbDate(years.prev.start) },
        { id: randomUUID(), schoolId: school.id, academicYearId: yearRows.current.id, days: SCHOOL_DAYS, effectiveFrom: dbDate(years.current.start) },
        { id: randomUUID(), schoolId: school.id, academicYearId: yearRows.current.id, branchId: north.id, days: ['SAT', 'SUN', 'MON', 'TUE', 'WED'], effectiveFrom: dbDate(years.current.start) },
        { id: randomUUID(), schoolId: school.id, academicYearId: yearRows.next.id, days: SCHOOL_DAYS, effectiveFrom: dbDate(years.next.start) },
      ]);
      const founders = addDays(years.current.start, 44);
      const midYear = { id: randomUUID(), start: `${yStart + 1}-01-10`, end: `${yStart + 1}-01-17` };
      const closure = { start: addDays(today, 10), end: addDays(today, 11) };
      let makeUp = addDays(closure.end, 1);
      while (weekday(makeUp) !== 'FRI') makeUp = addDays(makeUp, 1);
      const calendar = [
        { type: 'HOLIDAY', name: "Founders' Day", startDate: founders, endDate: founders, note: 'No school for students or teachers.' },
        { id: midYear.id, type: 'HOLIDAY', name: 'Mid-year break', startDate: midYear.start, endDate: midYear.end, allowBranchReopening: true },
        { type: 'REOPENING', branchId: north.id, name: 'Exam revision days', startDate: addDays(midYear.start, 4), endDate: addDays(midYear.start, 5), holidayId: midYear.id },
        { type: 'CLOSURE', branchId: mainBranch.id, name: 'Closed: water maintenance', startDate: closure.start, endDate: closure.end },
        { type: 'SCHOOL_DAY', name: 'Make-up day', startDate: makeUp, endDate: makeUp, timetableDay: 'THU', note: 'Makes up for the closure.' },
      ].filter((e) => e.endDate <= years.current.end);
      const holidays = calendar.filter((e) => e.type === 'HOLIDAY' || e.type === 'CLOSURE');
      await createMany(
        'calendarEntry',
        calendar.map((e) => ({ id: e.id ?? randomUUID(), schoolId: school.id, academicYearId: yearRows.current.id, ...e, startDate: dbDate(e.startDate), endDate: dbDate(e.endDate) })),
      );
      auditAs(owner, 'CALENDAR_ENTRY_CREATED', { type: 'HOLIDAY', id: midYear.id, name: 'Mid-year break' }, `Holiday Mid-year break, ${midYear.start} to ${midYear.end}.`, at(years.current.start, 600));

      // ---- bell schedules ---------------------------------------------------------------------------
      const bellRows = (bells) => bells.map((b) => ({ kind: b.kind, number: b.number ?? null, name: b.name ?? null, days: SCHOOL_DAYS, startMinute: b.start, endMinute: b.end, mainBreak: Boolean(b.mainBreak) }));
      const schoolBell = { id: randomUUID(), schoolId: school.id, name: 'School Day', nameKey: nameKey('School Day'), description: 'Six lessons, break after the third.' };
      const northBell = { id: randomUUID(), schoolId: school.id, branchId: north.id, name: 'North Day', nameKey: nameKey('North Day'), description: 'Starts 30 minutes later.' };
      const ramadanBell = { id: randomUUID(), schoolId: school.id, name: 'Ramadan Hours', nameKey: nameKey('Ramadan Hours'), status: 'INACTIVE', deactivatedAt: at(years.prev.end, 600) };
      await createMany('bellSchedule', [schoolBell, northBell, ramadanBell]);
      const versions = [
        { id: randomUUID(), bellScheduleId: schoolBell.id, effectiveFrom: dbDate(years.prev.start), periods: bellRows(MAIN_BELLS) },
        { id: randomUUID(), bellScheduleId: northBell.id, effectiveFrom: dbDate(years.current.start), periods: bellRows(NORTH_BELLS) },
        { id: randomUUID(), bellScheduleId: ramadanBell.id, effectiveFrom: dbDate(years.prev.start), periods: bellRows(MAIN_BELLS.slice(0, 3).map((b) => ({ ...b, start: b.start + 30, end: b.end + 25 }))) },
      ];
      await createMany('bellScheduleVersion', versions.map(({ periods, ...v }) => v));
      await createMany('bellPeriod', versions.flatMap((v) => v.periods.map((p) => ({ id: randomUUID(), versionId: v.id, ...p }))));

      // ---- teaching assignments ---------------------------------------------------------------------
      const teaching = [];
      const teacherOf = new Map(); // `${sectionId}|${subjectId}` → teacher
      for (const sec of mainSections) {
        const group = sec.letter === 'A' ? 0 : 1;
        subjects.forEach((subject, k) => {
          const teacher = teachersBySubject[k][group];
          teacherOf.set(`${sec.id}|${subject.id}`, teacher);
          teaching.push({ sectionId: sec.id, branchId: mainBranch.id, teacherId: teacher.id, role: 'SUBJECT_TEACHER', subjectId: subject.id });
        });
      }
      const classTeachers = teachersBySubject.flat();
      mainSections.forEach((sec, i) => teaching.push({ sectionId: sec.id, branchId: mainBranch.id, teacherId: classTeachers[i].id, role: 'CLASS_TEACHER' }));
      northSections.forEach((sec, i) => {
        teaching.push({ sectionId: sec.id, branchId: north.id, teacherId: northTeachers[i % northTeachers.length].id, role: 'CLASS_TEACHER' });
        // A Main Branch teacher also teaches English in the North Branch (teaching across branches).
        teaching.push({ sectionId: sec.id, branchId: north.id, teacherId: teachersBySubject[1][1].id, role: 'SUBJECT_TEACHER', subjectId: subjects[1].id });
        subjects.filter((_, k) => k !== 1).forEach((subject, k) => teaching.push({ sectionId: sec.id, branchId: north.id, teacherId: northTeachers[k % northTeachers.length].id, role: 'SUBJECT_TEACHER', subjectId: subject.id }));
      });
      const cancelledTeaching = { sectionId: northSections[0].id, branchId: north.id, teacherId: northTeachers[1].id, role: 'CLASS_TEACHER', startDate: dbDate(addDays(today, 20)), cancelledAt: new Date(now.getTime() - minutes(30)) };
      await createMany('teachingAssignment', [
        ...teaching.map((t) => ({ id: randomUUID(), schoolId: school.id, academicYearId: yearRows.current.id, startDate: dbDate(years.current.start), subjectId: null, ...t })),
        { id: randomUUID(), schoolId: school.id, academicYearId: yearRows.current.id, subjectId: null, ...cancelledTeaching },
      ]);
      auditAs(owner, 'TEACHING_ASSIGNED', { type: 'teaching', name: `${demoTeacher.name}: Mathematics` }, `${demoTeacher.name}: Mathematics in the A sections from ${years.current.start}.`, at(addDays(years.current.start, -3), 600));

      // ---- timetables (published through the builder) ------------------------------------------------
      const slots = SCHOOL_DAYS.flatMap((day) => [1, 2, 3, 4, 5, 6].map((period) => ({ day, period })));
      const lessonsBySection = new Map();
      for (const letter of ['A', 'B']) {
        const group = mainSections.filter((s) => s.letter === letter);
        for (const [sectionId, lessons] of buildTimetable(group.map((s) => s.id), subjects, slots, rng)) lessonsBySection.set(sectionId, lessons);
      }
      const timetableVersions = [
        ...mainSections.map((sec) => ({ id: randomUUID(), sectionId: sec.id, branchId: mainBranch.id, bellScheduleId: schoolBell.id, sec })),
        ...northSections.map((sec) => ({ id: randomUUID(), sectionId: sec.id, branchId: north.id, bellScheduleId: northBell.id, sec })),
      ];
      const publishedAt = at(addDays(years.current.start, -2), 660);
      await createMany(
        'timetableVersion',
        timetableVersions.map(({ sec, ...v }) => ({ ...v, schoolId: school.id, academicYearId: yearRows.current.id, effectiveFrom: dbDate(years.current.start), recordedAt: publishedAt })),
      );
      const timetableSlots = timetableVersions
        .filter((v) => lessonsBySection.has(v.sectionId))
        .flatMap((v) => lessonsBySection.get(v.sectionId).map((l) => ({ id: randomUUID(), versionId: v.id, weekday: l.day, periodNumber: l.period, subjectId: l.subjectId, teacherId: teacherOf.get(`${v.sectionId}|${l.subjectId}`).id })));
      await createMany('timetableSlot', timetableSlots);

      const setup = { id: randomUUID(), schoolId: school.id, academicYearId: yearRows.current.id, branchId: mainBranch.id, defaultBellScheduleId: schoolBell.id, fillAllPeriods: true, maxSubjectPerDay: 2, allowDoubleLessons: true, spreadSubjects: true, avoidTeacherGaps: true, teacherMaxPerDay: 6, morningSubjectIds: [subjects[0].id], searchSeconds: 10, createdAt: at(addDays(years.current.start, -4), 600) };
      await createMany('timetableSetup', [setup]);
      const firstSection = mainSections[0];
      const fixedLesson = lessonsBySection.get(firstSection.id).find((l) => l.day === 'SAT' && l.period === 1);
      await createMany('timetableFixedLesson', [{ id: randomUUID(), setupId: setup.id, sectionId: firstSection.id, weekday: 'SAT', periodNumber: 1, subjectId: fixedLesson.subjectId, teacherId: teacherOf.get(`${firstSection.id}|${fixedLesson.subjectId}`).id }]);

      // Teacher limits that the published timetable meets.
      const demoLessons = timetableSlots.filter((s) => s.teacherId === demoTeacher.id);
      const perDayMax = Math.max(...SCHOOL_DAYS.map((d) => demoLessons.filter((s) => s.weekday === d).length));
      const freeThu = [1, 2, 3, 4, 5, 6].filter((p) => !demoLessons.some((s) => s.weekday === 'THU' && s.periodNumber === p));
      const freeBell = MAIN_BELLS.find((b) => b.number === freeThu.at(-1));
      await createMany('teacherTimetableProfile', [
        { id: randomUUID(), schoolId: school.id, academicYearId: yearRows.current.id, teacherId: demoTeacher.id, maxPerDay: Math.max(perDayMax, 1), maxPerWeek: demoLessons.length, unavailable: freeBell ? [{ weekday: 'THU', startMinute: freeBell.start, endMinute: freeBell.end }] : [] },
        { id: randomUUID(), schoolId: school.id, academicYearId: yearRows.current.id, teacherId: teachersBySubject[1][0].id, maxPerDay: null, maxPerWeek: 30, unavailable: [] },
      ]);

      const planDays = (bells) => Object.fromEntries(SCHOOL_DAYS.map((d) => [d, bells.filter((b) => b.kind === 'LESSON').map((b) => ({ half: halfOfPeriod(bells, b.number).toLowerCase(), number: b.number, endMinute: b.end, startMinute: b.start }))]));
      const draft = {
        id: randomUUID(),
        schoolId: school.id,
        academicYearId: yearRows.current.id,
        branchId: mainBranch.id,
        setupId: setup.id,
        status: 'PUBLISHED',
        planDate: dbDate(years.current.start),
        sections: mainSections.map((s) => ({ days: planDays(MAIN_BELLS), name: s.label, bellName: schoolBell.name, sectionId: s.id, bellScheduleId: schoolBell.id })),
        seed: 20261120,
        revision: 1,
        report: {
          rules: { searchSeconds: 10, spreadSubjects: true, avoidTeacherGaps: true, maxSubjectPerDay: 2, teacherMaxPerDay: 6, morningSubjectIds: [subjects[0].id], allowDoubleLessons: true },
          score: { holes: 0, total: 0, spread: 0, morning: 0, teachers: 0 },
          stats: { ms: 0, placed: timetableSlots.length, required: timetableSlots.length, repairIterations: 0, improveIterations: 0 },
          edited: false,
          problems: [],
          unplaced: [],
          warnings: [],
        },
        createdById: manager.id,
        createdAt: at(addDays(years.current.start, -3), 600),
        publishedAt,
        publishedById: manager.id,
        publishedFrom: dbDate(years.current.start),
      };
      await createMany('timetableDraft', [draft]);
      const sectionOfVersion = new Map(timetableVersions.map((v) => [v.id, v.sectionId]));
      await createMany(
        'timetableDraftLesson',
        timetableSlots.map((s) => {
          const fixed = sectionOfVersion.get(s.versionId) === firstSection.id && s.weekday === 'SAT' && s.periodNumber === 1;
          return { id: randomUUID(), draftId: draft.id, sectionId: sectionOfVersion.get(s.versionId), weekday: s.weekday, periodNumber: s.periodNumber, subjectId: s.subjectId, teacherId: s.teacherId, locked: fixed, fixed };
        }),
      );
      auditAs(manager, 'TIMETABLE_PUBLISHED', { type: 'timetable', id: draft.id, name: mainBranch.name }, `Timetables of ${mainSections.length} sections published from ${years.current.start}.`, publishedAt);

      // ---- student attendance -----------------------------------------------------------------------
      const saSettings = { halfDayOpensBeforeMinutes: 15, halfDayDeadlineAfterMinutes: 60, lessonOpensBeforeMinutes: 5, lessonDeadlineAfterMinutes: 30 };
      await createMany('studentAttendanceSettings', [
        { id: randomUUID(), schoolId: school.id, halfDayFrequency: 'TWICE_DAILY', ...saSettings, managerEditDays: 7, correctionReasonRequired: true, teacherCorrectionMinutes: 60, offlineGraceMinutes: 1440, teacherReminders: true, managerAlerts: true, branchOverridable: ['halfDayFrequency', 'managerEditDays'], updatedById: owner.id, updatedByName: owner.name },
        { id: randomUUID(), schoolId: school.id, branchId: north.id, halfDayFrequency: 'ONCE_DAILY', updatedById: northManager.id, updatedByName: northManager.name },
      ]);
      auditAs(owner, 'STUDENT_ATTENDANCE_SETTINGS_CHANGED', { type: 'school', id: school.id, name: school.name }, 'Student attendance: twice a day; Managers may change the frequency and correction days.', at(years.current.start, 450));

      const isClosed = (date, branchId) => holidays.some((h) => h.startDate <= date && date <= h.endDate && (!h.branchId || h.branchId === branchId));
      const recentSchoolDays = (branchId, days, count) => {
        const result = [];
        for (let d = addDays(today, -1); result.length < count && d >= years.current.start; d = addDays(d, -1)) {
          if (days.includes(weekday(d)) && !isClosed(d, branchId)) result.push(d);
        }
        return result.reverse();
      };
      const activeEnrollments = (sectionId) => enrollments.filter((e) => e.sectionId === sectionId && e.status === 'ACTIVE');
      const sessions = [];
      const entries = [];
      const changes = [];
      const mark = (session, enrollment, actor, actorRole, source, occurredAt, forceStatus) => {
        const r = rng();
        const status = forceStatus ?? (r < 0.86 ? 'PRESENT' : r < 0.93 ? 'ABSENT' : r < 0.98 ? 'LATE' : 'EXCUSED');
        const reason = status === 'EXCUSED' ? 'Medical appointment (note from guardian).' : null;
        const entry = { id: randomUUID(), sessionId: session.id, schoolId: school.id, branchId: session.branchId, studentId: enrollment.studentId, enrollmentId: enrollment.id, addedAt: session.openedAt, status, reason, markedAt: occurredAt, markedById: actor.id, markedByName: actor.name, markedByRole: actorRole, occurredAt, syncedAt: source === 'MOBILE' ? new Date(occurredAt.getTime() + 30_000) : occurredAt, source, version: 1 };
        changes.push({ id: randomUUID(), entryId: entry.id, sessionId: session.id, studentId: enrollment.studentId, fromStatus: null, toStatus: status, reason, actorId: actor.id, actorName: actor.name, actorRole, source, occurredAt, recordedAt: entry.syncedAt });
        // Now and then a Manager corrects an absence to late within the deadline.
        if (status === 'ABSENT' && actorRole === 'MANAGER' && rng() < 0.4) {
          const later = new Date(occurredAt.getTime() + minutes(25));
          Object.assign(entry, { status: 'LATE', markedAt: later, occurredAt: later, syncedAt: later, version: 2, note: 'Arrived after the roll call.' });
          changes.push({ id: randomUUID(), entryId: entry.id, sessionId: session.id, studentId: enrollment.studentId, fromStatus: 'ABSENT', toStatus: 'LATE', note: entry.note, actorId: actor.id, actorName: actor.name, actorRole, source, occurredAt: later, recordedAt: later });
        }
        entries.push(entry);
      };

      // Manager half days: Main Branch twice a day (last 5 school days), North Branch once a day (last 3).
      const mainHalves = halvesOf(MAIN_BELLS);
      const mainDays = recentSchoolDays(mainBranch.id, SCHOOL_DAYS, 5);
      mainDays.forEach((date, dayIndex) => {
        for (const sec of mainSections) {
          for (const half of ['BEFORE_BREAK', 'AFTER_BREAK']) {
            // The latest day is left incomplete: one section's second half was not taken.
            if (dayIndex === mainDays.length - 1 && half === 'AFTER_BREAK' && sec === mainSections.at(-1)) continue;
            const { start, end } = mainHalves[half];
            const startsAt = at(date, start);
            const endsAt = at(date, end);
            const session = { id: randomUUID(), schoolId: school.id, branchId: mainBranch.id, academicYearId: yearRows.current.id, sectionId: sec.id, kind: 'HALF_DAY', date: dbDate(date), half, timetableDay: weekday(date), startsAt, endsAt, opensAt: new Date(startsAt.getTime() - minutes(saSettings.halfDayOpensBeforeMinutes)), deadlineAt: new Date(endsAt.getTime() + minutes(saSettings.halfDayDeadlineAfterMinutes)), openedAt: new Date(startsAt.getTime() + minutes(5)), openedById: manager.id, openedByName: manager.name };
            sessions.push(session);
            for (const e of activeEnrollments(sec.id)) mark(session, e, manager, 'MANAGER', 'WEB', new Date(session.openedAt.getTime() + minutes(3)));
          }
        }
      });
      const northWhole = halvesOf(NORTH_BELLS).WHOLE_DAY;
      for (const date of recentSchoolDays(north.id, ['SAT', 'SUN', 'MON', 'TUE', 'WED'], 3)) {
        for (const sec of northSections) {
          const startsAt = at(date, northWhole.start);
          const endsAt = at(date, northWhole.end);
          const session = { id: randomUUID(), schoolId: school.id, branchId: north.id, academicYearId: yearRows.current.id, sectionId: sec.id, kind: 'HALF_DAY', date: dbDate(date), half: 'WHOLE_DAY', timetableDay: weekday(date), startsAt, endsAt, opensAt: new Date(startsAt.getTime() - minutes(saSettings.halfDayOpensBeforeMinutes)), deadlineAt: new Date(endsAt.getTime() + minutes(saSettings.halfDayDeadlineAfterMinutes)), openedAt: new Date(startsAt.getTime() + minutes(10)), openedById: northManager.id, openedByName: northManager.name };
          sessions.push(session);
          for (const e of activeEnrollments(sec.id)) mark(session, e, northManager, 'MANAGER', 'WEB', new Date(session.openedAt.getTime() + minutes(4)));
        }
      }
      // The demo teacher's lessons of the last 3 school days (taken on the mobile app).
      for (const date of mainDays.slice(-3)) {
        for (const slot of demoLessons.filter((s) => s.weekday === weekday(date))) {
          const sectionId = sectionOfVersion.get(slot.versionId);
          const bell = MAIN_BELLS.find((b) => b.number === slot.periodNumber);
          const startsAt = at(date, bell.start);
          const endsAt = at(date, bell.end);
          const session = { id: randomUUID(), schoolId: school.id, branchId: mainBranch.id, academicYearId: yearRows.current.id, sectionId, kind: 'LESSON', date: dbDate(date), half: halfOfPeriod(MAIN_BELLS, slot.periodNumber), periodNumber: slot.periodNumber, subjectId: slot.subjectId, timetableDay: weekday(date), startsAt, endsAt, opensAt: new Date(startsAt.getTime() - minutes(saSettings.lessonOpensBeforeMinutes)), deadlineAt: new Date(endsAt.getTime() + minutes(saSettings.lessonDeadlineAfterMinutes)), openedAt: new Date(startsAt.getTime() + minutes(2)), openedById: demoTeacher.id, openedByName: demoTeacher.name };
          sessions.push(session);
          for (const e of activeEnrollments(sectionId)) mark(session, e, demoTeacher, 'STAFF', 'MOBILE', new Date(session.openedAt.getTime() + minutes(2)), rng() < 0.94 ? 'PRESENT' : 'ABSENT');
        }
      }
      await createMany('studentAttendanceSession', sessions);
      await createMany('studentAttendanceEntry', entries);
      await createMany('studentAttendanceChange', changes);
      if (sessions.length) auditAs(manager, 'STUDENT_ATTENDANCE_MARKED', { type: 'Section', id: mainSections[0].id, name: mainSections[0].label }, `Attendance of ${mainSections[0].label} taken.`, sessions[0].openedAt);

      // Excuses.
      const excusable = enrollments.filter((e) => e.status === 'ACTIVE' && e.branchId === mainBranch.id);
      const excuse = (enrollment, data) => ({ id: randomUUID(), schoolId: school.id, branchId: enrollment.branchId, studentId: enrollment.studentId, createdById: manager.id, createdByName: manager.name, ...data });
      await createMany('studentExcuse', [
        excuse(excusable[0], { startDate: dbDate(mainDays[1] ?? addDays(today, -2)), endDate: dbDate(mainDays[1] ?? addDays(today, -2)), reason: 'Family wedding', createdAt: at(mainDays[0] ?? addDays(today, -3), 900) }),
        excuse(excusable[3], { startDate: dbDate(addDays(today, 1)), endDate: dbDate(addDays(today, 3)), half: 'BEFORE_BREAK', reason: 'Hospital visits', note: 'Mornings only.' }),
        excuse(excusable[6], { startDate: dbDate(addDays(today, 2)), endDate: dbDate(addDays(today, 2)), periods: [5, 6], reason: 'Inter-school football match' }),
        excuse(excusable[9], { startDate: dbDate(addDays(today, 4)), endDate: dbDate(addDays(today, 5)), reason: 'Travel', cancelledAt: new Date(now.getTime() - minutes(60)), cancelledById: manager.id, cancelledByName: manager.name }),
      ]);

      // ---- notifications, outbox, preferences ---------------------------------------------------------
      await tx.notificationSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform' }, update: {} });
      await createMany('branchReminderSettings', [{ branchId: mainBranch.id, checkInLeadMinutes: 15, checkOutLeadMinutes: 10 }]);
      await createMany('notificationPreference', [
        { userId: demoTeacher.id, checkInLeadMinutes: 10, locationConsentAt: at(addDays(today, -20), 540) },
        { userId: manager.id, disabledCategories: ['DIGEST'] },
      ]);

      const branchRef = (b) => ({ code: b.code, name: b.name });
      const notifications = [];
      const outbox = [];
      const notify = (recipient, type, category, params, createdAt, extra = {}) => {
        const n = { id: randomUUID(), type, category, recipientId: recipient.id, schoolId: school.id, params, createdAt, expiresAt: new Date(createdAt.getTime() + 90 * 24 * 60 * minutes(1)), dedupeKey: `${type.toLowerCase()}:dev-seed:${randomUUID()}`, ...extra };
        notifications.push(n);
        return n;
      };
      for (const { event, person, shift, date } of lateEvents.filter((l) => l.event.branchId === mainBranch.id && l.date >= addDays(today, -3))) {
        notify(manager, 'LATE_CHECK_IN', 'ATTENDANCE', { staffName: person.name, staffCode: person.staffId, shiftName: shift.name, shiftStart: hhmm(shift.startMinute), date, time: localDateTime(event.occurredAt, tz).time, timeZone: tz }, new Date(event.receivedAt.getTime() + 60_000), { branchId: mainBranch.id, subjectType: 'attendanceEvent', subjectId: event.id, readAt: date < addDays(today, -1) ? new Date(event.receivedAt.getTime() + minutes(30)) : null });
        outbox.push({ id: randomUUID(), type: 'LATE_CHECK_IN', payload: { eventId: event.id }, dedupeKey: `late-check-in:${event.id}`, status: 'DONE', attempts: 1, createdAt: event.receivedAt, processedAt: new Date(event.receivedAt.getTime() + 60_000) });
      }
      const digestDate = addDays(today, -1);
      const dayStats = (branchId) => {
        const ins = events.filter((e) => e.type === 'CHECK_IN' && e.branchId === branchId && e.workDate.toISOString().slice(0, 10) === digestDate);
        const outs = new Set(events.filter((e) => e.type === 'CHECK_OUT').map((e) => e.checkInEventId));
        return { checkIns: ins.length, present: ins.filter((e) => e.status === 'PRESENT').length, late: ins.filter((e) => e.status === 'LATE').length, staff: new Set(ins.map((e) => e.staffUserId)).size, checkedOut: ins.filter((e) => outs.has(e.id)).length, open: ins.filter((e) => !outs.has(e.id)).length, notRequired: 0 };
      };
      const digestAt = at(today, 360);
      if (digestAt < now) {
        notify(manager, 'BRANCH_DIGEST', 'DIGEST', { date: digestDate, branch: branchRef(mainBranch), day: dayStats(mainBranch.id) }, digestAt, { branchId: mainBranch.id, subjectType: 'branch', subjectId: mainBranch.id });
        notify(owner, 'SCHOOL_DIGEST', 'DIGEST', { date: digestDate, schoolName: school.name, branches: [branchRef(mainBranch), branchRef(north)], day: dayStats(mainBranch.id) }, digestAt, { subjectType: 'school', subjectId: school.id });
      }
      const shiftsFor = (a) => a.shifts.map((s) => {
        const sh = shiftByKey.get(s.shiftKey);
        return { name: sh.name, days: s.days, start: hhmm(sh.startMinute), end: hhmm(sh.endMinute) };
      });
      const demoAssignment = assignments.find((a) => a.staffUserId === demoTeacher.id);
      const assignmentNote = notify(demoTeacher, 'ASSIGNMENT_CHANGED', 'ASSIGNMENT', { effectiveFrom: scheduleStart, shifts: shiftsFor(demoAssignment) }, at(addDays(scheduleStart, -5), 610), { branchId: mainBranch.id, subjectType: 'assignment', subjectId: demoAssignment.id, readAt: at(addDays(scheduleStart, -5), 700) });
      outbox.push({ id: randomUUID(), type: 'ASSIGNMENT_CHANGED', payload: { assignmentId: demoAssignment.id }, dedupeKey: `assignment:${demoAssignment.id}`, status: 'DONE', attempts: 1, createdAt: assignmentNote.createdAt, processedAt: assignmentNote.createdAt });
      notify(guard, 'STAFF_TRANSFERRED', 'TRANSFER', { effectiveFrom: scheduledTransferDate, fromBranch: branchRef(mainBranch), toBranch: branchRef(north), shifts: shiftsFor(guardNorth) }, scheduledTransfer.createdAt, { subjectType: 'staffTransfer', subjectId: scheduledTransfer.id });
      notify(northManager, 'STAFF_TRANSFER_IN', 'TRANSFER', { staffName: guard.name, staffCode: guard.staffId, effectiveFrom: scheduledTransferDate, toBranch: branchRef(north) }, scheduledTransfer.createdAt, { branchId: north.id, subjectType: 'staffTransfer', subjectId: scheduledTransfer.id });
      outbox.push({ id: randomUUID(), type: 'STAFF_TRANSFER', payload: { transferId: scheduledTransfer.id, action: 'scheduled' }, dedupeKey: `staff-transfer:${scheduledTransfer.id}:scheduled`, status: 'DONE', attempts: 1, createdAt: scheduledTransfer.createdAt, processedAt: scheduledTransfer.createdAt });
      const reactivatedAt = at(suspension.to, 600);
      notify(northManager, 'BRANCH_REACTIVATED', 'STATUS', { branch: branchRef(north) }, reactivatedAt, { branchId: north.id, subjectType: 'branch', subjectId: north.id, readAt: at(suspension.to, 700) });
      outbox.push({ id: randomUUID(), type: 'BRANCH_STATUS', payload: { branchId: north.id, status: 'ACTIVE', periodId: suspensionId }, dedupeKey: `branch-status:${suspensionId}:active`, status: 'DONE', attempts: 1, createdAt: reactivatedAt, processedAt: reactivatedAt });
      await createMany('notification', notifications);
      await createMany('notificationEvent', outbox);

      // The demo teacher's phone: a signed-in mobile session with a push device, and a delivered push.
      const session = { id: randomUUID(), tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'), userId: demoTeacher.id, createdAt: at(addDays(today, -6), 470), expiresAt: new Date(now.getTime() + 30 * 24 * 60 * minutes(1)), lastUsedAt: new Date(now.getTime() - minutes(120)), ipAddress: '127.0.0.1', userAgent: 'EduTrack Mobile (dev seed)' };
      await createMany('session', [session]);
      const token = `ExponentPushToken[devseed${randomBytes(8).toString('hex')}]`;
      await createMany('pushDevice', [{ id: randomUUID(), userId: demoTeacher.id, sessionId: session.id, token, platform: 'android', createdAt: session.createdAt, lastSeenAt: session.lastUsedAt }]);
      const push = { id: randomUUID(), userId: demoTeacher.id, sourceKey: `notification:${assignmentNote.id}`, category: 'ASSIGNMENT', status: 'ACCEPTED', attempts: 1, createdAt: assignmentNote.createdAt, nextAttemptAt: assignmentNote.createdAt, submittedAt: new Date(assignmentNote.createdAt.getTime() + 2000), acceptedAt: new Date(assignmentNote.createdAt.getTime() + minutes(15)) };
      await createMany('pushMessage', [push]);
      await createMany('pushDelivery', [{ id: randomUUID(), pushMessageId: push.id, token, platform: 'android', status: 'ACCEPTED', ticketId: `dev-seed-ticket-${randomUUID()}`, submittedAt: push.submittedAt, receiptCheckedAt: push.acceptedAt }]);

      // ---- announcements --------------------------------------------------------------------------
      const published = { id: randomUUID(), kind: 'FEATURE', title: 'Imaanshaha ardayda waa diyaar', body: 'Maamulayaashu hadda waxay qaadi karaan imaanshaha ardayda laba jeer maalintii, macallimiintuna casharradooda.', roles: ['OWNER', 'MANAGER', 'STAFF'], allSchools: false, status: 'PUBLISHED', publishAt: new Date(now.getTime() - 2 * 24 * 60 * minutes(1)), publishedAt: new Date(now.getTime() - 2 * 24 * 60 * minutes(1)), expiresAt: new Date(now.getTime() + 30 * 24 * 60 * minutes(1)), pushQueuedAt: new Date(now.getTime() - 2 * 24 * 60 * minutes(1)), createdById: admin.id, updatedById: admin.id };
      const draftNote = { id: randomUUID(), kind: 'MAINTENANCE', title: 'Dayactir qorsheysan', body: 'Nidaamku wuxuu xirnaan doonaa 30 daqiiqo habeenka Jimcaha.', roles: ['OWNER', 'MANAGER'], allSchools: true, status: 'DRAFT', expiresAt: new Date(now.getTime() + 14 * 24 * 60 * minutes(1)), createdById: admin.id, updatedById: admin.id };
      await createMany('announcement', [published, draftNote]);
      await createMany('announcementSchool', [{ announcementId: published.id, schoolId: school.id }]);
      await createMany('announcementRead', [{ announcementId: published.id, userId: owner.id, readAt: new Date(now.getTime() - 24 * 60 * minutes(1)) }]);
      auditAs(admin, 'ANNOUNCEMENT_PUBLISHED', { type: 'announcement', id: published.id, name: published.title }, `Announcement published to ${school.name}.`, published.publishedAt);

      // ---- backups (history only: these snapshots no longer exist in Neon) -----------------------------
      await tx.backupSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform', manualRetentionDays: 30, updatedById: admin.id }, update: {} });
      const snapshotId = `dev-seed-snapshot-${randomBytes(4).toString('hex')}`;
      const backupAt = at(addDays(today, -40), 1320);
      await createMany('backupRecord', [{ snapshotId, name: `Manual backup ${addDays(today, -40)}`, kind: 'MANUAL', expiresAt: new Date(backupAt.getTime() + 30 * 24 * 60 * minutes(1)), createdById: admin.id, createdByName: admin.name, verifiedAt: new Date(backupAt.getTime() + minutes(10)), verification: { ok: true, checks: [] }, deletedAt: new Date(backupAt.getTime() + 30 * 24 * 60 * minutes(1)), deletedByName: 'Expired', createdAt: backupAt }]);
      await createMany('backupOperation', [{ id: randomUUID(), type: 'CREATE', status: 'COMPLETED', lane: 'backup', snapshotId, requestedById: admin.id, requestedByName: admin.name, startedAt: backupAt, finishedAt: new Date(backupAt.getTime() + minutes(2)) }]);

      await createMany('auditEvent', audit);
    },
    { timeout: 300_000, maxWait: 30_000 },
  );

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  log(`Demo school ${school.name}: ${total} rows in ${Object.keys(counts).length} tables (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}).`);
}
