/*
 * Notifications in the Staff app (N2, N4, N5, N1): the unread count, the staff member's
 * preferences and reminder settings (as computed by the server), and keeping the phone's reminders
 * in step with them —
 *   the check-out reminder and the upload-limit reminder (scheduled on the phone, phase 2),
 *   the branch geofence for check-in reminders (only with consent and "Allow all the time"),
 *   push registration for this session (phase 3).
 * Settings and the day are saved on the phone, so reminders keep working offline. Signing out
 * cancels every reminder, stops the geofence and removes the push token.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAttendance } from '../attendance/AttendanceProvider';
import { useSession } from '../auth/SessionProvider';
import { getDatabase, readValue, writeValue } from '../db/database';
import { branchLocationAt } from '../attendance/geo';
import { fetchPreferences, fetchUnreadCount, savePreferences } from './api';
import { backgroundPermission, saveReminderContext, syncBranchGeofence } from './geofence';
import { cancelReminder, cancelReminders, scheduleReminder } from './local';
import { disablePush, enablePush } from './push';
import { checkOutPlan, shouldWatchBranch, uploadPlan } from './reminderPlan';

export const POLL_MS = 60_000;
const NotificationsContext = createContext(null);

export function NotificationsProvider({ children, openDatabase = getDatabase, clock = () => new Date() }) {
  const { api, user } = useSession();
  const { today, day, items, profile } = useAttendance();
  const userId = user?.id;
  const [unreadCount, setUnreadCount] = useState(0);
  const [preferences, setPreferences] = useState(null);
  const [backgroundGranted, setBackgroundGranted] = useState(false);
  const [pushState, setPushState] = useState(null);
  const pushDone = useRef(false);

  const refreshCount = useCallback(async () => {
    try {
      setUnreadCount(await fetchUnreadCount(api));
    } catch {
      // Offline or the server is busy: keep the last count.
    }
  }, [api]);

  const loadPreferences = useCallback(async () => {
    const db = await openDatabase();
    try {
      const prefs = await fetchPreferences(api);
      setPreferences(prefs);
      await writeValue(db, `preferences:${userId}`, prefs);
      return prefs;
    } catch {
      const saved = await readValue(db, `preferences:${userId}`);
      if (saved) setPreferences((p) => p ?? saved);
      return saved;
    }
  }, [api, openDatabase, userId]);

  const updatePreferences = useCallback(
    async (values) => {
      const prefs = await savePreferences(api, values);
      setPreferences(prefs);
      await writeValue(await openDatabase(), `preferences:${userId}`, prefs);
      return prefs;
    },
    [api, openDatabase, userId],
  );

  const refreshPermissions = useCallback(async () => {
    const status = await backgroundPermission().catch(() => ({ background: 'denied' }));
    setBackgroundGranted(status.background === 'granted');
    return status;
  }, []);

  // Start, every minute, and when the app returns to the foreground.
  useEffect(() => {
    if (!userId) return undefined;
    // State is set only after the server answers (asynchronously).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshCount();
    loadPreferences();
    refreshPermissions();
    const timer = setInterval(() => AppState.currentState === 'active' && refreshCount(), POLL_MS);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        refreshCount();
        refreshPermissions();
      }
    });
    return () => {
      clearInterval(timer);
      sub?.remove?.();
    };
  }, [userId, refreshCount, loadPreferences, refreshPermissions]);

  // Another branch (after a transfer): its reminder settings apply, so load the preferences again.
  const branchCode = profile?.branch?.code;
  const seenBranch = useRef(null);
  useEffect(() => {
    if (!userId || !branchCode) return;
    if (seenBranch.current && seenBranch.current !== branchCode) loadPreferences();
    seenBranch.current = branchCode;
  }, [userId, branchCode, loadPreferences]);

  // Keep the phone's reminders in step with the day, the waiting events and the settings.
  const reminders = preferences?.reminders;
  const branchOperating = preferences?.branchOperating ?? false;
  useEffect(() => {
    if (!userId || !reminders) return;
    const now = clock();
    (async () => {
      await saveReminderContext({ userId, today, reminders, branchOperating }, openDatabase);
      const checkOut = checkOutPlan({ today, day, reminders, now });
      if (checkOut) await scheduleReminder(checkOut.key, checkOut.content, checkOut.at);
      else await cancelReminders('checkout:');
      const upload = uploadPlan({ items, reminders, now });
      if (upload) await scheduleReminder(upload.key, upload.content, upload.at);
      else await cancelReminder('upload');
      const branchLocation = today ? branchLocationAt(today, now) : null;
      await syncBranchGeofence({ watch: shouldWatchBranch({ reminders, branchOperating, branchLocation, backgroundGranted }), branchLocation });
    })().catch(() => {
      // Reminders are a convenience: a device error never affects attendance.
    });
  }, [userId, today, day, items, reminders, branchOperating, backgroundGranted, openDatabase, clock]);

  // Push for this session, while the platform and the staff member allow it.
  const pushWanted = preferences?.push?.enabled;
  useEffect(() => {
    if (!userId || pushWanted === undefined) return;
    if (pushWanted && !pushDone.current) {
      pushDone.current = true;
      enablePush(api).then(setPushState);
    } else if (!pushWanted && pushDone.current) {
      pushDone.current = false;
      disablePush(api).then(() => setPushState('off'));
    }
  }, [api, userId, pushWanted]);

  // Signed out (or another account): nothing keeps reminding on this phone.
  useEffect(
    () => () => {
      cancelReminders().catch(() => {});
      syncBranchGeofence({ watch: false }).catch(() => {});
    },
    [userId],
  );

  const value = useMemo(
    () => ({ unreadCount, setUnreadCount, refreshCount, preferences, loadPreferences, updatePreferences, backgroundGranted, refreshPermissions, pushState, setPushState }),
    [unreadCount, refreshCount, preferences, loadPreferences, updatePreferences, backgroundGranted, refreshPermissions, pushState],
  );
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error('useNotifications must be used inside NotificationsProvider.');
  return value;
}
