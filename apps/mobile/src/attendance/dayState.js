/*
 * What the Home screen shows for today, from the server's day (GET /api/attendance/today) and the
 * events still waiting on this phone. Early feedback only: it never decides an event; the server
 * does when the event arrives (docs/business-rules.md → Attendance check-in and check-out).
 */
import { formatTime, localDate } from '../lib/format';

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const localMinutes = (instant, timeZone) => minutesOf(formatTime(instant, timeZone));

/**
 * deriveDay(today, localItems, now) → {
 *   isCurrentDay, timeline: [{ type, occurredAt, source: 'server' | 'pending', status, shiftName, clientEventId }],
 *   openCheckIn, lastCheckOut, shift (the shift to show), action: { kind, enabled, hint }
 * }
 * kind: 'CHECK_IN' | 'CHECK_OUT' | 'DONE' | 'NO_SHIFT' | 'UNKNOWN' (today not loaded).
 */
export function deriveDay(today, localItems = [], now = new Date()) {
  if (!today) return { isCurrentDay: false, timeline: [], openCheckIn: null, lastCheckOut: null, shift: null, action: { kind: 'UNKNOWN', enabled: false, hint: null } };
  const zone = today.timeZone;
  const isCurrentDay = localDate(now, zone) === today.date;

  const recordedIds = new Set(today.events.map((e) => e.clientEventId));
  const timeline = [
    ...today.events.map((e) => ({ type: e.type, occurredAt: e.occurredAt, source: 'server', status: e.status, shiftKey: e.shift?.key, shiftName: e.shift?.name, clientEventId: e.clientEventId, id: e.id, checkInEventId: e.checkInEventId })),
    ...localItems
      .filter((i) => i.state !== 'rejected' && !recordedIds.has(i.clientEventId) && localDate(i.occurredAt, zone) === today.date)
      .map((i) =>
        i.state === 'recorded' && i.serverEvent
          ? { type: i.type, occurredAt: i.occurredAt, source: 'server', status: i.serverEvent.status, shiftKey: i.serverEvent.shift?.key, shiftName: i.serverEvent.shift?.name, clientEventId: i.clientEventId, id: i.serverEvent.id, checkInEventId: i.serverEvent.checkInEventId }
          : { type: i.type, occurredAt: i.occurredAt, source: 'pending', status: null, shiftKey: null, shiftName: null, clientEventId: i.clientEventId },
      ),
  ].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

  // A check-in stays open until a later check-out closes it.
  let openCheckIn = null;
  let lastCheckOut = null;
  const checkedInShiftKeys = new Set();
  const nowMinutes = localMinutes(now, zone);
  for (const entry of timeline) {
    if (entry.type === 'CHECK_IN') {
      openCheckIn = entry;
      const key = entry.shiftKey ?? today.shifts.find((s) => withinWindow(s, localMinutes(entry.occurredAt, zone)))?.key;
      if (key) checkedInShiftKeys.add(key);
    } else {
      lastCheckOut = entry;
      openCheckIn = null;
    }
  }

  if (!isCurrentDay) return { isCurrentDay, timeline, openCheckIn, lastCheckOut, shift: null, action: { kind: 'UNKNOWN', enabled: false, hint: null } };

  const shiftOf = (entry) => today.shifts.find((s) => s.key === entry?.shiftKey) ?? null;
  if (openCheckIn) {
    const shift = shiftOf(openCheckIn) ?? today.shifts.find((s) => checkedInShiftKeys.has(s.key)) ?? null;
    return {
      isCurrentDay,
      timeline,
      openCheckIn,
      lastCheckOut,
      shift,
      action: today.checkOutEnabled ? { kind: 'CHECK_OUT', enabled: true, hint: null } : { kind: 'DONE', enabled: false, hint: 'Check-out is not used at your branch.' },
    };
  }

  // The next shift still open for check-in today.
  const next = today.shifts.find((s) => !checkedInShiftKeys.has(s.key) && nowMinutes < minutesOf(s.end));
  if (next) {
    const opens = minutesOf(next.checkInOpensAt);
    return {
      isCurrentDay,
      timeline,
      openCheckIn,
      lastCheckOut,
      shift: next,
      action: nowMinutes >= opens ? { kind: 'CHECK_IN', enabled: true, hint: null } : { kind: 'CHECK_IN', enabled: false, hint: `Check-in opens at ${next.checkInOpensAt}.` },
    };
  }
  if (!today.shifts.length) return { isCurrentDay, timeline, openCheckIn, lastCheckOut, shift: null, action: { kind: 'NO_SHIFT', enabled: false, hint: 'You have no assigned shift today.' } };
  const last = shiftOf(lastCheckOut) ?? today.shifts[today.shifts.length - 1];
  return {
    isCurrentDay,
    timeline,
    openCheckIn,
    lastCheckOut,
    shift: last,
    action: { kind: 'DONE', enabled: false, hint: checkedInShiftKeys.size ? 'Your attendance for today is complete.' : 'Today’s shifts have ended.' },
  };
}

function withinWindow(shift, minutes) {
  return minutes >= minutesOf(shift.checkInOpensAt) && minutes < minutesOf(shift.end);
}
