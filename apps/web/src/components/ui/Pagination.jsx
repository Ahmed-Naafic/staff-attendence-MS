import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn.js';

// Page list with ellipses: 1 … 4 5 6 … 20
function pageItems(page, pageCount) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const items = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) items.push('start-gap');
  for (let p = start; p <= end; p += 1) items.push(p);
  if (end < pageCount - 1) items.push('end-gap');
  items.push(pageCount);
  return items;
}

const pageButton =
  'grid h-8 min-w-8 place-items-center rounded-md border px-2 text-small font-medium tabular-nums transition-colors disabled:pointer-events-none disabled:text-fg-disabled';

/**
 * Table footer: "Showing 1 to 8 of 28 schools" + page buttons.
 * `itemLabel` is the plural noun for the summary (e.g. "schools").
 */
export function Pagination({ page, pageSize, total, onPageChange, itemLabel = 'results', className }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-between gap-3 border-t border-border-subtle px-4 py-3 sm:flex-row',
        className,
      )}
    >
      <p className="text-small text-fg-muted">
        Showing {from} to {to} of {total} {itemLabel}
      </p>
      <nav aria-label="Pagination">
        <ul className="flex items-center gap-1.5">
          <li>
            <button
              type="button"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              aria-label="Previous page"
              className={cn(pageButton, 'border-border bg-surface text-fg hover:bg-muted')}
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
            </button>
          </li>
          {pageItems(page, pageCount).map((item) =>
            typeof item === 'string' ? (
              <li key={item} aria-hidden="true" className="px-1 text-small text-fg-muted">
                …
              </li>
            ) : (
              <li key={item}>
                <button
                  type="button"
                  onClick={() => onPageChange(item)}
                  aria-current={item === page ? 'page' : undefined}
                  aria-label={`Page ${item}`}
                  className={cn(
                    pageButton,
                    item === page
                      ? 'border-interactive bg-interactive text-on-interactive'
                      : 'border-border bg-surface text-fg hover:bg-muted',
                  )}
                >
                  {item}
                </button>
              </li>
            ),
          )}
          <li>
            <button
              type="button"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= pageCount}
              aria-label="Next page"
              className={cn(pageButton, 'border-border bg-surface text-fg hover:bg-muted')}
            >
              <ChevronRight aria-hidden="true" className="size-4" />
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
