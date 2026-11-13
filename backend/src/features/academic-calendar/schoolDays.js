import { getPrisma } from '../../config/prisma.js';
import { WEEKDAYS } from '../schedules/scheduleInput.js';

/*
 * Whether a branch has school on a date: the one place that decides it (docs/business-rules.md →
 * Academic calendar → School days). Everything about student attendance asks here: sessions,
 * NOT_MARKED, notifications and reports. Staff schedules (BranchSchedule / BranchShift) are never
 * consulted: they say when staff work, not when students have school.
 *
 * In order, for a branch and a date:
 *   1. outside every academic year of the school       → no school ('no_academic_year')
 *   2. a closure of the branch covers it               → no school ('closure')
 *   3. a school holiday covers it, not reopened for
 *      the branch by a reopening of that holiday       → no school ('holiday')
 *   4. an extra school day of the branch, else of the
 *      school, covers it                               → school, following the extra day's
 *                                                        timetable weekday
 *   5. the year's weekly school days (the branch's own
 *      version when one applies, else the school's)    → school, or 'not_a_school_day';
 *      no days set up at all                           → 'no_school_days'
 * A reopening only cancels the holiday: the day still has to be a weekly school day (or an extra
 * school day). `timetableDay` says which weekday's timetable and bell times a school day follows:
 * its own weekday, or the one an extra school day names (a make-up day, or a timetable swap).
 * Suspensions (SuspensionPeriod, suspensions.js) are not part of the calendar: they apply to the
 * hours they cover, and the attendance features check them for each session.
 *
 * Dates are 'YYYY-MM-DD' strings (platform time zone calendar dates); DATE columns are read as
 * 00:00 UTC, so the string comparisons below are exact.
 */

const DAY_MS = 86_400_000;

export const toDay = (date) => date.toISOString().slice(0, 10);
export const asDbDay = (day) => new Date(`${day}T00:00:00Z`);
export const addDays = (day, n) => toDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS));
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
/** 'MON'…'SUN' of a date. */
export const weekdayOf = (day) => WEEKDAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7];

/** The newest of `versions` (one level, not cancelled) whose effectiveFrom ('YYYY-MM-DD') is on or before `day`, or null. */
export function versionOn(versions, day) {
  let found = null;
  for (const v of versions) if (v.effectiveFrom <= day && (!found || v.effectiveFrom > found.effectiveFrom)) found = v;
  return found;
}

/**
 * The weekly school days that apply on `day`: the branch's own version when one is in effect (and
 * does not follow the school), else the school's. → { days: ['SAT', …], source: 'branch' | 'school' | null }.
 */
export function weekdaysOn({ schoolVersions, branchVersions = [] }, day) {
  const own = versionOn(branchVersions, day);
  if (own && !own.followsSchool) return { days: own.days, source: 'branch' };
  const school = versionOn(schoolVersions, day);
  return school ? { days: school.days, source: 'school' } : { days: [], source: null };
}

const covers = (entry, day) => entry.startDate <= day && day <= entry.endDate;
const brief = (entry) => entry && { id: entry.id, name: entry.name };

/**
 * One day, from data already loaded for one branch: `years` (with their weekday versions split by
 * level) and the branch's active `entries`, all with 'YYYY-MM-DD' dates.
 */
