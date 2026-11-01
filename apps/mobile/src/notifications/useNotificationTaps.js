/*
 * Tapping a notification on the phone (app in the background, or closed and started by the tap).
 * A push carries only an opaque reference ({ kind: 'notification', source, id }); the app asks the
 * server for that notification as the signed-in account and opens its details (marking it read).
 * If it is not this account's — e.g. another account signed in since — the server answers 404 and
 * the app opens the notification centre instead, so nothing leaks between accounts. A reminder
 * opens Home, where the staff member checks in or out themselves.
 */
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { useSession } from '../auth/SessionProvider';
import { fetchNotification, markRead } from './api';
import { useNotifications } from './NotificationsProvider';

// Each tap is handled once, also when Home is shown again (the last response stays available).
const handled = new Set();

export function useNotificationTaps(navigation) {
  const { api } = useSession();
  const { refreshCount } = useNotifications();
  useEffect(() => {
    let active = true;
    const route = async (response) => {
      const key = response?.notification?.request?.identifier ?? null;
      const data = response?.notification?.request?.content?.data;
      if (!response || !data || (key && handled.has(key))) return;
      if (key) handled.add(key);
      Notifications.clearLastNotificationResponseAsync?.().catch(() => {});
      if (data.kind !== 'notification') return;
      if (!data.source || !data.id) return navigation.navigate('Notifications');
      try {
        const item = await fetchNotification(api, data.source, data.id);
        if (!active) return;
        navigation.navigate('NotificationDetail', { item });
        if (!item.readAt) {
          await markRead(api, item).catch(() => {});
          refreshCount();
        }
      } catch {
        if (active) navigation.navigate('Notifications');
      }
    };
    Notifications.getLastNotificationResponseAsync?.()
      .then(route)
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener?.(route);
    return () => {
      active = false;
      sub?.remove?.();
    };
  }, [navigation, api, refreshCount]);
}
