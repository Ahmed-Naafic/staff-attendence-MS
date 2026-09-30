import { useId } from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '../../lib/cn.js';

/**
 * Shared label / hint / error wrapper for form controls.
 * `children` is a render function receiving the ids and aria props to spread on the control.
 */
export function FormField({ label, hint, error, required, id: idProp, className, children }) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  const controlProps = {
    id,
    required,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': [errorId, hintId].filter(Boolean).join(' ') || undefined,
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-label text-fg">
          {label}
          {required && (
            <span aria-hidden="true" className="ml-0.5 text-error-fg">
              *
            </span>
          )}
        </label>
      )}
      {children(controlProps)}
      {hint && !error && (
        <p id={hintId} className="text-caption text-fg-muted">
          {hint}
        </p>
      )}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

export function FieldError({ id, children }) {
  return (
    <p id={id} className="flex items-center gap-1 text-caption text-error-fg">
      <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
      {children}
    </p>
  );
}

// Shared visual style for text-like controls (Input, Select, Textarea).
export const controlClass =
  'w-full rounded-md border border-border-input bg-surface text-body text-fg transition-colors ' +
  'placeholder:text-fg-muted hover:border-fg-muted ' +
  'focus:border-interactive focus:outline-none focus:ring-2 focus:ring-interactive/25 ' +
  'aria-invalid:border-error aria-invalid:focus:ring-error/25 ' +
  'disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-fg-disabled ' +
  'read-only:bg-muted read-only:focus:ring-0';
