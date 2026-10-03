import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { AuditLogsPage } from '../../features/audit-logs';
import { useSession } from '../../features/auth/SessionProvider.jsx';
import { DashboardPage } from '../../features/dashboard';
import PlatformSettingsPage from '../../features/platform-settings/PlatformSettingsPage.jsx';
import { PlatformReportsPage } from '../../features/reports';
import { SchoolOwnersPage } from '../../features/school-owners';
import { SchoolsPage } from '../../features/schools';
import { getRoleProfile } from '../config/navigation.js';
import RoleLayout from '../layouts/RoleLayout.jsx';
import NotFoundPage from './NotFoundPage.jsx';

// "/" sends the user to their role's start page.
function RoleHome() {
  const { user } = useSession();
  return <Navigate to={getRoleProfile(user.role)?.home ?? '/dashboard'} replace />;
}

// `handle.title` names the page for the topbar and the browser tab.
const routes = [
  {
    path: '/',
    element: <RoleLayout />,
    children: [
      { index: true, element: <RoleHome /> },

      // SUPER_ADMIN — platform scope (placeholder pages until their phase)
      { path: 'dashboard', element: <DashboardPage />, handle: { title: 'Dashboard' } },
      {
        path: 'schools',
        element: <SchoolsPage />,
        handle: { title: 'Schools' },
        // /schools/:schoolId opens the details panel over the list (the page stays mounted).
        // The panel itself is rendered by SchoolsPage, so the child route renders nothing.
        children: [{ path: ':schoolId', element: <></> }],
      },
      {
        path: 'school-owners',
        element: <SchoolOwnersPage />,
        handle: { title: 'School Owners' },
        // /school-owners/:ownerId opens the details panel over the list (rendered by the page).
        children: [{ path: ':ownerId', element: <></> }],
      },
      { path: 'platform-reports', element: <PlatformReportsPage />, handle: { title: 'Platform Reports' } },
      {
        path: 'audit-logs',
        element: <AuditLogsPage />,
        handle: { title: 'Audit Logs' },
        // /audit-logs/:logId opens the event's details panel over the list (rendered by the page).
        children: [{ path: ':logId', element: <></> }],
      },
      { path: 'platform-settings', element: <PlatformSettingsPage />, handle: { title: 'Platform Settings' } },

      { path: '*', element: <NotFoundPage />, handle: { title: 'Page not found' } },
    ],
  },
];

// Development-only design system preview. Vite removes this branch from production builds.
if (import.meta.env.DEV) {
  routes.push({
    path: '/design-system',
    // Shown while the lazily loaded preview downloads on first visit.
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await import('../dev/DesignSystemLayout.jsx')).default }),
    children: [
      { index: true, lazy: async () => ({ Component: (await import('../dev/FoundationsPreview.jsx')).default }) },
      {
        path: 'components',
        lazy: async () => ({ Component: (await import('../dev/ComponentsPreview.jsx')).default }),
      },
      { path: 'layout', lazy: async () => ({ Component: (await import('../dev/LayoutPreview.jsx')).default }) },
    ],
  });
}

const router = createBrowserRouter(routes);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
