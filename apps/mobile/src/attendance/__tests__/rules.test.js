/* The on-device location check and the Home day state (early feedback; the server decides). */
import { deriveDay } from '../dayState';
import { branchLocationAt, checkPosition, distanceMeters } from '../geo';

const M_PER_DEG = (6_371_008.8 * Math.PI) / 180;
const BRANCH = { latitude: 2.046934, longitude: 45.318162, effectiveFrom: '2026-01-01T00:00:00.000Z' };
const north = (metres, accuracy = 10) => ({ latitude: BRANCH.latitude + metres / M_PER_DEG, longitude: BRANCH.longitude, accuracy });

describe('location check (same limits as the server)', () => {
  test('exactly 50 m accuracy and 100 m distance are accepted; worse is refused', () => {
    expect(checkPosition(north(99.99, 50), BRANCH).ok).toBe(true);
    expect(checkPosition(north(10, 50.1), BRANCH).reason).toBe('accuracy_too_low');
    expect(checkPosition(north(100.01), BRANCH).reason).toBe('outside_geofence');
    expect(checkPosition(null, BRANCH).reason).toBe('no_position');
    expect(checkPosition({ latitude: 0, longitude: 0, accuracy: 5 }, BRANCH).reason).toBe('invalid_position');
    expect(checkPosition(north(10), null).reason).toBe('no_branch_location');
    expect(distanceMeters(BRANCH, north(40))).toBeCloseTo(40, 1);
  });

  test('the branch location in effect at the event time (a scheduled move applies from its time)', () => {
    const later = { latitude: 2.1, longitude: 45.4, effectiveFrom: '2026-10-28T06:00:00.000Z' };
    const today = { branchLocation: BRANCH, scheduledBranchLocation: later };
    expect(branchLocationAt(today, new Date('2026-10-28T05:59:59Z'))).toBe(BRANCH);
    expect(branchLocationAt(today, new Date('2026-10-28T06:00:00Z'))).toBe(later);
    expect(branchLocationAt({ branchLocation: null, scheduledBranchLocation: null }, new Date())).toBeNull();
  });
});

describe('day state', () => {
  // Africa/Mogadishu is UTC+3: 08:00 local = 05:00Z.
  const base = {
    date: '2026-10-27',
    timeZone: 'Africa/Mogadishu',
    checkOutEnabled: true,
    shifts: [{ key: 'main', name: 'Main Shift', start: '08:00', end: '16:00', checkInOpensAt: '07:30', lateAfter: '08:10' }],
    events: [],
    branchLocation: BRANCH,
    scheduledBranchLocation: null,
  };
  const at = (hhmm) => new Date(`2026-10-27T${String(Number(hhmm.slice(0, 2)) - 3).padStart(2, '0')}:${hhmm.slice(3)}:00Z`);
  const checkIn = { id: 's1', clientEventId: 'c1', type: 'CHECK_IN', occurredAt: at('07:58').toISOString(), receivedAt: at('07:58').toISOString(), workDate: '2026-10-27', shift: { key: 'main', name: 'Main Shift' }, status: 'PRESENT', distanceMeters: 28, checkInEventId: null };

  test('before the window: check-in shown but disabled, with the opening time', () => {
    const day = deriveDay(base, [], at('07:00'));
    expect(day.action).toEqual({ kind: 'CHECK_IN', enabled: false, hint: 'Check-in opens at 07:30.' });
    expect(deriveDay(base, [], at('07:30')).action.enabled).toBe(true);
  });

  test('after check-in: check-out; with check-out off: done', () => {
    const day = deriveDay({ ...base, events: [checkIn] }, [], at('09:00'));
    expect(day.action.kind).toBe('CHECK_OUT');
    expect(day.openCheckIn.status).toBe('PRESENT');
    expect(deriveDay({ ...base, checkOutEnabled: false, events: [checkIn] }, [], at('09:00')).action.kind).toBe('DONE');
  });

  test('a check-in waiting on the phone counts for the screen but is marked as pending', () => {
    const pending = { clientEventId: 'p1', type: 'CHECK_IN', occurredAt: at('07:58').toISOString(), state: 'pending' };
    const day = deriveDay(base, [pending], at('08:05'));
    expect(day.openCheckIn.source).toBe('pending');
    expect(day.action.kind).toBe('CHECK_OUT');
    // A rejected one does not count.
    expect(deriveDay(base, [{ ...pending, state: 'rejected' }], at('08:05')).action.kind).toBe('CHECK_IN');
  });

  test('after the shift ended, or no shift: no action', () => {
    expect(deriveDay(base, [], at('16:00')).action.kind).toBe('DONE');
    expect(deriveDay({ ...base, shifts: [] }, [], at('09:00')).action.kind).toBe('NO_SHIFT');
    expect(deriveDay(base, [], new Date('2026-10-28T06:00:00Z')).isCurrentDay).toBe(false);
  });
});
