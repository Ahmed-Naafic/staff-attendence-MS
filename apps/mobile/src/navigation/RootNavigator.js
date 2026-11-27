/*
 * Navigation by session state: splash while restoring, sign-in when signed out, only the password
 * change while a temporary password is in use, and the open workspace for a ready session. Signed-in
 * screens are never mounted without a session.
 *
 * Workspaces (docs/mobile/workspaces.md) each have four bottom tabs under the shared app header
 * (src/components/AppHeader.js):
 *   Teacher     Home · Classes · Attendance · More
 *   Accountant  Home · Students · Payments · More
 *   Manager     Home · Students · Attendance · More
 * Detail screens open on one shared stack; each checks its own data with the server.
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AttendanceProvider } from '../attendance/AttendanceProvider';
import { useSession } from '../auth/SessionProvider';
import { AppHeader } from '../components/AppHeader';
import { Icon, InTabContext, LoadingView } from '../components/ui';
import { NotificationsProvider } from '../notifications/NotificationsProvider';
import { accountantStack, accountantTabs } from '../screens/accountant';
import AttendanceResultScreen from '../screens/attendance/AttendanceResultScreen';
import AttendanceScreen from '../screens/attendance/AttendanceScreen';
import ChangePasswordScreen from '../screens/auth/ChangePasswordScreen';
import SignInScreen from '../screens/auth/SignInScreen';
import SplashScreen from '../screens/auth/SplashScreen';
import DevicesScreen from '../screens/devices/DevicesScreen';
import ExamDutiesScreen from '../screens/exams/ExamDutiesScreen';
import ExamMarkSheetScreen from '../screens/exams/ExamMarkSheetScreen';
import ExamMarksScreen from '../screens/exams/ExamMarksScreen';
import ExamRoomScreen from '../screens/exams/ExamRoomScreen';
import HistoryScreen from '../screens/history/HistoryScreen';
import HomeScreen from '../screens/home/HomeScreen';
import LessonScreen from '../screens/lessons/LessonScreen';
import LessonsScreen from '../screens/lessons/LessonsScreen';
import MySubjectsScreen from '../screens/lessons/MySubjectsScreen';
import MyTeachingScreen from '../screens/lessons/MyTeachingScreen';
import MyTimetableScreen from '../screens/lessons/MyTimetableScreen';
import { managerStack, managerTabs } from '../screens/manager';
import MoreScreen from '../screens/more/MoreScreen';
import NotificationDetailScreen from '../screens/notifications/NotificationDetailScreen';
import NotificationsScreen from '../screens/notifications/NotificationsScreen';
import ReminderSettingsScreen from '../screens/notifications/ReminderSettingsScreen';
import AboutScreen from '../screens/profile/AboutScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import SettingsScreen from '../screens/profile/SettingsScreen';
import SyncScreen from '../screens/sync/SyncScreen';
import { AppLockGate } from '../lock/AppLock';
import { AccountThemeSync } from '../theme/AccountThemeSync';
import { useTheme } from '../theme/ThemeProvider';
import { radius } from '../theme/tokens';
import { useWorkspace, WorkspaceProvider } from '../workspace/WorkspaceProvider';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

export const teacherTabs = [
  { name: 'Home', component: HomeScreen, icon: 'home' },
  { name: 'Classes', component: MyTeachingScreen, icon: 'people' },
  { name: 'Attendance', component: LessonsScreen, icon: 'checkbox' },
  { name: 'More', component: MoreScreen, icon: 'grid' },
];

const TABS = { teacher: teacherTabs, accountant: accountantTabs, manager: managerTabs };

/** A tab screen: under the app header, without its own top inset or Back button. */
function inTab(Component) {
  function TabScreen(props) {
    return (
      <InTabContext.Provider value>
        <Component {...props} />
      </InTabContext.Provider>
    );
  }
  TabScreen.displayName = `InTab(${Component.displayName ?? Component.name ?? 'Screen'})`;
  return TabScreen;
}
const wrapped = new Map();
const tabComponent = (c) => {
  if (!wrapped.has(c)) wrapped.set(c, inTab(c));
  return wrapped.get(c);
};

function TabIcon({ icon, focused }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.tabIcon, focused && { backgroundColor: colors.accentSoft }]}>
      <Icon name={focused ? icon : `${icon}-outline`} size={22} color={focused ? colors.accent : colors.fgSecondary} />
    </View>
  );
}

function WorkspaceTabs() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { workspace } = useWorkspace();
  const tabs = TABS[workspace];
  if (!tabs) return <LoadingView label="Opening your workspace…" />;
  return (
    <Tabs.Navigator
      // A new workspace starts on its own Home tab.
      key={workspace}
      screenOptions={({ navigation }) => ({
        header: () => <AppHeader navigation={navigation} />,
        tabBarActiveTintColor: colors.fg,
        tabBarInactiveTintColor: colors.fgSecondary,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 64 + insets.bottom, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 8) },
      })}
    >
      {tabs.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} component={tabComponent(t.component)} options={{ title: t.label ?? t.name, tabBarIcon: ({ focused }) => <TabIcon icon={t.icon} focused={focused} /> }} />
      ))}
    </Tabs.Navigator>
  );
}

const sharedStack = [
  // Staff check-in and check-out (route CheckIn; the Attendance tab is student attendance).
  ['CheckIn', AttendanceScreen],
  ['AttendanceResult', AttendanceResultScreen],
  ['Lesson', LessonScreen],
  ['Timetable', MyTimetableScreen],
  ['Teaching', MyTeachingScreen],
  ['MySubjects', MySubjectsScreen],
  ['ExamDuties', ExamDutiesScreen],
  ['ExamRoom', ExamRoomScreen],
  ['ExamMarks', ExamMarksScreen],
  ['ExamMarkSheet', ExamMarkSheetScreen],
  ['History', HistoryScreen],
  ['Sync', SyncScreen],
  ['Profile', ProfileScreen],
  ['Settings', SettingsScreen],
  ['About', AboutScreen],
  ['Devices', DevicesScreen],
  ['Notifications', NotificationsScreen],
  ['NotificationDetail', NotificationDetailScreen],
  ['ReminderSettings', ReminderSettingsScreen],
];

function SignedIn() {
  const { colors } = useTheme();
  return (
    <AttendanceProvider>
      <AccountThemeSync />
      <NotificationsProvider>
        <WorkspaceProvider>
          <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }}>
            <Stack.Screen name="Tabs" component={WorkspaceTabs} />
            {sharedStack.map(([name, component]) => (
                <Stack.Screen key={name} name={name} component={component} options={name === 'AttendanceResult' ? { gestureEnabled: false } : undefined} />
              ))}
            {[...accountantStack, ...managerStack].map(([name, component]) => (
              <Stack.Screen key={name} name={name} component={component} />
            ))}
          </Stack.Navigator>
        </WorkspaceProvider>
      </NotificationsProvider>
    </AttendanceProvider>
  );
}

export default function RootNavigator() {
  const { status } = useSession();
  if (status === 'restoring') return <SplashScreen />;
  if (status === 'signedOut') return <SignInScreen />;
  if (status === 'mustChangePassword') return <ChangePasswordScreen />;
  return (
    <AppLockGate>
      <SignedIn />
    </AppLockGate>
  );
}

const styles = StyleSheet.create({
  tabIcon: { width: 44, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
