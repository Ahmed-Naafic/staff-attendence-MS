import { getPrisma } from '../../config/prisma.js';
import { asDbDay } from '../academic-calendar/schoolDays.js';
import { minutesToTime as hhmm } from '../timetable/bellTimes.js';
import { scheduleOn } from './schedules.service.js';

/*
 * Staff working hours, read from the staff schedules (BranchSchedule / BranchShift) and the staff
 * members' shift assignments (StaffAssignment). Read only: used to compare lesson times (bell
 * schedules, timetables) with when staff are at work. Staff attendance itself never uses this.
 */

/** The shifts of each branch's staff schedule in effect on `date`: Map branchId → [{ key, name, days, startMinute, endMinute }]. */
export async function branchShiftsOn(branchIds, date, client = getPrisma()) {
  const versions = await Promise.all(branchIds.map((id) => scheduleOn(id, date, client)));
  return new Map(branchIds.map((id, i) => [id, (versions[i]?.shifts ?? []).map((s) => ({ key: s.shiftKey, name: s.name, days: [...s.days], startMinute: s.startMinute, endMinute: s.endMinute }))]));
}

/**
 * When each staff member works on `date` (their shift assignment in effect, with their branch's
 * shift times): Map staffId → { WEEKDAY: [{ name, startMinute, endMinute }] }. Staff without an
 * assignment are left out (nothing is known about their hours).
 */
export async function staffWorkWindows(staffIds, date, client = getPrisma()) {
  const result = new Map();
  if (!staffIds.length) return result;
  const rows = await client.staffAssignment.findMany({
    where: { staffUserId: { in: staffIds }, cancelledAt: null, effectiveFrom: { lte: asDbDay(date) } },
    orderBy: [{ effectiveFrom: 'desc' }, { effectiveAt: 'desc' }, { recordedAt: 'desc' }],
    include: { shifts: true },
  });
  const current = new Map();
  for (const a of rows) if (!current.has(a.staffUserId)) current.set(a.staffUserId, a);
  const shiftsByBranch = await branchShiftsOn([...new Set([...current.values()].map((a) => a.branchId))], date, client);
  for (const [staffId, a] of current) {
    const shifts = shiftsByBranch.get(a.branchId) ?? [];
    const windows = {};
    for (const assigned of a.shifts) {
      const shift = shifts.find((s) => s.key === assigned.shiftKey);
      if (!shift) continue;
      for (const day of assigned.days) (windows[day] ??= []).push({ name: shift.name, startMinute: shift.startMinute, endMinute: shift.endMinute });
    }
    result.set(staffId, windows);
  }
  return result;
}

/** Whether [startMinute, endMinute) lies inside one of the windows. */
export const insideWindows = (windows, startMinute, endMinute) => (windows ?? []).some((w) => w.startMinute <= startMinute && endMinute <= w.endMinute);

/**
 * Lesson periods outside a staff member's working hours. `days`: { WEEKDAY: [{ startMinute,
 * endMinute }] } (one or more classes' lesson periods); `windows`: from staffWorkWindows.
 * → [{ weekday, startMinute, endMinute, reason: 'no_shift' | 'outside' }], each time once.
 */
export function lessonsOutside(days, windows) {
  const out = new Map();
  for (const [weekday, periods] of Object.entries(days ?? {})) {
    for (const p of periods) {
      if (insideWindows(windows[weekday], p.startMinute, p.endMinute)) continue;
      out.set(`${weekday}|${p.startMinute}|${p.endMinute}`, { weekday, startMinute: p.startMinute, endMinute: p.endMinute, reason: windows[weekday]?.length ? 'outside' : 'no_shift' });
    }
  }
  return [...out.values()];
}

/** "Morning 07:00–13:30 (Sat, Sun, Mon)" for a staff member's windows, grouped by shift. */
export function windowsText(windows, dayLabels, order = Object.keys(dayLabels)) {
  const byShift = new Map();
  for (const [day, list] of Object.entries(windows ?? {})) {
    for (const w of list) {
      const k = `${w.name} ${hhmm(w.startMinute)}–${hhmm(w.endMinute)}`;
      byShift.set(k, [...(byShift.get(k) ?? []), day]);
    }
  }
  return [...byShift.entries()].map(([k, days]) => `${k} (${[...days].sort((x, y) => order.indexOf(x) - order.indexOf(y)).map((d) => dayLabels[d] ?? d).join(', ')})`).join('; ');
}

