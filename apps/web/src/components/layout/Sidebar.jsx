import { useEffect, useId, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { groupChildren, isWithin } from './groupChildren.js';
import { BookOpen, ChevronDown, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { Tooltip } from '../ui/Tooltip.jsx';
import { useDialog } from '../ui/useDialog.js';
import { useAppShell } from './AppShell.jsx';

/**
 * Sidebar (same background as the page) showing the product, the signed-in role and the navigation.
 * Role-agnostic: pass the sections for the current role.
 *
 * brand:    { name, subtitle, logo? }        e.g. { name: 'EduTrack', subtitle: 'Platform Administrator' }
 * roleLabel: string                           e.g. 'Super Admin'
 * sections: [{ label?, items: [{ to, label, icon, end? } | { id, label, icon, children: [link] }] }]
 *           A group opens and closes; it is open while one of its pages is shown. When the sidebar
 *           is collapsed to icons, a group's pages show as icons of their own.
 */
export function Sidebar({ brand, roleLabel, sections, footer }) {
  const { collapsed, toggleCollapsed, mobileNavOpen, closeMobileNav } = useAppShell();
  const dialogProps = useDialog({ open: mobileNavOpen, onClose: closeMobileNav });

  return (
    <>
      {/* Desktop */}
      <aside
        className={cn(
          'sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-fg [--color-focus:var(--color-sidebar-focus)] transition-[width] duration-200 lg:flex',
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
              'flex h-9 w-full items-center gap-3 rounded-md px-3 text-small text-sidebar-fg-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-hover-fg',
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
          className="absolute top-4 right-3 grid size-8 place-items-center rounded-md text-sidebar-fg-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-hover-fg"
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
        <span className="grid size-10 shrink-0 place-items-center rounded-md border border-accent/50 bg-primary text-accent">
          {Logo ? <Logo aria-hidden="true" className="size-6" /> : <BookOpen aria-hidden="true" className="size-5" />}
        </span>
        {!collapsed && (
          <div className="flex min-w-0 flex-col items-start">
            {/* Long names wrap (even a single long word) instead of widening the sidebar. */}
            <span className="max-w-full text-section-title text-sidebar-fg-strong wrap-anywhere">{brand.name}</span>
            {brand.subtitle && <span className="text-caption text-sidebar-fg-muted">{brand.subtitle}</span>}
            {roleLabel && (
              <span className="mt-1.5 rounded-sm border border-accent/60 px-1.5 py-px text-caption font-medium text-sidebar-badge-fg">
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
              {section.items.map((item) =>
                item.children ? (
                  <SidebarGroup key={item.id ?? item.label} group={item} collapsed={collapsed} onNavigate={onNavigate} />
                ) : (
                  <li key={item.to}>
                    <SidebarLink item={item} collapsed={collapsed} onNavigate={onNavigate} />
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
      </nav>

      {footer && !collapsed && <div className="border-t border-sidebar-border p-4">{footer}</div>}
    </>
  );
}

function SidebarGroup({ group, collapsed, onNavigate }) {
  const { pathname } = useLocation();
  const active = group.children.some((c) => isWithin(pathname, c.to));
  const children = groupChildren(group.children, pathname);
  const [open, setOpen] = useState(active);
  const listId = useId();
  // Opening one of its pages (a link elsewhere, the back button) opens the group.
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  if (collapsed) {
    // Icons only: no room for a sub-menu, so each page keeps its own icon (and its tooltip).
    return children.map((child) => (
      <li key={child.to}>
        <SidebarLink item={child} collapsed onNavigate={onNavigate} />
      </li>
    ));
  }
  const Icon = group.icon;
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={listId}
        className={cn(
          'group/item relative flex h-10 w-full items-center gap-3 rounded-md px-3 text-body font-medium transition-colors',
          active && !open ? 'bg-sidebar-active text-sidebar-active-fg' : 'text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-hover-fg',
        )}
      >
        {Icon && <Icon aria-hidden="true" className="size-[1.125rem] shrink-0" />}
        <span className="flex-1 truncate text-left">{group.label}</span>
        <ChevronDown aria-hidden="true" className={cn('size-4 shrink-0 transition-transform duration-200', active && !open ? 'text-current' : 'text-sidebar-fg-muted group-hover/item:text-current', open && 'rotate-180')} />
      </button>
      <ul id={listId} hidden={!open} className="mt-1 ml-5 flex flex-col gap-1 border-l border-sidebar-border pl-2">
        {children.map((child) => (
          <li key={child.to}>
            <SidebarLink item={child} onNavigate={onNavigate} nested />
          </li>
        ))}
      </ul>
    </li>
  );
}

function SidebarLink({ item, collapsed, onNavigate, nested = false }) {
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
          nested && 'h-9 text-small',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-sidebar-active text-sidebar-active-fg before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-pill before:bg-sidebar-active-bar'
            : 'text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-hover-fg',
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
