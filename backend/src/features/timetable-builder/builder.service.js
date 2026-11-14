import { randomInt } from 'node:crypto';
import { badRequest, conflict, forbidden, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { addDays, asDbDay, toDay, versionOn, weekdaysOn } from '../academic-calendar/schoolDays.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockActiveSchool, lockOperatingBranch } from '../branches/branches.service.js';
import { sectionDisplayName } from '../classes/classInput.js';
import { WEEKDAYS } from '../schedules/scheduleInput.js';
import { dayPlan, minutesToTime } from '../timetable/bellTimes.js';
import { assertNoClashes, prepareTimetableVersion } from '../timetable/timetable.service.js';
import { generateTimetable, hardViolations } from './generator.js';

/*
 * Timetable builder (docs/business-rules.md → Timetable builder): for one branch and academic year,
 * the setup (rules, each class's bell schedule, fixed lessons), teachers' limits and unavailable
 * times, the readiness checks, generation into a draft, draft edits, and publishing.
 *
 * Scope (from the account, never the request): the School Owner works on any branch of their school
 * (named in the request); a Manager on their own branch. A Manager sets limits only for staff whose
 * home branch is theirs (teachers from other branches: the School Owner). Anything outside the
 * scope is not found (404).
 *
 * One source of truth: publishing writes ordinary timetable versions (one per class) through the
 * same checks as the timetable editor (timetable.service prepareTimetableVersion), all in one
 * transaction with one teacher-clash check over every class, so it is all or nothing. Drafts are
 * private until published. Writes need the school ACTIVE (a Manager: their branch operating),
 * share a per-branch builder lock, and are audited in the same transaction.
 */

const TX = { timeout: 30000, maxWait: 10000 };
const PUBLISH_TX = { timeout: 120000, maxWait: 15000 };
const DAY_LABELS = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };

/** Where a class's lesson periods come from: "7 a day on 5 school days: Sat, Sun, Mon, Tue, Wed" (or per day when they differ). */
function periodBreakdown(days) {
  const entries = Object.entries(days);
  const counts = new Set(entries.map(([, list]) => list.length));
  const n = entries.length;
  if (counts.size === 1) return `${[...counts][0]} a day on ${n} school day${n === 1 ? '' : 's'}: ${entries.map(([d]) => DAY_LABELS[d]).join(', ')}`;
  return entries.map(([d, list]) => `${DAY_LABELS[d]} ${list.length}`).join(', ');
}
export const DEFAULT_RULES = {
  fillAllPeriods: true,
  maxSubjectPerDay: 2,
  allowDoubleLessons: true,
  spreadSubjects: true,
  avoidTeacherGaps: true,
  teacherMaxPerDay: null,
  morningSubjectIds: [],
  searchSeconds: 10,
};
const RULE_KEYS = Object.keys(DEFAULT_RULES);
const RULE_LABELS = {
  fillAllPeriods: 'Every period has a lesson',
  maxSubjectPerDay: 'Most lessons of a subject a day',
  allowDoubleLessons: 'Double lessons',
  spreadSubjects: 'Spread subjects over the week',
  avoidTeacherGaps: 'Few free periods between a teacher’s lessons',
  teacherMaxPerDay: 'Most lessons a teacher teaches a day',
  morningSubjectIds: 'Morning subjects',
  searchSeconds: 'Search time (seconds)',
  defaultBellScheduleId: 'Default bell schedule',
  sectionBells: 'Bell schedules of classes',
  excludedSectionIds: 'Classes left out',
};

const STALE = () => conflict('STALE_DRAFT', 'The draft was changed since you loaded it. Reload it and try again.');
const YEAR_CLOSED = (year) => conflict('YEAR_CLOSED', `${year.name} is closed. Its timetables are kept as they are.`);

// ---- context and locks ----------------------------------------------------------------------------

async function resolveContext(client, scope, { academicYear, branch }) {
  const year = await client.academicYear.findFirst({
    where: academicYear === 'current' ? { schoolId: scope.school.id, status: 'CURRENT' } : { id: academicYear, schoolId: scope.school.id },
  });
  if (!year) throw notFound(academicYear === 'current' ? 'There is no current academic year.' : 'Academic year not found.');
  const b = scope.branch
    ? await client.branch.findFirst({ where: { id: scope.branch.id, schoolId: scope.school.id }, select: { id: true, name: true, code: true, status: true } })
    : isUuid(branch)
      ? await client.branch.findFirst({ where: { id: branch, schoolId: scope.school.id }, select: { id: true, name: true, code: true, status: true } })
      : null;
  if (!b) throw notFound('Branch not found.');
  return { year, branch: b, yearStart: toDay(year.startDate), yearEnd: toDay(year.endDate) };
}

