import { Banknote, FileText, Lock, Percent, Receipt, ShieldCheck, Wallet, Award, ChartColumnBig, ClipboardList, DoorOpen, Grid3x3, LayoutDashboard, NotebookPen, PenLine, SlidersHorizontal, Tags, ArrowRightLeft, CalendarCog, ListOrdered, Table2, LayoutGrid, Backpack, BellRing, BookOpen, Building2, CalendarClock, CalendarDays, CalendarRange, GraduationCap, ChartColumn, ClipboardCheck, Clock, FileCheck, FileChartColumn, UserCheck, House, Megaphone, Presentation, School, ScrollText, Settings, UserCog, UserRound, Users } from 'lucide-react';

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
  ACCOUNTANT: {
    label: 'Accountant',
    subtitle: 'Fee Management',
    home: '/fees',
  },
};

/**
 * Fee Management under one menu (School Owner, Managers, Accountants), in the order of the work. Fee
 * Clearance sits with the others (examination eligibility). The pages explain when the school has not
 * had Fee Management switched on.
 */
const feeGroup = {
  id: 'fees',
  label: 'Fees',
  icon: Wallet,
  children: [
    { to: '/fees', label: 'Overview', icon: LayoutDashboard },
    { to: '/fees/structures', label: 'Fee Structures', icon: Receipt },
    { to: '/fees/students', label: 'Student Fees', icon: Users },
    { to: '/fees/invoices', label: 'Invoices', icon: FileText },
    { to: '/fees/payments', label: 'Payments', icon: Banknote },
    { to: '/fees/discounts', label: 'Discounts & Scholarships', icon: Percent },
    { to: '/fees/clearance', label: 'Fee Clearance', icon: ShieldCheck },
    { to: '/fees/cash-closing', label: 'Cash Closing', icon: Lock },
    { to: '/fees/reports', label: 'Reports', icon: ChartColumn },
    { to: '/fees/settings', label: 'Settings', icon: SlidersHorizontal },
  ],
};

/**
 * The school's schedule under one menu (School Owner and Manager), each page on its own, in the order it is set up: the
 * year, its school days and holidays, the bell times, then the timetables (build and publish, view
 * and print, edit one class by hand). Staff work shifts are the Manager's separate Staff Schedule.
 */
const scheduleGroup = {
  id: 'school-schedule',
  label: 'School Schedule',
  icon: Table2,
  children: [
    { to: '/academic-years', label: 'Academic Years', icon: CalendarRange },
    { to: '/academic-calendar', label: 'Academic Calendar', icon: CalendarDays },
    { to: '/bell-schedules', label: 'Bell Schedules', icon: BellRing },
    { to: '/timetable-builder', label: 'Timetable Builder', icon: CalendarCog },
    { to: '/timetable-views', label: 'Timetable Views', icon: LayoutGrid },
    { to: '/timetables', label: 'Class Timetables', icon: Clock },
  ],
};

/**
 * Everything about staff under one menu: the staff list, their work shifts (Staff Schedule,
 * Manager only: shifts are set per branch) and their attendance reports.
 */
const staffGroup = (role) => ({
  id: 'staff',
  label: 'Staff',
  icon: Users,
  children: [
    { to: '/staff', label: 'Staff List', icon: UserRound },
    ...(role === 'MANAGER' ? [{ to: '/schedule', label: 'Staff Schedule', icon: CalendarClock }] : []),
    { to: '/attendance', label: 'Staff Attendance', icon: ClipboardCheck },
  ],
});

/**
 * Everything about students under one menu (School Owner and Manager): the student list,
 * promotion to the next year, daily attendance, excuses and attendance reports.
 */
const studentGroup = {
  id: 'students',
  label: 'Students',
  icon: Backpack,
  children: [
    { to: '/students', label: 'Student List', icon: UserRound },
    { to: '/promotions', label: 'Promotion', icon: ArrowRightLeft },
    { to: '/student-attendance', label: 'Student Attendance', icon: UserCheck },
    { to: '/student-excuses', label: 'Student Excuses', icon: FileCheck },
    { to: '/student-attendance/reports', label: 'Student Reports', icon: FileChartColumn },
  ],
};

/**
 * Examinations under one menu (School Owner and Manager), in the order of the work: overview, the
 * examinations, their configuration and rooms, the timetable, marks, results, analytics, settings.
 * The pages explain when the school has not had Examinations switched on.
 */
const examGroup = {
  id: 'examinations',
  label: 'Examinations',
  icon: NotebookPen,
  children: [
    { to: '/examinations', label: 'Overview', icon: LayoutDashboard },
    { to: '/examinations/list', label: 'Examinations', icon: ClipboardList },
    { to: '/examinations/setup', label: 'Types & Periods', icon: Tags },
    { to: '/examinations/rooms', label: 'Rooms', icon: DoorOpen },
    { to: '/examinations/timetable', label: 'Timetable & Allocation', icon: Grid3x3 },
    { to: '/examinations/marks', label: 'Marks Entry', icon: PenLine },
    { to: '/examinations/results', label: 'Results & Report Cards', icon: Award },
    { to: '/examinations/analytics', label: 'Analytics', icon: ChartColumnBig },
    { to: '/examinations/settings', label: 'Settings', icon: SlidersHorizontal },
  ],
};

/**
 * Sidebar sections per role: [{ label?, items: [item] }], an item being a link { to, label, icon }
 * or a group { id, label, icon, children: [link] } shown as a menu that opens and closes.
 */
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
        staffGroup('OWNER'),
        scheduleGroup,
        // Every page needed to build a timetable, as steps in tabs (its own menu item).
        { to: '/timetable', label: 'Timetable', icon: ListOrdered },
        { to: '/classes', label: 'Classes', icon: GraduationCap },
        { to: '/subjects', label: 'Subjects', icon: BookOpen },
        { to: '/teaching', label: 'Teaching', icon: Presentation },
        studentGroup,
        examGroup,
        feeGroup,
      ],
    },
  ],
  // Branch scope: their own branch only. Attendance: read-only reports for that branch.
  MANAGER: [
    {
      items: [
        { to: '/my-branch', label: 'My Branch', icon: Building2 },
        staffGroup('MANAGER'),
        scheduleGroup,
        // Every page needed to build a timetable, as steps in tabs (its own menu item).
        { to: '/timetable', label: 'Timetable', icon: ListOrdered },
        { to: '/classes', label: 'Classes', icon: GraduationCap },
        { to: '/subjects', label: 'Subjects', icon: BookOpen },
        { to: '/teaching', label: 'Teaching', icon: Presentation },
        studentGroup,
        examGroup,
        feeGroup,
      ],
    },
  ],
  // Branch scope, Fee Management only (payments, receipts, invoices, cash closing, reports).
  ACCOUNTANT: [{ items: [feeGroup] }],
};

export function getNavigationForRole(role) {
  return navigationByRole[role] ?? [];
}

export function getRoleProfile(role) {
  return roleProfiles[role] ?? null;
}
