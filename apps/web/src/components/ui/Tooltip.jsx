import { cloneElement, useId, useLayoutEffect, useRef, useState } from 'react';
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
 * `decorative`: the child already describes itself (e.g. an unavailable Button), so the tooltip
 * is visual only and is not added to its description.
 */
export function Tooltip({ content, placement = 'top', decorative = false, children }) {
  const id = useId();
  const tipRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [shift, setShift] = useState(0);
  const show = () => setVisible(true);
  const hide = () => setVisible(false);

  // Keep the tooltip inside the viewport (e.g. on buttons at the right edge of a drawer).
  useLayoutEffect(() => {
    if (!visible || !tipRef.current) {
      setShift(0);
      return;
    }
    const margin = 8;
    const rect = tipRef.current.getBoundingClientRect();
    const viewport = document.documentElement.clientWidth;
    if (rect.right > viewport - margin) setShift(viewport - margin - rect.right);
    else if (rect.left < margin) setShift(margin - rect.left);
  }, [visible]);
  // Keep any description the child already has; add the tooltip while it is shown.
  const describedBy =
    [children.props['aria-describedby'], visible && !decorative ? id : null].filter(Boolean).join(' ') || undefined;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(event) => event.key === 'Escape' && hide()}
    >
      {cloneElement(children, { 'aria-describedby': describedBy })}
      <span
        role={decorative ? undefined : 'tooltip'}
        aria-hidden={decorative || undefined}
        id={id}
        ref={tipRef}
        style={shift ? { marginLeft: shift } : undefined}
        className={cn(
          'pointer-events-none absolute z-40 w-max max-w-60 rounded-md bg-tooltip px-2.5 py-1.5 text-caption font-medium text-fg-inverse shadow-medium',
          placements[placement],
          // Hidden tooltips take no space, so they cannot make their container scroll.
          visible ? 'block' : 'hidden',
        )}
      >
        {content}
      </span>
    </span>
  );
}