async function lockFor(tx, scope, branchId, what) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`timetable-builder:${branchId}`}))`;
  if (scope.branch) await lockOperatingBranch(tx, scope, what);
  else await lockActiveSchool(tx, scope.school);
}

async function withBuilderLock(scope, branchId, what, work, options = TX) {
  return getPrisma().$transaction(async (tx) => {
    await lockFor(tx, scope, branchId, what);
    return work(tx);
  }, options);
}

const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const audit = (tx, action, scope, { user, req, target, description, fields = [], details = {} }) =>
  recordAuditEvent({ client: tx, action, actor: actorOf(user), target, schoolId: scope.school.id, description, change: { fields, ...details }, req });

/** The first day a generated timetable can start by default: tomorrow (today is under way), within the year. */
function defaultPlanDate(today, yearStart, yearEnd) {
  const tomorrow = addDays(today, 1);
  const day = tomorrow < yearStart ? yearStart : tomorrow;
  return day > yearEnd ? null : day;
}

const plainVersions = (rows) => rows.filter((v) => !v.cancelledAt).map((v) => ({ ...v, effectiveFrom: toDay(v.effectiveFrom) }));
const rulesOf = (setup) => Object.fromEntries(RULE_KEYS.map((k) => [k, setup?.[k] ?? DEFAULT_RULES[k]]));
const hhmm = minutesToTime;

async function loadSetup(client, branchId, yearId) {
  return client.timetableSetup.findUnique({
    where: { branchId_academicYearId: { branchId, academicYearId: yearId } },
    include: { fixedLessons: { include: { subject: { select: { id: true, name: true } }, teacher: { select: { id: true, name: true, staffId: true } }, section: { select: { id: true, name: true, class: { select: { name: true } } } } } } },
  });
}

// ---- the model: everything generation needs, with readiness checks ---------------------------------

/**
 * Reads what the generator needs for a branch and year on `planDate`, and checks it. → { planDate,
 * weekdays, sections, units, teachers, fixed, rules, blockers, warnings, loads, subjects }.
 * `blockers` stop generation; `warnings` do not. Each: { code, message, fix, … } where `fix` names
 * the page that fixes it. Fixed number of queries whatever the size of the branch.
 */
export async function buildModel(client, scope, { year, branch, planDate, setup }) {
  const rules = rulesOf(setup);
  const blockers = [];
  const warnings = [];
  const block = (code, message, fix, extra = {}) => blockers.push({ code, message, fix, ...extra });
  const warn = (code, message, fix, extra = {}) => warnings.push({ code, message, fix, ...extra });
  const excluded = new Set(setup?.excludedSectionIds ?? []);
  const sectionBells = setup?.sectionBells && typeof setup.sectionBells === 'object' ? setup.sectionBells : {};

  if (year.status === 'CLOSED') block('YEAR_CLOSED', `${year.name} is closed.`, 'academic-years');

  const [weekdayRows, allSections, bells] = await Promise.all([
    client.academicWeekdays.findMany({ where: { academicYearId: year.id, cancelledAt: null, OR: [{ branchId: null }, { branchId: branch.id }] }, select: { branchId: true, days: true, followsSchool: true, effectiveFrom: true } }),
    client.section.findMany({
      where: { schoolId: scope.school.id, branchId: branch.id, academicYearId: year.id, status: 'ACTIVE', class: { status: 'ACTIVE' } },
      include: { class: { select: { id: true, name: true, sequence: true } } },
      orderBy: [{ class: { sequence: 'asc' } }, { nameKey: 'asc' }],
    }),
    client.bellSchedule.findMany({
      where: { schoolId: scope.school.id, OR: [{ branchId: null }, { branchId: branch.id }] },
      include: { versions: { where: { cancelledAt: null }, include: { periods: true } } },
      orderBy: { name: 'asc' },
    }),
  ]);
  const plainWeekdays = (rows) => rows.map((v) => ({ days: v.days, followsSchool: v.followsSchool, effectiveFrom: toDay(v.effectiveFrom) }));
  const { days: weekdays } = weekdaysOn({ schoolVersions: plainWeekdays(weekdayRows.filter((v) => !v.branchId)), branchVersions: plainWeekdays(weekdayRows.filter((v) => v.branchId)) }, planDate);
  if (!weekdays.length) block('NO_WEEKDAYS', `${year.name} has no school days of the week set on ${planDate}.`, 'academic-calendar');

  const sections = allSections.filter((s) => !excluded.has(s.id));
  if (!sections.length) block('NO_SECTIONS', `${branch.name} has no active classes in ${year.name}${allSections.length ? ' (all are left out)' : ''}.`, allSections.length ? 'setup' : 'classes');

  // The timetables of these classes (their bell schedule, and later changes already scheduled).
  const sectionIds = sections.map((s) => s.id);
  const ownVersions = sectionIds.length
    ? await client.timetableVersion.findMany({ where: { sectionId: { in: sectionIds }, cancelledAt: null }, select: { id: true, sectionId: true, bellScheduleId: true, effectiveFrom: true } })
    : [];
  const versionsBySection = new Map();
  for (const v of plainVersions(ownVersions)) versionsBySection.set(v.sectionId, [...(versionsBySection.get(v.sectionId) ?? []), v]);

  const activeBells = bells.filter((b) => b.status === 'ACTIVE');
  const bellById = new Map(bells.map((b) => [b.id, b]));
  const shapedSections = [];
  for (const s of sections) {
    const name = sectionDisplayName(s.class.name, s.name);
    const own = versionsBySection.get(s.id) ?? [];
    const current = versionOn(own, planDate) ?? [...own].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    let bellId = null;
    let source = null;
    if (sectionBells[s.id] && bellById.has(sectionBells[s.id])) [bellId, source] = [sectionBells[s.id], 'class'];
    else if (current && bellById.has(current.bellScheduleId)) [bellId, source] = [current.bellScheduleId, 'timetable'];
    else if (setup?.defaultBellScheduleId && bellById.has(setup.defaultBellScheduleId)) [bellId, source] = [setup.defaultBellScheduleId, 'default'];
    else if (activeBells.length === 1) [bellId, source] = [activeBells[0].id, 'only'];
    const later = own.filter((v) => v.effectiveFrom > planDate);
    if (later.length) warn('SCHEDULED_LATER', `${name} has a timetable change scheduled from ${later.map((v) => v.effectiveFrom).sort()[0]}; it still applies from then.`, 'timetables', { sectionId: s.id });
    const shaped = { id: s.id, name, classId: s.classId, className: s.class.name, bell: null, bellSource: source, days: {}, lessonPeriods: 0 };
    shapedSections.push(shaped);
    if (!bellId) {
      block('SECTION_NO_BELL', `${name} has no bell schedule. Choose one in the setup.`, 'setup', { sectionId: s.id });
      continue;
    }
    const bell = bellById.get(bellId);
    shaped.bell = { id: bell.id, name: bell.name };
    if (bell.status !== 'ACTIVE') {
      block('BELL_INACTIVE', `${bell.name} (bell schedule of ${name}) is inactive.`, 'bell-schedules', { sectionId: s.id });
      continue;
    }
    const times = versionOn(plainVersions(bell.versions), planDate);
    if (!times) {
      block('BELL_NO_TIMES', `${bell.name} has no times on ${planDate}.`, 'bell-schedules', { sectionId: s.id });
      continue;
    }
    for (const day of WEEKDAYS) {
      if (!weekdays.includes(day)) continue;
      const lessons = dayPlan(times.periods, day).filter((p) => p.kind === 'LESSON');
      if (!lessons.length) continue;
      shaped.days[day] = lessons.map((p) => ({ number: p.number, startMinute: p.startMinute, endMinute: p.endMinute, half: p.half }));
      shaped.lessonPeriods += lessons.length;
    }
    if (!shaped.lessonPeriods) block('BELL_NO_LESSONS', `${bell.name} has no lesson periods on the school days (${weekdays.map((d) => DAY_LABELS[d]).join(', ') || 'none set'}).`, 'bell-schedules', { sectionId: s.id });
  }

  // Subjects of each class (lessons per week) and who teaches them on the plan date.
  const classIds = [...new Set(sections.map((s) => s.classId))];
  const [curriculum, assignments] = await Promise.all([
    classIds.length ? client.classSubject.findMany({ where: { classId: { in: classIds } }, include: { subject: { select: { id: true, name: true, code: true, status: true } } } }) : [],
    sectionIds.length
      ? client.teachingAssignment.findMany({
          where: { sectionId: { in: sectionIds }, role: 'SUBJECT_TEACHER', cancelledAt: null, startDate: { lte: asDbDay(planDate) }, OR: [{ endDate: null }, { endDate: { gte: asDbDay(planDate) } }] },
          include: { teacher: { select: { id: true, name: true, staffId: true, status: true, branchId: true, branch: { select: { id: true, name: true } } } } },
          orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
        })
      : [],
  ]);
  const subjects = new Map();
  const byClass = new Map();
  for (const c of curriculum) {
    subjects.set(c.subject.id, c.subject);
    byClass.set(c.classId, [...(byClass.get(c.classId) ?? []), c]);
  }
  const teachersOf = new Map();
  const teacherRows = new Map();
  for (const a of assignments) {
    const k = `${a.sectionId}|${a.subjectId}`;
    if (!teachersOf.has(k)) teachersOf.set(k, []);
    if (!teachersOf.get(k).includes(a.teacherId)) teachersOf.get(k).push(a.teacherId);
    teacherRows.set(a.teacherId, a.teacher);
  }

  const units = [];
  const reportedClass = new Set();
  const shared = [];
  for (const s of shapedSections) {
    const list = byClass.get(s.classId) ?? [];
    if (!list.length) {
      if (!reportedClass.has(s.classId)) block('CLASS_NO_SUBJECTS', `${s.className} has no subject list with lessons per week. Your School Owner sets it on the class page (Classes → the class → Subjects).`, 'class-subjects', { classId: s.classId, className: s.className });
      reportedClass.add(s.classId);
      continue;
    }
    let total = 0;
    for (const c of list) {
      if (c.subject.status !== 'ACTIVE') {
        if (!reportedClass.has(`${s.classId}|${c.subjectId}`)) warn('SUBJECT_INACTIVE', `${c.subject.name} is inactive and is left out of ${s.className}.`, 'subjects', { classId: s.classId, subjectId: c.subjectId });
        reportedClass.add(`${s.classId}|${c.subjectId}`);
        continue;
      }
      if (c.weeklyLessons == null) {
        if (!reportedClass.has(`${s.classId}|${c.subjectId}`)) block('SUBJECT_NO_WEEKLY', `${c.subject.name} in ${s.className} has no lessons per week.`, 'class-subjects', { classId: s.classId, className: s.className, subjectId: c.subjectId });
        reportedClass.add(`${s.classId}|${c.subjectId}`);
        continue;
      }
      if (c.weeklyLessons <= 0) continue;
      total += c.weeklyLessons;
      const ids = (teachersOf.get(`${s.id}|${c.subjectId}`) ?? []).filter((id) => teacherRows.get(id)?.status === 'ACTIVE');
      const inactive = (teachersOf.get(`${s.id}|${c.subjectId}`) ?? []).filter((id) => teacherRows.get(id)?.status !== 'ACTIVE');
      for (const id of inactive) warn('TEACHER_INACTIVE', `${teacherRows.get(id).name} (${c.subject.name} in ${s.name}) is suspended and is left out.`, 'teaching', { sectionId: s.id, teacherId: id });
      if (!ids.length) {
        block('SUBJECT_NO_TEACHER', `${c.subject.name} in ${s.name} has no teacher on ${planDate}.`, 'teaching', { sectionId: s.id, subjectId: c.subjectId });
        continue;
      }
      if (ids.length > 1) shared.push(`${c.subject.name} in ${s.name} (${ids.map((id) => teacherRows.get(id).name).join(', ')})`);
      const base = Math.floor(c.weeklyLessons / ids.length);
      ids.forEach((id, i) => {
        const count = base + (i < c.weeklyLessons % ids.length ? 1 : 0);
        if (count) units.push({ sectionId: s.id, subjectId: c.subjectId, teacherId: id, count });
      });
      const schoolDays = Object.keys(s.days).length;
      if (schoolDays && c.weeklyLessons > schoolDays * rules.maxSubjectPerDay) {
        block('SUBJECT_DAILY_LIMIT', `${c.subject.name} needs ${c.weeklyLessons} lessons a week in ${s.name}, but at most ${rules.maxSubjectPerDay} a day on ${schoolDays} days is ${schoolDays * rules.maxSubjectPerDay}. Raise the daily limit or lower the lessons per week.`, 'setup', { sectionId: s.id, subjectId: c.subjectId });
      }
    }
    s.required = total;
    if (s.lessonPeriods && total > s.lessonPeriods) {
      const n = total - s.lessonPeriods;
      block('SECTION_OVERLOAD', `${s.name} needs ${total} lessons a week but has only ${s.lessonPeriods} lesson periods (${periodBreakdown(s.days)}), so ${n} lesson${n === 1 ? '' : 's'} would not fit. Remove ${n} lesson${n === 1 ? '' : 's'} per week from ${s.className}'s subjects, add school days in the Academic Calendar, or add periods to the bell schedule.`, 'class-subjects', { sectionId: s.id, classId: s.classId, className: s.className, extra: n });
    }
    else if (s.lessonPeriods && total < s.lessonPeriods) {
      if (rules.fillAllPeriods) {
        const n = s.lessonPeriods - total;
        block('SECTION_UNDERFILLED', `${s.name} has ${total} lessons a week but ${s.lessonPeriods} lesson periods (${periodBreakdown(s.days)}), so ${n} period${n === 1 ? ' would be' : 's would be'} empty. Every period needs a lesson: add ${n} lesson${n === 1 ? '' : 's'} per week to ${s.className}'s subjects, or shorten the bell schedule.`, 'class-subjects', { sectionId: s.id, classId: s.classId, className: s.className, missing: n });
      } else s.free = s.lessonPeriods - total;
    }
  }
  if (shared.length) warn('SHARED_SUBJECT', `Lessons are shared equally between the teachers of: ${shared.slice(0, 8).join('; ')}${shared.length > 8 ? '; …' : ''}.`, 'teaching');
  const withFree = shapedSections.filter((s) => s.free);
  if (withFree.length) warn('FREE_PERIODS', `Free periods remain in ${withFree.length} class${withFree.length === 1 ? '' : 'es'} (e.g. ${withFree.slice(0, 3).map((s) => `${s.name}: ${s.free}`).join(', ')}); they go at the end of days where possible.`, 'classes');

  // Teachers: limits, unavailable times, and their lessons elsewhere on the plan date (busy).
  const teacherIds = [...new Set(units.map((u) => u.teacherId))];
  const [profiles, elsewhere] = await Promise.all([
    teacherIds.length ? client.teacherTimetableProfile.findMany({ where: { academicYearId: year.id, teacherId: { in: teacherIds } } }) : [],
    teacherIds.length
      ? client.timetableVersion.findMany({
          where: { schoolId: scope.school.id, cancelledAt: null, sectionId: { notIn: sectionIds }, effectiveFrom: { lte: asDbDay(planDate) }, slots: { some: { teacherId: { in: teacherIds } } } },
          select: {
            id: true,
            sectionId: true,
            bellScheduleId: true,
            effectiveFrom: true,
            section: { select: { name: true, class: { select: { name: true } }, branch: { select: { name: true } } } },
            slots: { where: { teacherId: { in: teacherIds } }, select: { weekday: true, periodNumber: true, teacherId: true } },
          },
        })
      : [],
  ]);
  // Only the version in effect on the plan date counts for each other class.
  const latestElsewhere = new Map();
  for (const v of elsewhere) {
    const d = toDay(v.effectiveFrom);
    const prev = latestElsewhere.get(v.sectionId);
    if (!prev || d > toDay(prev.effectiveFrom)) latestElsewhere.set(v.sectionId, v);
  }
  // Those versions may be stale (a later version without the teacher): keep only versions in effect.
  const otherSectionIds = [...latestElsewhere.keys()];
  const newer = otherSectionIds.length
    ? await client.timetableVersion.findMany({ where: { sectionId: { in: otherSectionIds }, cancelledAt: null, effectiveFrom: { lte: asDbDay(planDate) } }, select: { sectionId: true, effectiveFrom: true } })
    : [];
  for (const n of newer) {
    const kept = latestElsewhere.get(n.sectionId);
    if (kept && toDay(n.effectiveFrom) > toDay(kept.effectiveFrom)) latestElsewhere.delete(n.sectionId);
  }
  const otherBellIds = [...new Set([...latestElsewhere.values()].map((v) => v.bellScheduleId))].filter((id) => !bellById.has(id));
  const otherBells = otherBellIds.length
    ? await client.bellScheduleVersion.findMany({ where: { bellScheduleId: { in: otherBellIds }, cancelledAt: null }, select: { bellScheduleId: true, effectiveFrom: true, periods: true } })
    : [];
  const bellVersions = new Map();
  for (const b of bells) bellVersions.set(b.id, plainVersions(b.versions));
  for (const b of otherBells) bellVersions.set(b.bellScheduleId, [...(bellVersions.get(b.bellScheduleId) ?? []), { ...b, effectiveFrom: toDay(b.effectiveFrom) }]);

  const teachers = {};
  for (const id of teacherIds) {
    const t = teacherRows.get(id);
    const profile = profiles.find((p) => p.teacherId === id);
    teachers[id] = {
      name: t.name,
      staffId: t.staffId,
      homeBranch: t.branch ? { id: t.branch.id, name: t.branch.name } : null,
      maxPerDay: profile?.maxPerDay ?? rules.teacherMaxPerDay ?? null,
      maxPerWeek: profile?.maxPerWeek ?? null,
      unavailable: Array.isArray(profile?.unavailable) ? profile.unavailable : [],
      busy: [],
    };
  }
  for (const v of latestElsewhere.values()) {
    const times = versionOn(bellVersions.get(v.bellScheduleId) ?? [], planDate);
    if (!times) continue;
    const label = `${sectionDisplayName(v.section.class.name, v.section.name)}, ${v.section.branch.name}`;
    for (const slot of v.slots) {
      const p = dayPlan(times.periods, slot.weekday).find((x) => x.kind === 'LESSON' && x.number === slot.periodNumber);
      if (p && teachers[slot.teacherId]) teachers[slot.teacherId].busy.push({ weekday: slot.weekday, startMinute: p.startMinute, endMinute: p.endMinute, label });
    }
  }
  const away = teacherIds.filter((id) => teachers[id].homeBranch?.id !== branch.id || teachers[id].busy.length);
  if (away.length) warn('TEACHERS_ELSEWHERE', `${away.length} teacher${away.length === 1 ? ' also teaches' : 's also teach'} in other classes or branches; those lessons are kept free (${away.slice(0, 4).map((id) => teachers[id].name).join(', ')}${away.length > 4 ? ', …' : ''}).`, 'teachers');

  // Fixed lessons of the setup.
  const fixed = [];
  const fixedCount = new Map();
  for (const f of setup?.fixedLessons ?? []) {
    const s = shapedSections.find((x) => x.id === f.sectionId);
    if (!s) continue;
    const label = `Fixed lesson ${f.subject.name} in ${s.name} (${DAY_LABELS[f.weekday]}, period ${f.periodNumber})`;
    const unitTeachers = units.filter((u) => u.sectionId === f.sectionId && u.subjectId === f.subjectId).map((u) => u.teacherId);
    const teacherId = f.teacherId ?? unitTeachers[0] ?? null;
    if (!unitTeachers.length) {
      block('FIXED_INVALID', `${label}: the subject is not taught in this class on ${planDate}.`, 'fixed', { fixedLessonId: f.id });
      continue;
    }
    if (f.teacherId && !unitTeachers.includes(f.teacherId)) {
      block('FIXED_INVALID', `${label}: ${f.teacher?.name ?? 'the teacher'} does not teach it there on ${planDate}.`, 'fixed', { fixedLessonId: f.id });
      continue;
    }
    if (!(s.days[f.weekday] ?? []).some((p) => p.number === f.periodNumber)) {
      block('FIXED_INVALID', `${label}: there is no such lesson period on a school day.`, 'fixed', { fixedLessonId: f.id });
      continue;
    }
    const k = `${f.sectionId}|${f.subjectId}`;
    fixedCount.set(k, (fixedCount.get(k) ?? 0) + 1);
    const weekly = units.filter((u) => u.sectionId === f.sectionId && u.subjectId === f.subjectId).reduce((n, u) => n + u.count, 0);
    if (fixedCount.get(k) > weekly) {
      block('FIXED_INVALID', `${label}: more fixed lessons than its ${weekly} lessons a week.`, 'fixed', { fixedLessonId: f.id });
      continue;
    }
    // The fixed lesson comes out of its teacher's share of the subject (keeps the split exact).
    const unit = units.find((u) => u.sectionId === f.sectionId && u.subjectId === f.subjectId && u.teacherId === teacherId);
    const teacherKey = `${k}|${teacherId}`;
    fixedCount.set(teacherKey, (fixedCount.get(teacherKey) ?? 0) + 1);
    if (!unit || fixedCount.get(teacherKey) > unit.count) {
      block('FIXED_INVALID', `${label}: ${teachers[teacherId]?.name ?? 'the teacher'} has only ${unit?.count ?? 0} of its lessons a week here.`, 'fixed', { fixedLessonId: f.id });
      continue;
    }
    fixed.push({ id: f.id, sectionId: f.sectionId, weekday: f.weekday, period: f.periodNumber, subjectId: f.subjectId, teacherId });
  }
  if (fixed.length) {
    const clash = hardViolations({ sections: shapedSections, lessons: fixed.map((f) => ({ ...f })), teachers, rules: { ...rules, maxSubjectPerDay: Infinity, allowDoubleLessons: true } });
    for (const v of clash) block('FIXED_CONFLICT', `Fixed lessons conflict: ${v.message}`, 'fixed');
  }

  // Teachers' capacity: their lessons against the periods they can teach.
  const loads = [];
  for (const id of teacherIds) {
    const t = teachers[id];
    const lessons = units.filter((u) => u.teacherId === id).reduce((n, u) => n + u.count, 0);
    const theirSections = shapedSections.filter((s) => units.some((u) => u.teacherId === id && u.sectionId === s.id));
    // Classes still without periods are reported on their own; their teachers' load is checked once they have them.
    if (theirSections.some((s) => !s.lessonPeriods)) continue;
    let capacity = 0;
    for (const day of WEEKDAYS) {
      const seen = new Map();
      for (const s of theirSections) for (const p of s.days[day] ?? []) seen.set(`${p.startMinute}-${p.endMinute}`, p);
      const blocks = [...t.unavailable, ...t.busy].filter((b) => b.weekday === day);
      const free = [...seen.values()].filter((p) => !blocks.some((b) => b.startMinute < p.endMinute && p.startMinute < b.endMinute)).length;
      capacity += t.maxPerDay ? Math.min(free, t.maxPerDay) : free;
    }
    if (t.maxPerWeek) capacity = Math.min(capacity, t.maxPerWeek);
    loads.push({ teacherId: id, name: t.name, lessons, capacity });
    if (lessons > capacity) {
      block('TEACHER_OVERLOAD', `${t.name} has ${lessons} lessons a week here but can teach at most ${capacity} (their free periods${t.maxPerDay ? `, at most ${t.maxPerDay} a day` : ''}${t.maxPerWeek ? `, at most ${t.maxPerWeek} a week` : ''}). Share the teaching or change their limits.`, 'teachers', { teacherId: id });
    }
  }

  return { planDate, weekdays, sections: shapedSections, units, teachers, fixed, rules, blockers, warnings, loads, subjects };
}

