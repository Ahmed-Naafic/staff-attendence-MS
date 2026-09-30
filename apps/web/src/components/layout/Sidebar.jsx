import { NavLink } from 'react-router';
import { BookOpen, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { Tooltip } from '../ui/Tooltip.jsx';
import { useDialog } from '../ui/useDialog.js';
import { useAppShell } from './AppShell.jsx';

/**
 * Navy sidebar showing the product, the signed-in role and the navigation.
 * Role-agnostic: pass the sections for the current role.
 *
 * brand:    { name, subtitle, logo? }        e.g. { name: 'EduTrack', subtitle: 'Platform Administrator' }
 * roleLabel: string                           e.g. 'Super Admin'
 * sections: [{ label?, items: [{ to, label, icon, end? }] }]
 */
export function Sidebar({ brand, roleLabel, sections, footer }) {
  const { collapsed, toggleCollapsed, mobileNavOpen, closeMobileNav } = useAppShell();
  const dialogProps = useDialog({ open: mobileNavOpen, onClose: closeMobileNav });

  return (
    <>
      {/* Desktop */}
      <aside
        className={cn(
          'sticky top-0 z-30 hidden h-dvh shrink-0 flex-col bg-sidebar text-sidebar-fg [--color-focus:var(--color-sidebar-focus)] transition-[width] duration-200 lg:flex',
          collapsed ? 'w-sidebar-collapsed' : 'w-sidebar',
        )}
      >
        <SidebarContent brand={brand} roleLabel={roleLabel} sections={sections} footer={footer} collapsed={collapsed} />
        <div className="border-t border-sidebar-border p-3">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className={cn(
              'flex h-9 w-full items-center gap-3 rounded-md px-3 text-small text-sidebar-fg-muted hover:bg-sidebar-hover hover:text-sidebar-fg',
              collapsed && 'justify-center px-0',
            )}
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" className="size-[1.125rem]" />
            ) : (
              <>
                <PanelLeftClose aria-hidden="true" className="size-[1.125rem]" />
                Collapse
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Tablet and phone: overlay panel */}
      <dialog
        {...dialogProps}
        aria-label="Navigation"
        className={cn(
          'my-0 mr-auto ml-0 h-dvh max-h-none w-72 max-w-[85vw] flex-col border-0 bg-sidebar p-0 text-sidebar-fg [--color-focus:var(--color-sidebar-focus)] open:flex lg:hidden',
          'transition-transform duration-200 starting:open:-translate-x-full',
        )}
      >
        <button
          type="button"
          onClick={closeMobileNav}
          aria-label="Close navigation"
          className="absolute top-4 right-3 grid size-8 place-items-center rounded-md text-sidebar-fg-muted hover:bg-sidebar-hover hover:text-sidebar-fg"
        >
          <X aria-hidden="true" className="size-[1.125rem]" />
        </button>
        <SidebarContent
          brand={brand}
          roleLabel={roleLabel}
          sections={sections}
          footer={footer}
          onNavigate={closeMobileNav}
        />
      </dialog>
    </>
  );
}

function SidebarContent({ brand, roleLabel, sections, footer, collapsed = false, onNavigate }) {
  const Logo = brand.logo;
  return (
    <>
      <div className={cn('flex items-center gap-3 px-5 pt-6 pb-5', collapsed && 'justify-center px-0')}>
        <span className="grid size-10 shrink-0 place-items-center rounded-md border border-accent/50 bg-sidebar-hover text-accent">
          {Logo ? <Logo aria-hidden="true" className="size-6" /> : <BookOpen aria-hidden="true" className="size-5" />}
        </span>
        {!collapsed && (
          <div className="flex min-w-0 flex-col items-start">
            <span className="text-section-title text-sidebar-fg-strong">{brand.name}</span>
            {brand.subtitle && <span className="text-caption text-sidebar-fg-muted">{brand.subtitle}</span>}
            {roleLabel && (
              <span className="mt-1.5 rounded-sm border border-accent/60 px-1.5 py-px text-caption font-medium text-sidebar-active-fg">
                {roleLabel}
              </span>
            )}
          </div>
        )}
      </div>

      <nav
        aria-label="Main"
        // Collapsed: no scroll container, so the icon tooltips can extend past the sidebar.
        className={cn('flex flex-1 flex-col gap-4 px-3 pb-4', collapsed ? 'overflow-visible' : 'overflow-y-auto')}
      >
        {sections.map((section, index) => (
          <div
            key={section.label ?? index}
            className={cn('flex flex-col gap-1', index > 0 && 'border-t border-sidebar-border pt-4')}
          >
            {section.label && !collapsed && (
              <p className="px-3 pb-1 text-caption font-semibold tracking-wide text-sidebar-fg-muted uppercase">
                {section.label}
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {section.items.map((item) => (
                <li key={item.to}>
                  <SidebarLink item={item} collapsed={collapsed} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {footer && !collapsed && <div className="border-t border-sidebar-border p-4">{footer}</div>}
    </>
  );
}

function SidebarLink({ item, collapsed, onNavigate }) {
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      aria-label={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'relative flex h-10 items-center gap-3 rounded-md px-3 text-body font-medium transition-colors',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-sidebar-active text-sidebar-active-fg before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-pill before:bg-accent'
            : 'text-sidebar-fg hover:bg-sidebar-hover',
        )
      }
    >
      {Icon && <Icon aria-hidden="true" className="size-[1.125rem] shrink-0" />}
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );

  return collapsed ? (
    <Tooltip content={item.label} placement="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}
