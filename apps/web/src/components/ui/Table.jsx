import { cn } from '../../lib/cn.js';
import { Skeleton } from './Skeleton.jsx';
import { EmptyState, ErrorState } from './States.jsx';

/*
 * Table primitives. Compose them; features own their columns and data.
 *
 * <TableContainer label="Schools">
 *   <Table>
 *     <TableHead><TableRow><TableHeaderCell>Name</TableHeaderCell>…</TableRow></TableHead>
 *     <TableBody>…rows | <TableLoading/> | <TableEmpty/> | <TableError/></TableBody>
 *   </Table>
 *   <Pagination … />
 * </TableContainer>
 */

/** Bordered, rounded wrapper. Scrolls horizontally on small screens instead of squashing columns. */
export function TableContainer({ label, className, children }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-surface', className)}>
      <div role="region" aria-label={label} tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
        {children}
      </div>
    </div>
  );
}

export function Table({ caption, className, children }) {
  return (
    <table className={cn('w-full min-w-[40rem] border-collapse text-left text-table text-fg', className)}>
      {caption && <caption className="sr-only">{caption}</caption>}
      {children}
    </table>
  );
}

export function TableHead({ children }) {
  return <thead className="bg-muted">{children}</thead>;
}

export function TableBody({ children }) {
  return <tbody className="divide-y divide-border-subtle">{children}</tbody>;
}

/** Row. `selected` highlights it (e.g. the row open in a drawer); `interactive` adds hover. */
export function TableRow({ selected = false, interactive = true, className, children, ...props }) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        'transition-colors',
        interactive && 'hover:bg-muted/60',
        selected && 'bg-interactive-soft hover:bg-interactive-soft',
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

export function TableHeaderCell({ align = 'left', className, children, ...props }) {
  return (
    <th
      scope="col"
      className={cn(
        'h-10 px-4 text-caption font-semibold whitespace-nowrap text-fg-secondary',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function TableCell({ align = 'left', className, children, ...props }) {
  return (
    <td
      className={cn(
        'h-12 px-4 py-2 align-middle',
        align === 'right' && 'text-right tabular-nums',
        align === 'center' && 'text-center',
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}

/** Actions cell: keeps row buttons aligned right and together. */
export function TableActions({ children }) {
  return <div className="flex items-center justify-end gap-1.5">{children}</div>;
}

/** Skeleton rows shown while data loads. */
export function TableLoading({ columns, rows = 5, label = 'Loading rows' }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} aria-hidden={row > 0 || undefined}>
          {Array.from({ length: columns }, (_, col) => (
            <td key={col} className="h-12 px-4">
              {row === 0 && col === 0 && <span className="sr-only">{label}</span>}
              <Skeleton className={cn('h-3.5', col === 0 ? 'w-8' : col % 3 === 1 ? 'w-36' : 'w-20')} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Full-width empty row. */
export function TableEmpty({ columns, ...emptyProps }) {
  return (
    <tr>
      <td colSpan={columns}>
        <EmptyState compact {...emptyProps} />
      </td>
    </tr>
  );
}

/** Full-width error row with optional retry. */
export function TableError({ columns, ...errorProps }) {
  return (
    <tr>
      <td colSpan={columns}>
        <ErrorState compact {...errorProps} />
      </td>
    </tr>
  );
}
