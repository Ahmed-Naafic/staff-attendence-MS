/*
 * The background geofence task (N1): arriving at the branch shows at most one reminder per shift
 * per day, leaving cancels a reminder scheduled for later, only the branch region counts, and the
 * task never records or sends attendance or stores the phone's position.
 */
import * as Location from 'expo-location';
import { migrate } from '../../db/database';
import { enqueue } from '../../attendance/queue';
import { backgroundPermission, BRANCH_REGION, handleGeofenceEvent, saveReminderContext, syncBranchGeofence } from '../geofence';
import { zonedInstant } from '../reminderPlan';

const ZONE = 'Africa/Mogadishu';
const DATE = '2026-10-30';
const at = (hhmm) => zonedInstant(DATE, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), ZONE);
const today = {
  date: DATE,
  timeZone: ZONE,
  checkOutEnabled: true,
  shifts: [{ key: 'am', name: 'Subax', start: '08:00', end: '12:00', checkInOpensAt: '07:30', lateAfter: '08:10' }],
  events: [],
};
const reminders = { checkIn: { enabled: true, consented: true, leadMinutes: 15 }, checkOut: { enabled: true, leadMinutes: 10 }, upload: { enabled: true } };
const enter = { eventType: Location.GeofencingEventType.Enter, region: { identifier: BRANCH_REGION, latitude: 2, longitude: 45, radius: 100 } };
const exit = { ...enter, eventType: Location.GeofencingEventType.Exit };

let db;
const open = async () => db;
beforeEach(async () => {
  db = global.__openTestDatabase();
  await migrate(db);
  global.__scheduled.clear();
  await saveReminderContext({ userId: 'staff-1', today, reminders, branchOperating: true }, open);
});

test('arriving shows one reminder, never a second for the same shift that day', async () => {
  expect(await handleGeofenceEvent(enter, { openDatabase: open, now: at('07:50') })).toBe('notify');
  expect([...global.__scheduled.keys()]).toEqual([`edutrack.checkin:${DATE}:am`]);
  expect(global.__scheduled.get(`edutrack.checkin:${DATE}:am`).trigger).toBeNull(); // shown now
  global.__scheduled.clear();
  expect(await handleGeofenceEvent(enter, { openDatabase: open, now: at('08:05') })).toBe('none');
  expect(global.__scheduled.size).toBe(0);
});

test('arriving early schedules the reminder; leaving cancels it', async () => {
  expect(await handleGeofenceEvent(enter, { openDatabase: open, now: at('06:30') })).toBe('schedule');
  const request = global.__scheduled.get(`edutrack.checkin:${DATE}:am`);
  expect(request.trigger.date.toISOString()).toBe(at('07:45').toISOString());
  expect(await handleGeofenceEvent(exit, { openDatabase: open, now: at('06:40') })).toBe('left');
  expect(global.__scheduled.size).toBe(0);
});

test('no reminder once a check-in is waiting to upload; the task records and sends nothing', async () => {
  await enqueue(db, 'staff-1', { clientEventId: 'e1', type: 'CHECK_IN', occurredAt: at('07:40').toISOString(), position: { latitude: 2, longitude: 45, accuracy: 10 }, distanceEstimate: 5 }, at('07:40'));
  const before = await db.getAllAsync('SELECT * FROM attendance_queue');
  expect(await handleGeofenceEvent(enter, { openDatabase: open, now: at('07:50') })).toBe('none');
  expect(await db.getAllAsync('SELECT * FROM attendance_queue')).toEqual(before);
  // Nothing about where the phone was is kept.
  const kv = await db.getAllAsync('SELECT key, value FROM kv');
  expect(JSON.stringify(kv)).not.toMatch(/latitude|longitude/);
});

test('other regions are ignored; no reminder without consent or for a suspended branch', async () => {
  expect(await handleGeofenceEvent({ ...enter, region: { identifier: 'elsewhere' } }, { openDatabase: open, now: at('07:50') })).toBe('ignored');
  await saveReminderContext({ userId: 'staff-1', today, reminders: { ...reminders, checkIn: { ...reminders.checkIn, consented: false } }, branchOperating: true }, open);
  expect(await handleGeofenceEvent(enter, { openDatabase: open, now: at('07:50') })).toBe('none');
  await saveReminderContext({ userId: 'staff-1', today, reminders, branchOperating: false }, open);
  expect(await handleGeofenceEvent(enter, { openDatabase: open, now: at('07:50') })).toBe('none');
  expect(global.__scheduled.size).toBe(0);
});

test('watching: one 100 m circle around the branch, replaced on change, stopped when not allowed', async () => {
  await syncBranchGeofence({ watch: true, branchLocation: { latitude: 2.05, longitude: 45.32 } });
  expect(Location.startGeofencingAsync).toHaveBeenLastCalledWith('edutrack-branch-geofence', [
    { identifier: BRANCH_REGION, latitude: 2.05, longitude: 45.32, radius: 100, notifyOnEnter: true, notifyOnExit: true },
  ]);
  Location.hasStartedGeofencingAsync.mockResolvedValueOnce(true);
  await syncBranchGeofence({ watch: false, branchLocation: null });
  expect(Location.stopGeofencingAsync).toHaveBeenCalled();
});

test('background permission is asked only when requested, after the foreground one, and denial is reported', async () => {
  Location.requestBackgroundPermissionsAsync.mockClear();
  expect(await backgroundPermission()).toEqual({ foreground: 'granted', background: 'undetermined', canAskAgain: true });
  expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  Location.requestBackgroundPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'denied', canAskAgain: false });
  expect(await backgroundPermission({ ask: true })).toEqual({ foreground: 'granted', background: 'denied', canAskAgain: false });
});
