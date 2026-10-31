/*
 * Tapping a notification on the phone: a push opens the notification centre (where the details are
 * read after signing in); a reminder opens Home, where the staff member checks in or out themselves.
 */
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';

export function useNotificationTaps(navigation) {
  useEffect(() => {
    const route = (response) => {
      const kind = response?.notification?.request?.content?.data?.kind;
      if (kind === 'notification') navigation.navigate('Notifications');
    };
    Notifications.getLastNotificationResponseAsync?.()
      .then(route)
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener?.(route);
    return () => sub?.remove?.();
  }, [navigation]);
}
