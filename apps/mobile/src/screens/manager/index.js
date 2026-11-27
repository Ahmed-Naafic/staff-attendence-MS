/*
 * Manager workspace (docs/mobile/workspaces.md): Home · Students · Attendance · More. Fee Management
 * uses the shared fee screens (registered with the Accountant workspace) on the Manager API.
 */
import MoreScreen from '../more/MoreScreen';
import {
  ManagerAttendanceScreen,
  ManagerClassesScreen,
  ManagerExamsScreen,
  ManagerHomeScreen,
  ManagerSectionTimetableScreen,
  ManagerStaffScreen,
  ManagerStudentScreen,
  ManagerStudentsScreen,
  SessionMarksScreen,
} from './ManagerScreens';
import ManagerDevicesScreen from '../devices/ManagerDevicesScreen';

export const managerTabs = [
  { name: 'ManagerHome', label: 'Home', component: ManagerHomeScreen, icon: 'home' },
  { name: 'ManagerStudentsTab', label: 'Students', component: ManagerStudentsScreen, icon: 'school' },
  { name: 'ManagerAttendanceTab', label: 'Attendance', component: ManagerAttendanceScreen, icon: 'checkbox' },
  { name: 'More', component: MoreScreen, icon: 'grid' },
];

export const managerStack = [
  ['ManagerStudent', ManagerStudentScreen],
  ['SessionMarks', SessionMarksScreen],
  ['ManagerStaff', ManagerStaffScreen],
  ['ManagerClasses', ManagerClassesScreen],
  ['ManagerSectionTimetable', ManagerSectionTimetableScreen],
  ['ManagerTimetable', ManagerClassesScreen],
  ['ManagerExams', ManagerExamsScreen],
  ['ManagerDevices', ManagerDevicesScreen],
];