// ---- reads -------------------------------------------------------------------------------------------

const toFixed = (f) => ({
  id: f.id,
  section: { id: f.section.id, displayName: sectionDisplayName(f.section.class.name, f.section.name) },
  weekday: f.weekday,
  period: f.periodNumber,
  subject: f.subject,
  teacher: f.teacher ?? null,
});

function toSetup(setup) {
  const rules = rulesOf(setup);
  return {
    id: setup?.id ?? null,
    ...rules,
    morningSubjects: rules.morningSubjectIds,
    defaultBellSchedule: setup?.defaultBellScheduleId ?? null,
    sectionBells: setup?.sectionBells ?? {},
    excludedSections: setup?.excludedSectionIds ?? [],
    updatedAt: setup?.updatedAt?.toISOString() ?? null,
  };
}

function bellSummary(b, day) {
  const times = versionOn(plainVersions(b.versions ?? []), day);
  const byDay = {};
  for (const d of WEEKDAYS) {
    const lessons = times ? times.periods.filter((p) => p.kind === 'LESSON' && p.days.includes(d)).length : 0;
    if (lessons) byDay[d] = lessons;
  }
  return { id: b.id, name: b.name, level: b.branchId ? 'branch' : 'school', status: b.status.toLowerCase(), hasTimes: Boolean(times), lessonsByDay: byDay };
}

