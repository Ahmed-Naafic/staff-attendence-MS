/*
 * "More" tab of every workspace: the workspace's other features, then the shared ones
 * (notifications, sync status, profile and settings). Only features of the open workspace are
 * listed; the server still checks every request.
 */
import { ScrollView, StyleSheet, View } from 'react-native';
import { useAttendance } from '../../attendance/AttendanceProvider';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Card, Divider, ListRow, Screen } from '../../components/ui';
import { useNotifications } from '../../notifications/NotificationsProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { useWorkspace } from '../../workspace/WorkspaceProvider';

/** The workspace features under More: [{ route, label, icon }]. */
export const MORE_ITEMS = {
  teacher: [
    { route: 'MySubjects', label: 'My Subjects', icon: 'library-outline' },
    { route: 'Timetable', label: 'Timetable', icon: 'calendar-outline' },
    { route: 'ExamDuties', label: 'Examinations: invigilation duties', icon: 'clipboard-outline' },
    { route: 'ExamMarks', label: 'Examinations: marks entry', icon: 'create-outline' },
    { route: 'History', label: 'My attendance history', icon: 'time-outline' },
  ],
  accountant: [
    { route: 'FeeStructures', label: 'Fee Structures', icon: 'layers-outline' },
    { route: 'Invoices', label: 'Invoices', icon: 'document-text-outline' },
    { route: 'Receipts', label: 'Receipts', icon: 'receipt-outline' },
    { route: 'Discounts', label: 'Discounts & Scholarships', icon: 'pricetags-outline' },
    { route: 'CashClosing', label: 'Cash Closing', icon: 'lock-closed-outline' },
    { route: 'FeeReports', label: 'Reports', icon: 'bar-chart-outline' },
  ],
  manager: [
    { route: 'ManagerStaff', label: 'Staff', icon: 'people-outline' },
    { route: 'ManagerClasses', label: 'Classes', icon: 'school-outline' },
    { route: 'ManagerTimetable', label: 'Timetables', icon: 'calendar-outline' },
    { route: 'ManagerExams', label: 'Examinations', icon: 'clipboard-outline' },
    { route: 'FeeOverview', label: 'Fee Management', icon: 'cash-outline' },
    { route: 'ManagerDevices', label: 'Staff devices', icon: 'phone-portrait-outline' },
  ],
};

export default function MoreScreen({ navigation }) {
  const { colors } = useTheme();
  const { workspace } = useWorkspace();
  const { user } = useSession();
  const { unreadCount } = useNotifications();
  const { pendingCount, lessonPendingCount } = useAttendance();
  const waiting = (pendingCount ?? 0) + (lessonPendingCount ?? 0);
  const items = MORE_ITEMS[workspace] ?? [];
  const shared = [
    { route: 'Notifications', label: 'Notifications', icon: 'notifications-outline', value: unreadCount ? `${unreadCount} unread` : undefined },
    ...(user?.role === 'STAFF' ? [{ route: 'Sync', label: 'Sync status', icon: 'sync-outline', value: waiting ? `${waiting} waiting` : undefined }] : []),
    { route: 'Devices', label: 'My devices', icon: 'phone-portrait-outline' },
    { route: 'Profile', label: 'Profile', icon: 'person-circle-outline' },
    { route: 'Settings', label: 'Settings', icon: 'settings-outline' },
  ];
  const group = (title, rows) => (
    <View style={{ marginBottom: space(5) }}>
      <AppText variant="label" color={colors.fgSecondary} style={styles.groupLabel}>
        {title}
      </AppText>
      <Card style={styles.list}>
        {rows.map((row, index) => (
          <View key={row.route}>
            {index ? <Divider /> : null}
            <ListRow testID={`more-${row.route}`} icon={row.icon} label={row.label} value={row.value} onPress={() => navigation.navigate(row.route)} />
          </View>
        ))}
      </Card>
    </View>
  );
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {items.length ? group('Workspace', items) : null}
        {group('General', shared)}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space(5) },
  groupLabel: { marginBottom: space(2), marginLeft: space(1) },
  list: { padding: 0, overflow: 'hidden' },
});
