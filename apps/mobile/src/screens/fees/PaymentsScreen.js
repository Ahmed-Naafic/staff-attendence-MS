/*
 * Payments tab (GET /fees/payments) and Receipts (the same payments by receipt number), newest
 * first, searchable. "Record payment" starts from a student. Online only.
 */
import { Pressable, View } from 'react-native';
import { AppText, Badge, Button, Card } from '../../components/ui';
import { loadPayments } from '../../fees/feeApi';
import { formatMoney } from '../../fees/feeFormat';
import { formatDayTime } from '../../lib/format';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { ServerList } from './feeCommon';

function PaymentList({ navigation, receipts = false }) {
  const { colors } = useTheme();
  return (
    <ServerList
      testID={receipts ? 'fee-receipts' : 'fee-payments'}
      load={(api, ws, p) => loadPayments(api, ws, p)}
      keyOf={(p) => p.id}
      search={receipts ? 'Search by receipt number or student' : 'Search by student or receipt'}
      emptyTitle={receipts ? 'No receipts' : 'No payments'}
      emptyMessage="Payments recorded in your scope appear here."
      header={receipts ? null : <Button testID="new-payment" title="Record payment" icon="add-circle-outline" onPress={() => navigation.navigate('FeeStudents')} />}
      renderItem={({ item, meta }) => (
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('PaymentDetail', { paymentId: item.id })}>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(2) }}>
              <AppText variant="cardTitle" style={{ flex: 1 }} numberOfLines={1}>
                {receipts ? (item.receipt?.number ?? '—') : formatMoney(item.amount, meta?.currency)}
              </AppText>
              {item.status === 'reversed' ? <Badge label="Reversed" tone="error" /> : item.receipt?.void ? <Badge label="Void" tone="error" /> : null}
            </View>
            <AppText variant="small" color={colors.fgSecondary} numberOfLines={1}>
              {`${item.student?.name ?? ''} · ${receipts ? formatMoney(item.amount, meta?.currency) : (item.receipt?.number ?? '')}`}
            </AppText>
            <AppText variant="caption" color={colors.fgMuted}>
              {`${formatDayTime(item.receivedAt, 'UTC')} · ${item.recordedBy?.name ?? ''}`}
            </AppText>
          </Card>
        </Pressable>
      )}
    />
  );
}

export default function PaymentsScreen(props) {
  return <PaymentList {...props} />;
}

export function ReceiptsScreen(props) {
  return <PaymentList {...props} receipts />;
}