/**
 * The builder page of a branch and year: setup (rules, bell schedules), the classes with the bell
 * schedule each uses, bell schedules to choose from, subjects, fixed lessons, the open draft
 * (summary) and the plan date.
 */
export async function getBuilder(scope, query) {
  const prisma = getPrisma();
  const today = await calendarToday();
  const { year, branch, yearStart, yearEnd } = await resolveContext(prisma, scope, query);
  const planDate = query.date ?? defaultPlanDate(today, yearStart, yearEnd) ?? yearEnd;
  const [setup, bells, sections, subjects, draft] = await Promise.all([
    loadSetup(prisma, branch.id, year.id),
    prisma.bellSchedule.findMany({ where: { schoolId: scope.school.id, OR: [{ branchId: null }, { branchId: branch.id }] }, include: { versions: { where: { cancelledAt: null }, include: { periods: true } } }, orderBy: { name: 'asc' } }),
    prisma.section.findMany({
      where: { schoolId: scope.school.id, branchId: branch.id, academicYearId: year.id, status: 'ACTIVE', class: { status: 'ACTIVE' } },
      include: { class: { select: { id: true, name: true, sequence: true } } },
      orderBy: [{ class: { sequence: 'asc' } }, { nameKey: 'asc' }],
    }),
    prisma.subject.findMany({ where: { schoolId: scope.school.id, status: 'ACTIVE' }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
    prisma.timetableDraft.findFirst({ where: { branchId: branch.id, academicYearId: year.id, status: 'DRAFT' }, select: { id: true, revision: true, createdAt: true, updatedAt: true, planDate: true, report: true } }),
  ]);
  const model = await buildModel(prisma, scope, { year, branch, planDate, setup });
  return {
    today,
    planDate,
    academicYear: { id: year.id, name: year.name, status: year.status.toLowerCase(), startDate: yearStart, endDate: yearEnd },
    branch: { id: branch.id, name: branch.name, code: branch.code },
    setup: toSetup(setup),
    bellSchedules: bells.map((b) => bellSummary(b, planDate)),
    sections: sections.map((s) => {
      const shaped = model.sections.find((x) => x.id === s.id);
      return {
        id: s.id,
        displayName: sectionDisplayName(s.class.name, s.name),
        class: { id: s.class.id, name: s.class.name },
        excluded: !shaped,
        bell: shaped?.bell ?? null,
        bellSource: shaped?.bellSource ?? null,
        lessonPeriods: shaped?.lessonPeriods ?? 0,
        lessonsNeeded: shaped?.required ?? 0,
        periods: Object.fromEntries(Object.entries(shaped?.days ?? {}).map(([d, list]) => [d, list.map((p) => ({ number: p.number, start: hhmm(p.startMinute), end: hhmm(p.endMinute) }))])),
      };
    }),
    subjects,
    fixedLessons: (setup?.fixedLessons ?? []).map(toFixed).sort((a, b) => a.section.displayName.localeCompare(b.section.displayName) || WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) || a.period - b.period),
    readiness: { ready: !model.blockers.length, blockers: model.blockers.length, warnings: model.warnings.length },
    draft: draft && { id: draft.id, revision: draft.revision, createdAt: draft.createdAt.toISOString(), updatedAt: draft.updatedAt.toISOString(), planDate: toDay(draft.planDate), unplaced: (draft.report?.unplaced ?? []).reduce((n, u) => n + u.count, 0) },
  };
}

/** The readiness checks for a branch and year on a plan date: { ready, planDate, blockers, warnings, summary }. */
export async function readiness(scope, query) {
  const prisma = getPrisma();
  const today = await calendarToday();
  const { year, branch, yearStart, yearEnd } = await resolveContext(prisma, scope, query);
  const planDate = query.date ?? defaultPlanDate(today, yearStart, yearEnd) ?? yearEnd;
  const setup = await loadSetup(prisma, branch.id, year.id);
  const model = await buildModel(prisma, scope, { year, branch, planDate, setup });
  if (planDate < yearStart || planDate > yearEnd) model.blockers.unshift({ code: 'DATE_OUTSIDE_YEAR', message: `${planDate} is outside ${year.name} (${yearStart} to ${yearEnd}).`, fix: 'date' });
  return {
    ready: !model.blockers.length,
    planDate,
    blockers: model.blockers,
    warnings: model.warnings,
    summary: {
      classes: model.sections.length,
      lessons: model.units.reduce((n, u) => n + u.count, 0),
      lessonPeriods: model.sections.reduce((n, s) => n + s.lessonPeriods, 0),
      teachers: model.loads.length,
      fixedLessons: model.fixed.length,
      weekdays: model.weekdays,
    },
    teachers: model.loads.map((l) => ({ ...l, ...pick(model.teachers[l.teacherId], ['staffId', 'homeBranch', 'maxPerDay', 'maxPerWeek']), unavailable: model.teachers[l.teacherId].unavailable.length, busy: model.teachers[l.teacherId].busy.length })).sort((a, b) => b.lessons / Math.max(1, b.capacity) - a.lessons / Math.max(1, a.capacity)),
  };
}
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k] ?? null]));

// ---- setup changes ------------------------------------------------------------------------------------

