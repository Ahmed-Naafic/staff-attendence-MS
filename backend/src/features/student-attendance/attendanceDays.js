import { localDateTime, zonedMidnight } from '../../common/zonedTime.js';
import { getPrisma } from '../../config/prisma.js';
import { addDays, asDbDay, toDay } from '../academic-calendar/schoolDays.js';
import { mergeIntervals } from '../attendance/suspensions.js';
import { platformTimeZone } from '../platform-settings/settings.service.js';
import { loadSectionDays } from '../timetable/lessons.js';
import {
  countStatuses,
  dayShape,
  editableUntil,
  effectiveStatus,
  excuseCoversHalf,
  excuseCoversLesson,
  HALF_FROM_DB,
  HALF_LABELS,
  lessonTimes,
  plannedHalves,
  sessionTimes,
  STATUS_FROM_DB,
  windowState,
} from './attendanceRules.js';
import { activeExcuses } from './excuses.service.js';
import { effectiveSettingsFor } from './settings.js';

/*
 * What student attendance a section should have on each day and how far it is taken — the one
 * place that combines the school days and timetables (lessons.js), the settings, the opened
 * sessions with their marks, excuses and suspensions. The Manager's day screen, completion, the
 * notifications job and the reports all read it (docs/business-rules.md → Student attendance →
 * Completion). Fixed number of queries whatever the number of sections and days.
 *
 * Each expected item (a Manager half-day session, or a lesson) gets a `state` (its window: upcoming,
 * open, overdue, locked; suspended) and a `status`:
 *   complete     opened and every student marked (or excused)
 *   incomplete   opened, some students not marked, past its deadline
 *   in_progress  opened, some students not marked, before its deadline
 *   missing      never opened, past its deadline
 *   open         never opened, can be taken now
 *   upcoming     cannot be taken yet
 *   suspended    the branch or school was suspended throughout it
 * `due`: its deadline has passed (and it was not suspended).
 */

export const SECTION_INCLUDE = {
  class: { select: { id: true, name: true, sequence: true, status: true } },
  branch: { select: { id: true, name: true, code: true, status: true } },
  academicYear: { select: { id: true, name: true, status: true, startDate: true, endDate: true } },
};

const clockOf = (instant, timeZone) => (instant ? localDateTime(instant, timeZone).time : null);

function statusOf(state, counts, now, deadlineAt) {
  if (state === 'suspended') return 'suspended';
  if (counts) return counts.notMarked === 0 ? 'complete' : now > deadlineAt ? 'incomplete' : 'in_progress';
  if (state === 'upcoming') return 'upcoming';
  if (state === 'open') return 'open';
  return 'missing';
}

/** Suspension intervals of the school or these branches overlapping [start, end): Map branchId → merged [{ start, end }]. */
export async function suspensionsOf(client, schoolId, branchIds, start, end, now) {
  const rows = await client.suspensionPeriod.findMany({
    where: { startedAt: { lt: end }, OR: [{ endedAt: null }, { endedAt: { gt: start } }], AND: [{ OR: [{ schoolId }, { branchId: { in: branchIds } }] }] },
    select: { schoolId: true, branchId: true, startedAt: true, endedAt: true },
  });
  return new Map(
    branchIds.map((id) => [id, mergeIntervals(rows.filter((r) => r.schoolId === schoolId || r.branchId === id).map((r) => ({ start: r.startedAt, end: r.endedAt ?? now })))]),
  );
}

/** Whether merged `intervals` cover all of [start, end). */
export const coveredThroughout = (intervals, start, end) => intervals.some((i) => i.start <= start && i.end >= end);

/**
 * For the branches of one school and the dates from..to: → { timeZone, rows } with one row per
 * section and date its academic year covers (active sections, or ones with sessions then):
 * { date, section, day, settings, students (active enrollments now), halves: [item], lessons: [item] }.
 * Half item: { half, label, start, end, opensAt, deadlineAt, state, status, due, session }.
 * Lesson item: { period, start, end, half, subject, teacher, state, status, due, session }.
 * session: { id, openedAt, openedBy, counts, complete } (counts with excuses applied).
 */
