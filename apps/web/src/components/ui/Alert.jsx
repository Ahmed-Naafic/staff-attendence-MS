import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '../../lib/cn.js';

const variants = {
  success: { icon: CircleCheck, className: 'border-success/30 bg-success-soft text-success-fg' },
  warning: { icon: TriangleAlert, className: 'border-warning/40 bg-warning-soft text-warning-fg' },
  error: { icon: CircleAlert, className: 'border-error/30 bg-error-soft text-error-fg' },
  info: { icon: Info, className: 'border-info/30 bg-info-soft text-info-fg' },
};

/**
 * Inline feedback message (success, warning, error, info).
 * Errors and warnings are announced immediately (role="alert"); others politely (role="status").
 */
export function Alert({ variant = 'info', title, action, onDismiss, className, children }) {
  const { icon: Icon, className: variantClass } = variants[variant] ?? variants.info;
  const assertive = variant === 'error' || variant === 'warning';

  return (
    <div
      role={assertive ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-md border px-4 py-3', variantClass, className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-[1.125rem] shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title && <p className="text-body font-semibold">{title}</p>}
        {children && <div className="text-small">{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-m-1 grid size-7 shrink-0 place-items-center rounded-md hover:bg-surface/50"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}
