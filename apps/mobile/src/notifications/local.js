/*
 * Device notifications (expo-notifications): the Android channel, the notification permission,
 * and scheduling or cancelling reminders by a stable key (so a reminder is never scheduled twice).
 * Local reminders never leave the phone.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const CHANNEL_ID = 'default';
const KEY_PREFIX = 'edutrack.';

// Shown also while the app is open (a banner), without a badge count of its own.
Notifications.setNotificationHandler?.({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  // AndroidImportance is re-exported through `export *`, which the import rule cannot follow.
  // eslint-disable-next-line import/namespace
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, { name: 'EduTrack', importance: Notifications.AndroidImportance.HIGH });
}

/** 'granted' | 'denied' | 'undetermined', asking when `ask` and the system still allows it. */
export async function notificationPermission({ ask = false } = {}) {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || !ask || current.canAskAgain === false) return current.granted ? 'granted' : current.status;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted ? 'granted' : asked.status;
}

/** Shows `content` now (at = null) or at `at`, replacing an earlier reminder with the same key. */
export async function scheduleReminder(key, content, at = null) {
  await ensureChannel();
  const identifier = KEY_PREFIX + key;
  await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: { ...content, data: { kind: 'reminder' } },
    trigger: at ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL_ID } : null,
  });
}

export const cancelReminder = (key) => Notifications.cancelScheduledNotificationAsync(KEY_PREFIX + key).catch(() => {});

/** Cancels every scheduled EduTrack reminder whose key starts with `prefix` (all of them by default). */
export async function cancelReminders(prefix = '') {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(scheduled.filter((n) => n.identifier?.startsWith(KEY_PREFIX + prefix)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})));
}
