/*
 * Student attendance rules without a database (docs/business-rules.md → Student attendance): the
 * sessions of a day (once or twice, a fixed shape once opened), their windows, excuses and what a
 * student's attendance counts as, and how settings are resolved across platform, school and branch.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { zonedInstant } from '../src/common/zonedTime.js';
import {
  countStatuses,
  dayShape,
  editableUntil,
  effectiveStatus,
  excuseCoversHalf,
  plannedHalves,
  sessionTimes,
  windowState,
} from '../src/features/student-attendance/attendanceRules.js';
import { PLATFORM_DEFAULTS, readSettingsChange, resolveSettings } from '../src/features/student-attendance/settings.js';

const TZ = 'Africa/Mogadishu';
const twoHalves = {
  schoolDay: true,
  halves: [
    { half: 'before_break', startMinute: 450, endMinute: 630 },
    { half: 'after_break', startMinute: 660, endMinute: 780 },
  ],
};
const settings = { ...PLATFORM_DEFAULTS };

describe('sessions of a day', () => {
  test('twice: before and after the main break; once: one whole-day session over all of it', () => {
    assert.deepEqual(plannedHalves(twoHalves, settings).map((h) => h.half), ['before_break', 'after_break']);
    assert.deepEqual(plannedHalves(twoHalves, { ...settings, halfDayFrequency: 'once_daily' }), [{ half: 'whole_day', startMinute: 450, endMinute: 780 }]);
  });

  test('no main break: one session; no bell times: one session without times; no school: none', () => {
    const one = { schoolDay: true, halves: [{ half: 'whole_day', startMinute: 450, endMinute: 700 }] };
    assert.deepEqual(plannedHalves(one, settings), [{ half: 'whole_day', startMinute: 450, endMinute: 700 }]);
    assert.deepEqual(plannedHalves({ schoolDay: true, halves: [] }, settings), [{ half: 'whole_day', startMinute: null, endMinute: null }]);
    assert.deepEqual(plannedHalves({ schoolDay: false, halves: twoHalves.halves }, settings), []);
  });

  test('opened sessions fix the shape of the day', () => {
    const planned = plannedHalves(twoHalves, { ...settings, halfDayFrequency: 'once_daily' });
    const before = { id: 's1', half: 'before_break' };
    const shape = dayShape(planned, twoHalves.halves, [before]);
    assert.deepEqual(shape.map((s) => [s.half, s.session?.id ?? null]), [['before_break', 's1'], ['after_break', null]]);
    const whole = { id: 's2', half: 'whole_day' };
    assert.deepEqual(dayShape(plannedHalves(twoHalves, settings), twoHalves.halves, [whole]).map((s) => s.half), ['whole_day']);
    assert.deepEqual(dayShape(planned, twoHalves.halves, []).map((s) => s.session), [null]);
  });
});

describe('windows', () => {
  test('opens before the start, due after the end, then late entries until the correction period ends', () => {
    const t = sessionTimes('2026-11-14', { startMinute: 450, endMinute: 630 }, settings, TZ);
    assert.equal(t.startsAt.getTime(), zonedInstant('2026-11-14', 450, TZ).getTime());
    assert.equal(t.opensAt.getTime(), t.startsAt.getTime() - 15 * 60_000);
    assert.equal(t.deadlineAt.getTime(), t.endsAt.getTime() + 60 * 60_000);
    const until = editableUntil('2026-11-14', settings, TZ);
    assert.equal(until.getTime(), zonedInstant('2026-11-22', 0, TZ).getTime(), 'the end of the 7th day after');
    assert.equal(windowState(t, until, new Date(t.opensAt.getTime() - 1)), 'upcoming');
    assert.equal(windowState(t, until, t.opensAt), 'open');
    assert.equal(windowState(t, until, t.deadlineAt), 'open');
    assert.equal(windowState(t, until, new Date(t.deadlineAt.getTime() + 1)), 'overdue');
    assert.equal(windowState(t, until, until), 'locked');
  });

  test('no correction period: editable until the deadline only; no times: the whole day', () => {
    const none = { ...settings, managerEditDays: 0 };
    const t = sessionTimes('2026-11-14', { startMinute: 1380, endMinute: 1439 }, none, TZ);
    const until = editableUntil('2026-11-14', none, TZ);
    assert.ok(t.deadlineAt > until, 'the deadline is after midnight');
    assert.equal(windowState(t, until, new Date(t.deadlineAt.getTime() - 1)), 'open');
    assert.equal(windowState(t, until, new Date(t.deadlineAt.getTime() + 1)), 'locked');
    const free = sessionTimes('2026-11-14', { startMinute: null, endMinute: null }, settings, TZ);
    assert.equal(free.startsAt, null);
    assert.equal(free.opensAt.getTime(), zonedInstant('2026-11-14', 0, TZ).getTime());
    assert.equal(free.deadlineAt.getTime(), zonedInstant('2026-11-15', 60, TZ).getTime());
  });
});

describe('excuses and what attendance counts as', () => {
  test('an excuse covers whole days or its half; lesson excuses do not cover Manager sessions', () => {
    const e = { startDate: '2026-11-10', endDate: '2026-11-12', half: null, periods: [] };
    assert.equal(excuseCoversHalf(e, '2026-11-11', 'before_break'), true);
    assert.equal(excuseCoversHalf(e, '2026-11-13', 'before_break'), false);
    assert.equal(excuseCoversHalf({ ...e, half: 'after_break' }, '2026-11-11', 'before_break'), false);
    assert.equal(excuseCoversHalf({ ...e, half: 'after_break' }, '2026-11-11', 'after_break'), true);
    assert.equal(excuseCoversHalf({ ...e, half: 'after_break' }, '2026-11-11', 'whole_day'), false);
    assert.equal(excuseCoversHalf({ ...e, periods: [3] }, '2026-11-11', 'before_break'), false);
  });

  test('absent or unmarked + excuse → excused; present or late stands; unmarked is never absent', () => {
    assert.equal(effectiveStatus('absent', { excused: true }), 'excused');
    assert.equal(effectiveStatus(null, { excused: true }), 'excused');
    assert.equal(effectiveStatus('present', { excused: true }), 'present');
    assert.equal(effectiveStatus('late', { excused: true }), 'late');
    assert.equal(effectiveStatus('excused'), 'excused');
    assert.equal(effectiveStatus(null), 'pending');
    assert.equal(effectiveStatus(null, { overdue: true }), 'not_marked');
    assert.deepEqual(countStatuses(['present', 'absent', 'late', 'excused', 'pending', 'not_marked']), { present: 1, absent: 1, late: 1, excused: 1, notMarked: 2, total: 6 });
  });
});

describe('settings', () => {
  test('branch values apply only where the school allows; else school; else platform', () => {
    const school = { halfDayOpensBeforeMinutes: 30, managerEditDays: null, halfDayFrequency: 'TWICE_DAILY', branchOverridable: ['halfDayFrequency'] };
    const branch = { halfDayFrequency: 'ONCE_DAILY', halfDayOpensBeforeMinutes: 5 };
    const { values, sources } = resolveSettings(school, branch);
    assert.equal(values.halfDayFrequency, 'once_daily');
    assert.equal(sources.halfDayFrequency, 'branch');
    assert.equal(values.halfDayOpensBeforeMinutes, 30, 'not allowed for branches: the school value');
    assert.equal(sources.halfDayOpensBeforeMinutes, 'school');
    assert.equal(values.managerEditDays, PLATFORM_DEFAULTS.managerEditDays);
    assert.equal(sources.managerEditDays, 'platform');
    assert.deepEqual(resolveSettings(null, null).values, PLATFORM_DEFAULTS);
  });

  test('changes are validated: limits, known settings, only the Owner decides what branches may change', () => {
    assert.throws(() => readSettingsChange({ halfDayOpensBeforeMinutes: 241 }, { role: 'OWNER' }), (e) => !!e.details.halfDayOpensBeforeMinutes);
    assert.throws(() => readSettingsChange({ halfDayFrequency: 'thrice' }, { role: 'OWNER' }), (e) => !!e.details.halfDayFrequency);
    assert.throws(() => readSettingsChange({ nope: 1 }, { role: 'OWNER' }), (e) => !!e.details.nope);
    assert.throws(() => readSettingsChange({ branchOverridable: [] }, { role: 'MANAGER' }), (e) => !!e.details.branchOverridable);
    assert.throws(() => readSettingsChange({ branch: 'x', managerEditDays: 1 }, { role: 'MANAGER' }), (e) => !!e.details.branch);
    assert.throws(() => readSettingsChange({}, { role: 'OWNER' }), /at least one/);
    assert.deepEqual(readSettingsChange({ managerEditDays: null, branchOverridable: ['managerEditDays', 'halfDayFrequency', 'managerEditDays'] }, { role: 'OWNER' }), {
      values: { managerEditDays: null },
      branchOverridable: ['halfDayFrequency', 'managerEditDays'],
    });
  });
});

describe('teacher lessons', () => {
  test('lesson excuses: named periods, else the lesson’s half, else the whole day', async () => {
    const { excuseCoversLesson } = await import('../src/features/student-attendance/attendanceRules.js');
    const e = { startDate: '2026-11-10', endDate: '2026-11-10', half: null, periods: [] };
    assert.equal(excuseCoversLesson(e, '2026-11-10', { half: 'before_break', period: 2 }), true);
    assert.equal(excuseCoversLesson({ ...e, periods: [3] }, '2026-11-10', { half: 'before_break', period: 2 }), false);
    assert.equal(excuseCoversLesson({ ...e, periods: [2, 3] }, '2026-11-10', { half: 'before_break', period: 2 }), true);
    assert.equal(excuseCoversLesson({ ...e, half: 'after_break' }, '2026-11-10', { half: 'before_break', period: 2 }), false);
    assert.equal(excuseCoversLesson(e, '2026-11-11', { half: null, period: 1 }), false);
  });

  test('a teacher’s mark: inside the window, own corrections for a while, never over a Manager or a newer mark', async () => {
    const { teacherMarkRefusal } = await import('../src/features/student-attendance/attendanceRules.js');
    const t = (m) => new Date(Date.UTC(2026, 10, 10, 8, m));
    const session = { opensAt: t(0), deadlineAt: t(60) };
    const s = { ...PLATFORM_DEFAULTS, teacherCorrectionMinutes: 30 };
    const blank = { markedByRole: null, occurredAt: null, markedById: null, markedAt: null, firstMarkedAt: null };
    assert.equal(teacherMarkRefusal({ at: t(10), session, entry: blank, teacherId: 'me', settings: s }), null);
    assert.equal(teacherMarkRefusal({ at: new Date(t(0) - 1), session, entry: blank, teacherId: 'me', settings: s }), 'OUTSIDE_WINDOW');
    assert.equal(teacherMarkRefusal({ at: t(70), session, entry: blank, teacherId: 'me', settings: s }), 'OUTSIDE_WINDOW');
    const own = { markedByRole: 'STAFF', occurredAt: t(50), markedById: 'me', markedAt: t(50), firstMarkedAt: t(50) };
    assert.equal(teacherMarkRefusal({ at: t(75), session, entry: own, teacherId: 'me', settings: s }), null, 'own correction within 30 minutes');
    assert.equal(teacherMarkRefusal({ at: t(81), session, entry: own, teacherId: 'me', settings: s }), 'OUTSIDE_WINDOW');
    assert.equal(teacherMarkRefusal({ at: t(75), session, entry: { ...own, markedById: 'other' }, teacherId: 'me', settings: s }), 'OUTSIDE_WINDOW');
    assert.equal(teacherMarkRefusal({ at: t(40), session, entry: own, teacherId: 'me', settings: s }), 'NEWER_MARK');
    assert.equal(teacherMarkRefusal({ at: t(55), session, entry: { ...own, markedByRole: 'MANAGER' }, teacherId: 'me', settings: s }), 'SET_BY_MANAGER');
  });
});
