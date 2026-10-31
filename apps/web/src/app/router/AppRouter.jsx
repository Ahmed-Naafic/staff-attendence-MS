import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { AttendanceReportsPage } from '../../features/attendance-reports';
import { AuditLogsPage } from '../../features/audit-logs';
import { BranchesPage } from '../../features/branches';
import { LoginPage, RequireSession, useSession } from '../../features/auth';
import { DashboardPage } from '../../features/dashboard';
import { ManagersPage } from '../../features/managers';
import { MyBranchPage } from '../../features/my-branch';
import { NotificationsPage } from '../../features/notifications';
import { AnnouncementsPage } from '../../features/announcements';
import { SchedulePage } from '../../features/schedules';
import { StaffPage } from '../../features/staff';
import { OwnerStaffPage } from '../../features/staff-transfers';
import { PlatformSettingsPage } from '../../features/platform-settings';
import { PlatformReportsPage } from '../../features/reports';
import { SchoolOwnersPage } from '../../features/school-owners';
import { SchoolsPage } from '../../features/schools';
import { getRoleProfile } from '../config/navigation.js';
import RoleLayout from '../layouts/RoleLayout.jsx';
import NotFoundPage from './NotFoundPage.jsx';

// /staff: the Manager manages their branch's staff; the Owner sees the school's staff and transfers them.
function StaffRoute() {
  const { user } = useSession();
  return user.role === 'OWNER' ? <OwnerStaffPage /> : <StaffPage />;
}

// "/" sends the user to their role's start page.
function RoleHome() {
  const { user } = useSession();
  return <Navigate to={getRoleProfile(user.role)?.home ?? '/dashboard'} replace />;
}

// `handle.title` names the page for the topbar and the browser tab; `handle.roles` lists the roles
// the page belongs to (another role gets the not-found page; the API enforces access either way).
const SUPER_ADMIN = ['SUPER_ADMIN'];
const OWNER = ['OWNER'];
const MANAGER = ['MANAGER'];
const OWNER_OR_MANAGER = ['OWNER', 'MANAGER'];
const routes = [
  // Public: the sign-in page. Everything else requires a session.
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireSession>
        <RoleLayout />
      </RequireSession>
    ),
    children: [
      { index: true, element: <RoleHome /> },

      // SUPER_ADMIN — platform scope
      { path: 'dashboard', element: <DashboardPage />, handle: { title: 'Dashboard', roles: SUPER_ADMIN } },
      {
        path: 'schools',
        element: <SchoolsPage />,
        handle: { title: 'Schools', roles: SUPER_ADMIN },
        // /schools/:schoolId opens the details panel over the list (the page stays mounted).
        // The panel itself is rendered by SchoolsPage, so the child route renders nothing.
        children: [{ path: ':schoolId', element: <></> }],
      },
      {
        path: 'school-owners',
        element: <SchoolOwnersPage />,
        handle: { title: 'School Owners', roles: SUPER_ADMIN },
        // /school-owners/:ownerId opens the details panel over the list (rendered by the page).
        children: [{ path: ':ownerId', element: <></> }],
      },
      { path: 'platform-reports', element: <PlatformReportsPage />, handle: { title: 'Platform Reports', roles: SUPER_ADMIN } },
      {
        path: 'audit-logs',
        element: <AuditLogsPage />,
        handle: { title: 'Audit Logs', roles: SUPER_ADMIN },
        // /audit-logs/:logId opens the event's details panel over the list (rendered by the page).
        children: [{ path: ':logId', element: <></> }],
      },
      { path: 'platform-settings', element: <PlatformSettingsPage />, handle: { title: 'Platform Settings', roles: SUPER_ADMIN } },
      { path: 'announcements', element: <AnnouncementsPage />, handle: { title: 'Announcements', roles: SUPER_ADMIN } },

      // OWNER — school scope
      {
        path: 'branches',
        element: <BranchesPage />,
        handle: { title: 'Branches', roles: OWNER },
        // /branches/:branchId opens the branch details panel over the list (rendered by the page).
        children: [{ path: ':branchId', element: <></> }],
      },
      {
        path: 'managers',
        element: <ManagersPage />,
        handle: { title: 'Managers', roles: OWNER },
        // /managers/:managerId opens the Manager details panel over the list (rendered by the page).
        children: [{ path: ':managerId', element: <></> }],
      },

      // MANAGER — branch scope
      { path: 'my-branch', element: <MyBranchPage />, handle: { title: 'My Branch', roles: MANAGER } },
      { path: 'schedule', element: <SchedulePage />, handle: { title: 'Schedule', roles: MANAGER } },
      {
        path: 'staff',
        element: <StaffRoute />,
        handle: { title: 'Staff', roles: OWNER_OR_MANAGER },
        // /staff/:staffId opens the staff details panel over the list (rendered by the Manager's page).
        children: [{ path: ':staffId', element: <></> }],
      },

      // OWNER and MANAGER — attendance reports (read only; each role sees its own scope, decided by the API)
      { path: 'attendance', element: <AttendanceReportsPage />, handle: { title: 'Attendance', roles: OWNER_OR_MANAGER } },
      // OWNER and MANAGER — notification centre (each sees only their own notifications, decided by the API)
      { path: 'notifications', element: <NotificationsPage />, handle: { title: 'Notifications', roles: OWNER_OR_MANAGER } },

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