/** Saves rules and bell schedule choices (creates the setup on first save). */
export async function saveSetup(scope, input, user, req) {
  const prisma = getPrisma();
  const { year, branch } = await resolveContext(prisma, scope, input);
  if (year.status === 'CLOSED') throw YEAR_CLOSED(year);
  const c = input.changes;
  await withBuilderLock(scope, branch.id, 'timetable setup', async (tx) => {
    const before = await tx.timetableSetup.findUnique({ where: { branchId_academicYearId: { branchId: branch.id, academicYearId: year.id } } });
    const errors = {};
    const bellIds = [c.defaultBellScheduleId, ...Object.values(c.sectionBells ?? {})].filter(Boolean);
    if (bellIds.length) {
      const found = await tx.bellSchedule.findMany({ where: { id: { in: bellIds }, schoolId: scope.school.id, OR: [{ branchId: null }, { branchId: branch.id }] }, select: { id: true, status: true, name: true } });
      const ok = new Map(found.map((b) => [b.id, b]));
      if (c.defaultBellScheduleId && !ok.has(c.defaultBellScheduleId)) errors.defaultBellSchedule = 'Bell schedule not found.';
      else if (c.defaultBellScheduleId && ok.get(c.defaultBellScheduleId).status !== 'ACTIVE') errors.defaultBellSchedule = `${ok.get(c.defaultBellScheduleId).name} is inactive.`;
      for (const id of Object.values(c.sectionBells ?? {})) if (id && !ok.has(id)) errors.sectionBells = 'A bell schedule was not found.';
    }
    const sectionIds = [...Object.keys(c.sectionBells ?? {}), ...(c.excludedSectionIds ?? [])];
    if (sectionIds.length) {
      const n = await tx.section.count({ where: { id: { in: [...new Set(sectionIds)] }, branchId: branch.id, academicYearId: year.id } });
      if (n !== new Set(sectionIds).size) errors.sectionBells = errors.sectionBells ?? `A class is not one of ${branch.name}'s in ${year.name}.`;
    }
    if (c.morningSubjectIds?.length) {
      const n = await tx.subject.count({ where: { id: { in: c.morningSubjectIds }, schoolId: scope.school.id } });
      if (n !== c.morningSubjectIds.length) errors.morningSubjects = 'A subject was not found.';
    }
    if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);

    const data = { ...c };
    if (c.sectionBells) {
      const merged = { ...(before?.sectionBells ?? {}) };
      for (const [k, v] of Object.entries(c.sectionBells)) {
        if (v) merged[k] = v;
        else delete merged[k];
      }
      data.sectionBells = merged;
    }
    const after = before
      ? await tx.timetableSetup.update({ where: { id: before.id }, data })
      : await tx.timetableSetup.create({ data: { schoolId: scope.school.id, academicYearId: year.id, branchId: branch.id, ...data } });
    const fields = Object.keys(c)
      .map((k) => ({ field: RULE_LABELS[k] ?? k, from: show(before ? before[k] : DEFAULT_RULES[k] ?? null), to: show(after[k]) }))
      .filter((f) => f.from !== f.to);
    if (!fields.length) return;
    await audit(tx, AUDIT_ACTIONS.TIMETABLE_SETUP_CHANGED, scope, {
      user,
      req,
      target: { type: 'timetable_setup', id: after.id, name: `${branch.name} (${year.name})` },
      description: `Timetable builder setup of ${branch.name} (${year.name}) changed: ${fields.map((f) => f.field).join(', ')}.`,
      fields,
      details: { academicYearId: year.id, branchId: branch.id },
    });
  });
  return getBuilder(scope, { academicYear: year.id, branch: branch.id });
}
const show = (v) => (v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Adds a fixed lesson (the generator keeps it exactly there). */
export async function addFixedLesson(scope, input, user, req) {
  const prisma = getPrisma();
  const { year, branch } = await resolveContext(prisma, scope, input);
  if (year.status === 'CLOSED') throw YEAR_CLOSED(year);
  await withBuilderLock(scope, branch.id, 'timetable setup', async (tx) => {
    const section = await tx.section.findFirst({ where: { id: input.sectionId, branchId: branch.id, academicYearId: year.id, schoolId: scope.school.id }, include: { class: true } });
    if (!section) throw notFound('Class not found.');
    const name = sectionDisplayName(section.class.name, section.name);
    const listed = await tx.classSubject.findFirst({ where: { classId: section.classId, subjectId: input.subjectId }, include: { subject: true } });
    if (!listed || listed.subject.status !== 'ACTIVE') throw badRequest('Check the highlighted fields.', { subject: `Choose one of ${section.class.name}'s active subjects.` });
    let teacher = null;
    if (input.teacherId) {
      const a = await tx.teachingAssignment.findFirst({ where: { sectionId: section.id, subjectId: input.subjectId, teacherId: input.teacherId, role: 'SUBJECT_TEACHER', cancelledAt: null }, include: { teacher: { select: { name: true } } } });
      if (!a) throw badRequest('Check the highlighted fields.', { teacher: `This teacher does not teach ${listed.subject.name} in ${name}.` });
      teacher = a.teacher;
    }
    const setup =
      (await tx.timetableSetup.findUnique({ where: { branchId_academicYearId: { branchId: branch.id, academicYearId: year.id } } })) ??
      (await tx.timetableSetup.create({ data: { schoolId: scope.school.id, academicYearId: year.id, branchId: branch.id } }));
    const taken = await tx.timetableFixedLesson.findFirst({ where: { setupId: setup.id, sectionId: section.id, weekday: input.weekday, periodNumber: input.periodNumber } });
    if (taken) throw conflict('FIXED_EXISTS', `${name} already has a fixed lesson on ${DAY_LABELS[input.weekday]}, period ${input.periodNumber}.`);
    const row = await tx.timetableFixedLesson.create({ data: { setupId: setup.id, sectionId: section.id, weekday: input.weekday, periodNumber: input.periodNumber, subjectId: input.subjectId, teacherId: input.teacherId } });
    await audit(tx, AUDIT_ACTIONS.TIMETABLE_FIXED_LESSON_ADDED, scope, {
      user,
      req,
      target: { type: 'timetable_setup', id: setup.id, name: `${branch.name} (${year.name})` },
      description: `Fixed lesson added: ${listed.subject.name} in ${name}, ${DAY_LABELS[input.weekday]} period ${input.periodNumber}${teacher ? ` (${teacher.name})` : ''}.`,
      fields: [{ field: 'Fixed lesson', from: null, to: `${name}: ${listed.subject.name}, ${DAY_LABELS[input.weekday]} period ${input.periodNumber}` }],
      details: { academicYearId: year.id, branchId: branch.id, fixedLessonId: row.id, sectionId: section.id },
    });
  });
  return getBuilder(scope, { academicYear: year.id, branch: branch.id });
}

/** Removes a fixed lesson. */
export async function removeFixedLesson(scope, id, user, req) {
  const prisma = getPrisma();
  const row = isUuid(id)
    ? await prisma.timetableFixedLesson.findFirst({
        where: { id, setup: { schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) } },
        include: { setup: { include: { branch: true, academicYear: true } }, subject: true, section: { include: { class: true } } },
      })
    : null;
  if (!row) throw notFound('Fixed lesson not found.');
  const name = sectionDisplayName(row.section.class.name, row.section.name);
  await withBuilderLock(scope, row.setup.branchId, 'timetable setup', async (tx) => {
    const deleted = await tx.timetableFixedLesson.deleteMany({ where: { id: row.id } });
    if (!deleted.count) return;
    await audit(tx, AUDIT_ACTIONS.TIMETABLE_FIXED_LESSON_REMOVED, scope, {
      user,
      req,
      target: { type: 'timetable_setup', id: row.setupId, name: `${row.setup.branch.name} (${row.setup.academicYear.name})` },
      description: `Fixed lesson removed: ${row.subject.name} in ${name}, ${DAY_LABELS[row.weekday]} period ${row.periodNumber}.`,
      fields: [{ field: 'Fixed lesson', from: `${name}: ${row.subject.name}, ${DAY_LABELS[row.weekday]} period ${row.periodNumber}`, to: null }],
      details: { academicYearId: row.setup.academicYearId, branchId: row.setup.branchId, fixedLessonId: row.id },
    });
  });
  return getBuilder(scope, { academicYear: row.setup.academicYearId, branch: row.setup.branchId });
}

// ---- teachers ------------------------------------------------------------------------------------------

/**
 * The teachers of a branch's timetable (their lessons there, the periods they can teach, limits and
 * unavailable times), with whether the signed-in user can change their limits.
 */
