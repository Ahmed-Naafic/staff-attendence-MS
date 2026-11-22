/*
 * The examination timetable engine (docs/business-rules.md → Examinations → Timetable). Pure functions,
 * no database: the service loads the facts, calls these, and saves the result.
 *
 *  1. planPapers     places papers into sessions: each day runs its shifts, each shift up to N sessions
 *                    one after another. A class sits one paper per session and at most `maxPapersPerDay`
 *                    a day; a session never holds more students than the rooms seat. Papers of the same
 *                    subject go in the same session when they fit (one question paper, one sitting), and
 *                    each class's papers are spread over the days.
 *  2. sessionTimes   gives sessions their times: a session lasts as long as its longest paper; the next
 *                    starts after a gap, a shift never before its start time.
 *  3. seatSession    chooses rooms (the fewest that seat everyone, or all) and seats students in
 *                    proportion: every room gets a share of each class sitting, so classes mix, and seats
 *                    alternate between classes. Students in alphabetical or (seeded) random order.
 *  4. assignInvigilators  gives every room of every session its invigilators (one per N students, at
 *                    least one) with a minimum-cost flow: duties spread evenly over people and days, a
 *                    person never in two places at once, at most `roomsPerInvigilator` rooms each per
 *                    session, and (when the school asks) never a teacher of a subject being sat in the room.
 * Everything is deterministic for the same input (random order uses the stored seed).
 */

// ---- times ------------------------------------------------------------------------------------

export const toMinutes = (hhmm) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const toClock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// ---- 1. placing papers ----------------------------------------------------------------------------

/**
 * days: ['YYYY-MM-DD'] in order; shifts: [{ name, start (minutes), sessions }] in order of start;
 * papers: [{ id, classId, subjectId, durationMinutes, students }]; capacity: seats available per session.
 * → { slots: [{ date, shift, shiftName, index, paperIds }] (only used slots, in time order),
 *     unplaced: [{ paperId, reason: 'no_students' | 'too_many_students' | 'no_session' }] }
 */
export function planPapers({ days, shifts, papers, maxPapersPerDay, capacity }) {
  const slots = [];
  for (const date of days) {
    shifts.forEach((shift, s) => {
      for (let i = 0; i < shift.sessions; i += 1) slots.push({ date, shift: s, shiftName: shift.name, index: i, classes: new Set(), students: 0, paperIds: [] });
    });
  }
  const perClassDay = new Map(); // `${classId}|${date}` → papers that day
  const perDay = new Map(); // date → papers that day
  const unplaced = [];
  const dayCount = (classId, date) => perClassDay.get(`${classId}|${date}`) ?? 0;

  const fits = (slot, group) =>
    group.every((p) => !slot.classes.has(p.classId) && dayCount(p.classId, slot.date) < maxPapersPerDay) && slot.students + group.reduce((n, p) => n + p.students, 0) <= capacity;
  const score = (slot, order, group) => {
    const heaviest = Math.max(...group.map((p) => dayCount(p.classId, slot.date)));
    return heaviest * 1e6 + (perDay.get(slot.date) ?? 0) * 1e3 + order;
  };
  const place = (slot, group) => {
    for (const p of group) {
      slot.classes.add(p.classId);
      slot.students += p.students;
      slot.paperIds.push(p.id);
      perClassDay.set(`${p.classId}|${slot.date}`, dayCount(p.classId, slot.date) + 1);
      perDay.set(slot.date, (perDay.get(slot.date) ?? 0) + 1);
    }
  };
  const tryPlace = (group) => {
    let best = null;
    slots.forEach((slot, order) => {
      if (!fits(slot, group)) return;
      const sc = score(slot, order, group);
      if (!best || sc < best.sc) best = { slot, sc };
    });
    if (best) place(best.slot, group);
    return Boolean(best);
  };

  const sittable = [];
  for (const p of papers) {
    if (!p.students) unplaced.push({ paperId: p.id, reason: 'no_students' });
    else if (p.students > capacity) unplaced.push({ paperId: p.id, reason: 'too_many_students' });
    else sittable.push(p);
  }
  // Subjects with the most classes (then students) first: they are the hardest to fit together.
  const bySubject = new Map();
  for (const p of sittable) bySubject.set(p.subjectId, [...(bySubject.get(p.subjectId) ?? []), p]);
  const groups = [...bySubject.values()].sort((a, b) => b.length - a.length || b.reduce((n, p) => n + p.students, 0) - a.reduce((n, p) => n + p.students, 0) || (a[0].subjectId < b[0].subjectId ? -1 : 1));
  for (const group of groups) {
    if (tryPlace(group)) continue;
    for (const p of [...group].sort((a, b) => b.students - a.students || (a.id < b.id ? -1 : 1))) if (!tryPlace([p])) unplaced.push({ paperId: p.id, reason: 'no_session' });
  }
  return { slots: slots.filter((s) => s.paperIds.length).map(({ date, shift, shiftName, index, paperIds }) => ({ date, shift, shiftName, index, paperIds })), unplaced };
}

