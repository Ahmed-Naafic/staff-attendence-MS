import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Bell, CheckCheck } from 'lucide-react';
import { Button, Spinner } from '../../../components/ui';
import { cn } from '../../../lib/cn.js';
import { loadNotifications, markAllNotificationsRead, markNotificationRead } from '../data/notificationsApi.js';
import { announceNotificationsChanged, useUnreadCount } from '../hooks/useUnreadCount.js';
import { allRead, badgeText, bellLabel, linkTarget, withRead } from '../utils/notificationRules.js';
import { NotificationRow } from './NotificationRow.jsx';

const LATEST = 6;

/**
 * Topbar bell for School Owners and Managers: the unread count, and a panel with the latest
 * notifications, "Mark all as read" and a link to the full history. Opening an item marks it read
 * and goes to its page (or its details in the notification centre).
 */
export function NotificationBell({ role }) {
  const { count, setCount } = useUnreadCount();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ status: 'idle', items: [] });
  const panelId = useId();
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    setState((s) => ({ ...s, status: 'loading' }));
    loadNotifications({ pageSize: LATEST }, controller.signal)
      .then((data) => {
        setState({ status: 'ready', items: data.items });
        setCount(data.unreadCount);
      })
      .catch((error) => error.name !== 'AbortError' && setState({ status: 'error', items: [] }));
    const onPointer = (event) => !rootRef.current?.contains(event.target) && setOpen(false);
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      controller.abort();
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setCount]);

  async function openItem(item) {
    setOpen(false);
    if (!item.readAt) {
      try {
        const read = await markNotificationRead(item);
        setState((s) => ({ ...s, items: withRead(s.items, read) }));
        announceNotificationsChanged();
      } catch {
        // Opening still works; the item stays unread.
      }
    }
    navigate(linkTarget(item, role) ?? `/notifications?item=${item.source}:${item.id}`);
  }

  async function readAll() {
    try {
      const { unreadCount } = await markAllNotificationsRead();
      setCount(unreadCount);
      setState((s) => ({ ...s, items: allRead(s.items) }));
      announceNotificationsChanged();
    } catch {
      setState((s) => ({ ...s, status: 'error' }));
    }
  }

  const badge = badgeText(count);
  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={bellLabel(count)}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-10 place-items-center rounded-md text-fg-secondary hover:bg-muted hover:text-fg"
      >
        <Bell aria-hidden="true" className="size-5" />
        {badge && (
          <span aria-hidden="true" className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-pill bg-error px-1 text-[10px] leading-none font-semibold text-fg-inverse">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Latest notifications"
          className={cn('absolute right-0 z-30 mt-2 flex w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-elevated shadow-large')}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
            <h2 className="text-card-title text-fg">Notifications</h2>
            <Button variant="ghost" size="sm" leftIcon={CheckCheck} onClick={readAll} disabled={count === 0}>
              Mark all as read
            </Button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {state.status === 'loading' && (
              <div className="grid place-items-center py-8">
                <Spinner label="Loading notifications" />
              </div>
            )}
            {state.status === 'error' && <p className="px-4 py-6 text-small text-fg-muted">Notifications could not be loaded. Try again.</p>}
            {state.status === 'ready' && state.items.length === 0 && <p className="px-4 py-6 text-small text-fg-muted">You have no notifications.</p>}
            {state.status === 'ready' && state.items.length > 0 && (
              <ul className="divide-y divide-border-subtle">
                {state.items.map((item) => (
                  <li key={`${item.source}:${item.id}`}>
                    <NotificationRow item={item} compact onOpen={() => openItem(item)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="border-t border-border-subtle px-4 py-3 text-center text-small font-medium text-info-fg hover:bg-muted">
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
