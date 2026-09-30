import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, EllipsisVertical } from 'lucide-react';
import { cn } from '../../lib/cn.js';

/**
 * Action menu (WAI-ARIA menu button pattern).
 * items: [
 *   { label, icon?, onSelect, disabled?, destructive?, selected? },
 *   { type: 'separator' },
 *   { type: 'label', label },
 * ]
 * `selected` (true/false) makes the item a radio-style choice with a check mark.
 * `renderTrigger(props)` renders a custom trigger; spread `props` onto a <button>.
 * The default trigger is a "more actions" (⋮) icon button labelled by `label`.
 */
export function DropdownMenu({ label = 'More actions', items, align = 'end', renderTrigger, className }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  // Disabled items stay focusable (WAI-ARIA menu pattern) so users can discover them;
  // they just cannot be activated.
  const menuItems = () => [...(menuRef.current?.querySelectorAll('[role^="menuitem"]') ?? [])];

  function close({ restoreFocus = true } = {}) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  // The menu is position: fixed so scrolling containers (e.g. tables) cannot clip it.
  // Place it under the trigger, or above when there is no room below.
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const trigger = triggerRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const gap = 6;
    const fitsBelow = trigger.bottom + gap + menuHeight <= window.innerHeight;
    setPosition({
      top: fitsBelow ? trigger.bottom + gap : Math.max(gap, trigger.top - gap - menuHeight),
      ...(align === 'end'
        ? { right: document.documentElement.clientWidth - trigger.right }
        : { left: trigger.left }),
    });
  }, [open, align]);

  // Focus the first item once the menu is positioned (hidden elements cannot take focus).
  // preventScroll: a scroll would trigger the close-on-scroll handler below.
  const positioned = position !== null;
  useEffect(() => {
    if (open && positioned) menuItems()[0]?.focus({ preventScroll: true });
  }, [open, positioned]);

  // Close on outside click, scroll or resize.
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function onViewportChange(event) {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [open]);

  function onMenuKeyDown(event) {
    const list = menuItems();
    const index = list.indexOf(document.activeElement);
    const moves = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: list.length - 1 };
    if (event.key in moves) {
      event.preventDefault();
      list[(moves[event.key] + list.length) % list.length]?.focus({ preventScroll: true });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      close({ restoreFocus: false });
    }
  }

  function onTriggerKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  const triggerProps = {
    ref: triggerRef,
    type: 'button',
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: () => setOpen((value) => !value),
    onKeyDown: onTriggerKeyDown,
  };

  return (
    <div ref={rootRef} className={cn('relative inline-flex', className)}>
      {renderTrigger ? (
        renderTrigger(triggerProps)
      ) : (
        <button
          {...triggerProps}
          aria-label={label}
          className="grid size-8 place-items-center rounded-md border border-border bg-surface text-fg-secondary hover:bg-muted hover:text-fg"
        >
          <EllipsisVertical aria-hidden="true" className="size-4" />
        </button>
      )}

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          style={position ?? { visibility: 'hidden' }}
          className="fixed z-30 flex min-w-48 flex-col rounded-md border border-border bg-elevated p-1 shadow-large"
        >
          {items.map((item, index) => {
            if (item.type === 'separator') {
              return <div key={index} role="separator" className="my-1 h-px bg-border-subtle" />;
            }
            if (item.type === 'label') {
              return (
                <div key={index} role="presentation" className="px-2.5 pt-2 pb-1 text-caption font-semibold text-fg-muted">
                  {item.label}
                </div>
              );
            }
            const Icon = item.icon;
            const isChoice = typeof item.selected === 'boolean';
            return (
              <button
                key={index}
                type="button"
                role={isChoice ? 'menuitemradio' : 'menuitem'}
                aria-checked={isChoice ? item.selected : undefined}
                aria-disabled={item.disabled || undefined}
                tabIndex={-1}
                onClick={() => {
                  if (item.disabled) return;
                  close();
                  item.onSelect?.();
                }}
                className={cn(
                  'flex h-9 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-body transition-colors',
                  'focus-visible:outline-offset-[-2px] focus:bg-muted',
                  item.disabled
                    ? 'cursor-not-allowed text-fg-disabled'
                    : item.destructive
                      ? 'text-error-fg hover:bg-error-soft focus:bg-error-soft'
                      : 'text-fg hover:bg-muted',
                  item.selected && 'font-medium',
                )}
              >
                {Icon && <Icon aria-hidden="true" className="size-4 shrink-0" />}
                <span className="flex-1">{item.label}</span>
                {item.selected && <Check aria-hidden="true" className="size-4 shrink-0 text-interactive" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
