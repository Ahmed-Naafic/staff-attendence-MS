import { cn } from '../../lib/cn.js';

const variants = {
  success: { badge: 'bg-success-soft text-success-fg', dot: 'bg-success' },
  warning: { badge: 'bg-warning-soft text-warning-fg', dot: 'bg-warning' },
  error: { badge: 'bg-error-soft text-error-fg', dot: 'bg-error' },
  info: { badge: 'bg-info-soft text-info-fg', dot: 'bg-info' },
  neutral: { badge: 'bg-muted text-fg-secondary', dot: 'bg-secondary' },
  accent: { badge: 'bg-accent-soft text-accent-fg', dot: 'bg-accent' },
};

/**
 * Status label. The text always carries the meaning; color only reinforces it.
 * Business statuses (Active, Pending, PRESENT, LATE…) are mapped to a variant by the feature that owns them.
 */
export function Badge({ variant = 'neutral', dot = false, className, children }) {
  const style = variants[variant] ?? variants.neutral;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-caption font-medium whitespace-nowrap',
        style.badge,
        className,
      )}
    >
      {dot && <span aria-hidden="true" className={cn('size-1.5 rounded-pill', style.dot)} />}
      {children}
    </span>
  );
}