export function resolveDay(day, { years, entries }) {
  const weekday = weekdayOf(day);
  const year = years.find((y) => y.startDate <= day && day <= y.endDate) ?? null;
  const base = { date: day, weekday, timetableDay: null, academicYear: year && { id: year.id, name: year.name }, holiday: null, closure: null, reopening: null, extraDay: null, weekdaySource: null };
  if (!year) return { ...base, schoolDay: false, reason: 'no_academic_year' };

  const closure = entries.find((e) => e.type === 'CLOSURE' && covers(e, day));
  const holiday = entries.find((e) => e.type === 'HOLIDAY' && covers(e, day));
  const reopening = holiday ? entries.find((e) => e.type === 'REOPENING' && e.holidayId === holiday.id && covers(e, day)) : null;
  const extras = entries.filter((e) => e.type === 'SCHOOL_DAY' && covers(e, day));
  const extra = extras.find((e) => e.branchId) ?? extras[0] ?? null;
  const { days, source } = weekdaysOn(year.weekdays, day);
  const result = { ...base, holiday: brief(holiday), closure: brief(closure), reopening: brief(reopening), weekdaySource: source };

  if (closure) return { ...result, schoolDay: false, reason: 'closure' };
  if (holiday && !reopening) return { ...result, schoolDay: false, reason: 'holiday' };
  if (extra) return { ...result, extraDay: { ...brief(extra), timetableDay: extra.timetableDay, level: extra.branchId ? 'branch' : 'school' }, timetableDay: extra.timetableDay, schoolDay: true, reason: null };
  if (!source) return { ...result, schoolDay: false, reason: 'no_school_days' };
  if (!days.includes(weekday)) return { ...result, schoolDay: false, reason: 'not_a_school_day' };
  return { ...result, timetableDay: weekday, schoolDay: true, reason: null };
}

/** The longest range read at once (a year and a day). */
export const MAX_RANGE_DAYS = 366;

/**
 * Every day from `from` to `to` (inclusive, at most MAX_RANGE_DAYS) for one branch of a school,
 * resolved with three queries whatever the length of the range. `branch`: { id, schoolId }.
 */
export async function loadSchoolDays(branch, from, to, client = getPrisma()) {
  return (await loadSchoolDaysForBranches(branch.schoolId, [branch.id], from, to, client)).get(branch.id);
}

/**
 * The same for several branches of one school at once (still three queries): Map branchId → days.
 */
export async function loadSchoolDaysForBranches(schoolId, branchIds, from, to, client = getPrisma()) {
  const result = new Map();
  if (!branchIds.length) return result;
  const [years, entries] = await Promise.all([
    client.academicYear.findMany({
      where: { schoolId, startDate: { lte: asDbDay(to) }, endDate: { gte: asDbDay(from) } },
      select: { id: true, name: true, startDate: true, endDate: true },
    }),
    client.calendarEntry.findMany({
      where: {
        schoolId,
        cancelledAt: null,
        startDate: { lte: asDbDay(to) },
        endDate: { gte: asDbDay(from) },
        OR: [{ branchId: null }, { branchId: { in: branchIds } }],
      },
      select: { id: true, type: true, name: true, branchId: true, startDate: true, endDate: true, holidayId: true, timetableDay: true },
    }),
  ]);
  const versions = years.length
    ? await client.academicWeekdays.findMany({
        where: { academicYearId: { in: years.map((y) => y.id) }, cancelledAt: null, OR: [{ branchId: null }, { branchId: { in: branchIds } }] },
        select: { academicYearId: true, branchId: true, days: true, followsSchool: true, effectiveFrom: true },
      })
    : [];

  const plain = (v) => ({ days: v.days, followsSchool: v.followsSchool, effectiveFrom: toDay(v.effectiveFrom) });
  const allEntries = entries.map((e) => ({ ...e, startDate: toDay(e.startDate), endDate: toDay(e.endDate) }));
  for (const branchId of branchIds) {
    const data = {
      years: years.map((y) => ({
        id: y.id,
        name: y.name,
        startDate: toDay(y.startDate),
        endDate: toDay(y.endDate),
        weekdays: {
          schoolVersions: versions.filter((v) => v.academicYearId === y.id && !v.branchId).map(plain),
          branchVersions: versions.filter((v) => v.academicYearId === y.id && v.branchId === branchId).map(plain),
        },
      })),
      entries: allEntries.filter((e) => !e.branchId || e.branchId === branchId),
    };
    const days = [];
    for (let day = from; day <= to; day = addDays(day, 1)) days.push(resolveDay(day, data));
    result.set(branchId, days);
  }
  return result;
}

/** Whether `branch` ({ id, schoolId }) has school on `day`, with the reason when not. */
export async function schoolDay(branch, day, client = getPrisma()) {
  const [result] = await loadSchoolDays(branch, day, day, client);
  return result;
}