// ---- 2. session times -----------------------------------------------------------------------------

/**
 * slots (from planPapers), shifts, gapMinutes, durationOf(paperId) → [{ ...slot, sequence, startMinute,
 * endMinute }]. Throws { code: 'PAST_MIDNIGHT' } when a day's sessions do not fit before midnight.
 */
export function sessionTimes(slots, shifts, gapMinutes, durationOf) {
  const out = [];
  let date = null;
  let end = null;
  let sequence = 0;
  let shift = null;
  for (const slot of slots) {
    if (slot.date !== date) {
      date = slot.date;
      end = null;
      sequence = 0;
      shift = null;
    }
    const shiftStart = shifts[slot.shift].start;
    const start = end === null ? shiftStart : slot.shift !== shift ? Math.max(shiftStart, end + gapMinutes) : end + gapMinutes;
    const length = Math.max(...slot.paperIds.map(durationOf));
    sequence += 1;
    shift = slot.shift;
    end = start + length;
    if (end > 1440) throw Object.assign(new Error('Sessions run past midnight.'), { code: 'PAST_MIDNIGHT', date });
    out.push({ ...slot, sequence, startMinute: start, endMinute: end });
  }
  return out;
}

// ---- 3. seating -----------------------------------------------------------------------------------

/** A small seeded random generator (mulberry32). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Rooms for N students: the fewest (largest first) that seat them all, or every room. */
export function chooseRooms(rooms, students, useAll) {
  const sorted = [...rooms].sort((a, b) => b.capacity - a.capacity || (a.name ?? '').localeCompare(b.name ?? '') || (a.id < b.id ? -1 : 1));
  if (useAll) return sorted;
  const chosen = [];
  let seats = 0;
  for (const r of sorted) {
    if (seats >= students) break;
    chosen.push(r);
    seats += r.capacity;
  }
  return chosen;
}

