import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const AppShellContext = createContext(null);

/**
 * Page frame: sidebar + topbar + main content. Role-agnostic; each role passes its own
 * sidebar navigation and topbar content.
 *
 *   <AppShell sidebar={<Sidebar … />} topbar={<Topbar … />}>
 *     <PageContainer>…</PageContainer>
 *   </AppShell>
 *
 * Desktop (lg+): fixed sidebar, optionally collapsed to icons.
 * Tablet and phone (<lg): sidebar hidden; the topbar menu button opens it as an overlay.
 */
export function AppShell({ sidebar, topbar, children }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const openMobileNav = useCallback(() => setMobileNavOpen(true), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const toggleCollapsed = useCallback(() => setCollapsed((value) => !value), []);

  const value = useMemo(
    () => ({ mobileNavOpen, openMobileNav, closeMobileNav, collapsed, toggleCollapsed }),
    [mobileNavOpen, openMobileNav, closeMobileNav, collapsed, toggleCollapsed],
  );

  return (
    <AppShellContext.Provider value={value}>
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-accent px-4 py-2 text-button text-on-accent focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to main content
      </a>
      <div className="flex min-h-dvh bg-page">
        {sidebar}
        <div className="flex min-w-0 flex-1 flex-col">
          {topbar}
          <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
            {children}
          </main>
        </div>
      </div>
    </AppShellContext.Provider>
  );
}

export function useAppShell() {
  const context = useContext(AppShellContext);
  if (!context) throw new Error('useAppShell must be used inside <AppShell>.');
  return context;
}
