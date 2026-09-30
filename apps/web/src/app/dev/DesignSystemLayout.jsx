import { Outlet } from 'react-router';
import { Bell, Component, LayoutTemplate, LogOut, Palette, User } from 'lucide-react';
import { AppShell, Sidebar, Topbar, UserMenu } from '../../components/layout';
import { Input, Tooltip } from '../../components/ui';

// Development-only preview of the design system (not included in production builds).
// Uses neutral sample content; it is not an application page.
const sections = [
  {
    label: 'Design system',
    items: [
      { to: '/design-system', label: 'Foundations', icon: Palette, end: true },
      { to: '/design-system/components', label: 'Components', icon: Component },
      { to: '/design-system/layout', label: 'Layout & states', icon: LayoutTemplate },
    ],
  },
];

export default function DesignSystemLayout() {
  return (
    <AppShell
      sidebar={
        <Sidebar
          brand={{ name: 'EduTrack', subtitle: 'Design System' }}
          roleLabel="Preview"
          sections={sections}
        />
      }
      topbar={
        <Topbar
          search={<Input type="search" label="Search" hideLabel placeholder="Search…" size="sm" />}
          actions={
            <Tooltip content="Notifications (placeholder)" placement="bottom">
              <button
                type="button"
                aria-label="Notifications"
                className="grid size-10 place-items-center rounded-md text-fg-secondary hover:bg-muted hover:text-fg"
              >
                <Bell aria-hidden="true" className="size-5" />
              </button>
            </Tooltip>
          }
          user={
            <UserMenu
              name="Sample User"
              roleLabel="Preview role"
              items={[
                { label: 'Profile', icon: User, onSelect: () => {} },
                { type: 'separator' },
                { label: 'Sign out', icon: LogOut, onSelect: () => {} },
              ]}
            />
          }
        />
      }
    >
      <Outlet />
    </AppShell>
  );
}
