import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { FormField, controlClass } from './FormField.jsx';

/**
 * Native <select> styled to match the inputs. Native keeps keyboard, screen reader
 * and mobile behaviour correct; the open list is drawn by the browser.
 * options: [{ value, label, disabled? }]
 */
export function Select({
  label,
  hideLabel = false,
  hint,
  error,
  required,
  id,
  options = [],
  placeholder,
  size = 'md',
  className,
  fieldClassName,
  ...props
}) {
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
          <select
            {...controlProps}
            aria-label={hideLabel ? label : undefined}
            className={cn(controlClass, 'appearance-none pr-9 pl-3', size === 'sm' ? 'h-9' : 'h-10', className)}
            {...props}
          >
            {placeholder && (
              <option value="" disabled={required}>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-muted"
          />
        </div>
      )}
    </FormField>
  );
}
