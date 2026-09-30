import { useId, useState } from 'react';
import { cn } from '../../lib/cn.js';

/**
 * On/off toggle (role="switch"). Controlled with `checked` + `onChange(next)`,
 * or uncontrolled with `defaultChecked`.
 */
export function Switch({ label, description, checked, defaultChecked = false, onChange, disabled, id: idProp, className }) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const [internal, setInternal] = useState(defaultChecked);
  const isOn = checked ?? internal;

  function toggle() {
    const next = !isOn;
    if (checked === undefined) setInternal(next);
    onChange?.(next);
  }

  return (
    <div className={cn('flex items-start gap-3', className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-labelledby={label ? `${id}-label` : undefined}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={toggle}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-pill border-2 border-transparent transition-colors',
          isOn ? 'bg-interactive' : 'bg-border-input',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-5 rounded-pill bg-surface shadow-subtle transition-transform',
            isOn ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
      {(label || description) && (
        <span className="flex flex-col">
          {label && (
            <span
              id={`${id}-label`}
              onClick={disabled ? undefined : toggle}
              className={cn('text-body', disabled ? 'text-fg-disabled' : 'cursor-pointer text-fg')}
            >
              {label}
            </span>
          )}
          {description && (
            <span id={`${id}-desc`} className="text-caption text-fg-muted">
              {description}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
