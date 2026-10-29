import { getPrisma } from '../../config/prisma.js';

/*
 * Suspension intervals of schools and branches (approved rules: docs/business-rules.md →
 * Attendance check-in and check-out, ATT-005). Each SuspensionPeriod is [startedAt, endedAt): the
 * start instant is suspended, the end instant is not; an open period (endedAt null) lasts until now.
 * A branch is suspended at a time when the branch or its school has a period covering it.
 */

const covering = (time) => ({ startedAt: { lte: time }, OR: [{ endedAt: null }, { endedAt: { gt: time } }] });
const ofBranchOrSchool = ({ branchId, schoolId }) => ({ OR: [{ branchId }, { schoolId }] });

/** Whether the branch (or its school) was suspended at `time`: { suspended, reasons: ['branch_suspended'?, 'school_suspended'?] }. */
export async function suspendedAt({ branchId, schoolId }, time, client = getPrisma()) {
  const rows = await client.suspensionPeriod.findMany({
    where: { AND: [ofBranchOrSchool({ branchId, schoolId }), covering(time)] },
    select: { branchId: true, schoolId: true },
  });
  const reasons = [];
  if (rows.some((r) => r.branchId)) reasons.push('branch_suspended');
  if (rows.some((r) => r.schoolId)) reasons.push('school_suspended');
  return { suspended: reasons.length > 0, reasons };
}

/**
 * The parts of [start, end) during which the branch or its school was suspended, merged and
 * clipped to the range, in time order: [{ start, end }]. For absence calculation: only these parts
 * of a shift are excluded, never the whole day. `now` closes open periods.
 */
export async function suspendedOverlap({ branchId, schoolId }, start, end, { client = getPrisma(), now = new Date() } = {}) {
  if (!(end > start)) return [];
  const rows = await client.suspensionPeriod.findMany({
    where: { AND: [ofBranchOrSchool({ branchId, schoolId }), { startedAt: { lt: end } }] },
    select: { startedAt: true, endedAt: true },
    orderBy: { startedAt: 'asc' },
  });
  return mergeIntervals(
    rows
      .filter((r) => (r.endedAt ?? now) > start)
      .map((r) => ({ start: r.startedAt > start ? r.startedAt : start, end: (r.endedAt ?? now) < end ? (r.endedAt ?? now) : end }))
      .filter((i) => i.end > i.start),
  );
}

/** Merges overlapping or touching intervals ({ start, end } Dates), in time order. */
export function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const i of sorted) {
    const last = merged.at(-1);
    if (last && i.start <= last.end) {
      if (i.end > last.end) last.end = i.end;
    } else merged.push({ start: i.start, end: i.end });
  }
  return merged;
}
