import { useId } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { useDialog } from './useDialog.js';

const sizes = { md: 'sm:max-w-md', lg: 'sm:max-w-xl' };

/**
 * Side panel from the right for record details (as in the reference designs).
 * Full screen width on phones; fixed width from `sm` up. Overlay, Escape and the
 * close button all call onClose.
 * - `header`: optional custom content under the title row (e.g. avatar + status badge).
 * - `footer`: sticky actions at the bottom.
 */
export function Drawer({ open, onClose, title, description, header, size = 'md', footer, className, children }) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogProps = useDialog({ open, onClose });

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        'my-0 mr-0 ml-auto h-dvh max-h-none w-full flex-col border-0 border-l border-border bg-elevated p-0 text-fg shadow-large open:flex',
        'transition-transform duration-200 starting:open:translate-x-full',
        sizes[size],
        className,
      )}
    >
      <header className="flex flex-col gap-4 border-b border-border-subtle px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id={titleId} className="text-section-title text-fg">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="text-small text-fg-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="-mr-2 grid size-8 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-muted hover:text-fg"
          >
            <X aria-hidden="true" className="size-[1.125rem]" />
          </button>
        </div>
        {header && <div className="flex flex-wrap items-center gap-2">{header}</div>}
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>

      {footer && (
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle px-5 py-4">
          {footer}
        </footer>
      )}
    </dialog>
  );
}
