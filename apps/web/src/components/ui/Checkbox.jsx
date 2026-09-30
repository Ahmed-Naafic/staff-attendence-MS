import { useEffect, useId, useRef } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { FieldError } from './FormField.jsx';

const boxClass =
  'peer size-4 shrink-0 cursor-pointer appearance-none rounded-sm border border-border-input bg-surface transition-colors ' +
  'checked:border-interactive checked:bg-interactive indeterminate:border-interactive indeterminate:bg-interactive ' +
  'hover:border-fg-muted aria-invalid:border-error ' +
  'disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:checked:bg-fg-disabled disabled:indeterminate:bg-fg-disabled';

/** Checkbox with label, optional description, indeterminate and error states. */
export function Checkbox({ label, description, error, indeterminate = false, id: idProp, className, ...props }) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const describedBy = [error && `${id}-error`, description && `${id}-desc`].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-start gap-2.5">
        <span className="relative mt-0.5 flex">
          <input
            ref={ref}
            id={id}
            type="checkbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={boxClass}
            {...props}
          />
          <Check
            aria-hidden="true"
            strokeWidth={3}
            className="pointer-events-none absolute inset-0 m-auto hidden size-3 text-on-interactive peer-checked:block peer-indeterminate:hidden"
          />
          <Minus
            aria-hidden="true"
            strokeWidth={3}
            className="pointer-events-none absolute inset-0 m-auto hidden size-3 text-on-interactive peer-indeterminate:block"
          />
        </span>
        {(label || description) && (
          <span className="flex flex-col">
            {label && (
              <label htmlFor={id} className={cn('text-body text-fg', props.disabled ? 'text-fg-disabled' : 'cursor-pointer')}>
                {label}
              </label>
            )}
            {description && (
              <span id={`${id}-desc`} className="text-caption text-fg-muted">
                {description}
              </span>
            )}
          </span>
        )}
      </div>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}
