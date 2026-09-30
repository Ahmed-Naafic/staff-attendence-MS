import { LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/cn.js';

const sizes = { sm: 'size-4', md: 'size-5', lg: 'size-8' };

// Decorative by default (inside a button that already says "Loading").
// Pass a label when the spinner is the only loading indicator.
export function Spinner({ size = 'md', label, className }) {
  return (
    <span role={label ? 'status' : undefined} className={cn('inline-flex', className)}>
      <LoaderCircle aria-hidden="true" className={cn('animate-spin', sizes[size])} />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
