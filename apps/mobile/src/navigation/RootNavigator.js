/*
 * Navigation by session state: splash while restoring, sign-in when signed out, only the password
 * change while a temporary password is in use, and the attendance screens for a ready STAFF
 * session. Signed-in screens are never mounted without a session.
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AttendanceProvider } from '../attendance/AttendanceProvider';
import { useSession } from '../auth/SessionProvider';
import { Icon } from '../components/ui';
import AttendanceResultScreen from '../screens/attendance/AttendanceResultScreen';
import AttendanceScreen from '../screens/attendance/AttendanceScreen';
import ChangePasswordScreen from '../screens/auth/ChangePasswordScreen';
import SignInScreen from '../screens/auth/SignInScreen';
import SplashScreen from '../screens/auth/SplashScreen';
import HistoryScreen from '../screens/history/HistoryScreen';
import HomeScreen from '../screens/home/HomeScreen';
import NotificationDetailScreen from '../screens/notifications/NotificationDetailScreen';
import NotificationsScreen from '../screens/notifications/NotificationsScreen';
import ReminderSettingsScreen from '../screens/notifications/ReminderSettingsScreen';
import { NotificationsProvider } from '../notifications/NotificationsProvider';
import AboutScreen from '../screens/profile/AboutScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import SettingsScreen from '../screens/profile/SettingsScreen';
import SyncScreen from '../screens/sync/SyncScreen';
import { useTheme } from '../theme/ThemeProvider';
import { radius } from '../theme/tokens';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

const TAB_ICONS = { Home: 'home', History: 'time', Profile: 'person' };

function TabIcon({ route, focused }) {
  const { colors } = useTheme();
  const name = TAB_ICONS[route.name];
  return (
    <View style={[styles.tabIcon, focused && { backgroundColor: colors.accentSoft }]}>
      <Icon name={focused ? name : `${name}-outline`} size={22} color={focused ? colors.accent : colors.fgSecondary} />
    </View>
  );
}

function MainTabs() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused }) => <TabIcon route={route} focused={focused} />,
        tabBarActiveTintColor: colors.fg,
        tabBarInactiveTintColor: colors.fgSecondary,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 64 + insets.bottom, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 8) },
      })}
    >
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="History" component={HistoryScreen} />
      <Tabs.Screen name="Profile" component={ProfileScreen} />
    </Tabs.Navigator>
  );
}

function SignedIn() {
  const { colors } = useTheme();
  return (
    <AttendanceProvider>
      <NotificationsProvider>
        <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }}>
          <Stack.Screen name="Tabs" component={MainTabs} />
          <Stack.Screen name="Attendance" component={AttendanceScreen} />
          <Stack.Screen name="AttendanceResult" component={AttendanceResultScreen} options={{ gestureEnabled: false }} />
          <Stack.Screen name="Sync" component={SyncScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="About" component={AboutScreen} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} />
          <Stack.Screen name="NotificationDetail" component={NotificationDetailScreen} />
          <Stack.Screen name="ReminderSettings" component={ReminderSettingsScreen} />
        </Stack.Navigator>
      </NotificationsProvider>
    </AttendanceProvider>
  );
}

export default function RootNavigator() {
  const { status } = useSession();
  if (status === 'restoring') return <SplashScreen />;
  if (status === 'signedOut') return <SignInScreen />;
  if (status === 'mustChangePassword') return <ChangePasswordScreen />;
  return <SignedIn />;
}

const styles = StyleSheet.create({
  tabIcon: { width: 44, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
