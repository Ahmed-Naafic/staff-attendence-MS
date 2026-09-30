import { useId, useRef } from 'react';
import { cn } from '../../lib/cn.js';

const tabId = (baseId, value) => `${baseId}-tab-${value}`;
const panelId = (baseId, value) => `${baseId}-panel-${value}`;

/**
 * Accessible tabs (WAI-ARIA tabs pattern; arrow keys, Home and End move between tabs).
 * Controlled: `value` + `onChange(value)`. tabs: [{ value, label, icon?, disabled? }]
 *
 * To link the panel, create one id and pass it to both:
 *   const tabsId = useId();
 *   <Tabs id={tabsId} … />  <TabPanel tabsId={tabsId} value={active}>…</TabPanel>
 */
export function Tabs({ id, tabs, value, onChange, label, className }) {
  const autoId = useId();
  const baseId = id ?? autoId;
  const listRef = useRef(null);

  function onKeyDown(event) {
    const enabled = tabs.filter((tab) => !tab.disabled);
    const index = enabled.findIndex((tab) => tab.value === value);
    const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: enabled.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = enabled[(moves[event.key] + enabled.length) % enabled.length];
    onChange(next.value);
    listRef.current?.querySelector(`#${CSS.escape(tabId(baseId, next.value))}`)?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      // Baseline drawn as an inset shadow so the active tab's underline can cover it
      // without overflowing (which would add a vertical scrollbar).
      className={cn('flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-border)]', className)}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        const Icon = tab.icon;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={tabId(baseId, tab.value)}
            aria-selected={selected}
            aria-controls={panelId(baseId, tab.value)}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.value)}
            className={cn(
              'flex items-center gap-2 border-b-2 px-3 py-2.5 text-small font-medium whitespace-nowrap transition-colors',
              'focus-visible:outline-offset-[-2px] disabled:text-fg-disabled',
              selected
                ? 'border-accent text-accent-fg'
                : 'border-transparent text-fg-secondary hover:border-border-strong hover:text-fg',
            )}
          >
            {Icon && <Icon aria-hidden="true" className="size-4" />}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/** Panel for the active tab. */
export function TabPanel({ tabsId, value, className, children }) {
  return (
    <div
      role="tabpanel"
      id={tabsId ? panelId(tabsId, value) : undefined}
      aria-labelledby={tabsId ? tabId(tabsId, value) : undefined}
      tabIndex={0}
      className={cn('focus-visible:outline-offset-4', className)}
    >
      {children}
    </div>
  );
}
