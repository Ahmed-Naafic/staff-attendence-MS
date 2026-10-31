import { Building2, CalendarClock, ChartColumn, ClipboardCheck, House, Megaphone, School, ScrollText, Settings, UserCog, Users } from 'lucide-react';

/*
 * Role-aware navigation. Each role gets its own identity and sidebar sections;
 * roles never share or mix navigation.
 *
 * SUPER_ADMIN (Phase 2), OWNER (Branch Management, Manager accounts) and MANAGER (their branch)
 * are defined. STAFF use the mobile app. New sections only need entries here (and routes).
 */

/** How the shell presents each role. `home` is where "/" redirects. */
export const roleProfiles = {
  SUPER_ADMIN: {
    label: 'Super Admin',
    subtitle: 'Platform Administrator',
    home: '/dashboard',
  },
  OWNER: {
    label: 'School Owner',
    subtitle: 'School Administration',
    home: '/branches',
  },
  MANAGER: {
    label: 'Manager',
    subtitle: 'Branch Management',
    home: '/my-branch',
  },
};

/** Sidebar sections per role: [{ label?, items: [{ to, label, icon }] }]. */
export const navigationByRole = {
  // Platform scope only. Branches, Managers, Staff and Daily Attendance belong to
  // the Owner / Manager scopes and must not appear here.
  SUPER_ADMIN: [
    {
      items: [
        { to: '/dashboard', label: 'Dashboard', icon: House },
        { to: '/schools', label: 'Schools', icon: School },
        { to: '/school-owners', label: 'School Owners', icon: Users },
      ],
    },
    {
      items: [
        { to: '/platform-reports', label: 'Platform Reports', icon: ChartColumn },
        { to: '/announcements', label: 'Announcements', icon: Megaphone },
        { to: '/audit-logs', label: 'Audit Logs', icon: ScrollText },
        { to: '/platform-settings', label: 'Platform Settings', icon: Settings },
      ],
    },
  ],
  // School scope: their own school only. Attendance: read-only reports for every branch of the school.
  OWNER: [
    {
      items: [
        { to: '/branches', label: 'Branches', icon: Building2 },
        { to: '/managers', label: 'Managers', icon: UserCog },
        { to: '/staff', label: 'Staff', icon: Users },
        { to: '/attendance', label: 'Attendance', icon: ClipboardCheck },
      ],
    },
  ],
  // Branch scope: their own branch only. Attendance: read-only reports for that branch.
  MANAGER: [
    {
      items: [
        { to: '/my-branch', label: 'My Branch', icon: Building2 },
        { to: '/schedule', label: 'Schedule', icon: CalendarClock },
        { to: '/staff', label: 'Staff', icon: Users },
        { to: '/attendance', label: 'Attendance', icon: ClipboardCheck },
      ],
    },
  ],
};

export function getNavigationForRole(role) {
  return navigationByRole[role] ?? [];
}

export function getRoleProfile(role) {
  return roleProfiles[role] ?? null;
}
