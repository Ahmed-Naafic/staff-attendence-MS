import { cn } from '../../lib/cn.js';

// Placeholder shape while content loads. Size it with className (h-4 w-32…).
// Wrap a group of skeletons in an element with aria-busy="true" and a text label.
export function Skeleton({ className }) {
  return <span aria-hidden="true" className={cn('block animate-pulse rounded-md bg-border', className)} />;
}
