import { cn } from '../../lib/cn.js';
import { Spinner } from './Spinner.jsx';

const base =
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border text-button transition-colors ' +
  'disabled:pointer-events-none disabled:border-border disabled:bg-muted disabled:text-fg-disabled disabled:shadow-none ' +
  'aria-disabled:pointer-events-none';

const variants = {
  // Gold: the main action on a page or dialog. Use once per view.
  primary: 'border-transparent bg-accent text-on-accent shadow-subtle hover:bg-accent-hover active:bg-accent-hover',
  // Navy: strong supporting action.
  secondary: 'border-transparent bg-interactive text-on-interactive hover:bg-interactive-hover active:bg-interactive-hover',
  outline: 'border-border-strong bg-surface text-fg hover:bg-muted active:bg-border-subtle',
  ghost: 'border-transparent bg-transparent text-fg-secondary hover:bg-muted hover:text-fg active:bg-border-subtle',
  // Destructive actions (suspend, remove).
  danger: 'border-error/40 bg-error-soft text-error-fg hover:border-error hover:bg-error-soft active:bg-error-soft',
};

const sizes = {
  sm: 'h-8 px-3 text-small',
  md: 'h-10 px-4',
  lg: 'h-11 px-5',
};

const iconSizes = { sm: 'size-8', md: 'size-10', lg: 'size-11' };

/**
 * Button. Icon-only buttons must pass `aria-label`.
 * `loading` keeps the button's width, shows a spinner and blocks clicks.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  iconOnly = false,
  loading = false,
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  type = 'button',
  disabled,
  onClick,
  className,
  children,
  ...props
}) {
  const iconClass = size === 'sm' ? 'size-4' : 'size-[1.125rem]';

  return (
    <button
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={loading ? undefined : onClick}
      className={cn(base, variants[variant], iconOnly ? cn(iconSizes[size], 'px-0') : sizes[size], className)}
      {...props}
    >
      {loading ? (
        <Spinner size="sm" />
      ) : (
        LeftIcon && <LeftIcon aria-hidden="true" className={iconClass} />
      )}
      {children}
      {!loading && RightIcon && <RightIcon aria-hidden="true" className={iconClass} />}
    </button>
  );
}
