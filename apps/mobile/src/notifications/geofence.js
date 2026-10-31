/*
 * Check-in reminders from OS-managed geofencing (N1). With the staff member's consent and the
 * system's "Allow all the time" location permission, the phone's operating system watches ONE
 * circle — the staff member's current, operating branch (100 m) — and wakes the app only when the
 * phone enters or leaves it. The app never polls GPS for this, never stores where the phone was,
 * and sends nothing to the server: the event only decides whether to show a reminder.
 * A reminder never records attendance; only an accepted check-in does.
 *
 * The background task reads what the app last saved on this phone (the day, the reminder
 * settings, events waiting to upload and the reminders already shown), so it works offline.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { getDatabase, readValue, writeValue } from '../db/database';
import { itemsSince } from '../attendance/queue';
import { cancelReminders, scheduleReminder } from './local';
import { arrivalDecision, TEXTS } from './reminderPlan';

export const GEOFENCE_TASK = 'edutrack-branch-geofence';
export const BRANCH_REGION = 'branch';
const CONTEXT_KEY = 'reminders:context';
const SENT_KEY = 'reminders:sent';

/** What the background task needs, saved by the app whenever it changes: { userId, today, reminders, branchOperating }. */
export const saveReminderContext = async (context, openDatabase = getDatabase) => writeValue(await openDatabase(), CONTEXT_KEY, context);

/** Handles one geofence event (exported for tests). */
export async function handleGeofenceEvent({ eventType, region }, { openDatabase = getDatabase, now = new Date() } = {}) {
  if (region?.identifier !== BRANCH_REGION) return 'ignored';
  if (eventType === Location.GeofencingEventType.Exit) {
    // Left before the reminder time: no reminder for that arrival.
    await cancelReminders('checkin:');
    return 'left';
  }
  if (eventType !== Location.GeofencingEventType.Enter) return 'ignored';
  const db = await openDatabase();
  const context = await readValue(db, CONTEXT_KEY);
  if (!context?.userId) return 'no_context';
  const items = await itemsSince(db, context.userId, new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString());
  const sent = (await readValue(db, SENT_KEY)) ?? [];
  const decision = arrivalDecision({ ...context, items, sent, now });
  if (decision.action === 'notify' || decision.action === 'schedule') {
    await scheduleReminder(decision.key, TEXTS.checkIn(decision.shift), decision.action === 'schedule' ? decision.at : null);
    // At most one reminder per shift per day.
    await writeValue(db, SENT_KEY, [...sent, decision.key].slice(-60));
  }
  return decision.action;
}

// The task must be defined when the JavaScript bundle loads (index.js imports this module).
if (!TaskManager.isTaskDefined?.(GEOFENCE_TASK)) {
  TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
    if (error || !data) return;
    try {
      await handleGeofenceEvent(data);
    } catch {
      // A reminder is a convenience: a failure here must not crash the background task.
    }
  });
}

/**
 * Location permissions for geofence reminders. → { foreground, background, canAskAgain }
 * (status strings). Asking for background location is done only after the staff member agreed in
 * the app's own explanation.
 */
export async function backgroundPermission({ ask = false } = {}) {
  let fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted && ask && fg.canAskAgain !== false) fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return { foreground: fg.status, background: 'denied', canAskAgain: fg.canAskAgain !== false };
  let bg = await Location.getBackgroundPermissionsAsync();
  if (!bg.granted && ask && bg.canAskAgain !== false) bg = await Location.requestBackgroundPermissionsAsync();
  return { foreground: 'granted', background: bg.granted ? 'granted' : bg.status, canAskAgain: bg.canAskAgain !== false };
}

/** Starts watching the branch (replacing any earlier circle) or stops watching. */
export async function syncBranchGeofence({ watch, branchLocation }) {
  const started = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false);
  if (!watch || !branchLocation) {
    if (started) await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {});
    if (!watch) await cancelReminders('checkin:');
    return false;
  }
  await Location.startGeofencingAsync(GEOFENCE_TASK, [
    { identifier: BRANCH_REGION, latitude: branchLocation.latitude, longitude: branchLocation.longitude, radius: 100, notifyOnEnter: true, notifyOnExit: true },
  ]);
  return true;
}