export async function loadAttendanceDays(schoolId, branchIds, from, to, { now = new Date(), client = getPrisma() } = {}) {
  const timeZone = await platformTimeZone();
  if (!branchIds.length) return { timeZone, rows: [] };
  const fromDb = asDbDay(from);
  const toDb = asDbDay(to);
  const sections = await client.section.findMany({
    where: {
      schoolId,
      branchId: { in: branchIds },
      academicYear: { startDate: { lte: toDb }, endDate: { gte: fromDb } },
      OR: [{ status: 'ACTIVE', class: { status: 'ACTIVE' } }, { attendanceSessions: { some: { date: { gte: fromDb, lte: toDb } } } }],
    },
    include: SECTION_INCLUDE,
    orderBy: [{ branch: { number: 'asc' } }, { class: { sequence: 'asc' } }, { nameKey: 'asc' }],
  });
  const sectionIds = sections.map((s) => s.id);
  const rangeStart = zonedMidnight(from, timeZone);
  const rangeEnd = zonedMidnight(addDays(to, 1), timeZone);
  const [settingsMap, days, sessions, enrolled, suspensions] = await Promise.all([
    effectiveSettingsFor(schoolId, branchIds, client),
    loadSectionDays(schoolId, sections.map((s) => ({ id: s.id, branchId: s.branchId })), from, to, client),
    sectionIds.length
      ? client.studentAttendanceSession.findMany({
          where: { sectionId: { in: sectionIds }, date: { gte: fromDb, lte: toDb } },
          select: { id: true, sectionId: true, kind: true, date: true, half: true, periodNumber: true, startsAt: true, endsAt: true, opensAt: true, deadlineAt: true, openedAt: true, openedByName: true, entries: { select: { studentId: true, status: true } } },
        })
      : [],
    sectionIds.length ? client.enrollment.groupBy({ by: ['sectionId'], where: { sectionId: { in: sectionIds }, status: 'ACTIVE' }, _count: { _all: true } }) : [],
    suspensionsOf(client, schoolId, branchIds, rangeStart, rangeEnd, now),
  ]);
  const studentIds = [...new Set(sessions.flatMap((s) => s.entries.map((e) => e.studentId)))];
  const excuses = await activeExcuses(client, schoolId, studentIds, from, to);
  const bySectionDate = new Map();
  for (const s of sessions) {
    const key = `${s.sectionId}|${toDay(s.date)}`;
    bySectionDate.set(key, [...(bySectionDate.get(key) ?? []), s]);
  }
  const countsOf = (session, date, covers) => {
    const overdue = now > session.deadlineAt;
    return countStatuses(session.entries.map((e) => effectiveStatus(STATUS_FROM_DB[e.status], { excused: (excuses.get(e.studentId) ?? []).some((x) => covers(x)), overdue })));
  };
  const brief = (session, counts) => ({ id: session.id, openedAt: session.openedAt, openedBy: session.openedByName, counts, complete: counts.notMarked === 0 });

  const rows = [];
  for (const section of sections) {
    const settings = settingsMap.get(section.branchId);
    for (const day of days.get(section.id) ?? []) {
      if (day.academicYear?.id !== section.academicYearId) continue;
      const date = day.date;
      const dayStart = zonedMidnight(date, timeZone);
      const dayEnd = zonedMidnight(addDays(date, 1), timeZone);
      const until = editableUntil(date, settings, timeZone);
      const opened = bySectionDate.get(`${section.id}|${date}`) ?? [];
      const halfSessions = opened.filter((s) => s.kind === 'HALF_DAY').map((s) => ({ ...s, half: HALF_FROM_DB[s.half] }));
      const halves = dayShape(plannedHalves(day, settings), day.halves, halfSessions).map((item) => {
        const times = item.session ?? sessionTimes(date, item, settings, timeZone);
        const suspended = !item.session && coveredThroughout(suspensions.get(section.branchId) ?? [], times.startsAt ?? dayStart, times.endsAt ?? dayEnd);
        const state = suspended ? 'suspended' : windowState(times, until, now);
        const counts = item.session ? countsOf(item.session, date, (x) => excuseCoversHalf(x, date, item.half)) : null;
        const status = statusOf(state, counts, now, times.deadlineAt);
        return {
          half: item.half,
          label: HALF_LABELS[item.half],
          start: clockOf(times.startsAt, timeZone),
          end: clockOf(times.endsAt, timeZone),
          opensAt: times.opensAt,
          deadlineAt: times.deadlineAt,
          state,
          status,
          due: status !== 'suspended' && now > times.deadlineAt,
          session: item.session ? brief(item.session, counts) : null,
        };
      });
      const lessons = (day.schoolDay ? day.periods : [])
        .filter((p) => p.kind === 'LESSON' && p.lesson)
        .map((p) => {
          const session = opened.find((s) => s.kind === 'LESSON' && s.periodNumber === p.number) ?? null;
          const times = session ?? lessonTimes(date, p, settings, timeZone);
          const suspended = !session && coveredThroughout(suspensions.get(section.branchId) ?? [], times.startsAt, times.endsAt);
          const state = suspended ? 'suspended' : windowState(times, until, now);
          const half = p.half === 'before_break' || p.half === 'after_break' ? p.half : null;
          const counts = session ? countsOf(session, date, (x) => excuseCoversLesson(x, date, { half, period: p.number })) : null;
          const status = statusOf(state, counts, now, times.deadlineAt);
          return {
            period: p.number,
            start: p.start,
            end: p.end,
            half,
            subject: p.lesson.subject,
            teacher: p.lesson.teacher,
            opensAt: times.opensAt,
            deadlineAt: times.deadlineAt,
            state,
            status,
            due: status !== 'suspended' && now > times.deadlineAt,
            session: session ? brief(session, counts) : null,
          };
        });
      rows.push({ date, section, day, settings, students: enrolled.find((e) => e.sectionId === section.id)?._count._all ?? 0, halves, lessons });
    }
  }
  return { timeZone, rows };
}

/** Totals of items (halves or lessons): { expected, due, taken, complete, incomplete, missing }. Suspended items are not expected. */
export function completionTotals(items) {
  const t = { expected: 0, due: 0, taken: 0, complete: 0, incomplete: 0, missing: 0 };
  for (const i of items) {
    if (i.status === 'suspended') continue;
    t.expected += 1;
    if (i.session) t.taken += 1;
    if (i.status === 'complete') t.complete += 1;
    if (i.status === 'incomplete') t.incomplete += 1;
    if (i.status === 'missing') t.missing += 1;
    if (i.due) t.due += 1;
  }
  return t;
}
