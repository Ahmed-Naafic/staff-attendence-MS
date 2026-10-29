/*
 * Today's attendance for the signed-in staff member: the server's day and profile (kept on the
 * device for offline use), the offline queue, connectivity, and recording an event. An event is
 * written to the queue before it is sent; its outcome is what the server answers
 * (src/attendance/sync.js). Uploads run on start, when the connection returns, when the app comes
 * to the foreground and on "Sync now".
 */
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { fetchProfile, fetchToday } from '../api/endpoints';
import { userMessage } from '../api/errors';
import { useSession } from '../auth/SessionProvider';
import { getDatabase, readValue, writeValue } from '../db/database';
import { addDays, localDate } from '../lib/format';
import { deriveDay } from './dayState';
import { branchLocationAt, checkPosition, POSITION_MESSAGES } from './geo';
import { countPending, dismissRejected, enqueue, getItem, itemsSince, outstandingFor } from './queue';
import { syncPending } from './sync';

const AttendanceContext = createContext(null);

const isOnline = (state) => state?.isConnected !== false && state?.isInternetReachable !== false;

const systemClock = () => new Date();

export function AttendanceProvider({ children, openDatabase = getDatabase, clock = systemClock, newId = Crypto.randomUUID }) {
  const { api, user } = useSession();
  const userId = user?.id;
  const [today, setToday] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [online, setOnline] = useState(true);
  const [items, setItems] = useState([]);
  const [outstanding, setOutstanding] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const todayRef = useRef(null);
  const recording = useRef(false);
  useEffect(() => {
    todayRef.current = today;
  }, [today]);

  const reloadQueue = useCallback(async () => {
    if (!userId) return;
    const db = await openDatabase();
    const since = new Date(clock().getTime() - 48 * 60 * 60 * 1000).toISOString();
    const [recent, open, count] = await Promise.all([itemsSince(db, userId, since), outstandingFor(db, userId), countPending(db, userId)]);
    setItems(recent);
    setOutstanding(open);
    setPendingCount(count);
  }, [openDatabase, userId, clock]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const db = await openDatabase();
    setLoading(true);
    try {
      const [day, me] = await Promise.all([fetchToday(api), fetchProfile(api)]);
      setToday(day);
      setProfile(me);
      setLoadError(null);
      await writeValue(db, `today:${userId}`, day);
      await writeValue(db, `profile:${userId}`, me);
    } catch (error) {
      setLoadError(error);
      // Offline: the last loaded day and profile from this phone.
      if (!todayRef.current) {
        const [day, me] = await Promise.all([readValue(db, `today:${userId}`), readValue(db, `profile:${userId}`)]);
        if (day) setToday(day);
        if (me) setProfile(me);
      }
    } finally {
      setLoading(false);
    }
  }, [api, openDatabase, userId]);

  const syncNow = useCallback(async () => {
    if (!userId) return null;
    const db = await openDatabase();
    setSyncing(true);
    try {
      const result = await syncPending({ db, api, userId, clock });
      setLastSync({ at: clock().toISOString(), ...summary(result) });
      if (result.recorded.length) refresh().catch(() => {});
      return result;
    } finally {
      setSyncing(false);
      await reloadQueue();
    }
  }, [api, clock, openDatabase, refresh, reloadQueue, userId]);

  // Start: load the queue, the day and upload what is waiting.
  useEffect(() => {
    if (!userId) return;
    // State is set only after the database and server answer (asynchronously).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reloadQueue()
      .then(() => refresh())
      .then(() => syncNow())
      .catch(() => {});
    // Once per account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Connection returns or the app comes back: upload and refresh.
  useEffect(() => {
    if (!userId) return undefined;
    let wasOnline = true;
    const unsubscribe = NetInfo.addEventListener((state) => {
      const now = isOnline(state);
      setOnline(now);
      if (now && !wasOnline) syncNow().catch(() => {});
      wasOnline = now;
    });
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        syncNow().catch(() => {});
        refresh().catch(() => {});
      }
    });
    return () => {
      unsubscribe?.();
      appState?.remove?.();
    };
  }, [userId, syncNow, refresh]);

  /**
   * Records a check-in or check-out at `position` ({ latitude, longitude, accuracy }).
   * → { outcome: 'recorded', item, event } | { outcome: 'rejected', item, code, message }
   *   | { outcome: 'pending', item, message } | { outcome: 'blocked', reason, message } (not saved).
   */
  const record = useCallback(
    async (type, position) => {
      // One event at a time: a second tap while one is being recorded does nothing.
      if (recording.current) return { outcome: 'busy' };
      recording.current = true;
      try {
        return await recordOnce(type, position);
      } finally {
        recording.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clock, newId, openDatabase, reloadQueue, syncNow, userId],
  );

  async function recordOnce(type, position) {
    const occurred = clock();
    // The on-device check (the offline rule: an event that fails it is not saved).
    const check = checkPosition(position, branchLocationAt(todayRef.current, occurred));
    if (!check.ok) return { outcome: 'blocked', reason: check.reason, message: POSITION_MESSAGES[check.reason] };
    const db = await openDatabase();
    const item = await enqueue(
      db,
      userId,
      { clientEventId: newId(), type, occurredAt: occurred.toISOString(), position: { latitude: position.latitude, longitude: position.longitude, accuracy: position.accuracy }, distanceEstimate: check.distanceMeters },
      occurred,
    );
    await reloadQueue();
    let result = await syncNow();
    // An upload that was already running did not include this event: send again.
    let stored = await getItem(db, item.clientEventId);
    if (stored.state === 'pending' && !result?.stoppedBy) {
      result = await syncNow();
      stored = await getItem(db, item.clientEventId);
    }
    if (stored.state === 'recorded') return { outcome: 'recorded', item: stored, event: stored.serverEvent };
    if (stored.state === 'rejected') return { outcome: 'rejected', item: stored, code: stored.errorCode, message: stored.errorMessage };
    return { outcome: 'pending', item: stored, message: stored.errorMessage ?? userMessage(result?.stoppedBy) };
  }

  const dismiss = useCallback(
    async (clientEventId) => {
      await dismissRejected(await openDatabase(), clientEventId, clock());
      await reloadQueue();
    },
    [clock, openDatabase, reloadQueue],
  );

  const day = useMemo(() => deriveDay(today, items, clock()), [today, items, clock]);

  const value = useMemo(
    () => ({ today, profile, loading, loadError, online, day, items, outstanding, pendingCount, syncing, lastSync, refresh, syncNow, record, dismiss, reloadQueue }),
    [today, profile, loading, loadError, online, day, items, outstanding, pendingCount, syncing, lastSync, refresh, syncNow, record, dismiss, reloadQueue],
  );
  return <AttendanceContext.Provider value={value}>{children}</AttendanceContext.Provider>;
}

function summary(result) {
  return { recorded: result.recorded.length, rejected: result.rejected.length, stopped: result.stoppedBy ? userMessage(result.stoppedBy) : null };
}

export function useAttendance() {
  const value = useContext(AttendanceContext);
  if (!value) throw new Error('useAttendance must be used inside AttendanceProvider.');
  return value;
}

/** The date range of a history tab in branch time: this week (from Monday) or this month. */
export function historyRange(tab, now, timeZone) {
  const day = localDate(now, timeZone);
  if (tab === 'month') return { from: `${day.slice(0, 8)}01`, to: day };
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return { from: addDays(day, -weekday), to: day };
}
