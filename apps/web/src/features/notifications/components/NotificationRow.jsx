import { AlertTriangle, ArrowLeftRight, BarChart3, Bell, CalendarClock, ClipboardCheck, Clock, Megaphone, ShieldAlert } from 'lucide-react';
import { formatDateTime, formatRelative } from '../../../lib/format.js';
import { cn } from '../../../lib/cn.js';
import { CATEGORY_LABELS, utcLabel } from '../utils/notificationRules.js';

const ICONS = {
  ATTENDANCE: Clock,
  MISSING_CHECK_OUT: ClipboardCheck,
  DIGEST: BarChart3,
  ASSIGNMENT: CalendarClock,
  SCHEDULE: CalendarClock,
  BRANCH_SETUP: AlertTriangle,
  MANAGER_ASSIGNMENT: ArrowLeftRight,
  STATUS: ShieldAlert,
  ANNOUNCEMENT: Megaphone,
};

/** One notification in a list: icon, Somali title and first line, category and time; unread ones are marked. */
export function NotificationRow({ item, onOpen, compact = false }) {
  const Icon = ICONS[item.category] ?? Bell;
  const unread = !item.readAt;
  const firstLine = item.body.split('\n')[0];
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted focus-visible:bg-muted', unread && 'bg-info-soft/40')}
    >
      <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-md', unread ? 'bg-accent-soft text-accent-fg' : 'bg-muted text-fg-muted')}>
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-start justify-between gap-2">
          <span lang={item.language} className={cn('min-w-0 text-small text-fg', unread ? 'font-semibold' : 'font-medium')}>
            {item.title}
          </span>
          {unread && (
            <span className="mt-1.5 size-2 shrink-0 rounded-pill bg-accent">
              <span className="sr-only">Unread</span>
            </span>
          )}
        </span>
        <span lang={item.language} className={cn('text-small text-fg-secondary', compact ? 'line-clamp-1' : 'line-clamp-2')}>
          {firstLine}
        </span>
        <span className="text-caption text-fg-muted">
          {CATEGORY_LABELS[item.category] ?? item.category} · <time dateTime={item.createdAt} title={utcLabel(formatDateTime(item.createdAt))}>{formatRelative(item.createdAt)}</time>
        </span>
      </span>
    </button>
  );
}
