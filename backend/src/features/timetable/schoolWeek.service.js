import { notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { asDbDay, toDay, weekdaysOn } from '../academic-calendar/schoolDays.js';
import { branchShiftsOn } from '../schedules/workWindows.js';
import { minutesToTime } from './bellTimes.js';

/**
 * The school week on a date, for setting up bell schedules and school days (read only):
 * - schoolDays: the weekly school days of the academic year covering the date (Academic Calendar),
 *   for the branch (its own days, or the school's) or, without a branch, the school's;
 * - shifts: the staff shifts in effect (Staff Schedule) of the branch or, without one, of every
 *   active branch, each with its branch.
 * A Manager always gets their own branch; the School Owner may name one (`branch`) or none.
 * Nothing here is linked: callers copy from it and compare with it.
 */
export async function schoolWeek(scope, { branch, date }) {
  const prisma = getPrisma();
  const day = date ?? (await calendarToday());
  let target = scope.branch ? { id: scope.branch.id, name: scope.branch.name } : null;
  if (!target && branch) {
    target = isUuid(branch) ? await prisma.branch.findFirst({ where: { id: branch, schoolId: scope.school.id }, select: { id: true, name: true } }) : null;
    if (!target) throw notFound('Branch not found.');
  }
  const year = await prisma.academicYear.findFirst({
    where: { schoolId: scope.school.id, startDate: { lte: asDbDay(day) }, endDate: { gte: asDbDay(day) } },
    orderBy: { startDate: 'desc' },
    select: { id: true, name: true },
  });
  let schoolDays = [];
  if (year) {
    const rows = await prisma.academicWeekdays.findMany({
      where: { academicYearId: year.id, cancelledAt: null, OR: [{ branchId: null }, ...(target ? [{ branchId: target.id }] : [])] },
      select: { branchId: true, days: true, followsSchool: true, effectiveFrom: true },
    });
    const plain = (list) => list.map((v) => ({ days: v.days, followsSchool: v.followsSchool, effectiveFrom: toDay(v.effectiveFrom) }));
    schoolDays = weekdaysOn({ schoolVersions: plain(rows.filter((v) => !v.branchId)), branchVersions: plain(rows.filter((v) => v.branchId)) }, day).days ?? [];
  }
  const branches = target ? [target] : await prisma.branch.findMany({ where: { schoolId: scope.school.id, status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const shifts = await branchShiftsOn(branches.map((b) => b.id), day, prisma);
  return {
    date: day,
    academicYear: year,
    branch: target,
    schoolDays,
    shifts: branches.flatMap((b) =>
      (shifts.get(b.id) ?? []).map((s) => ({ branch: b, key: s.key, name: s.name, days: s.days, start: minutesToTime(s.startMinute), end: minutesToTime(s.endMinute) })),
    ),
  };
}
