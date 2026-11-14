/*
 * Timetable generator (docs/business-rules.md → Timetable builder → Generation). Pure: no database,
 * no clock except `now` (injected), deterministic for the same input, seed and iteration budget.
 *
 * Input
 *   sections: [{ id, name, days: { MON: [{ number, startMinute, endMinute, half }], … } }]
 *             the lesson periods of each weekday (from the section's bell schedule).
 *   units:    [{ sectionId, subjectId, teacherId, count }] lessons a week to place. A teacher may
 *             have several subjects in one section; one subject may have different teachers in
 *             different sections (and they may teach it at the same time).
 *   fixed:    [{ sectionId, weekday, period, subjectId, teacherId, locked? }] lessons that must stay
 *             exactly there (fixed lessons of the setup, and lessons locked in a draft). Each one
 *             counts as one of its unit's lessons.
 *   teachers: { [teacherId]: { name, maxPerDay, unavailable: [{ weekday, startMinute, endMinute }],
 *               busy: [{ weekday, startMinute, endMinute, label }] } }  (busy: lessons elsewhere)
 *   rules:    { maxSubjectPerDay, allowDoubleLessons, spreadSubjects, avoidTeacherGaps,
 *               morningSubjectIds, teacherMaxPerDay }
 *   seed, timeLimitMs, now (() => ms), maxIterations (optional, for tests)
 *
 * Hard constraints (never broken in the result):
 *   - a section has at most one lesson in a period;
 *   - a teacher never has two lessons at overlapping clock times (any sections, any bell schedules),
 *     and never one during their unavailable times or their lessons elsewhere (`busy`);
 *   - a teacher's lessons on a day stay within their daily limit;
 *   - a subject has at most `maxSubjectPerDay` lessons in a section on a day;
 *   - without double lessons, two lessons of a subject never follow each other in a section;
 *   - fixed and locked lessons stay where they are; lessons go in lesson periods only.
 * Lessons that cannot be placed are reported (`unplaced`, with the reason), never dropped silently.
 *
 * Preferences (lower score is better): subjects spread over the week, no empty periods between a
 * class's lessons, few free periods between a teacher's lessons, teachers' days balanced, morning
 * subjects early.
 *
 * Method: most-constrained-first placement; lessons with no free period displace the lessons
 * blocking them (conflict-directed repair, the least-displaced first); then simulated annealing on
 * the preferences (moves and swaps within a section, hard constraints checked on every move).
 */

const WEEKDAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DAY_NAMES = { MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday', SUN: 'Sunday' };
const W = { spread: 10, hole: 6, gap: 4, balance: 1, morning: 3 };

export const REASONS = {
  section_full: 'the class has no free period left',
  teacher_unavailable: 'the teacher is unavailable at the free periods',
  teacher_busy: 'the teacher teaches elsewhere at the free periods',
  teacher_clash: 'the teacher already teaches another class at the free periods',
  teacher_day_limit: 'the teacher has reached their daily limit on the days with free periods',
  subject_day_limit: 'the subject has reached its daily limit on the days with free periods',
  no_double: 'double lessons are not allowed and the free periods are next to the same subject',
};

/** Seeded random numbers (mulberry32). */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const overlaps = (a, b) => a.startMinute < b.endMinute && b.startMinute < a.endMinute;

export function generateTimetable(input) {
  const { sections, units, fixed = [], teachers = {}, rules = {}, seed = 1, timeLimitMs = 10000, now = () => Date.now(), maxIterations } = input;
  const rng = random(seed);
  const started = now();
  const outOfTime = () => now() - started > timeLimitMs;
  const maxSubjectPerDay = rules.maxSubjectPerDay ?? 2;
  const allowDoubles = rules.allowDoubleLessons !== false;
  const morning = new Set(rules.morningSubjectIds ?? []);

  // ---- slots ----------------------------------------------------------------------------------
  const sectionById = new Map();
  for (const s of sections) {
    const slots = [];
    const byKey = new Map();
    const dayLists = new Map();
    for (const day of WEEKDAY_ORDER) {
      const periods = [...(s.days?.[day] ?? [])].sort((a, b) => a.startMinute - b.startMinute);
      const list = periods.map((p, idx) => {
        const morningHalf = p.half ? p.half !== 'after_break' : idx < Math.ceil(periods.length / 2);
        const slot = { key: `${day}|${p.number}`, day, period: p.number, startMinute: p.startMinute, endMinute: p.endMinute, idx, morning: p.half === 'whole_day' ? idx < Math.ceil(periods.length / 2) : morningHalf };
        byKey.set(slot.key, slot);
        slots.push(slot);
        return slot;
      });
      if (list.length) dayLists.set(day, list);
    }
    sectionById.set(s.id, { ...s, slots, byKey, dayLists, occ: new Map() });
  }
  const days = WEEKDAY_ORDER.filter((d) => sections.some((s) => (s.days?.[d] ?? []).length));

  // The time grid of each day (every distinct lesson period of every section), for teachers' free periods.
  const grid = new Map();
  for (const day of days) {
    const seen = new Map();
    for (const s of sectionById.values()) for (const slot of s.dayLists.get(day) ?? []) seen.set(`${slot.startMinute}-${slot.endMinute}`, slot);
    grid.set(day, [...seen.values()].sort((a, b) => a.startMinute - b.startMinute));
  }

  // ---- teachers ---------------------------------------------------------------------------------
  const tinfo = new Map();
  const teacherOf = (id) => {
    if (!tinfo.has(id)) {
      const t = teachers[id] ?? {};
      const blocks = new Map();
      for (const b of t.unavailable ?? []) blocks.set(b.weekday, [...(blocks.get(b.weekday) ?? []), { ...b, kind: 'teacher_unavailable' }]);
      for (const b of t.busy ?? []) blocks.set(b.weekday, [...(blocks.get(b.weekday) ?? []), { ...b, kind: 'teacher_busy' }]);
      const limit = t.maxPerDay ?? rules.teacherMaxPerDay ?? Infinity;
      tinfo.set(id, { id, name: t.name ?? 'A teacher', blocks, maxPerDay: limit, byDay: new Map() });
    }
    return tinfo.get(id);
  };

  // ---- lessons ----------------------------------------------------------------------------------
  const lessons = [];
  const remaining = new Map();
  const unitKey = (u) => `${u.sectionId}|${u.subjectId}|${u.teacherId ?? ''}`;
  for (const u of units) {
    if (!sectionById.has(u.sectionId)) continue;
    remaining.set(unitKey(u), (remaining.get(unitKey(u)) ?? 0) + Math.max(0, u.count));
  }
  const problems = [];
  const subjectDay = new Map();
  const sdKey = (sec, subj, day) => `${sec}|${subj}|${day}`;

  function place(l, slot) {
    const s = sectionById.get(l.sectionId);
    s.occ.set(slot.key, l);
    l.slot = slot;
    if (l.teacherId) {
      const t = teacherOf(l.teacherId);
      const set = t.byDay.get(slot.day) ?? new Set();
      set.add(l);
      t.byDay.set(slot.day, set);
    }
    const k = sdKey(l.sectionId, l.subjectId, slot.day);
    subjectDay.set(k, (subjectDay.get(k) ?? 0) + 1);
  }
  function unplace(l) {
    const slot = l.slot;
    if (!slot) return;
    sectionById.get(l.sectionId).occ.delete(slot.key);
    if (l.teacherId) teacherOf(l.teacherId).byDay.get(slot.day)?.delete(l);
    const k = sdKey(l.sectionId, l.subjectId, slot.day);
    subjectDay.set(k, subjectDay.get(k) - 1);
    l.slot = null;
  }

  /** Why `l` cannot go in `slot` (first reason), or null when it can. */
  function blockedBy(l, slot) {
    const s = sectionById.get(l.sectionId);
    if (s.occ.has(slot.key)) return 'section_full';
    if (l.teacherId) {
      const t = teacherOf(l.teacherId);
      for (const b of t.blocks.get(slot.day) ?? []) if (overlaps(b, slot)) return b.kind;
      const mine = t.byDay.get(slot.day);
      if (mine) {
        for (const o of mine) if (overlaps(o.slot, slot)) return 'teacher_clash';
        if (mine.size >= t.maxPerDay) return 'teacher_day_limit';
      }
    }
    if ((subjectDay.get(sdKey(l.sectionId, l.subjectId, slot.day)) ?? 0) >= maxSubjectPerDay) return 'subject_day_limit';
    if (!allowDoubles) {
      const list = s.dayLists.get(slot.day);
      for (const n of [list[slot.idx - 1], list[slot.idx + 1]]) if (n && s.occ.get(n.key)?.subjectId === l.subjectId) return 'no_double';
    }
    return null;
  }

  // Fixed and locked lessons first, exactly where they are.
  for (const f of fixed) {
    const s = sectionById.get(f.sectionId);
    const slot = s?.byKey.get(`${f.weekday}|${f.period}`);
    const l = { i: lessons.length, sectionId: f.sectionId, subjectId: f.subjectId, teacherId: f.teacherId ?? null, fixed: !f.locked, locked: true, slot: null, moved: 0 };
    if (!slot) {
      problems.push({ ...f, code: 'no_period', message: `period ${f.period} does not exist on ${f.weekday}` });
      continue;
    }
    const why = blockedBy(l, slot);
    if (why) {
      problems.push({ ...f, code: why, message: REASONS[why] });
      continue;
    }
    // It is one of its subject's lessons a week: from its teacher's share, else another teacher's.
    const k = `${f.sectionId}|${f.subjectId}|${f.teacherId ?? ''}`;
    const prefix = `${f.sectionId}|${f.subjectId}|`;
    const from = (remaining.get(k) ?? 0) > 0 ? k : [...remaining.keys()].find((x) => x.startsWith(prefix) && remaining.get(x) > 0);
    if (!from && [...remaining.keys()].some((x) => x.startsWith(prefix))) {
      problems.push({ ...f, code: 'over_weekly', message: 'more fixed or locked lessons than the subject has a week' });
      continue;
    }
    if (from) remaining.set(from, remaining.get(from) - 1);
    place(l, slot);
    lessons.push(l);
  }
  for (const u of units) {
    if (!sectionById.has(u.sectionId)) continue;
    const k = unitKey(u);
    const n = remaining.get(k) ?? 0;
    for (let i = 0; i < n; i += 1) lessons.push({ i: lessons.length, sectionId: u.sectionId, subjectId: u.subjectId, teacherId: u.teacherId ?? null, fixed: false, locked: false, slot: null, moved: 0 });
    remaining.set(k, 0);
  }
  const movable = lessons.filter((l) => !l.locked);

  // ---- preferences --------------------------------------------------------------------------------
  const perSectionSubject = new Map();
  for (const l of lessons) {
    const k = `${l.sectionId}|${l.subjectId}`;
    perSectionSubject.set(k, (perSectionSubject.get(k) ?? 0) + 1);
  }
  const teacherWeek = new Map();
  for (const l of lessons) if (l.teacherId) teacherWeek.set(l.teacherId, (teacherWeek.get(l.teacherId) ?? 0) + 1);

  function spreadPenalty(sec, subj) {
    if (!rules.spreadSubjects && rules.spreadSubjects !== undefined) return 0;
    const total = perSectionSubject.get(`${sec}|${subj}`) ?? 0;
    const s = sectionById.get(sec);
    let used = 0;
    for (const day of s.dayLists.keys()) if ((subjectDay.get(sdKey(sec, subj, day)) ?? 0) > 0) used += 1;
    return (Math.min(total, s.dayLists.size) - used) * W.spread;
  }
  /**
   * A class's free periods belong at the end of the day: every empty period before its last lesson
   * of the day counts (at the start too — the class is at school from the first period).
   */
  function holePenalty(sec, day) {
    const list = sectionById.get(sec).dayLists.get(day) ?? [];
    const occ = sectionById.get(sec).occ;
    let last = -1;
    for (const slot of list) if (occ.has(slot.key)) last = slot.idx;
    let holes = 0;
    for (let i = 0; i <= last; i += 1) if (!occ.has(list[i].key)) holes += 1;
    return holes * W.hole;
  }
  function teacherDayPenalty(tid, day) {
    const t = teacherOf(tid);
    const mine = [...(t.byDay.get(day) ?? [])].map((l) => l.slot);
    let p = 0;
    if (mine.length && rules.avoidTeacherGaps !== false) {
      const first = Math.min(...mine.map((s) => s.startMinute));
      const last = Math.max(...mine.map((s) => s.endMinute));
      for (const g of grid.get(day) ?? []) {
        if (g.startMinute < first || g.endMinute > last) continue;
        if (!mine.some((s) => overlaps(s, g))) p += W.gap;
      }
    }
    const avg = (teacherWeek.get(tid) ?? 0) / Math.max(1, days.length);
    p += (mine.length - avg) ** 2 * W.balance;
    return p;
  }
  const morningPenalty = (l, slot) => (morning.has(l.subjectId) && !slot.morning ? W.morning : 0);

  function score() {
    const parts = { spread: 0, holes: 0, teachers: 0, morning: 0 };
    for (const k of perSectionSubject.keys()) {
      const [sec, subj] = k.split('|');
      parts.spread += spreadPenalty(sec, subj);
    }
    for (const s of sectionById.values()) for (const day of s.dayLists.keys()) parts.holes += holePenalty(s.id, day);
    for (const tid of teacherWeek.keys()) for (const day of days) parts.teachers += teacherDayPenalty(tid, day);
    for (const l of lessons) if (l.slot) parts.morning += morningPenalty(l, l.slot);
    return { ...parts, total: parts.spread + parts.holes + parts.teachers + parts.morning };
  }

  /** Penalty of the keys a set of lessons touches (for move deltas). */
  function localPenalty(touched) {
    let p = 0;
    for (const k of touched.ss) {
      const [sec, subj] = k.split('|');
      p += spreadPenalty(sec, subj);
    }
    for (const k of touched.sd) {
      const [sec, day] = k.split('|');
      p += holePenalty(sec, day);
    }
    for (const k of touched.td) {
      const [tid, day] = k.split('|');
      p += teacherDayPenalty(tid, day);
    }
    for (const l of touched.lessons) if (l.slot) p += morningPenalty(l, l.slot);
    return p;
  }
  function touch(pairs) {
    const t = { ss: new Set(), sd: new Set(), td: new Set(), lessons: new Set() };
    for (const [l, slot] of pairs) {
      t.lessons.add(l);
      t.ss.add(`${l.sectionId}|${l.subjectId}`);
      if (slot) {
        t.sd.add(`${l.sectionId}|${slot.day}`);
        if (l.teacherId) t.td.add(`${l.teacherId}|${slot.day}`);
      }
    }
    return t;
  }

  // ---- construction ----------------------------------------------------------------------------------
  // Static difficulty: the periods of the class the teacher could ever use, and the teacher's load.
  const domain = new Map();
  for (const l of movable) {
    const s = sectionById.get(l.sectionId);
    let n = 0;
    for (const slot of s.slots) {
      const blocks = l.teacherId ? teacherOf(l.teacherId).blocks.get(slot.day) ?? [] : [];
      if (!blocks.some((b) => overlaps(b, slot))) n += 1;
    }
    domain.set(l, n);
  }
  const order = [...movable].map((l) => ({ l, r: rng() })).sort(
    (a, b) => domain.get(a.l) - domain.get(b.l) || (teacherWeek.get(b.l.teacherId) ?? 0) - (teacherWeek.get(a.l.teacherId) ?? 0) || a.r - b.r,
  ).map((x) => x.l);

  function bestFreeSlot(l) {
    const s = sectionById.get(l.sectionId);
    let best = null;
    let bestCost = Infinity;
    for (const slot of s.slots) {
      if (blockedBy(l, slot)) continue;
      const touched = touch([[l, slot]]);
      const before = localPenalty(touched);
      place(l, slot);
      const after = localPenalty(touched);
      unplace(l);
      const cost = after - before + rng() * 0.5;
      if (cost < bestCost) {
        bestCost = cost;
        best = slot;
      }
    }
    return best;
  }

  /** The lessons to displace so `l` fits `slot`, or null when it never can (fixed lessons, unavailable times). */
  function displaceFor(l, slot) {
    const s = sectionById.get(l.sectionId);
    const out = new Set();
    const occupant = s.occ.get(slot.key);
    if (occupant) {
      if (occupant.locked) return null;
      out.add(occupant);
    }
    if (l.teacherId) {
      const t = teacherOf(l.teacherId);
      for (const b of t.blocks.get(slot.day) ?? []) if (overlaps(b, slot)) return null;
      const mine = [...(t.byDay.get(slot.day) ?? [])];
      for (const o of mine) {
        if (!overlaps(o.slot, slot)) continue;
        if (o.locked) return null;
        out.add(o);
      }
      const left = mine.filter((o) => !out.has(o));
      if (left.length >= t.maxPerDay) {
        const pick = left.filter((o) => !o.locked).sort((a, b) => a.moved - b.moved)[0];
        if (!pick) return null;
        out.add(pick);
      }
    }
    const sameDay = [...s.occ.values()].filter((o) => o.subjectId === l.subjectId && o.slot.day === slot.day && !out.has(o));
    if (sameDay.length >= maxSubjectPerDay) {
      const pick = sameDay.filter((o) => !o.locked).sort((a, b) => a.moved - b.moved)[0];
      if (!pick) return null;
      out.add(pick);
    }
    if (!allowDoubles) {
      const list = s.dayLists.get(slot.day);
      for (const n of [list[slot.idx - 1], list[slot.idx + 1]]) {
        const o = n && s.occ.get(n.key);
        if (o && o.subjectId === l.subjectId && !out.has(o)) {
          if (o.locked) return null;
          out.add(o);
        }
      }
    }
    return out;
  }

  let iterations = 0;
  const repairLimit = maxIterations ?? Math.max(2000, movable.length * 60);
  const queue = [...order];
  let best = null;
  const snapshot = () => movable.map((l) => l.slot);
  const unplacedCount = () => movable.reduce((n, l) => n + (l.slot ? 0 : 1), 0);
  let lastDisplaced = new WeakMap();
  while (queue.length && iterations < repairLimit && !outOfTime()) {
    iterations += 1;
    const l = queue.shift();
    if (l.slot) continue;
    const free = bestFreeSlot(l);
    if (free) {
      place(l, free);
    } else {
      const s = sectionById.get(l.sectionId);
      let choice = null;
      let choiceCost = Infinity;
      for (const slot of s.slots) {
        const out = displaceFor(l, slot);
        if (!out) continue;
        let cost = 0;
        for (const o of out) cost += 1 + o.moved * 2 + (lastDisplaced.get(o) === l ? 50 : 0);
        cost += rng() * 0.9;
        if (cost < choiceCost) {
          choiceCost = cost;
          choice = { slot, out };
        }
      }
      if (!choice) continue; // never placeable: reported below
      for (const o of choice.out) {
        unplace(o);
        o.moved += 1;
        lastDisplaced.set(o, l);
        queue.push(o);
      }
      if (!blockedBy(l, choice.slot)) place(l, choice.slot);
      else queue.push(l);
    }
    if (!best || unplacedCount() < best.unplaced) best = { unplaced: unplacedCount(), slots: snapshot() };
  }
  // Restore the arrangement with the fewest lessons left out.
  const current = unplacedCount();
  if (best && best.unplaced < current) {
    for (const l of movable) unplace(l);
    movable.forEach((l, i) => {
      const slot = best.slots[i];
      if (slot) place(l, slot);
    });
  }
  lastDisplaced = null;

  // ---- improvement (simulated annealing on the preferences) -------------------------------------------
  let total = score().total;
  const saLimit = maxIterations ?? movable.length * 400;
  const placedMovable = () => movable.filter((l) => l.slot);
  let saIter = 0;
  let bestTotal = total;
  let bestSlots = snapshot();
  const T0 = 6;
  while (saIter < saLimit && !outOfTime() && movable.length) {
    saIter += 1;
    if (saIter % 200 === 0) {
      // Lessons still left out: take any free period that has appeared.
      for (const l of movable) {
        if (l.slot) continue;
        const slot = bestFreeSlot(l);
        if (slot) place(l, slot);
      }
      total = score().total;
    }
    const pool = placedMovable();
    if (!pool.length) break;
    const temp = T0 * (1 - saIter / saLimit) + 0.05;
    const l = pool[Math.floor(rng() * pool.length)];
    const s = sectionById.get(l.sectionId);
    const target = s.slots[Math.floor(rng() * s.slots.length)];
    if (target.key === l.slot.key) continue;
    const other = s.occ.get(target.key);
    if (other?.locked) continue;
    const from = l.slot;
    const touched = touch([[l, from], [l, target], ...(other ? [[other, target], [other, from]] : [])]);
    const before = localPenalty(touched);
    unplace(l);
    if (other) unplace(other);
    let ok = !blockedBy(l, target);
    if (ok) {
      place(l, target);
      if (other) {
        ok = !blockedBy(other, from);
        if (ok) place(other, from);
        else unplace(l);
      }
    }
    if (!ok) {
      place(l, from);
      if (other) place(other, target);
      continue;
    }
    const delta = localPenalty(touched) - before;
    if (delta <= 0 || rng() < Math.exp(-delta / temp)) {
      total += delta;
      if (total < bestTotal - 1e-9) {
        bestTotal = total;
        bestSlots = snapshot();
      }
    } else {
      unplace(l);
      if (other) unplace(other);
      place(l, from);
      if (other) place(other, target);
    }
  }
  // Restore the best arrangement found (it never has more lessons left out: moves keep lessons placed).
  if (bestSlots.filter(Boolean).length >= placedMovable().length && bestTotal < score().total) {
    for (const l of movable) unplace(l);
    movable.forEach((l, i) => {
      const slot = bestSlots[i];
      if (slot) place(l, slot);
    });
  }

  // ---- result ---------------------------------------------------------------------------------------
  const unplaced = new Map();
  for (const l of movable) {
    if (l.slot) continue;
    const k = `${l.sectionId}|${l.subjectId}|${l.teacherId ?? ''}`;
    if (!unplaced.has(k)) {
      const counts = {};
      for (const slot of sectionById.get(l.sectionId).slots) {
        const why = blockedBy(l, slot) ?? 'section_full';
        counts[why] = (counts[why] ?? 0) + 1;
      }
      const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const main = ranked.find(([code]) => code !== 'section_full')?.[0] ?? 'section_full';
      unplaced.set(k, { sectionId: l.sectionId, subjectId: l.subjectId, teacherId: l.teacherId, count: 0, code: main, reason: REASONS[main], blockedPeriods: counts });
    }
    unplaced.get(k).count += 1;
  }
  const raw = score();
  const finalScore = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  return {
    lessons: lessons
      .filter((l) => l.slot)
      .map((l) => ({ sectionId: l.sectionId, weekday: l.slot.day, period: l.slot.period, subjectId: l.subjectId, teacherId: l.teacherId, fixed: l.fixed, locked: l.locked }))
      .sort((a, b) => a.sectionId.localeCompare(b.sectionId) || WEEKDAY_ORDER.indexOf(a.weekday) - WEEKDAY_ORDER.indexOf(b.weekday) || a.period - b.period),
    unplaced: [...unplaced.values()],
    problems,
    score: finalScore,
    stats: { required: lessons.length + problems.length, placed: lessons.filter((l) => l.slot).length, repairIterations: iterations, improveIterations: saIter, ms: now() - started },
  };
}

/**
 * Checks a complete timetable against the hard constraints (used by tests, by draft edits and before
 * publishing). `lessons`: [{ sectionId, weekday, period, subjectId, teacherId }]. → [{ code, message, … }].
 */
export function hardViolations({ sections, lessons, teachers = {}, rules = {} }) {
  const out = [];
  const maxSubjectPerDay = rules.maxSubjectPerDay ?? 2;
  const periodOf = new Map();
  for (const s of sections) for (const [day, list] of Object.entries(s.days ?? {})) for (const p of list) periodOf.set(`${s.id}|${day}|${p.number}`, { ...p, day });
  const seen = new Map();
  const byTeacherDay = new Map();
  const subjectDayCount = new Map();
  for (const l of lessons) {
    const p = periodOf.get(`${l.sectionId}|${l.weekday}|${l.period}`);
    if (!p) {
      out.push({ code: 'no_period', lesson: l, message: `There is no lesson period ${l.period} on ${DAY_NAMES[l.weekday] ?? l.weekday}.` });
      continue;
    }
    const k = `${l.sectionId}|${l.weekday}|${l.period}`;
    if (seen.has(k)) out.push({ code: 'section_double', lesson: l, message: 'Two lessons in one period of a class.' });
    seen.set(k, l);
    const sk = `${l.sectionId}|${l.subjectId}|${l.weekday}`;
    subjectDayCount.set(sk, (subjectDayCount.get(sk) ?? 0) + 1);
    if (l.teacherId) {
      const tk = `${l.teacherId}|${l.weekday}`;
      byTeacherDay.set(tk, [...(byTeacherDay.get(tk) ?? []), { l, p }]);
      const t = teachers[l.teacherId] ?? {};
      for (const b of [...(t.unavailable ?? []), ...(t.busy ?? [])]) {
        if (b.weekday === l.weekday && overlaps(b, p)) out.push({ code: 'teacher_blocked', lesson: l, message: `${t.name ?? 'The teacher'} is not available then.` });
      }
    }
  }
  for (const [tk, list] of byTeacherDay) {
    const [tid] = tk.split('|');
    const t = teachers[tid] ?? {};
    const limit = t.maxPerDay ?? rules.teacherMaxPerDay ?? Infinity;
    if (list.length > limit) out.push({ code: 'teacher_day_limit', teacherId: tid, message: `${t.name ?? 'A teacher'} would have ${list.length} lessons on ${DAY_NAMES[tk.split('|')[1]]} (limit ${limit}).` });
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (overlaps(list[i].p, list[j].p)) out.push({ code: 'teacher_clash', teacherId: tid, message: `${t.name ?? 'A teacher'} would teach two classes at the same time on ${DAY_NAMES[tk.split('|')[1]]}.` });
      }
    }
  }
  for (const [sk, n] of subjectDayCount) if (n > maxSubjectPerDay) out.push({ code: 'subject_day_limit', key: sk, message: `A subject has ${n} lessons in a day (limit ${maxSubjectPerDay}).` });
  if (rules.allowDoubleLessons === false) {
    for (const s of sections) {
      for (const [day, list] of Object.entries(s.days ?? {})) {
        const sorted = [...list].sort((a, b) => a.startMinute - b.startMinute);
        for (let i = 1; i < sorted.length; i += 1) {
          const a = seen.get(`${s.id}|${day}|${sorted[i - 1].number}`);
          const b = seen.get(`${s.id}|${day}|${sorted[i].number}`);
          if (a && b && a.subjectId === b.subjectId) out.push({ code: 'no_double', lesson: b, message: 'Two lessons of a subject follow each other, and double lessons are off.' });
        }
      }
    }
  }
  return out;
}
