import { CircleAlert, Inbox, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { Button } from './Button.jsx';
import { Spinner } from './Spinner.jsx';

/** Nothing to show yet: icon, title, description and an optional action. */
export function EmptyState({ icon: Icon = Inbox, title, description, action, compact = false, className }) {
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'gap-2 py-8' : 'gap-3 py-14', className)}>
      <span className="grid size-12 place-items-center rounded-pill bg-muted text-fg-muted">
        <Icon aria-hidden="true" className="size-6" />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-card-title text-fg">{title}</p>
        {description && <p className="text-small text-fg-muted">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** Something failed: message, helpful description and an optional retry. */
export function ErrorState({
  title = 'Something went wrong',
  description = 'The information could not be loaded. Check your connection and try again.',
  onRetry,
  retryLabel = 'Try again',
  compact = false,
  className,
}) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center text-center', compact ? 'gap-2 py-8' : 'gap-3 py-14', className)}
    >
      <span className="grid size-12 place-items-center rounded-pill bg-error-soft text-error-fg">
        <CircleAlert aria-hidden="true" className="size-6" />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-card-title text-fg">{title}</p>
        {description && <p className="text-small text-fg-muted">{description}</p>}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" leftIcon={RefreshCw} onClick={onRetry} className="mt-1">
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

/** Centered spinner with a visible label for whole-section loading. */
export function LoadingState({ label = 'Loading…', className }) {
  return (
    <div role="status" className={cn('flex flex-col items-center gap-3 py-14 text-fg-muted', className)}>
      <Spinner size="lg" />
      <p className="text-small">{label}</p>
    </div>
  );
}
