import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';

/** Small text link in a card header ("View all"). `context` completes the accessible name. */
export function ViewAllLink({ to, context, children = 'View all', withArrow = false }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 rounded-sm text-small font-medium whitespace-nowrap text-interactive hover:text-interactive-hover hover:underline"
    >
      {children}
      {context && <span className="sr-only"> {context}</span>}
      {withArrow && <ArrowRight aria-hidden="true" className="size-3.5" />}
    </Link>
  );
}
