import { useId } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { Alert } from './Alert.jsx';
import { Spinner } from './Spinner.jsx';
import { useDialog } from './useDialog.js';

const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-5xl' };

/**
 * Centered modal dialog.
 * - `loading`: shows a spinner over the content and blocks closing (e.g. while saving).
 * - `error`: message shown at the top of the content (e.g. save failed).
 * - `footer`: action buttons, primary action last.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  loading = false,
  loadingLabel = 'Saving…',
  error,
  footer,
  className,
  children,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogProps = useDialog({ open, onClose, dismissible: !loading });

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={loading || undefined}
      className={cn(
        'm-auto w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-lg border border-border bg-elevated p-0 text-fg shadow-large open:flex',
        'transition-[opacity,transform] duration-150 starting:open:scale-[0.98] starting:open:opacity-0',
        sizes[size],
        className,
      )}
    >
      <header className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-1">
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
          disabled={loading}
          aria-label="Close"
          className="-mr-2 grid size-8 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-muted hover:text-fg disabled:opacity-50"
        >
          <X aria-hidden="true" className="size-[1.125rem]" />
        </button>
      </header>

      <div className="relative flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        {error && (
          <Alert variant="error" className="mb-4">
            {error}
          </Alert>
        )}
        {children}
        {loading && (
          <div className="absolute inset-0 grid place-items-center bg-elevated/70">
            <Spinner size="lg" label={loadingLabel} className="text-interactive" />
          </div>
        )}
      </div>

      {footer && (
        <footer className="flex flex-col-reverse gap-2 border-t border-border-subtle px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          {footer}
        </footer>
      )}
    </dialog>
  );
}