export async function listTeachers(scope, query) {
  const prisma = getPrisma();
  const today = await calendarToday();
  const { year, branch, yearStart, yearEnd } = await resolveContext(prisma, scope, query);
  const planDate = query.date ?? defaultPlanDate(today, yearStart, yearEnd) ?? yearEnd;
  const setup = await loadSetup(prisma, branch.id, year.id);
  const model = await buildModel(prisma, scope, { year, branch, planDate, setup });
  const ids = model.loads.map((l) => l.teacherId);
  const profiles = ids.length ? await prisma.teacherTimetableProfile.findMany({ where: { academicYearId: year.id, teacherId: { in: ids } } }) : [];
  return {
    planDate,
    academicYear: { id: year.id, name: year.name },
    branch: { id: branch.id, name: branch.name },
    defaultMaxPerDay: model.rules.teacherMaxPerDay,
    items: model.loads
      .map((l) => {
        const t = model.teachers[l.teacherId];
        const p = profiles.find((x) => x.teacherId === l.teacherId);
        return {
          id: l.teacherId,
          name: t.name,
          staffId: t.staffId,
          homeBranch: t.homeBranch,
          lessons: l.lessons,
          capacity: l.capacity,
          maxPerDay: p?.maxPerDay ?? null,
          maxPerWeek: p?.maxPerWeek ?? null,
          unavailable: (Array.isArray(p?.unavailable) ? p.unavailable : []).map((u) => ({ weekday: u.weekday, start: hhmm(u.startMinute), end: hhmm(u.endMinute) })),
          busyElsewhere: t.busy.map((b) => ({ weekday: b.weekday, start: hhmm(b.startMinute), end: hhmm(b.endMinute), label: b.label })),
          canEdit: !scope.branch || t.homeBranch?.id === scope.branch.id,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Sets a teacher's limits and unavailable times for a year. Managers: their branch's staff only. */
export async function saveTeacherLimits(scope, teacherId, input, user, req) {
  const prisma = getPrisma();
  const teacher = isUuid(teacherId)
    ? await prisma.user.findFirst({ where: { id: teacherId, role: 'STAFF', branch: { schoolId: scope.school.id } }, select: { id: true, name: true, staffId: true, branchId: true } })
    : null;
  if (!teacher) throw notFound('Teacher not found.');
  if (scope.branch && teacher.branchId !== scope.branch.id) throw forbidden('This teacher’s home branch is another branch. Their limits are set by their branch’s Manager or your School Owner.');
  const year = await prisma.academicYear.findFirst({ where: input.academicYear === 'current' ? { schoolId: scope.school.id, status: 'CURRENT' } : { id: input.academicYear, schoolId: scope.school.id } });
  if (!year) throw notFound('Academic year not found.');
  if (year.status === 'CLOSED') throw YEAR_CLOSED(year);
  await withBuilderLock(scope, teacher.branchId, 'teacher limits', async (tx) => {
    const before = await tx.teacherTimetableProfile.findUnique({ where: { teacherId_academicYearId: { teacherId: teacher.id, academicYearId: year.id } } });
    const after = before
      ? await tx.teacherTimetableProfile.update({ where: { id: before.id }, data: input.changes })
      : await tx.teacherTimetableProfile.create({ data: { schoolId: scope.school.id, academicYearId: year.id, teacherId: teacher.id, ...input.changes } });
    const describe = (list) => (Array.isArray(list) && list.length ? list.map((u) => `${DAY_LABELS[u.weekday]} ${hhmm(u.startMinute)}–${hhmm(u.endMinute)}`).join(', ') : null);
    const fields = [
      { field: 'Most lessons a day', from: show(before?.maxPerDay), to: show(after.maxPerDay) },
      { field: 'Most lessons a week', from: show(before?.maxPerWeek), to: show(after.maxPerWeek) },
      { field: 'Unavailable', from: describe(before?.unavailable), to: describe(after.unavailable) },
    ].filter((f) => f.from !== f.to);
    if (!fields.length) return;
    await audit(tx, AUDIT_ACTIONS.TEACHER_TIMETABLE_LIMITS_CHANGED, scope, {
      user,
      req,
      target: { type: 'staff', id: teacher.id, name: `${teacher.name} (${teacher.staffId})` },
      description: `Timetable limits of ${teacher.name} (${year.name}) changed: ${fields.map((f) => f.field).join(', ')}.`,
      fields,
      details: { academicYearId: year.id, branchId: teacher.branchId },
    });
  });
  const p = await prisma.teacherTimetableProfile.findUnique({ where: { teacherId_academicYearId: { teacherId: teacher.id, academicYearId: year.id } } });
  return {
    teacher: { id: teacher.id, name: teacher.name, staffId: teacher.staffId },
    maxPerDay: p?.maxPerDay ?? null,
    maxPerWeek: p?.maxPerWeek ?? null,
    unavailable: (Array.isArray(p?.unavailable) ? p.unavailable : []).map((u) => ({ weekday: u.weekday, start: hhmm(u.startMinute), end: hhmm(u.endMinute) })),
  };
}

// ---- generation and drafts ---------------------------------------------------------------------------

const draftSections = (model) => model.sections.map((s) => ({ sectionId: s.id, name: s.name, bellScheduleId: s.bell?.id ?? null, bellName: s.bell?.name ?? null, days: s.days }));

/** Classes of a draft with empty lesson periods: [{ sectionId, name, count }]. */
function emptyPeriods(sections, lessons) {
  return sections
    .map((s) => {
      const periods = Object.values(s.days ?? {}).reduce((n, list) => n + list.length, 0);
      const taken = lessons.filter((l) => l.sectionId === s.sectionId).length;
      return { sectionId: s.sectionId, name: s.name, count: periods - taken };
    })
    .filter((e) => e.count > 0);
}

/** Unplaced lessons per class and subject: lessons a week minus lessons in the draft. */
function unplacedFrom(units, lessons, reasons = []) {
  const need = new Map();
  for (const u of units) need.set(`${u.sectionId}|${u.subjectId}`, (need.get(`${u.sectionId}|${u.subjectId}`) ?? 0) + u.count);
  for (const l of lessons) {
    const k = `${l.sectionId}|${l.subjectId}`;
    if (need.has(k)) need.set(k, need.get(k) - 1);
  }
  return [...need.entries()]
    .filter(([, n]) => n > 0)
    .map(([k, count]) => {
      const [sectionId, subjectId] = k.split('|');
      const known = reasons.find((r) => r.sectionId === sectionId && r.subjectId === subjectId);
      return { sectionId, subjectId, teacherId: known?.teacherId ?? units.find((u) => u.sectionId === sectionId && u.subjectId === subjectId)?.teacherId ?? null, count, code: known?.code ?? 'removed', reason: known?.reason ?? 'taken out of the draft' };
    });
}

/**
 * Generates a branch's timetable into a draft (replacing the open draft). Refused while readiness
 * has blockers (409 NOT_READY with them). With keepLocked (default) the open draft's locked lessons
 * stay where they are. The search runs outside any transaction; the draft is written after, and
 * refused if the open draft changed meanwhile (409 STALE_DRAFT).
 */
export async function generate(scope, input, user) {
  const prisma = getPrisma();
  const today = await calendarToday();
  const { year, branch, yearStart, yearEnd } = await resolveContext(prisma, scope, input);
  if (year.status === 'CLOSED') throw YEAR_CLOSED(year);
  const planDate = input.date ?? defaultPlanDate(today, yearStart, yearEnd);
  if (!planDate || planDate < yearStart || planDate > yearEnd) throw badRequest('Check the highlighted fields.', { date: `Choose a date within ${year.name} (${yearStart} to ${yearEnd}).` });
  if (planDate < today) throw badRequest('Check the highlighted fields.', { date: `Choose today (${today}) or a later date.` });
  const [setup, open] = await Promise.all([
    loadSetup(prisma, branch.id, year.id),
    prisma.timetableDraft.findFirst({ where: { branchId: branch.id, academicYearId: year.id, status: 'DRAFT' }, include: { lessons: true } }),
  ]);
  const model = await buildModel(prisma, scope, { year, branch, planDate, setup });
  if (model.blockers.length) throw conflict('NOT_READY', `The timetable cannot be generated yet: ${model.blockers[0].message}`, { blockers: model.blockers });

  // Locked lessons of the open draft that still fit (class, subject and teacher still taught).
  const locked = input.keepLocked && open
    ? open.lessons
        .filter((l) => l.locked && !l.fixed)
        .filter((l) => model.units.some((u) => u.sectionId === l.sectionId && u.subjectId === l.subjectId && u.teacherId === l.teacherId))
        .filter((l) => !model.fixed.some((f) => f.sectionId === l.sectionId && f.weekday === l.weekday && f.period === l.periodNumber))
        .map((l) => ({ sectionId: l.sectionId, weekday: l.weekday, period: l.periodNumber, subjectId: l.subjectId, teacherId: l.teacherId, locked: true }))
    : [];
  const seed = input.seed ?? randomInt(1, 2 ** 31);
  const result = generateTimetable({
    sections: model.sections.map((s) => ({ id: s.id, name: s.name, days: s.days })),
    units: model.units,
    fixed: [...model.fixed, ...locked],
    teachers: model.teachers,
    rules: model.rules,
    seed,
    timeLimitMs: model.rules.searchSeconds * 1000,
  });
  // Never store a broken timetable (the generator guarantees this; checked again here).
  const violations = hardViolations({ sections: model.sections, lessons: result.lessons, teachers: model.teachers, rules: model.rules });
  if (violations.length) throw new Error(`Generator produced a conflicting timetable: ${violations[0].message}`);

  const draftId = await withBuilderLock(scope, branch.id, 'timetables', async (tx) => {
    const current = await tx.timetableDraft.findFirst({ where: { branchId: branch.id, academicYearId: year.id, status: 'DRAFT' }, select: { id: true, revision: true } });
    if ((current?.id ?? null) !== (open?.id ?? null) || (current && current.revision !== open.revision)) throw STALE();
    if (current) await tx.timetableDraft.update({ where: { id: current.id }, data: { status: 'DISCARDED', discardedAt: new Date() } });
    const setupRow =
      setup ?? (await tx.timetableSetup.upsert({ where: { branchId_academicYearId: { branchId: branch.id, academicYearId: year.id } }, update: {}, create: { schoolId: scope.school.id, academicYearId: year.id, branchId: branch.id } }));
    const draft = await tx.timetableDraft.create({
      data: {
        schoolId: scope.school.id,
        academicYearId: year.id,
        branchId: branch.id,
        setupId: setupRow.id,
        planDate: asDbDay(planDate),
        sections: draftSections(model),
        seed,
        createdById: user.id,
        report: {
          score: result.score,
          stats: result.stats,
          unplaced: result.unplaced,
          problems: result.problems,
          warnings: model.warnings,
          rules: model.rules,
          lockedKept: locked.length,
          edited: false,
        },
      },
    });
    if (result.lessons.length) {
      await tx.timetableDraftLesson.createMany({
        data: result.lessons.map((l) => ({ draftId: draft.id, sectionId: l.sectionId, weekday: l.weekday, periodNumber: l.period, subjectId: l.subjectId, teacherId: l.teacherId, locked: l.locked, fixed: l.fixed })),
      });
    }
    return draft.id;
  });
  return getDraft(scope, { academicYear: year.id, branch: branch.id, draftId });
}

async function findDraft(client, scope, id) {
  const draft = isUuid(id) ? await client.timetableDraft.findFirst({ where: { id, schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) } }) : null;
  if (!draft) throw notFound('Draft not found.');
  return draft;
}

/**
 * The open draft of a branch and year (or `draftId`): classes with their periods, lessons, lessons
 * left out (with the reason), each teacher's week, and the generation report. { draft: null } when
 * there is none.
 */
export async function getDraft(scope, query) {
  const prisma = getPrisma();
  const { year, branch } = await resolveContext(prisma, scope, query);
  const draft = query.draftId
    ? await findDraft(prisma, scope, query.draftId)
    : await prisma.timetableDraft.findFirst({ where: { branchId: branch.id, academicYearId: year.id, status: 'DRAFT' } });
  if (!draft) return { draft: null };
  const lessons = await prisma.timetableDraftLesson.findMany({
    where: { draftId: draft.id },
    include: { subject: { select: { id: true, name: true, code: true } }, teacher: { select: { id: true, name: true, staffId: true } } },
  });
  const sections = Array.isArray(draft.sections) ? draft.sections : [];
  const report = draft.report ?? {};
  const subjectIds = [...new Set((report.unplaced ?? []).map((u) => u.subjectId))];
  const teacherIds = [...new Set([...(report.unplaced ?? []).map((u) => u.teacherId).filter(Boolean), ...lessons.map((l) => l.teacherId).filter(Boolean)])];
  const [subjects, teachers] = await Promise.all([
    subjectIds.length ? prisma.subject.findMany({ where: { id: { in: subjectIds } }, select: { id: true, name: true, code: true } }) : [],
    teacherIds.length ? prisma.user.findMany({ where: { id: { in: teacherIds } }, select: { id: true, name: true, staffId: true } }) : [],
  ]);
  const subjectById = new Map([...subjects, ...lessons.map((l) => l.subject)].map((s) => [s.id, s]));
  const teacherById = new Map(teachers.map((t) => [t.id, t]));
  const sectionName = new Map(sections.map((s) => [s.sectionId, s.name]));
  const perTeacher = new Map();
  for (const l of lessons) {
    if (!l.teacherId) continue;
    const t = perTeacher.get(l.teacherId) ?? { id: l.teacherId, name: l.teacher.name, staffId: l.teacher.staffId, lessons: 0, perDay: {} };
    t.lessons += 1;
    t.perDay[l.weekday] = (t.perDay[l.weekday] ?? 0) + 1;
    perTeacher.set(l.teacherId, t);
  }
  return {
    draft: {
      id: draft.id,
      status: draft.status.toLowerCase(),
      revision: draft.revision,
      planDate: toDay(draft.planDate),
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
      publishedFrom: draft.publishedFrom ? toDay(draft.publishedFrom) : null,
      academicYear: { id: year.id, name: year.name, endDate: toDay(year.endDate) },
      branch: { id: branch.id, name: branch.name },
      seed: draft.seed,
      sections: sections.map((s) => ({
        id: s.sectionId,
        displayName: s.name,
        bell: s.bellScheduleId ? { id: s.bellScheduleId, name: s.bellName } : null,
        periods: Object.fromEntries(Object.entries(s.days ?? {}).map(([d, list]) => [d, list.map((p) => ({ number: p.number, start: hhmm(p.startMinute), end: hhmm(p.endMinute), half: p.half }))])),
      })),
      lessons: lessons
        .map((l) => ({ id: l.id, sectionId: l.sectionId, weekday: l.weekday, period: l.periodNumber, subject: l.subject, teacher: l.teacher ?? null, locked: l.locked, fixed: l.fixed }))
        .sort((a, b) => a.sectionId.localeCompare(b.sectionId) || WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) || a.period - b.period),
      unplaced: (report.unplaced ?? []).map((u) => ({
        section: { id: u.sectionId, displayName: sectionName.get(u.sectionId) ?? '' },
        subject: subjectById.get(u.subjectId) ?? { id: u.subjectId, name: '' },
        teacher: u.teacherId ? teacherById.get(u.teacherId) ?? null : null,
        count: u.count,
        code: u.code,
        reason: u.reason,
      })),
      problems: report.problems ?? [],
      warnings: report.warnings ?? [],
      score: report.score ?? null,
      stats: report.stats ?? null,
      edited: Boolean(report.edited),
      rules: report.rules ?? null,
      fillAllPeriods: rulesOf(await prisma.timetableSetup.findUnique({ where: { id: draft.setupId } })).fillAllPeriods,
      emptyPeriods: emptyPeriods(sections, lessons.map((l) => ({ sectionId: l.sectionId }))),
      teachers: [...perTeacher.values()].sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

/**
 * Edits the open draft (move or swap, lock, unlock, remove, place a lesson left out, change the
 * teacher). Every edit is checked against the hard rules with today's teaching, limits and lessons
 * elsewhere; one that would break any is refused (409 DRAFT_CONFLICT, with the reasons). Stale
 * revisions are refused (409 STALE_DRAFT).
 */
export async function editDraft(scope, draftId, edit) {
  const prisma = getPrisma();
  const draft = await findDraft(prisma, scope, draftId);
  if (draft.status !== 'DRAFT') throw conflict('DRAFT_CLOSED', 'This draft was already published or discarded.');
  const year = await prisma.academicYear.findUnique({ where: { id: draft.academicYearId } });
  const branch = await prisma.branch.findUnique({ where: { id: draft.branchId }, select: { id: true, name: true, code: true, status: true } });
  const planDate = toDay(draft.planDate);
  const setup = await loadSetup(prisma, branch.id, year.id);
  const model = await buildModel(prisma, scope, { year, branch, planDate, setup });
  const sections = (Array.isArray(draft.sections) ? draft.sections : []).map((s) => ({ id: s.sectionId, name: s.name, days: s.days }));

  await withBuilderLock(scope, branch.id, 'timetables', async (tx) => {
    const current = await tx.timetableDraft.findUnique({ where: { id: draft.id } });
    if (current.status !== 'DRAFT') throw conflict('DRAFT_CLOSED', 'This draft was already published or discarded.');
    if (current.revision !== edit.revision) throw STALE();
    const rows = await tx.timetableDraftLesson.findMany({ where: { draftId: draft.id } });
    const lessons = rows.map((r) => ({ ...r, period: r.periodNumber }));
    const at = (sectionId, slot) => lessons.find((l) => l.sectionId === sectionId && l.weekday === slot.weekday && l.periodNumber === slot.periodNumber);
    const byId = (id) => {
      const l = lessons.find((x) => x.id === id);
      if (!l) throw notFound('Lesson not found in the draft.');
      return l;
    };
    const section = (id) => {
      const s = sections.find((x) => x.id === id);
      if (!s) throw notFound('Class not found in the draft.');
      return s;
    };
    const periodExists = (s, slot) => (s.days?.[slot.weekday] ?? []).some((p) => p.number === slot.periodNumber);
    const ops = [];

    if (edit.action === 'move') {
      const s = section(edit.sectionId);
      const a = at(s.id, edit.from);
      if (!a) throw notFound('There is no lesson there.');
      if (!periodExists(s, edit.to)) throw badRequest('Check the highlighted fields.', { to: 'There is no such lesson period.' });
      const b = at(s.id, edit.to);
      if (a.fixed || b?.fixed) throw conflict('FIXED_LESSON', 'Fixed lessons stay where they are. Change them in the setup.');
      if (b === a) return;
      ops.push({ remove: a }, ...(b ? [{ remove: b }] : []));
      const movedA = { ...a, weekday: edit.to.weekday, periodNumber: edit.to.periodNumber, period: edit.to.periodNumber };
      const movedB = b && { ...b, weekday: edit.from.weekday, periodNumber: edit.from.periodNumber, period: edit.from.periodNumber };
      lessons.splice(lessons.indexOf(a), 1, movedA);
      if (b) lessons.splice(lessons.indexOf(b), 1, movedB);
      ops.push({ create: movedA }, ...(movedB ? [{ create: movedB }] : []));
    } else if (edit.action === 'lock' || edit.action === 'unlock') {
      const l = byId(edit.lessonId);
      if (l.fixed) throw conflict('FIXED_LESSON', 'Fixed lessons are always kept. Change them in the setup.');
      ops.push({ update: l, data: { locked: edit.action === 'lock' } });
    } else if (edit.action === 'remove') {
      const l = byId(edit.lessonId);
      if (l.fixed) throw conflict('FIXED_LESSON', 'Fixed lessons are removed in the setup.');
      lessons.splice(lessons.indexOf(l), 1);
      ops.push({ remove: l });
    } else if (edit.action === 'place') {
      const s = section(edit.sectionId);
      if (!periodExists(s, edit.to)) throw badRequest('Check the highlighted fields.', { to: 'There is no such lesson period.' });
      if (at(s.id, edit.to)) throw conflict('PERIOD_TAKEN', 'That period already has a lesson. Move it first.');
      const units = model.units.filter((u) => u.sectionId === s.id && u.subjectId === edit.subjectId);
      if (!units.length) throw badRequest('Check the highlighted fields.', { subject: 'This subject is not taught in this class.' });
      const weekly = units.reduce((n, u) => n + u.count, 0);
      const placed = lessons.filter((l) => l.sectionId === s.id && l.subjectId === edit.subjectId).length;
      if (placed >= weekly) throw conflict('SUBJECT_COMPLETE', `This subject already has its ${weekly} lessons a week here.`);
      let teacherId = edit.teacherId;
      if (teacherId && !units.some((u) => u.teacherId === teacherId)) throw badRequest('Check the highlighted fields.', { teacher: 'This teacher does not teach the subject in this class.' });
      if (!teacherId) teacherId = units.find((u) => lessons.filter((l) => l.sectionId === s.id && l.subjectId === edit.subjectId && l.teacherId === u.teacherId).length < u.count)?.teacherId ?? units[0].teacherId;
      const created = { id: null, draftId: draft.id, sectionId: s.id, weekday: edit.to.weekday, periodNumber: edit.to.periodNumber, period: edit.to.periodNumber, subjectId: edit.subjectId, teacherId, locked: false, fixed: false };
      lessons.push(created);
      ops.push({ create: created });
    } else if (edit.action === 'teacher') {
      const l = byId(edit.lessonId);
      if (l.fixed) throw conflict('FIXED_LESSON', 'Fixed lessons are changed in the setup.');
      if (!model.units.some((u) => u.sectionId === l.sectionId && u.subjectId === l.subjectId && u.teacherId === edit.teacherId)) {
        throw badRequest('Check the highlighted fields.', { teacher: 'This teacher does not teach the subject in this class.' });
      }
      l.teacherId = edit.teacherId;
      ops.push({ update: l, data: { teacherId: edit.teacherId } });
    }

    // Hard rules with today's data (teachers' other lessons, limits, unavailable times).
    const violations = hardViolations({
      sections,
      lessons: lessons.map((l) => ({ sectionId: l.sectionId, weekday: l.weekday, period: l.periodNumber, subjectId: l.subjectId, teacherId: l.teacherId })),
      teachers: model.teachers,
      rules: model.rules,
    });
    if (violations.length) {
      const names = new Map(sections.map((s) => [s.id, s.name]));
      const messages = [...new Set(violations.map((v) => (v.lesson ? `${names.get(v.lesson.sectionId) ?? ''} ${DAY_LABELS[v.lesson.weekday]} period ${v.lesson.period}: ${v.message}` : v.message)))];
      throw conflict('DRAFT_CONFLICT', messages[0], { conflicts: messages.slice(0, 10) });
    }

    for (const op of ops) {
      if (op.remove) await tx.timetableDraftLesson.deleteMany({ where: { id: op.remove.id } });
    }
    for (const op of ops) {
      if (op.create) {
        await tx.timetableDraftLesson.create({
          data: { draftId: draft.id, sectionId: op.create.sectionId, weekday: op.create.weekday, periodNumber: op.create.periodNumber, subjectId: op.create.subjectId, teacherId: op.create.teacherId, locked: op.create.locked, fixed: op.create.fixed },
        });
      }
      if (op.update) await tx.timetableDraftLesson.update({ where: { id: op.update.id }, data: op.data });
    }
    const report = current.report ?? {};
    await tx.timetableDraft.update({
      where: { id: draft.id },
      data: { revision: current.revision + 1, report: { ...report, edited: true, unplaced: unplacedFrom(model.units, lessons, report.unplaced ?? []) } },
    });
  });
  return getDraft(scope, { academicYear: year.id, branch: branch.id, draftId: draft.id });
}

/** Discards the open draft (nothing is published). */
export async function discardDraft(scope, draftId, revision) {
  const prisma = getPrisma();
  const draft = await findDraft(prisma, scope, draftId);
  await withBuilderLock(scope, draft.branchId, 'timetables', async (tx) => {
    const current = await tx.timetableDraft.findUnique({ where: { id: draft.id } });
    if (current.status !== 'DRAFT') throw conflict('DRAFT_CLOSED', 'This draft was already published or discarded.');
    if (current.revision !== revision) throw STALE();
    await tx.timetableDraft.update({ where: { id: draft.id }, data: { status: 'DISCARDED', discardedAt: new Date() } });
  });
  return { draft: null };
}

/**
 * Publishes the open draft from `effectiveFrom`: every class's timetable is written through the
 * timetable editor's checks (bell times on that date, subjects, teaching assignments), with one
 * teacher-clash check over all of them and every other timetable of the school, in one transaction:
 * all classes or none. Earlier timetables and attendance stay as they were.
 */
export async function publishDraft(scope, draftId, { revision, effectiveFrom }, user, req) {
  const prisma = getPrisma();
  const today = await calendarToday();
  const draft = await findDraft(prisma, scope, draftId);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`classes:${scope.school.id}`}))`;
    await lockFor(tx, scope, draft.branchId, 'timetables');
    const current = await tx.timetableDraft.findUnique({ where: { id: draft.id }, include: { branch: true, academicYear: true } });
    if (current.status !== 'DRAFT') throw conflict('DRAFT_CLOSED', 'This draft was already published or discarded.');
    if (current.revision !== revision) throw STALE();
    const year = current.academicYear;
    if (year.status === 'CLOSED') throw YEAR_CLOSED(year);
    const lessons = await tx.timetableDraftLesson.findMany({ where: { draftId: draft.id } });
    const sections = Array.isArray(current.sections) ? current.sections : [];
    if (!lessons.length) throw conflict('DRAFT_EMPTY', 'The draft has no lessons to publish.');
    const setupRules = rulesOf(await tx.timetableSetup.findUnique({ where: { id: current.setupId } }));
    if (setupRules.fillAllPeriods) {
      const empty = emptyPeriods(sections, lessons);
      if (empty.length) {
        throw conflict('DRAFT_INCOMPLETE', `Every period needs a lesson: ${empty.map((e) => `${e.name} has ${e.count} empty`).join(', ')}. Place the lessons left out first.`, { classes: empty });
      }
    }

    const plans = [];
    for (const s of sections) {
      const own = lessons.filter((l) => l.sectionId === s.sectionId);
      if (!own.length || !s.bellScheduleId) continue;
      try {
        const plan = await prepareTimetableVersion(
          tx,
          scope,
          s.sectionId,
          { effectiveFrom, bellScheduleId: s.bellScheduleId, lessons: own.map((l, index) => ({ index, weekday: l.weekday, periodNumber: l.periodNumber, subjectId: l.subjectId, teacherId: l.teacherId, room: null })) },
          today,
          { note: ' Generated with the timetable builder.' },
        );
        if (!plan.unchanged) plans.push(plan);
      } catch (error) {
        const detail = error.details ? Object.values(error.details)[0] : null;
        throw conflict('PUBLISH_REFUSED', `${s.name}: ${detail ?? error.message}`, { sectionId: s.sectionId, ...(error.details && { details: error.details }) });
      }
    }
    if (plans.length) {
      await assertNoClashes(tx, scope, {
        add: plans.map((p) => p.candidate),
        remove: new Set(plans.map((p) => p.replaced?.id).filter(Boolean)),
        candidates: (v) => String(v.id).startsWith('new:'),
        clipFrom: effectiveFrom,
        teacherIds: new Set(plans.flatMap((p) => p.teacherIds)),
      });
    }
    for (const p of plans) await p.write(tx, user, req);
    await tx.timetableDraft.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: user.id, publishedFrom: asDbDay(effectiveFrom), revision: current.revision + 1 } });
    await audit(tx, AUDIT_ACTIONS.TIMETABLE_PUBLISHED, scope, {
      user,
      req,
      target: { type: 'timetable_setup', id: current.setupId, name: `${current.branch.name} (${year.name})` },
      description: `Generated timetable of ${current.branch.name} (${year.name}) published from ${effectiveFrom}: ${plans.length} class${plans.length === 1 ? '' : 'es'} changed, ${lessons.length} lessons a week.`,
      fields: [
        { field: 'Classes changed', from: null, to: String(plans.length) },
        { field: 'Lessons a week', from: null, to: String(lessons.length) },
        { field: 'Effective from', from: null, to: effectiveFrom },
      ],
      details: { academicYearId: year.id, branchId: current.branchId, draftId: draft.id },
    });
    return { changed: plans.length, unchanged: sections.length - plans.length, warnings: plans.flatMap((p) => p.warnings).slice(0, 20) };
  }, PUBLISH_TX);
  return { published: true, effectiveFrom, ...result };
}
