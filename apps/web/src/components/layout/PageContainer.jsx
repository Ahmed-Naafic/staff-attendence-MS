import { useId } from 'react';
import { cn } from '../../lib/cn.js';

/** Standard page padding, max width and vertical rhythm between sections. */
export function PageContainer({ className, children }) {
  return (
    <div className={cn('mx-auto flex w-full max-w-page flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8', className)}>
      {children}
    </div>
  );
}

/** A titled region of a page. Title, description and actions are optional. */
export function ContentSection({ title, description, actions, className, children }) {
  const titleId = useId();
  return (
    <section aria-labelledby={title ? titleId : undefined} className={cn('flex flex-col gap-4', className)}>
      {(title || actions) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-0.5">
            {title && (
              <h2 id={titleId} className="text-section-title text-fg">
                {title}
              </h2>
            )}
            {description && <p className="text-small text-fg-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
