/*
 * Phone reminder rules (N1, N5; docs/notifications/notification-specification.md → Reminders):
 * check-in reminders only with consent, an operating branch, no check-in yet (recorded or waiting)
 * and at most once per shift per day; check-out reminders before the end of the open check-in's
 * shift; upload reminders before the 24-hour limit. Reminders never record attendance.
 */
import { arrivalDecision, checkedInShifts, checkOutPlan, shouldWatchBranch, TEXTS, uploadPlan, zonedInstant } from '../reminderPlan';

const ZONE = 'Africa/Mogadishu'; // UTC+3, no daylight saving
const DATE = '2026-10-30';
const at = (hhmm) => zonedInstant(DATE, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), ZONE);
const today = (extra = {}) => ({
  date: DATE,
  timeZone: ZONE,
  checkOutEnabled: true,
  shifts: [
    { key: 'am', name: 'Subax', start: '08:00', end: '12:00', checkInOpensAt: '07:30', lateAfter: '08:10' },
    { key: 'pm', name: 'Galab', start: '13:00', end: '17:00', checkInOpensAt: '12:30', lateAfter: '13:10' },
  ],
  events: [],
  ...extra,
});
const reminders = (extra = {}) => ({
  checkIn: { available: true, enabled: true, leadMinutes: 15, consented: true },
  checkOut: { available: true, enabled: true, leadMinutes: 10 },
  upload: { available: true, enabled: true },
  ...extra,
});
const base = (extra = {}) => ({ today: today(), items: [], reminders: reminders(), branchOperating: true, sent: [], now: at('07:50'), ...extra });

test('zonedInstant gives the instant of a local time', () => {
  expect(at('07:50').toISOString()).toBe('2026-10-30T04:50:00.000Z');
});

test('arriving within the reminder window: notify for the next shift not checked in', () => {
  const d = arrivalDecision(base());
  expect(d).toMatchObject({ action: 'notify', key: `checkin:${DATE}:am` });
  expect(TEXTS.checkIn(d.shift).title).toMatch(/Xasuusin/);
  expect(TEXTS.checkIn(d.shift).body).toMatch(/Subax.*08:00/);
});

test('arriving early: the reminder is scheduled for the window start (lead, never before check-in opens)', () => {
  const early = arrivalDecision(base({ now: at('06:00') }));
  expect(early.action).toBe('schedule');
  expect(early.at.toISOString()).toBe(at('07:45').toISOString()); // 08:00 − 15 min
  const longLead = arrivalDecision(base({ now: at('06:00'), reminders: reminders({ checkIn: { enabled: true, leadMinutes: 60, consented: true } }) }));
  expect(longLead.at.toISOString()).toBe(at('07:30').toISOString()); // check-in opens at 07:30
});

test('no reminder without consent, when turned off, for a suspended branch, or when the day is not loaded', () => {
  expect(arrivalDecision(base({ reminders: reminders({ checkIn: { enabled: true, leadMinutes: 15, consented: false } }) })).reason).toBe('no_consent');
  expect(arrivalDecision(base({ reminders: reminders({ checkIn: { enabled: false, leadMinutes: 15, consented: true } }) })).reason).toBe('disabled');
  expect(arrivalDecision(base({ branchOperating: false })).reason).toBe('branch_not_operating');
  expect(arrivalDecision(base({ today: null })).reason).toBe('day_not_loaded');
  expect(arrivalDecision(base({ now: new Date('2026-10-31T05:00:00Z') })).reason).toBe('day_not_loaded');
});

test('at most one reminder per shift per day; none once checked in (recorded or waiting to upload)', () => {
  expect(arrivalDecision(base({ sent: [`checkin:${DATE}:am`] })).reason).toBe('already_reminded');
  const recorded = today({ events: [{ type: 'CHECK_IN', shift: { key: 'am' } }] });
  expect(arrivalDecision(base({ today: recorded })).key).toBe(`checkin:${DATE}:pm`);
  const waiting = [{ type: 'CHECK_IN', state: 'pending', occurredAt: at('07:40').toISOString() }];
  expect(checkedInShifts(today(), waiting)).toEqual(new Set(['am']));
  expect(arrivalDecision(base({ items: waiting })).key).toBe(`checkin:${DATE}:pm`);
  const both = today({ events: [{ type: 'CHECK_IN', shift: { key: 'am' } }, { type: 'CHECK_IN', shift: { key: 'pm' } }] });
  expect(arrivalDecision(base({ today: both })).reason).toBe('checked_in');
  // A refused event does not count as a check-in.
  expect(arrivalDecision(base({ items: [{ ...waiting[0], state: 'rejected' }] })).key).toBe(`checkin:${DATE}:am`);
});

test('check-out reminder: lead minutes before the end of the open check-in’s shift, on check-out days only', () => {
  const day = { isCurrentDay: true, openCheckIn: { type: 'CHECK_IN' }, shift: today().shifts[0] };
  const plan = checkOutPlan({ today: today(), day, reminders: reminders(), now: at('09:00') });
  expect(plan.key).toBe(`checkout:${DATE}:am`);
  expect(plan.at.toISOString()).toBe(at('11:50').toISOString());
  expect(plan.content.body).toMatch(/12:00/);
  expect(checkOutPlan({ today: today({ checkOutEnabled: false }), day, reminders: reminders(), now: at('09:00') })).toBeNull();
  expect(checkOutPlan({ today: today(), day: { ...day, openCheckIn: null }, reminders: reminders(), now: at('09:00') })).toBeNull();
  expect(checkOutPlan({ today: today(), day, reminders: reminders(), now: at('11:55') })).toBeNull();
  expect(checkOutPlan({ today: today(), day, reminders: reminders({ checkOut: { enabled: false, leadMinutes: 10 } }), now: at('09:00') })).toBeNull();
});

test('upload reminder: two hours before the oldest waiting event reaches 24 hours', () => {
  const items = [
    { state: 'pending', occurredAt: '2026-10-30T05:00:00.000Z' },
    { state: 'pending', occurredAt: '2026-10-30T03:00:00.000Z' },
    { state: 'recorded', occurredAt: '2026-10-29T01:00:00.000Z' },
  ];
  const plan = uploadPlan({ items, reminders: reminders(), now: new Date('2026-10-30T06:00:00Z') });
  expect(plan.at.toISOString()).toBe('2026-10-31T01:00:00.000Z');
  expect(uploadPlan({ items: [], reminders: reminders() })).toBeNull();
  expect(uploadPlan({ items, reminders: reminders({ upload: { enabled: false } }) })).toBeNull();
});

test('the branch is watched only with reminders on, consent, an operating branch, a location and background permission', () => {
  const ok = { reminders: reminders(), branchOperating: true, branchLocation: { latitude: 2, longitude: 45 }, backgroundGranted: true };
  expect(shouldWatchBranch(ok)).toBe(true);
  for (const change of [{ backgroundGranted: false }, { branchOperating: false }, { branchLocation: null }, { reminders: reminders({ checkIn: { enabled: true, consented: false } }) }]) {
    expect(shouldWatchBranch({ ...ok, ...change })).toBe(false);
  }
});
