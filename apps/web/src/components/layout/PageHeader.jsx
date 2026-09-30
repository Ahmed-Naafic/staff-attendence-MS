import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn.js';

/**
 * Page title block.
 * breadcrumbs:     [{ label, to? }]  — last item is the current page
 * primaryAction:   usually one <Button variant="primary">
 * secondaryActions: other buttons/filters shown before the primary action
 */
export function PageHeader({ title, description, breadcrumbs, primaryAction, secondaryActions, className }) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {breadcrumbs?.length > 0 && <Breadcrumbs items={breadcrumbs} />}
        <h1 className="text-page-title text-fg">{title}</h1>
        {description && <p className="text-body text-fg-secondary">{description}</p>}
      </div>
      {(primaryAction || secondaryActions) && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
          {secondaryActions}
          {primaryAction}
        </div>
      )}
    </div>
  );
}

function Breadcrumbs({ items }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-1">
      <ol className="flex flex-wrap items-center gap-1 text-small text-fg-muted">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {item.to && !current ? (
                <Link to={item.to} className="rounded-sm hover:text-fg hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={current ? 'page' : undefined} className={current ? 'text-fg-secondary' : undefined}>
                  {item.label}
                </span>
              )}
              {!current && <ChevronRight aria-hidden="true" className="size-3.5" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
