import { Link } from 'react-router';
import { buttonClassName } from './Button.jsx';

/**
 * A navigation link styled as a Button (same variants and sizes).
 * Use it when the action goes to another page; use Button when it acts on this page.
 */
export function LinkButton({ to, variant = 'outline', size = 'md', leftIcon: LeftIcon, className, children, ...props }) {
  const iconClass = size === 'sm' ? 'size-4' : 'size-[1.125rem]';
  return (
    <Link to={to} className={buttonClassName({ variant, size, className })} {...props}>
      {LeftIcon && <LeftIcon aria-hidden="true" className={iconClass} />}
      {children}
    </Link>
  );
}
