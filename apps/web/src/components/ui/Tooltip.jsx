import { cloneElement, useId, useState } from 'react';
import { cn } from '../../lib/cn.js';

const placements = {
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-2 -translate-x-1/2',
  right: 'left-full top-1/2 ml-2 -translate-y-1/2',
  left: 'right-full top-1/2 mr-2 -translate-y-1/2',
};

/**
 * Short hint on hover and keyboard focus. The child must be focusable (usually a button).
 * Tooltips supplement a label; they never replace it for icon-only buttons (use aria-label too).
 */
export function Tooltip({ content, placement = 'top', children }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const show = () => setVisible(true);
  const hide = () => setVisible(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(event) => event.key === 'Escape' && hide()}
    >
      {cloneElement(children, { 'aria-describedby': visible ? id : undefined })}
      <span
        role="tooltip"
        id={id}
        className={cn(
          'pointer-events-none absolute z-40 w-max max-w-60 rounded-md bg-tooltip px-2.5 py-1.5 text-caption font-medium text-fg-inverse shadow-medium',
          placements[placement],
          visible ? 'visible opacity-100' : 'invisible opacity-0',
        )}
      >
        {content}
      </span>
    </span>
  );
}
