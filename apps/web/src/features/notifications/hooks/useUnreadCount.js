import { useCallback, useEffect, useState } from 'react';
import { loadUnreadCount } from '../data/notificationsApi.js';
import { POLL_MS } from '../utils/notificationRules.js';

const CHANGED = 'edutrack:notifications-changed';

/** Tells every unread counter on the page to refresh (after marking items read). */
export const announceNotificationsChanged = () => window.dispatchEvent(new Event(CHANGED));

/**
 * The signed-in user's unread count: loaded at once, every minute while the tab is visible, when
 * the window regains focus, and after items are marked read anywhere in the app. A failed refresh
 * keeps the last count (the bell never shows an error of its own).
 */
export function useUnreadCount() {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setCount(await loadUnreadCount());
    } catch {
      // Keep the last known count; a 401 returns the app to the sign-in page by itself.
    }
  }, []);

  useEffect(() => {
    // The count is set only when the server answers (asynchronously).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener(CHANGED, onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(CHANGED, onFocus);
    };
  }, [refresh]);

  return { count, refresh, setCount };
}
