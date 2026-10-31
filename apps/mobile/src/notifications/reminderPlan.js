/*
 * Which phone reminders to show, and when (N1, N2 phase 2, N5). Pure functions over the day the
 * server sent (GET /api/attendance/today), the events on this phone and the reminder settings the
 * server computed (platform ∧ branch ∧ staff, within the platform limits). Reminders are messages
 * only: they never record attendance — only an accepted check-in does.
 *
 *   check-in  (geofence): when the phone reports arriving at the branch and no check-in exists for
 *             the shift (recorded or waiting); from lead minutes before the start (never before
 *             check-in opens) until the shift ends; at most one per shift per day.
 *   check-out (time):     lead minutes before the end of the shift of an open check-in, on days the
 *             branch uses check-out.
 *   upload    (time):     two hours before a waiting event reaches the 24-hour upload limit.
 *
 * Texts are Somali (N24).
 */
import { localDate } from '../lib/format';

export const UPLOAD_LIMIT_MS = 24 * 60 * 60 * 1000;
export const UPLOAD_WARNING_MS = 2 * 60 * 60 * 1000;

export const TEXTS = {
  checkIn: (shift) => ({ title: 'Xasuusin: diiwaangeli imaanshahaaga', body: `Waxaad timid laantaada. Wareegga ${shift.name} wuxuu bilaabmayaa ${shift.start}. Imaanshaha waxaa diiwaangeliya oo keliya markaad adigu gudbiso.` }),
  checkOut: (shift) => ({ title: 'Xasuusin: diiwaangeli bixitaankaaga', body: `Wareegga ${shift.name} wuxuu dhammaanayaa ${shift.end}. Ha illoobin inaad diiwaangeliso bixitaanka.` }),
  upload: () => ({ title: 'Dhacdooyin sugaya in la diro', body: 'Ku xir internetka si dhacdooyinkaaga loo diro ka hor xadka 24-ka saac.' }),
};

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The instant of a local date and minute in a time zone. */
export function zonedInstant(date, minutes, timeZone) {
  const guess = new Date(Date.parse(`${date}T00:00:00Z`) + minutes * 60 * 1000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(guess)
      .map((p) => [p.type, p.value]),
  );
  const shown = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
  return new Date(guess.getTime() - (shown - guess.getTime()));
}

/** The shift keys already checked in today, from the server's events and events waiting on this phone. */
export function checkedInShifts(today, items = []) {
  const keys = new Set(today.events.filter((e) => e.type === 'CHECK_IN').map((e) => e.shift?.key));
  for (const item of items) {
    if (item.type !== 'CHECK_IN' || item.state === 'rejected' || localDate(item.occurredAt, today.timeZone) !== today.date) continue;
    if (item.serverEvent?.shift?.key) keys.add(item.serverEvent.shift.key);
    else {
      // Waiting: the shift whose check-in window contains the event time.
      const minute = minutesOf(new Intl.DateTimeFormat('en-GB', { timeZone: today.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(item.occurredAt)));
      const shift = today.shifts.find((s) => minute >= minutesOf(s.checkInOpensAt) && minute < minutesOf(s.end));
      if (shift) keys.add(shift.key);
    }
  }
  return keys;
}

/**
 * On arrival at the branch (OS geofence "enter"). → { action: 'notify', key, shift } (show now),
 * { action: 'schedule', key, shift, at } (arrived early: remind when the window starts, cancelled
 * on leaving) or { action: 'none', reason }.
 */
export function arrivalDecision({ today, items = [], reminders, branchOperating, sent = [], now = new Date() }) {
  if (!reminders?.checkIn?.enabled) return { action: 'none', reason: 'disabled' };
  if (!reminders.checkIn.consented) return { action: 'none', reason: 'no_consent' };
  if (!branchOperating) return { action: 'none', reason: 'branch_not_operating' };
  if (!today || localDate(now, today.timeZone) !== today.date) return { action: 'none', reason: 'day_not_loaded' };
  const done = checkedInShifts(today, items);
  const nowMinute = minutesOf(new Intl.DateTimeFormat('en-GB', { timeZone: today.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now));
  const shift = today.shifts.find((s) => !done.has(s.key) && nowMinute < minutesOf(s.end));
  if (!shift) return { action: 'none', reason: done.size ? 'checked_in' : 'no_shift' };
  const key = `checkin:${today.date}:${shift.key}`;
  if (sent.includes(key)) return { action: 'none', reason: 'already_reminded' };
  const from = Math.max(minutesOf(shift.checkInOpensAt), minutesOf(shift.start) - reminders.checkIn.leadMinutes);
  if (nowMinute >= from) return { action: 'notify', key, shift };
  return { action: 'schedule', key, shift, at: zonedInstant(today.date, from, today.timeZone) };
}

/** The check-out reminder for the open check-in, or null. */
export function checkOutPlan({ today, day, reminders, now = new Date() }) {
  if (!reminders?.checkOut?.enabled || !today?.checkOutEnabled || !day?.isCurrentDay || !day.openCheckIn) return null;
  const shift = day.shift;
  if (!shift) return null;
  const at = zonedInstant(today.date, minutesOf(shift.end) - reminders.checkOut.leadMinutes, today.timeZone);
  if (at <= now) return null;
  return { key: `checkout:${today.date}:${shift.key}`, at, content: TEXTS.checkOut(shift) };
}

/** One reminder before the oldest waiting event reaches the 24-hour limit, or null. */
export function uploadPlan({ items = [], reminders, now = new Date() }) {
  if (!reminders?.upload?.enabled) return null;
  const pending = items.filter((i) => i.state === 'pending').sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  if (!pending.length) return null;
  const at = new Date(Date.parse(pending[0].occurredAt) + UPLOAD_LIMIT_MS - UPLOAD_WARNING_MS);
  if (at <= now) return null;
  return { key: 'upload', at, content: TEXTS.upload() };
}

/** Whether the OS geofence should watch the branch: reminders on, consent given, branch operating and a branch location known. */
export const shouldWatchBranch = ({ reminders, branchOperating, branchLocation, backgroundGranted }) =>
  Boolean(reminders?.checkIn?.enabled && reminders.checkIn.consented && branchOperating && branchLocation && backgroundGranted);
