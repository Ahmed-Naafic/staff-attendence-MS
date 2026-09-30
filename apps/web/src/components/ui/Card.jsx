import { cn } from '../../lib/cn.js';

const variants = {
  default: 'border border-border bg-surface',
  elevated: 'border border-border-subtle bg-elevated shadow-medium',
  // Whole card is clickable: render as a <button> or <a> via `as`.
  interactive:
    'border border-border bg-surface text-left transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-medium cursor-pointer',
};

/** Card container. Use `as="button"`/`as="a"` with variant="interactive" for clickable cards. */
export function Card({ variant = 'default', as: Tag = 'div', className, children, ...props }) {
  return (
    <Tag className={cn('flex flex-col rounded-lg', variants[variant], className)} {...props}>
      {children}
    </Tag>
  );
}

/** Title row with optional description and an action on the right (e.g. "View all"). */
export function CardHeader({ title, description, action, titleAs: Title = 'h3', className, children }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        {title && <Title className="text-card-title text-fg">{title}</Title>}
        {description && <p className="text-small text-fg-muted">{description}</p>}
        {children}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardContent({ className, children }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>;
}

export function CardFooter({ className, children }) {
  return (
    <div className={cn('flex items-center justify-end gap-3 border-t border-border-subtle px-5 py-3', className)}>
      {children}
    </div>
  );
}