/** Largest remainder rounding of `targets` (summing to an integer `total`) → integers summing to total. */
function roundToTotal(targets, total, cap = () => Infinity) {
  const base = targets.map((t, i) => Math.min(Math.floor(t), cap(i)));
  let left = total - base.reduce((a, b) => a + b, 0);
  const order = targets.map((t, i) => [t - Math.floor(t), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  while (left > 0) {
    let moved = false;
    for (const [, i] of order) {
      if (left === 0) break;
      if (base[i] < cap(i)) {
        base[i] += 1;
        left -= 1;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return base;
}

/**
 * rooms: [{ id, name, capacity }] (available this session); groups: [{ key, sittingId, sectionId,
 * students: [{ id, name }] }] (a section sitting a paper); distribution 'alphabetical' | 'random'; seed.
 * → { seats: [{ roomId, studentId, sittingId, sectionId, seatNumber }], rooms: [{ id, students }],
 *     unseated: [studentId] } (unseated only when the rooms are too small).
 */
export function seatSession({ rooms, groups, distribution, seed = 1, useAllRooms = false }) {
  const total = groups.reduce((n, g) => n + g.students.length, 0);
  const chosen = chooseRooms(rooms, total, useAllRooms);
  const capacity = chosen.reduce((n, r) => n + r.capacity, 0);
  const seated = Math.min(total, capacity);
  const ordered = groups.map((g) => {
    const list = [...g.students];
    if (distribution === 'random') {
      const rand = seededRandom(seed ^ hash(g.key));
      for (let i = list.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    } else list.sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
    return { ...g, list };
  });
  if (!seated) return { seats: [], rooms: [], unseated: ordered.flatMap((g) => g.list.map((s) => s.id)) };

  // Each group seats its share (proportional when rooms are short), each room its share of everyone.
  const groupTotals = roundToTotal(ordered.map((g) => (g.list.length * seated) / total), seated, (i) => ordered[i].list.length);
  const roomTotals = roundToTotal(chosen.map((r) => (seated * r.capacity) / capacity), seated, (i) => chosen[i].capacity);
  // The matrix: group g in room r ≈ groupTotals[g] × roomTotals[r] / seated, rows and columns exact.
  const cells = ordered.map((_, g) => chosen.map((__, r) => (groupTotals[g] * roomTotals[r]) / seated));
  const counts = cells.map((row) => row.map(Math.floor));
  const rowLeft = groupTotals.map((t, g) => t - counts[g].reduce((a, b) => a + b, 0));
  const colLeft = roomTotals.map((t, r) => t - counts.reduce((a, row) => a + row[r], 0));
  const fractions = [];
  cells.forEach((row, g) => row.forEach((v, r) => fractions.push([v - Math.floor(v), g, r])));
  fractions.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  // Remaining units always have a row and a column with room left (their sums are equal).
  let remaining = rowLeft.reduce((a, b) => a + b, 0);
  while (remaining > 0) {
    let moved = false;
    for (const [, g, r] of fractions) {
      if (remaining === 0) break;
      if (rowLeft[g] > 0 && colLeft[r] > 0) {
        counts[g][r] += 1;
        rowLeft[g] -= 1;
        colLeft[r] -= 1;
        remaining -= 1;
        moved = true;
      }
    }
    if (!moved) break;
  }

  const seats = [];
  const unseated = [];
  const perRoom = chosen.map(() => []);
  ordered.forEach((g, gi) => {
    let at = 0;
    chosen.forEach((room, ri) => {
      const take = g.list.slice(at, at + counts[gi][ri]);
      at += counts[gi][ri];
      perRoom[ri].push(take.map((s) => ({ studentId: s.id, sittingId: g.sittingId, sectionId: g.sectionId })));
    });
    unseated.push(...g.list.slice(at).map((s) => s.id));
  });
  // Seats alternate between the groups in a room (round robin), so neighbours sit different papers or classes.
  chosen.forEach((room, ri) => {
    const queues = perRoom[ri].filter((q) => q.length).map((q) => [...q]);
    let seat = 0;
    while (queues.some((q) => q.length)) {
      for (const q of queues) {
        const next = q.shift();
        if (next) seats.push({ roomId: room.id, seatNumber: (seat += 1), ...next });
      }
    }
  });
  return { seats, rooms: chosen.map((r, ri) => ({ id: r.id, students: roomTotals[ri] })).filter((r) => r.students > 0), unseated };
}

// ---- 4. invigilators (minimum-cost flow) -----------------------------------------------------------

/** Minimum-cost maximum flow (successive shortest paths with SPFA). edges: [from, to, capacity, cost]. */
export function minCostFlow(nodeCount, edges, source, sink) {
  const head = new Array(nodeCount).fill(-1);
  const to = [];
  const cap = [];
  const cost = [];
  const next = [];
  const add = (u, v, c, w) => {
    to.push(v), cap.push(c), cost.push(w), next.push(head[u]), (head[u] = to.length - 1);
    to.push(u), cap.push(0), cost.push(-w), next.push(head[v]), (head[v] = to.length - 1);
  };
  const ids = edges.map(([u, v, c, w]) => (add(u, v, c, w), to.length - 2));
  let flow = 0;
  let total = 0;
  const dist = new Array(nodeCount);
  const inQueue = new Array(nodeCount);
  const via = new Array(nodeCount);
  for (;;) {
    dist.fill(Infinity);
    inQueue.fill(false);
    via.fill(-1);
    dist[source] = 0;
    const queue = [source];
    inQueue[source] = true;
    for (let qi = 0; qi < queue.length; qi += 1) {
      const u = queue[qi];
      inQueue[u] = false;
      for (let e = head[u]; e !== -1; e = next[e]) {
        if (cap[e] > 0 && dist[u] + cost[e] < dist[to[e]]) {
          dist[to[e]] = dist[u] + cost[e];
          via[to[e]] = e;
          if (!inQueue[to[e]]) {
            inQueue[to[e]] = true;
            queue.push(to[e]);
          }
        }
      }
    }
    if (dist[sink] === Infinity) break;
    let push = Infinity;
    for (let v = sink; v !== source; v = to[via[v] ^ 1]) push = Math.min(push, cap[via[v]]);
    for (let v = sink; v !== source; v = to[via[v] ^ 1]) {
      cap[via[v]] -= push;
      cap[via[v] ^ 1] += push;
    }
    flow += push;
    total += push * dist[sink];
  }
  return { flow, cost: total, used: (i) => cap[ids[i] ^ 1] };
}

/**
 * sessions: [{ id, date, rooms: [{ roomId, students, subjects: [{ sectionId, subjectId }] }] }];
 * staff: [{ id, teaches: Set('sectionId|subjectId') }]; busy: Set('staffId|sessionId') (already elsewhere);
 * load: Map(staffId → duties already held, e.g. sessions kept when only some are redone);
 * settings: { studentsPerInvigilator, roomsPerInvigilator, avoidOwnSubject }.
 * → { assignments: [{ sessionId, roomId, staffId }], shortfall: [{ sessionId, roomId, missing }] }
 */
export function assignInvigilators({ sessions, staff, busy = new Set(), load = new Map(), settings }) {
  const { studentsPerInvigilator, roomsPerInvigilator, avoidOwnSubject } = settings;
  const need = (students) => Math.max(1, Math.ceil(students / studentsPerInvigilator));
  const slots = sessions.flatMap((s) => s.rooms.map((r) => ({ session: s, room: r, need: need(r.students) })));
  const totalNeed = slots.reduce((n, s) => n + s.need, 0);
  if (!slots.length || !staff.length) return { assignments: [], shortfall: slots.map((s) => ({ sessionId: s.session.id, roomId: s.room.roomId, missing: s.need })) };

  const days = [...new Set(sessions.map((s) => s.date))];
  let n = 0;
  const S = n++;
  const T = n++;
  const staffNode = staff.map(() => n++);
  const dayNode = staff.map(() => days.map(() => n++));
  const sessionNode = staff.map(() => sessions.map(() => n++));
  const slotNode = slots.map(() => n++);
  const edges = [];
  const perDay = (si, di) => sessions.filter((s) => s.date === days[di]).length;
  // Convex costs: the k-th duty costs more than the (k-1)-th, so duties spread over people, then days.
  staff.forEach((p, pi) => {
    const held = load.get(p.id) ?? 0;
    const most = Math.min(totalNeed, sessions.length * roomsPerInvigilator);
    for (let k = 1; k <= most; k += 1) edges.push([S, staffNode[pi], 1, 100 * (2 * (held + k) - 1)]);
    days.forEach((_, di) => {
      const most2 = perDay(pi, di) * roomsPerInvigilator;
      for (let k = 1; k <= most2; k += 1) edges.push([staffNode[pi], dayNode[pi][di], 1, 10 * (2 * k - 1)]);
    });
    sessions.forEach((s, si) => {
      if (busy.has(`${p.id}|${s.id}`)) return;
      edges.push([dayNode[pi][days.indexOf(s.date)], sessionNode[pi][si], roomsPerInvigilator, 0]);
    });
  });
  const slotEdges = [];
  slots.forEach((slot, ti) => {
    const si = sessions.indexOf(slot.session);
    staff.forEach((p, pi) => {
      if (busy.has(`${p.id}|${slot.session.id}`)) return;
      const own = slot.room.subjects.some((x) => p.teaches.has(`${x.sectionId}|${x.subjectId}`));
      if (own && avoidOwnSubject) return;
      slotEdges.push({ index: edges.length, ti, pi });
      edges.push([sessionNode[pi][si], slotNode[ti], 1, own ? 1 : 0]);
    });
    edges.push([slotNode[ti], T, slot.need, 0]);
  });
  const result = minCostFlow(n, edges, S, T);
  const assignments = [];
  const filled = new Array(slots.length).fill(0);
  for (const e of slotEdges) {
    if (result.used(e.index) > 0) {
      assignments.push({ sessionId: slots[e.ti].session.id, roomId: slots[e.ti].room.roomId, staffId: staff[e.pi].id });
      filled[e.ti] += 1;
    }
  }
  const shortfall = slots.map((s, ti) => ({ sessionId: s.session.id, roomId: s.room.roomId, missing: s.need - filled[ti] })).filter((s) => s.missing > 0);
  return { assignments, shortfall };
}
