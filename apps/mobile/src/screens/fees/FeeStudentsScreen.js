/*
 * Students tab of the Accountant workspace: student fee accounts of the current year in the
 * account's scope (GET /fees/students), searchable by name or number. Online only.
 */
import { Pressable, View } from 'react-native';
import { AppText, Badge, Card } from '../../components/ui';
import { loadAccounts } from '../../fees/feeApi';
import { formatMoney } from '../../fees/feeFormat';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { ServerList } from './feeCommon';

const TONE = { cleared: 'success', partial: 'info', outstanding: 'warning', overdue: 'error', none: 'neutral' };
const LABEL = { cleared: 'Cleared', partial: 'Partly paid', outstanding: 'Outstanding', overdue: 'Overdue', none: 'No fees' };

export default function FeeStudentsScreen({ navigation }) {
  const { colors } = useTheme();
  return (
    <ServerList
      testID="fee-students"
      load={(api, ws, p) => loadAccounts(api, ws, p)}
      keyOf={(r) => r.student.id}
      search="Search by name or student number"
      emptyTitle="No students found"
      emptyMessage="Students enrolled this year appear here with their fee balances."
      renderItem={({ item, meta }) => (
        <Pressable accessibilityRole="button" testID={`fee-student-${item.student.id}`} onPress={() => navigation.navigate('FeeStudent', { studentId: item.student.id, name: item.student.name })}>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(2) }}>
              <AppText variant="cardTitle" style={{ flex: 1 }} numberOfLines={1}>
                {item.student.name}
              </AppText>
              <Badge label={LABEL[item.status] ?? item.status} tone={TONE[item.status] ?? 'neutral'} />
            </View>
            <AppText variant="small" color={colors.fgSecondary}>
              {`${item.student.studentNumber} · ${item.section.displayName}`}
            </AppText>
            <AppText variant="small" color={item.totals.overdue ? colors.errorFg : colors.fgSecondary} style={{ marginTop: space(1) }}>
              {`Balance ${formatMoney(item.totals.balance, meta?.currency)}${item.totals.overdue ? ` · overdue ${formatMoney(item.totals.overdue, meta?.currency)}` : ''}`}
            </AppText>
          </Card>
        </Pressable>
      )}
    />
  );
}
