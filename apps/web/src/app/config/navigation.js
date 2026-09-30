import { ChartColumn, House, School, ScrollText, Settings, Users } from 'lucide-react';

/*
 * Role-aware navigation. Each role gets its own identity and sidebar sections;
 * roles never share or mix navigation.
 *
 * Only SUPER_ADMIN is defined in Phase 2. OWNER and MANAGER are added in their own
 * phases by adding entries here (and their routes) — the shell needs no changes.
 */

/** How the shell presents each role. `home` is where "/" redirects. */
export const roleProfiles = {
  SUPER_ADMIN: {
    label: 'Super Admin',
    subtitle: 'Platform Administrator',
    home: '/dashboard',
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
        { to: '/audit-logs', label: 'Audit Logs', icon: ScrollText },
        { to: '/platform-settings', label: 'Platform Settings', icon: Settings },
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
