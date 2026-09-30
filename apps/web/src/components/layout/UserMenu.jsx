import { ChevronDown } from 'lucide-react';
import { Avatar } from '../ui/Avatar.jsx';
import { DropdownMenu } from '../ui/DropdownMenu.jsx';

/**
 * Signed-in user button with a menu. The menu items are supplied by the caller
 * (e.g. profile, sign out) — this component defines only the presentation.
 */
export function UserMenu({ name, roleLabel, items }) {
  return (
    <DropdownMenu
      label={`Account menu for ${name}`}
      items={items}
      renderTrigger={(props) => (
        <button
          {...props}
          aria-label={`Account menu for ${name}`}
          className="flex items-center gap-2.5 rounded-md py-1 pr-1.5 pl-1 hover:bg-muted"
        >
          <Avatar name={name} decorative />
          <span className="hidden min-w-0 flex-col items-start text-left md:flex">
            <span className="truncate text-small font-semibold text-fg">{name}</span>
            {roleLabel && <span className="truncate text-caption text-fg-muted">{roleLabel}</span>}
          </span>
          <ChevronDown aria-hidden="true" className="hidden size-4 text-fg-muted md:block" />
        </button>
      )}
    />
  );
}
