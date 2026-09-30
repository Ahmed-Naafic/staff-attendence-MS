import { useId } from 'react';
import { cn } from '../../lib/cn.js';
import { FieldError } from './FormField.jsx';

const radioClass =
  'size-4 shrink-0 cursor-pointer appearance-none rounded-pill border border-border-input bg-surface transition-colors ' +
  'checked:border-[5px] checked:border-interactive hover:border-fg-muted checked:hover:border-interactive ' +
  'aria-invalid:border-error ' +
  'disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:checked:border-fg-disabled';

/**
 * A group of radio buttons in a fieldset. Arrow keys move between options (native).
 * options: [{ value, label, description?, disabled? }]
 */
export function RadioGroup({
  name,
  legend,
  options = [],
  value,
  defaultValue,
  onChange,
  error,
  disabled,
  orientation = 'vertical',
  className,
}) {
  const autoId = useId();
  const groupName = name ?? autoId;
  const errorId = error ? `${autoId}-error` : undefined;

  return (
    <fieldset
      disabled={disabled}
      aria-describedby={errorId}
      aria-invalid={error ? true : undefined}
      className={cn('flex flex-col gap-2', className)}
    >
      {legend && <legend className="mb-1 text-label text-fg">{legend}</legend>}
      <div className={cn('flex gap-x-6 gap-y-2.5', orientation === 'vertical' ? 'flex-col' : 'flex-wrap')}>
        {options.map((option) => {
          const optionId = `${autoId}-${option.value}`;
          const isDisabled = disabled || option.disabled;
          return (
            <div key={option.value} className="flex items-start gap-2.5">
              <input
                id={optionId}
                type="radio"
                name={groupName}
                value={option.value}
                checked={value === undefined ? undefined : value === option.value}
                defaultChecked={defaultValue === undefined ? undefined : defaultValue === option.value}
                onChange={onChange ? () => onChange(option.value) : undefined}
                disabled={option.disabled}
                aria-invalid={error ? true : undefined}
                aria-describedby={option.description ? `${optionId}-desc` : undefined}
                className={cn(radioClass, 'mt-0.5')}
              />
              <span className="flex flex-col">
                <label
                  htmlFor={optionId}
                  className={cn('text-body', isDisabled ? 'text-fg-disabled' : 'cursor-pointer text-fg')}
                >
                  {option.label}
                </label>
                {option.description && (
                  <span id={`${optionId}-desc`} className="text-caption text-fg-muted">
                    {option.description}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </fieldset>
  );
}
