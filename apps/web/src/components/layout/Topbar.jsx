import { Menu } from 'lucide-react';
import { useAppShell } from './AppShell.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';

/**
 * Sticky top bar. Slots keep it role-agnostic:
 * - `context`: page title/context text (shown when there is no search, or next to it on wide screens)
 * - `search`: a search input (hidden below `md`; pages can offer their own search)
 * - `actions`: extra icon buttons (e.g. notifications, once that feature is approved)
 * - `user`: usually <UserMenu />
 * The theme toggle is always present.
 */
export function Topbar({ context, search, actions, user }) {
  const { openMobileNav } = useAppShell();

  return (
    <header className="sticky top-0 z-20 flex h-topbar shrink-0 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6">
      <button
        type="button"
        onClick={openMobileNav}
        aria-label="Open navigation"
        className="-ml-1 grid size-10 place-items-center rounded-md text-fg-secondary hover:bg-muted hover:text-fg lg:hidden"
      >
        <Menu aria-hidden="true" className="size-5" />
      </button>

      {context && <div className="min-w-0 truncate text-card-title text-fg">{context}</div>}
      {search && <div className="hidden w-full max-w-sm md:block">{search}</div>}

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        {actions}
        <ThemeToggle />
        {user && <div className="ml-1 border-l border-border pl-2 sm:pl-3">{user}</div>}
      </div>
    </header>
  );
}
