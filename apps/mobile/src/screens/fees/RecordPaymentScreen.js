/*
 * Record a cash payment (online only, never queued; docs/mobile/workspaces.md → Accountant). The
 * amount is spread over the open fees, oldest due first; the server checks the allocations and the
 * partial-payment policy and decides. The request key is made once for this payment and sent with
 * every try: if the answer is lost, trying again returns the first payment (never a second one).
 * Only the server's answer with a receipt number is shown as a recorded payment.
 */
import * as Crypto from 'expo-crypto';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { ApiError } from '../../api/client';
import { userMessage } from '../../api/errors';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Button, Card, LoadingView, Notice, Screen, ScreenHeader, TextField } from '../../components/ui';
import { loadPayable, recordPayment } from '../../fees/feeApi';
import { allocate, formatMoney, parseAmount } from '../../fees/feeFormat';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { useFeeWorkspace, useOnlineOnly } from './feeCommon';

export default function RecordPaymentScreen({ navigation, route }) {
  const { studentId } = route.params;
  const { api } = useSession();
  const ws = useFeeWorkspace();
  const guard = useOnlineOnly();
  const { colors } = useTheme();
  const [payable, setPayable] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [done, setDone] = useState(null);
  // One key per payment on this screen (kept while the amount and fees stay the same).
  const keyRef = useRef(null);
  const keyFor = useRef('');

  const load = useCallback(async () => {
    try {
      setPayable(await loadPayable(api, ws, studentId));
      setLoadError(null);
    } catch (e) {
      setLoadError(e);
    }
  }, [api, ws, studentId]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!payable && !loadError) return <LoadingView />;
  const cur = payable?.currency ?? 'USD';
  const amount = parseAmount(amountText, cur);
  const plan = payable && amount ? allocate(amount, payable.items) : null;
  const tooMuch = plan && plan.rest > 0;

  async function submit() {
    setProblem(null);
    const blocked = await guard();
    if (blocked) return setProblem(blocked);
    const signature = JSON.stringify({ amount, allocations: plan.allocations });
    if (!keyRef.current || keyFor.current !== signature) {
      keyRef.current = Crypto.randomUUID();
      keyFor.current = signature;
    }
    setBusy(true);
    try {
      const result = await recordPayment(api, ws, { studentId, amount, allocations: plan.allocations, note: note.trim() || null, requestKey: keyRef.current });
      setDone(result.payment);
    } catch (e) {
      const unanswered = e instanceof ApiError && e.retryable;
      setProblem(unanswered ? `${userMessage(e)} The payment may or may not have been recorded. Tap Record payment again: it is sent with the same request, so it can never be recorded twice.` : userMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <ScreenHeader title="Payment recorded" onBack={() => navigation.goBack()} />
        <View style={{ padding: space(5), gap: space(3) }}>
          <Notice tone="success" title={`Receipt ${done.receipt?.number ?? ''}`} message={`${formatMoney(done.amount, cur)} recorded by the server for ${payable.student.name}.`} />
          <Button title="Done" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title="Record payment" subtitle={payable?.student?.name} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: space(5), paddingTop: 0, gap: space(3) }} keyboardShouldPersistTaps="handled">
        {loadError ? <Notice title="Could not load the open fees" message={userMessage(loadError)} onRetry={load} /> : null}
        {payable ? (
          <>
            <Card>
              <AppText variant="small" color={colors.fgSecondary}>
                Outstanding
              </AppText>
              <AppText variant="section">{formatMoney(payable.totals.outstanding, cur)}</AppText>
            </Card>
            <TextField testID="payment-amount" label="Cash received" icon="cash-outline" value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad" error={amountText && !amount ? 'Enter an amount, e.g. 25.00' : tooMuch ? 'More than the outstanding fees.' : null} />
            <TextField testID="payment-note" label="Note (optional)" icon="create-outline" value={note} onChangeText={setNote} />
            {plan && !tooMuch ? (
              <Card style={{ gap: space(1) }}>
                <AppText variant="label" color={colors.fgSecondary}>
                  Pays
                </AppText>
                {plan.allocations.map((a) => {
                  const o = payable.items.find((x) => x.id === a.obligationId);
                  return <AppText key={a.obligationId} variant="small">{`${o.period}: ${formatMoney(a.amount, cur)}${a.amount < o.balance ? ' (part)' : ''}`}</AppText>;
                })}
              </Card>
            ) : null}
            {problem ? <Notice title="Not recorded" message={problem} /> : null}
            <Button testID="confirm-payment" title="Record payment" icon="checkmark" loading={busy} disabled={!plan || tooMuch || busy} onPress={submit} />
            <AppText variant="caption" color={colors.fgMuted}>
              Payments are recorded only with a connection and are never saved on this phone to send later.
            </AppText>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
