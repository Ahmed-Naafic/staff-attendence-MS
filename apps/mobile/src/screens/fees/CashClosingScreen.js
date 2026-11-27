/*
 * Cash closing (online only, never queued): the cash this account received since its last closing
 * (GET /fees/closings/mine), counted and closed with POST /fees/closings. The expected amount shown
 * is sent with the closing; if payments changed meanwhile the server refuses and asks to count
 * again. A difference needs an explanation (the server's rule). Recent closings are listed.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { userMessage } from '../../api/errors';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Button, Card, LoadingView, Notice, Screen, ScreenHeader, TextField } from '../../components/ui';
import { closeCash, loadMyClosing } from '../../fees/feeApi';
import { formatMoney, parseAmount } from '../../fees/feeFormat';
import { formatDayTime } from '../../lib/format';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { useFeeWorkspace, useOnlineOnly } from './feeCommon';

export default function CashClosingScreen({ navigation }) {
  const { api } = useSession();
  const ws = useFeeWorkspace();
  const guard = useOnlineOnly();
  const { colors } = useTheme();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [counted, setCounted] = useState('');
  const [explanation, setExplanation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await loadMyClosing(api, ws));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [api, ws]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!data && !error) return <LoadingView />;
  const cur = data?.currency ?? 'USD';
  const expected = data?.open.expectedAmount ?? 0;
  const countedCents = counted === '0' ? 0 : parseAmount(counted, cur);
  const difference = countedCents === null ? null : countedCents - expected;

  async function close() {
    setMessage(null);
    const blocked = await guard();
    if (blocked) return setMessage({ tone: 'error', text: blocked });
    setBusy(true);
    try {
      await closeCash(api, ws, { counted: countedCents, explanation: explanation.trim() || null, expected });
      setCounted('');
      setExplanation('');
      await load();
      setMessage({ tone: 'success', text: 'Cash closed. The server recorded your closing.' });
    } catch (e) {
      setMessage({ tone: 'error', text: userMessage(e) });
      if (e?.code === 'EXPECTED_CHANGED') load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScreenHeader title="Cash Closing" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: space(5), paddingTop: 0, gap: space(3) }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        {error ? <Notice title="Could not load your cash" message={userMessage(error)} onRetry={load} /> : null}
        {data ? (
          <>
            <Card style={{ gap: space(1) }}>
              <AppText variant="label" color={colors.fgSecondary}>
                Expected cash
              </AppText>
              <AppText variant="section" testID="expected-cash">
                {formatMoney(expected, cur)}
              </AppText>
              <AppText variant="small" color={colors.fgSecondary}>
                {`${data.open.paymentsCount} payment${data.open.paymentsCount === 1 ? '' : 's'}${data.open.reversalsCount ? `, ${data.open.reversalsCount} reversal${data.open.reversalsCount === 1 ? '' : 's'}` : ''}${data.open.since ? ` since ${formatDayTime(data.open.since, 'UTC')}` : ''}`}
              </AppText>
            </Card>
            {data.closedToday ? <Notice tone="info" message="You have already closed your cash today. Closing again starts a new period." /> : null}
            <TextField testID="counted-cash" label="Cash counted" icon="calculator-outline" value={counted} onChangeText={setCounted} keyboardType="decimal-pad" error={counted && countedCents === null ? 'Enter the amount, e.g. 120.00' : null} />
            {difference ? (
              <>
                <Notice tone="warning" message={`${difference < 0 ? 'Shortage' : 'Surplus'} of ${formatMoney(Math.abs(difference), cur)}. Explain the difference.`} />
                <TextField testID="closing-explanation" label="Explanation" icon="create-outline" value={explanation} onChangeText={setExplanation} />
              </>
            ) : null}
            {message ? <Notice tone={message.tone} message={message.text} /> : null}
            <Button testID="close-cash" title="Close cash" icon="lock-closed-outline" loading={busy} disabled={countedCents === null || busy || (difference !== 0 && !explanation.trim())} onPress={close} />
            <AppText variant="caption" color={colors.fgMuted}>
              Cash closing needs a connection and is never saved on this phone to send later.
            </AppText>
            {data.recent?.length ? (
              <>
                <AppText variant="label" color={colors.fgSecondary}>
                  Recent closings
                </AppText>
                {data.recent.map((c) => (
                  <Card key={c.id}>
                    <AppText variant="cardTitle">{`${formatMoney(c.countedAmount ?? c.counted, cur)} counted`}</AppText>
                    <AppText variant="small" color={colors.fgSecondary}>{`${c.closingDate ?? ''} · expected ${formatMoney(c.expectedAmount ?? c.expected, cur)}`}</AppText>
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
