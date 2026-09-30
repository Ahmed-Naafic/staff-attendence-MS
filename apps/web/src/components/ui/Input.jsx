import { useState } from 'react';
import { Eye, EyeOff, Search } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { FormField, controlClass } from './FormField.jsx';

/**
 * Text-like input: text, email, tel, password, search, number, date, time.
 * Always give it a `label`; for a visually hidden label (e.g. topbar search) pass `hideLabel`.
 */
export function Input({
  label,
  hideLabel = false,
  hint,
  error,
  required,
  id,
  type = 'text',
  size = 'md',
  leftIcon,
  className,
  fieldClassName,
  ...props
}) {
  const [showPassword, setShowPassword] = useState(false);
  const LeftIcon = leftIcon ?? (type === 'search' ? Search : null);
  const isPassword = type === 'password';

  return (
    <FormField
      label={hideLabel ? null : label}
      hint={hint}
      error={error}
      required={required}
      id={id}
      className={fieldClassName}
    >
      {(controlProps) => (
        <div className="relative">
          {LeftIcon && (
            <LeftIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted"
            />
          )}
          <input
            {...controlProps}
            aria-label={hideLabel ? label : undefined}
            type={isPassword && showPassword ? 'text' : type}
            className={cn(
              controlClass,
              size === 'sm' ? 'h-9' : 'h-10',
              LeftIcon ? 'pl-9' : 'pl-3',
              isPassword ? 'pr-10' : 'pr-3',
              // Hide the browser's own clear button; keeps search inputs consistent.
              type === 'search' && '[&::-webkit-search-cancel-button]:hidden',
              className,
            )}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              disabled={props.disabled}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-fg-muted hover:bg-muted hover:text-fg disabled:pointer-events-none"
            >
              {showPassword ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
            </button>
          )}
        </div>
      )}
    </FormField>
  );
}

export function Textarea({ label, hint, error, required, id, rows = 3, className, fieldClassName, ...props }) {
  return (
    <FormField label={label} hint={hint} error={error} required={required} id={id} className={fieldClassName}>
      {(controlProps) => (
        <textarea {...controlProps} rows={rows} className={cn(controlClass, 'px-3 py-2', className)} {...props} />
      )}
    </FormField>
  );
}
