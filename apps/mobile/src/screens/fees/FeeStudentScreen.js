/*
 * One student's fee account: open fees (oldest due first, from GET /fees/students/:id/payable) and
 * recent payments, with Record payment. Online only; nothing is kept on the phone.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { userMessage } from '../../api/errors';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Badge, Button, Card, LoadingView, Notice, Screen, ScreenHeader } from '../../components/ui';
import { loadPayable, loadPayments } from '../../fees/feeApi';
import { formatMoney } from '../../fees/feeFormat';
import { formatDayTime } from '../../lib/format';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { useFeeWorkspace } from './feeCommon';

export default function FeeStudentScreen({ navigation, route }) {
  const { studentId, name } = route.params;
  const { api } = useSession();
  const ws = useFeeWorkspace();
  const { colors } = useTheme();
  const [state, setState] = useState({ payable: null, payments: null, error: null, loading: true });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const [payable, payments] = await Promise.all([loadPayable(api, ws, studentId), loadPayments(api, ws, { student: studentId, pageSize: 10 })]);
      setState({ payable, payments, error: null, loading: false });
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false }));
    }
  }, [api, ws, studentId]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const p = state.payable;
  const cur = p?.currency ?? 'USD';
  return (
    <Screen>
      <ScreenHeader title={p?.student?.name ?? name ?? 'Student'} subtitle={p?.student?.studentNumber} onBack={() => navigation.goBack()} />
      {!p && state.loading ? <LoadingView /> : null}
      <ScrollView contentContainerStyle={{ padding: space(5), paddingTop: 0, gap: space(3) }} refreshControl={<RefreshControl refreshing={state.loading && Boolean(p)} onRefresh={load} />}>
        {state.error ? <Notice title="Could not load from the server" message={`${userMessage(state.error)} Fee information is not kept on this phone.`} onRetry={load} /> : null}
        {p ? (
          <>
            <Card style={{ gap: space(1) }}>
              <AppText variant="label" color={colors.fgSecondary}>
                Outstanding
              </AppText>
              <AppText variant="section">{formatMoney(p.totals.outstanding, cur)}</AppText>
              {p.totals.overdue ? <AppText variant="small" color={colors.errorFg}>{`Overdue ${formatMoney(p.totals.overdue, cur)}`}</AppText> : null}
            </Card>
            {p.items.length ? <Button testID="record-payment" title="Record payment" icon="add-circle-outline" onPress={() => navigation.navigate('RecordPayment', { studentId })} /> : <Notice tone="success" message="Nothing is owed." />}
            <AppText variant="label" color={colors.fgSecondary}>
              Open fees
            </AppText>
            {p.items.map((o) => (
              <Card key={o.id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(2) }}>
                  <AppText variant="cardTitle" style={{ flex: 1 }}>
                    {o.period}
                  </AppText>
                  {o.overdue ? <Badge label="Overdue" tone="error" /> : null}
                </View>
                <AppText variant="small" color={colors.fgSecondary}>
                  {`Due ${o.dueDate} · ${formatMoney(o.netAmount, cur)} · paid ${formatMoney(o.paidAmount, cur)}`}
                </AppText>
                <AppText variant="small" style={{ fontWeight: '600' }}>{`Balance ${formatMoney(o.balance, cur)}`}</AppText>
              </Card>
            ))}
            {state.payments?.items?.length ? (
              <>
                <AppText variant="label" color={colors.fgSecondary}>
                  Recent payments
                </AppText>
                {state.payments.items.map((pay) => (
                  <Card key={pay.id}>
                    <AppText variant="cardTitle">{formatMoney(pay.amount, cur)}</AppText>
                    <AppText variant="small" color={colors.fgSecondary}>
                      {`${formatDayTime(pay.receivedAt, 'UTC')} · ${pay.receipt?.number ?? 'no receipt'}${pay.status === 'reversed' ? ' · reversed' : ''}`}
                    </AppText>
                  </Card>
                ))}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
