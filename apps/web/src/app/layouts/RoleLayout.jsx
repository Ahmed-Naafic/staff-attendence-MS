import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useMatches } from 'react-router';
import { LogOut, UserRound } from 'lucide-react';
import { AppShell, Sidebar, Topbar, UserMenu } from '../../components/layout';
import { EmptyState } from '../../components/ui';
import { useSession } from '../../features/auth/SessionProvider.jsx';
import { getNavigationForRole, getRoleProfile } from '../config/navigation.js';

const PRODUCT_NAME = 'EduTrack';

/**
 * The web application shell for the signed-in role: sidebar (role identity + navigation),
 * topbar (page context, theme toggle, user menu) and the routed page in the content area.
 * Pages render only their own content, starting with <PageContainer>.
 */
export default function RoleLayout() {
  const { user, isDemo } = useSession();
  const profile = getRoleProfile(user.role);
  const title = usePageTitle();
  useRouteAnnouncements(title);

  if (!profile) {
    // e.g. STAFF, who use the mobile app. Owner/Manager navigation arrives in later phases.
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <EmptyState
          title="No web workspace for this role yet"
          description="This account's role does not have web navigation in this version."
        />
      </main>
    );
  }

  return (
    <AppShell
      sidebar={
        <Sidebar
          brand={{ name: PRODUCT_NAME, subtitle: profile.subtitle }}
          roleLabel={profile.label}
          sections={getNavigationForRole(user.role)}
        />
      }
      topbar={
        <Topbar
          // The page header shows the title on wide screens; the topbar repeats it on
          // smaller screens where the header scrolls away.
          context={title && <span className="lg:hidden">{title}</span>}
          user={
            <UserMenu
              name={user.name}
              roleLabel={profile.label}
              items={[
                ...(isDemo ? [{ type: 'label', label: 'Demo session — no sign-in yet' }] : []),
                // Profile and sign-out arrive with the authentication phase.
                { label: 'Profile', icon: UserRound, disabled: true },
                { type: 'separator' },
                { label: 'Sign out', icon: LogOut, disabled: true },
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

/** Title of the deepest matched route that declares `handle.title`. */
function usePageTitle() {
  const matches = useMatches();
  return [...matches].reverse().find((match) => match.handle?.title)?.handle.title ?? null;
}

/**
 * On navigation: update the browser tab title and move focus to the main content,
 * so keyboard and screen reader users start at the new page instead of the old link.
 */
function useRouteAnnouncements(title) {
  const { pathname } = useLocation();
  // Compare with the previous path rather than using a "first render" flag:
  // StrictMode re-runs effects on mount, which a flag would mistake for a navigation.
  const previousPath = useRef(pathname);

  useEffect(() => {
    document.title = title ? `${title} · ${PRODUCT_NAME}` : PRODUCT_NAME;
  }, [title]);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [pathname]);
}
