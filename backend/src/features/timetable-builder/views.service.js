import { notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { asDbDay, toDay, versionOn, weekdaysOn } from '../academic-calendar/schoolDays.js';
import { sectionDisplayName } from '../classes/classInput.js';
import { WEEKDAYS } from '../schedules/scheduleInput.js';
import { dayPlan, minutesToTime } from '../timetable/bellTimes.js';

/*
 * Timetable views (docs/business-rules.md → Timetable builder → Views): the class timetable, the
 * teacher timetable and the master timetable of a branch, as weekly grids. Source 'published' (the
 * timetables in effect on a date, default today) or 'draft' (the branch's open draft). Read only.
 *
 * Scope: School Owner — every branch and teacher of the school; Manager — their branch's classes,
 * and teachers whose home branch is theirs or who teach there (a teacher's grid shows all their
 * lessons in the school, so busy times elsewhere are visible). Anything else is not found (404).
 */

const hhmm = minutesToTime;
const subjectSelect = { id: true, name: true, code: true };
const teacherSelect = { id: true, name: true, staffId: true };
const plain = (rows) => rows.filter((v) => !v.cancelledAt).map((v) => ({ ...v, effectiveFrom: toDay(v.effectiveFrom) }));
const dayOrder = (a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b);

async function yearOf(client, scope, academicYear) {
  const year = await client.academicYear.findFirst({ where: academicYear === 'current' ? { schoolId: scope.school.id, status: 'CURRENT' } : { id: academicYear, schoolId: scope.school.id } });
  if (!year) throw notFound(academicYear === 'current' ? 'There is no current academic year.' : 'Academic year not found.');
  return year;
}

async function branchOf(client, scope, branchId) {
  const id = scope.branch?.id ?? branchId;
  const branch = isUuid(id) ? await client.branch.findFirst({ where: { id, schoolId: scope.school.id }, select: { id: true, name: true, code: true } }) : null;
  if (!branch) throw notFound('Branch not found.');
  return branch;
}

/** Periods of a bell version on each weekday: { MON: [{ kind, number, name, start, end, half }] }. */
function periodsOf(times) {
  const out = {};
  if (!times) return out;
  for (const day of WEEKDAYS) {
    const plan = dayPlan(times.periods, day);
    if (plan.some((p) => p.kind === 'LESSON')) out[day] = plan.map((p) => ({ kind: p.kind === 'LESSON' ? 'lesson' : 'break', number: p.number, name: p.name, start: hhmm(p.startMinute), end: hhmm(p.endMinute), startMinute: p.startMinute, endMinute: p.endMinute, half: p.half }));
  }
  return out;
}

/**
 * The published timetables of sections on `date`: Map sectionId → { version, bell: { id, name },
 * periods, lessons: [{ weekday, period, subject, teacher, room }] }. Fixed number of queries.
 */
async function publishedOn(client, sectionIds, date) {
  const result = new Map();
  if (!sectionIds.length) return result;
  const versions = await client.timetableVersion.findMany({
    where: { sectionId: { in: sectionIds }, cancelledAt: null, effectiveFrom: { lte: asDbDay(date) } },
    select: { id: true, sectionId: true, bellScheduleId: true, effectiveFrom: true, bellSchedule: { select: { id: true, name: true } } },
  });
  const inEffect = new Map();
  for (const v of plain(versions)) {
    const prev = inEffect.get(v.sectionId);
    if (!prev || v.effectiveFrom > prev.effectiveFrom) inEffect.set(v.sectionId, v);
  }
  const ids = [...inEffect.values()].map((v) => v.id);
  const bellIds = [...new Set([...inEffect.values()].map((v) => v.bellScheduleId))];
  const [slots, bells] = await Promise.all([
    ids.length ? client.timetableSlot.findMany({ where: { versionId: { in: ids } }, include: { subject: { select: subjectSelect }, teacher: { select: teacherSelect } } }) : [],
    bellIds.length ? client.bellScheduleVersion.findMany({ where: { bellScheduleId: { in: bellIds }, cancelledAt: null, effectiveFrom: { lte: asDbDay(date) } }, select: { bellScheduleId: true, effectiveFrom: true, periods: true } }) : [],
  ]);
  const bellTimes = new Map();
  for (const b of bells) bellTimes.set(b.bellScheduleId, [...(bellTimes.get(b.bellScheduleId) ?? []), { ...b, effectiveFrom: toDay(b.effectiveFrom) }]);
  for (const v of inEffect.values()) {
    const times = versionOn(bellTimes.get(v.bellScheduleId) ?? [], date);
    result.set(v.sectionId, {
      version: { id: v.id, effectiveFrom: v.effectiveFrom },
      bell: v.bellSchedule,
      periods: periodsOf(times),
      lessons: slots.filter((s) => s.versionId === v.id).map((s) => ({ weekday: s.weekday, period: s.periodNumber, subject: s.subject, teacher: s.teacher ?? null, room: s.room ?? '' })),
    });
  }
  return result;
}

/** The weekly school days on `date` of each branch: Map branchId → ['SAT', …] (empty when none are set). */
async function schoolDaysOf(client, yearId, branchIds, date) {
  const ids = [...new Set(branchIds)];
  const rows = ids.length ? await client.academicWeekdays.findMany({ where: { academicYearId: yearId, cancelledAt: null, OR: [{ branchId: null }, { branchId: { in: ids } }] }, select: { branchId: true, days: true, followsSchool: true, effectiveFrom: true } }) : [];
  const plainRows = (list) => list.map((v) => ({ days: v.days, followsSchool: v.followsSchool, effectiveFrom: toDay(v.effectiveFrom) }));
  const school = plainRows(rows.filter((v) => !v.branchId));
  return new Map(ids.map((id) => [id, weekdaysOn({ schoolVersions: school, branchVersions: plainRows(rows.filter((v) => v.branchId === id)) }, date).days]));
}

/**
 * A published timetable seen on the school days in effect: days that are no longer school days are
 * left out, and what does not fit is counted → { ...grid, gaps: { empty, offDay, offDays } }:
 * `empty` lesson periods with no lesson, `offDay` lessons on days that are not school days. A
 * timetable published before the school days or bell changed shows its gaps instead of hiding them.
 */
export function onSchoolDays(grid, days) {
  if (!grid) return grid;
  const keep = days.length ? (d) => days.includes(d) : () => true;
  const periods = Object.fromEntries(Object.entries(grid.periods).filter(([d]) => keep(d)));
  const lessons = grid.lessons.filter((l) => keep(l.weekday));
  const offDays = [...new Set(grid.lessons.filter((l) => !keep(l.weekday)).map((l) => l.weekday))].sort(dayOrder);
  let empty = 0;
  for (const [d, list] of Object.entries(periods)) for (const p of list) if (p.kind === 'lesson' && !lessons.some((l) => l.weekday === d && l.period === p.number)) empty += 1;
  return { ...grid, periods, lessons, gaps: { empty, offDay: grid.lessons.length - lessons.length, offDays } };
}

async function openDraft(client, branchId, yearId) {
  const draft = await client.timetableDraft.findFirst({ where: { branchId, academicYearId: yearId, status: 'DRAFT' } });
  if (!draft) return null;
  const lessons = await client.timetableDraftLesson.findMany({ where: { draftId: draft.id }, include: { subject: { select: subjectSelect }, teacher: { select: teacherSelect } } });
  const sections = new Map();
  for (const s of Array.isArray(draft.sections) ? draft.sections : []) {
    const periods = Object.fromEntries(
      Object.entries(s.days ?? {}).map(([d, list]) => [d, list.map((p) => ({ kind: 'lesson', number: p.number, name: null, start: hhmm(p.startMinute), end: hhmm(p.endMinute), startMinute: p.startMinute, endMinute: p.endMinute, half: p.half }))]),
    );
    sections.set(s.sectionId, {
      version: null,
      bell: s.bellScheduleId ? { id: s.bellScheduleId, name: s.bellName } : null,
      periods,
      lessons: lessons.filter((l) => l.sectionId === s.sectionId).map((l) => ({ id: l.id, weekday: l.weekday, period: l.periodNumber, subject: l.subject, teacher: l.teacher ?? null, room: '', locked: l.locked, fixed: l.fixed })),
    });
  }
  return { draft, sections };
}

/** The first date after `date` when one of these classes gets a (new) timetable, or null. */
async function nextStartAfter(client, sectionIds, date) {
  if (!sectionIds.length) return null;
  const next = await client.timetableVersion.findFirst({
    where: { sectionId: { in: sectionIds }, cancelledAt: null, effectiveFrom: { gt: asDbDay(date) } },
    orderBy: { effectiveFrom: 'asc' },
    select: { effectiveFrom: true },
  });
  return next ? toDay(next.effectiveFrom) : null;
}

const daysOf = (grids) => [...new Set(grids.flatMap((g) => Object.keys(g.periods ?? {})))].sort(dayOrder);
const stripMinutes = (periods) => Object.fromEntries(Object.entries(periods).map(([d, list]) => [d, list.map(({ startMinute, endMinute, ...p }) => p)]));

/** The master timetable of a branch: every class's week. */
export async function masterView(scope, { academicYear, branch: branchId, date, source }) {
  const prisma = getPrisma();
  const today = await calendarToday();
  const [year, branch] = await Promise.all([yearOf(prisma, scope, academicYear), branchOf(prisma, scope, branchId)]);
  const on = date ?? today;
  const sections = await prisma.section.findMany({
    where: { schoolId: scope.school.id, branchId: branch.id, academicYearId: year.id, status: 'ACTIVE' },
    include: { class: { select: { name: true, sequence: true } } },
    orderBy: [{ class: { sequence: 'asc' } }, { nameKey: 'asc' }],
  });
  let grids;
  let draft = null;
  if (source === 'draft') {
    const d = await openDraft(prisma, branch.id, year.id);
    if (!d) throw notFound('There is no draft for this branch and year. Generate one first.');
    draft = d.draft;
    grids = d.sections;
  } else {
    const days = (await schoolDaysOf(prisma, year.id, [branch.id], on)).get(branch.id);
    grids = new Map([...(await publishedOn(prisma, sections.map((s) => s.id), on))].map(([id, g]) => [id, onSchoolDays(g, days)]));
  }
  const items = sections
    .filter((s) => source !== 'draft' || grids.has(s.id))
    .map((s) => {
      const g = grids.get(s.id);
      return { id: s.id, displayName: sectionDisplayName(s.class.name, s.name), room: s.room ?? '', bell: g?.bell ?? null, effectiveFrom: g?.version?.effectiveFrom ?? null, periods: stripMinutes(g?.periods ?? {}), lessons: g?.lessons ?? [], gaps: g?.gaps ?? null };
    });
  const teachers = new Map();
  for (const s of items) {
    for (const l of s.lessons) {
      if (!l.teacher) continue;
      const t = teachers.get(l.teacher.id) ?? { ...l.teacher, lessons: 0 };
      t.lessons += 1;
      teachers.set(l.teacher.id, t);
    }
  }
  return {
    kind: 'master',
    source,
    nextStart: source === 'draft' ? null : await nextStartAfter(prisma, items.filter((s) => !s.lessons.length).map((s) => s.id), on),
    date: source === 'draft' ? toDay(draft.planDate) : on,
    draft: draft && { id: draft.id, revision: draft.revision, planDate: toDay(draft.planDate) },
    academicYear: { id: year.id, name: year.name },
    branch,
    days: daysOf([...grids.values()]),
    sections: items,
    teachers: [...teachers.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** A class's timetable (one section's week). */
export async function sectionView(scope, sectionId, { date, source }) {
  const prisma = getPrisma();
  const today = await calendarToday();
  const section = isUuid(sectionId)
    ? await prisma.section.findFirst({
        where: { id: sectionId, schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) },
        include: { class: { select: { name: true } }, branch: { select: { id: true, name: true, code: true } }, academicYear: { select: { id: true, name: true } } },
      })
    : null;
  if (!section) throw notFound('Class not found.');
  const on = date ?? today;
  let grid;
  let draft = null;
  if (source === 'draft') {
    const d = await openDraft(prisma, section.branchId, section.academicYearId);
    if (!d || !d.sections.has(section.id)) throw notFound('There is no draft with this class. Generate one first.');
    draft = d.draft;
    grid = d.sections.get(section.id);
  } else {
    const days = (await schoolDaysOf(prisma, section.academicYearId, [section.branchId], on)).get(section.branchId);
    grid = onSchoolDays((await publishedOn(prisma, [section.id], on)).get(section.id) ?? null, days);
  }
  return {
    kind: 'section',
    source,
    nextStart: draft || grid?.lessons?.length ? null : await nextStartAfter(prisma, [section.id], on),
    date: draft ? toDay(draft.planDate) : on,
    academicYear: section.academicYear,
    branch: section.branch,
    section: { id: section.id, displayName: sectionDisplayName(section.class.name, section.name), room: section.room ?? '' },
    bell: grid?.bell ?? null,
    effectiveFrom: grid?.version?.effectiveFrom ?? null,
    days: daysOf(grid ? [grid] : []),
    periods: stripMinutes(grid?.periods ?? {}),
    lessons: grid?.lessons ?? [],
    gaps: grid?.gaps ?? null,
  };
}

/**
 * A teacher's timetable: their lessons in every class of the school in effect on `date` (or, with
 * source 'draft', the branch's open draft, plus their published lessons in other branches as
 * "elsewhere"). Rows are clock times, so lessons on different bell schedules line up.
 */
export async function teacherView(scope, teacherId, { academicYear, branch: branchId, date, source }) {
  const prisma = getPrisma();
  const today = await calendarToday();
  const teacher = isUuid(teacherId)
    ? await prisma.user.findFirst({ where: { id: teacherId, role: 'STAFF', branch: { schoolId: scope.school.id } }, select: { id: true, name: true, staffId: true, jobTitle: true, branchId: true, branch: { select: { id: true, name: true } } } })
    : null;
  if (!teacher) throw notFound('Teacher not found.');
  const year = await yearOf(prisma, scope, academicYear);
  if (scope.branch && teacher.branchId !== scope.branch.id) {
    const teachesHere = await prisma.teachingAssignment.count({ where: { teacherId: teacher.id, branchId: scope.branch.id, academicYearId: year.id, cancelledAt: null } });
    if (!teachesHere) throw notFound('Teacher not found.');
  }
  const on = date ?? today;
  const sections = await prisma.section.findMany({
    where: { schoolId: scope.school.id, academicYearId: year.id },
    include: { class: { select: { name: true } }, branch: { select: { id: true, name: true } } },
  });
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const branchDays = await schoolDaysOf(prisma, year.id, sections.map((s) => s.branchId), on);
  const published = new Map([...(await publishedOn(prisma, sections.map((s) => s.id), on))].map(([id, g]) => [id, onSchoolDays(g, branchDays.get(sectionById.get(id).branchId) ?? [])]));
  let grids = published;
  let draft = null;
  let draftBranch = null;
  if (source === 'draft') {
    draftBranch = await branchOf(prisma, scope, branchId ?? teacher.branchId);
    const d = await openDraft(prisma, draftBranch.id, year.id);
    if (!d) throw notFound('There is no draft for this branch and year. Generate one first.');
    draft = d.draft;
    grids = new Map([...published].filter(([id]) => sectionById.get(id)?.branchId !== draftBranch.id));
    for (const [id, g] of d.sections) grids.set(id, g);
  }
  const lessons = [];
  for (const [sectionId, g] of grids) {
    const s = sectionById.get(sectionId);
    if (!s) continue;
    for (const l of g.lessons) {
      if (l.teacher?.id !== teacher.id) continue;
      const p = (g.periods[l.weekday] ?? []).find((x) => x.kind === 'lesson' && x.number === l.period);
      if (!p) continue;
      lessons.push({
        weekday: l.weekday,
        period: l.period,
        start: p.start,
        end: p.end,
        startMinute: p.startMinute,
        endMinute: p.endMinute,
        section: { id: s.id, displayName: sectionDisplayName(s.class.name, s.name), branch: s.branch },
        subject: l.subject,
        room: l.room || s.room || '',
        elsewhere: Boolean(draftBranch && s.branchId !== draftBranch.id),
      });
    }
  }
  lessons.sort((a, b) => dayOrder(a.weekday, b.weekday) || a.startMinute - b.startMinute);
  // Rows: every distinct lesson time of the sections they teach (so free periods show too).
  const theirSections = new Set(lessons.map((l) => l.section.id));
  const rows = new Map();
  for (const id of theirSections) {
    for (const list of Object.values(grids.get(id)?.periods ?? {})) {
      for (const p of list) if (p.kind === 'lesson') rows.set(`${p.start}-${p.end}`, { start: p.start, end: p.end, startMinute: p.startMinute });
    }
  }
  const perDay = {};
  for (const l of lessons) perDay[l.weekday] = (perDay[l.weekday] ?? 0) + 1;
  return {
    kind: 'teacher',
    source,
    date: draft ? toDay(draft.planDate) : on,
    draft: draft && { id: draft.id, branch: draftBranch },
    academicYear: { id: year.id, name: year.name },
    teacher: { id: teacher.id, name: teacher.name, staffId: teacher.staffId, jobTitle: teacher.jobTitle ?? '', homeBranch: teacher.branch },
    days: [...new Set([...daysOf([...theirSections].map((id) => grids.get(id))), ...lessons.map((l) => l.weekday)])].sort(dayOrder),
    rows: [...rows.values()].sort((a, b) => a.startMinute - b.startMinute).map(({ start, end }) => ({ start, end })),
    lessons: lessons.map(({ startMinute, endMinute, ...l }) => l),
    perDay,
    total: lessons.length,
  };
}

/** The teacher's own week (Staff app): their published lessons in effect on `date`, every branch. */
export async function myTimetable(teacher, { date }) {
  const prisma = getPrisma();
  const school = { id: teacher.school.id };
  const year = await prisma.academicYear.findFirst({ where: { schoolId: school.id, status: 'CURRENT' } });
  if (!year) return { kind: 'teacher', source: 'published', date: date ?? (await calendarToday()), academicYear: null, days: [], rows: [], lessons: [], perDay: {}, total: 0 };
  return teacherView({ school, branch: null }, teacher.id, { academicYear: year.id, date, source: 'published' });
}
