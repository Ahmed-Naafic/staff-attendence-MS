import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useMatches, useNavigate } from 'react-router';
import { LogOut, UserRound } from 'lucide-react';
import { AppShell, Sidebar, Topbar, UserMenu } from '../../components/layout';
import { Button, EmptyState } from '../../components/ui';
import { useSession } from '../../features/auth/SessionProvider.jsx';
import { useBranding } from '../../features/branding';
import { getNavigationForRole, getRoleProfile } from '../config/navigation.js';
import { DisplaySettingsProvider } from '../providers/DisplaySettingsProvider.jsx';
import NotFoundPage from '../router/NotFoundPage.jsx';

/**
 * The web application shell for the signed-in role: sidebar (role identity + navigation),
 * topbar (page context, theme toggle, user menu) and the routed page in the content area.
 * Pages render only their own content, starting with <PageContainer>.
 */
export default function RoleLayout() {
  const { user, signOut } = useSession();
  const { platformName, loaded } = useBranding();
  const navigate = useNavigate();
  const profile = getRoleProfile(user.role);
  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      navigate('/login', { replace: true });
    }
  };
  const allowed = useRouteAllowed(user.role);
  const pageTitle = usePageTitle();
  const title = allowed ? pageTitle : 'Page not found';
  useRouteAnnouncements(title, loaded ? platformName : null);

  if (!profile) {
    // e.g. STAFF, who use the mobile app. Owner/Manager navigation arrives in later phases.
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <EmptyState
          title="No web workspace for this role yet"
          description="This account's role does not have web navigation in this version."
          action={
            <Button variant="outline" onClick={handleSignOut}>
              Sign out
            </Button>
          }
        />
      </main>
    );
  }

  return (
    <AppShell
      sidebar={
        <Sidebar
          // The saved platform name (EduTrack when unavailable); a blank line for the moment it loads.
          brand={{ name: loaded ? platformName : ' ', subtitle: profile.subtitle }}
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
                // Profile is not available yet (no approved profile features).
                { label: 'Profile', icon: UserRound, disabled: true },
                { type: 'separator' },
                { label: 'Sign out', icon: LogOut, onSelect: handleSignOut },
              ]}
            />
          }
        />
      }
    >
      {/* Dates in the pages use the platform time zone and formats (Platform Settings → General). */}
      <DisplaySettingsProvider enabled={user.role === 'SUPER_ADMIN'}>
        {allowed ? <Outlet /> : <NotFoundPage />}
      </DisplaySettingsProvider>
    </AppShell>
  );
}

/** Whether the role may open this page: routes that list `handle.roles` belong to those roles only. */
function useRouteAllowed(role) {
  const matches = useMatches();
  return matches.every((match) => !match.handle?.roles || match.handle.roles.includes(role));
}

/** Title of the deepest matched route that declares `handle.title`. */
function usePageTitle() {
  const matches = useMatches();
  return [...matches].reverse().find((match) => match.handle?.title)?.handle.title ?? null;
}

/**
 * Browser tab title: "<page> · <platform name>" (left as it is until the name has loaded).
 * On navigation to another section: move focus to the main
 * content, so keyboard and screen reader users start at the new page instead of the old link.
 * Moves within a section (e.g. /schools → /schools/:id opening a details panel) keep focus
 * where the page puts it, so closing the panel returns focus to the button that opened it.
 */
function useRouteAnnouncements(title, platformName) {
  const { pathname } = useLocation();
  const section = pathname.split('/')[1] ?? '';
  // Compare with the previous section rather than using a "first render" flag:
  // StrictMode re-runs effects on mount, which a flag would mistake for a navigation.
  const previousSection = useRef(section);

  useEffect(() => {
    if (platformName) document.title = title ? `${title} · ${platformName}` : platformName;
  }, [title, platformName]);

  useEffect(() => {
    if (previousSection.current === section) return;
    previousSection.current = section;
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [section]);
}
