/*
 * Read-only details and lists of the Fee Management module on the phone: a payment and its receipt,
 * an invoice, fee structures, discounts and scholarships, and the reports. Changes to structures,
 * policies and invoices stay in the web app (where the School Owner or authorised users make them);
 * the server decides what each account may see. Online only.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { userMessage } from '../../api/errors';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Badge, Card, Divider, ListRow, LoadingView, Notice, Screen, ScreenHeader } from '../../components/ui';
import { loadInvoice, loadInvoices, loadPayment, loadPolicies, loadReport, loadStructures, loadStudentDiscounts, REPORTS } from '../../fees/feeApi';
import { cellText, formatMoney, formatRate } from '../../fees/feeFormat';
import { formatDayTime } from '../../lib/format';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { ServerList, useFeeWorkspace } from './feeCommon';

/** Loads one server answer for a detail screen (online only). */
function useServer(loader, deps) {
  const { api } = useSession();
  const ws = useFeeWorkspace();
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      setState({ data: await loader(api, ws), error: null, loading: false });
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, ws, ...deps]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return { ...state, load };
}

function DetailFrame({ title, subtitle, navigation, state, children }) {
  return (
    <Screen>
      <ScreenHeader title={title} subtitle={subtitle} onBack={() => navigation.goBack()} />
      {!state.data && state.loading ? <LoadingView /> : null}
      <ScrollView contentContainerStyle={{ padding: space(5), paddingTop: 0, gap: space(3) }} refreshControl={<RefreshControl refreshing={state.loading && Boolean(state.data)} onRefresh={state.load} />}>
        {state.error ? <Notice title="Could not load from the server" message={`${userMessage(state.error)} Fee information is not kept on this phone.`} onRetry={state.load} /> : null}
        {state.data ? children(state.data) : null}
      </ScrollView>
    </Screen>
  );
}

export function PaymentDetailScreen({ navigation, route }) {
  const { colors } = useTheme();
  const state = useServer((api, ws) => loadPayment(api, ws, route.params.paymentId), [route.params.paymentId]);
  const p = state.data?.payment ?? state.data;
  return (
    <DetailFrame title="Payment" subtitle={p?.receipt?.number} navigation={navigation} state={state}>
      {() => (
        <Card style={{ gap: space(1) }}>
          <AppText variant="section">{formatMoney(p.amount, state.data.currency)}</AppText>
          {p.status === 'reversed' ? <Badge label="Reversed" tone="error" /> : null}
          <AppText variant="small" color={colors.fgSecondary}>{`${p.student?.name ?? ''} ${p.student?.studentNumber ? `(${p.student.studentNumber})` : ''}`}</AppText>
          <AppText variant="small" color={colors.fgSecondary}>{`Received ${formatDayTime(p.receivedAt, 'UTC')} by ${p.recordedBy?.name ?? '—'}`}</AppText>
          <AppText variant="small" color={colors.fgSecondary}>{`Receipt ${p.receipt?.number ?? '—'}${p.receipt?.void ? ' (void)' : ''}`}</AppText>
          {p.reversalReason ? <AppText variant="small" color={colors.errorFg}>{`Reversal: ${p.reversalReason}`}</AppText> : null}
          {(p.allocations ?? []).map((a) => (
            <AppText key={a.id ?? a.obligationId} variant="small">{`${a.period ?? a.title ?? 'Fee'}: ${formatMoney(a.amount, state.data.currency)}`}</AppText>
          ))}
        </Card>
      )}
    </DetailFrame>
  );
}

export function InvoicesScreen({ navigation }) {
  const { colors } = useTheme();
  return (
    <Screen>
      <ScreenHeader title="Invoices" onBack={() => navigation.goBack()} />
      <ServerList
        testID="fee-invoices"
        load={(api, ws, p) => loadInvoices(api, ws, p)}
        keyOf={(i) => i.id}
        search="Search by invoice number or student"
        emptyTitle="No invoices"
        emptyMessage="Invoices made in the web app appear here."
        renderItem={({ item, meta }) => (
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate('InvoiceDetail', { invoiceId: item.id })}>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <AppText variant="cardTitle">{item.number ?? 'Draft'}</AppText>
                <Badge label={item.status.replace('_', ' ')} tone={item.status === 'paid' ? 'success' : item.status === 'cancelled' ? 'error' : 'info'} />
              </View>
              <AppText variant="small" color={colors.fgSecondary}>{`${item.student?.name ?? ''} · ${item.student?.class ?? ''}`}</AppText>
              <AppText variant="small">{`Total ${formatMoney(item.totals?.total, meta?.currency)} · balance ${formatMoney(item.totals?.balance, meta?.currency)}`}</AppText>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}

export function InvoiceDetailScreen({ navigation, route }) {
  const { colors } = useTheme();
  const state = useServer((api, ws) => loadInvoice(api, ws, route.params.invoiceId), [route.params.invoiceId]);
  const inv = state.data?.invoice ?? state.data;
  return (
    <DetailFrame title={inv?.number ?? 'Invoice'} subtitle={inv?.student?.name} navigation={navigation} state={state}>
      {() => (
        <>
          <Card style={{ gap: space(1) }}>
            <Badge label={inv.status.replace('_', ' ')} tone="info" />
            <AppText variant="small" color={colors.fgSecondary}>{`Total ${formatMoney(inv.totals.total, inv.currency)} · paid ${formatMoney(inv.totals.paid, inv.currency)}`}</AppText>
            <AppText variant="cardTitle">{`Balance ${formatMoney(inv.totals.balance, inv.currency)}`}</AppText>
          </Card>
          {(inv.lines ?? []).map((l, i) => (
            <Card key={l.id ?? i}>
              <AppText variant="cardTitle">{l.title ?? l.period ?? 'Fee'}</AppText>
              <AppText variant="small" color={colors.fgSecondary}>{formatMoney(l.currentAmount ?? l.amount, inv.currency)}</AppText>
            </Card>
          ))}
        </>
      )}
    </DetailFrame>
  );
}

export function FeeStructuresScreen({ navigation }) {
  const { colors } = useTheme();
  const state = useServer((api, ws) => loadStructures(api, ws), []);
  return (
    <DetailFrame title="Fee Structures" subtitle={state.data?.academicYear?.name} navigation={navigation} state={state}>
      {(d) =>
        d.items.length ? (
          d.items.map((s) => (
            <Card key={s.id ?? s.class.id}>
              <AppText variant="cardTitle">{s.class.name}</AppText>
              <AppText variant="small" color={colors.fgSecondary}>{`Monthly ${formatMoney(s.monthlyFee, d.currency)}${s.examFee ? ` · exam fee up to ${formatMoney(s.examFee, d.currency)}` : ''}`}</AppText>
            </Card>
          ))
        ) : (
          <Notice tone="info" message="No fee structures for this year yet. The School Owner sets them in the web app." />
        )
      }
    </DetailFrame>
  );
}

export function DiscountsScreen({ navigation }) {
  const { colors } = useTheme();
  const state = useServer(async (api, ws) => ({ policies: await loadPolicies(api, ws), students: await loadStudentDiscounts(api, ws, { pageSize: 50 }) }), []);
  return (
    <DetailFrame title="Discounts & Scholarships" navigation={navigation} state={state}>
      {(d) => (
        <>
          <AppText variant="label" color={colors.fgSecondary}>
            Policies
          </AppText>
          {d.policies.items.map((p) => (
            <Card key={p.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <AppText variant="cardTitle" style={{ flex: 1 }}>
                  {p.name}
                </AppText>
                <Badge label={p.category} tone="neutral" />
              </View>
              <AppText variant="small" color={colors.fgSecondary}>{p.type === 'percentage' ? formatRate(p.value) : formatMoney(p.value, d.policies.currency)}</AppText>
            </Card>
          ))}
          <AppText variant="label" color={colors.fgSecondary}>
            Students
          </AppText>
          {d.students.items.map((s) => (
            <Card key={s.id}>
              <AppText variant="cardTitle">{s.student.name}</AppText>
              <AppText variant="small" color={colors.fgSecondary}>{`${s.policy.name} · ${s.startMonth}${s.endMonth ? ` to ${s.endMonth}` : ''}${s.active ? '' : ' · revoked'}`}</AppText>
            </Card>
          ))}
        </>
      )}
    </DetailFrame>
  );
}

export function FeeReportsScreen({ navigation }) {
  return (
    <Screen>
      <ScreenHeader title="Reports" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: space(5), paddingTop: 0 }}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {REPORTS.map(([name, label], i) => (
            <View key={name}>
              {i ? <Divider /> : null}
              <ListRow testID={`report-${name}`} icon="bar-chart-outline" label={label} onPress={() => navigation.navigate('FeeReport', { name, label })} />
            </View>
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}

export function FeeReportScreen({ navigation, route }) {
  const { colors } = useTheme();
  const state = useServer((api, ws) => loadReport(api, ws, route.params.name, {}), [route.params.name]);
  return (
    <DetailFrame title={route.params.label} subtitle="Live from the server" navigation={navigation} state={state}>
      {(r) => (
        <>
          {r.summary ? (
            <Card style={{ gap: space(1) }}>
              {Object.entries(r.summary).map(([k, v]) => (
                <AppText key={k} variant="small">{`${k}: ${k === 'rate' ? formatRate(v) : typeof v === 'number' ? formatMoney(v, r.currency) : v}`}</AppText>
              ))}
            </Card>
          ) : null}
          {(r.rows ?? []).slice(0, 200).map((row, i) => (
            <Card key={i} style={{ gap: 2 }}>
              {(r.columns ?? []).map((c, j) => (
                <View key={c.key} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(2) }}>
                  <AppText variant={j === 0 ? 'cardTitle' : 'caption'} color={j === 0 ? undefined : colors.fgSecondary}>
                    {j === 0 ? cellText(c, row[c.key], r.currency) : c.label}
                  </AppText>
                  {j === 0 ? null : <AppText variant="small">{cellText(c, row[c.key], r.currency)}</AppText>}
                </View>
              ))}
            </Card>
          ))}
          {(r.rows ?? []).length > 200 ? <Notice tone="info" message="The first 200 rows are shown. Download the full report in the web app." /> : null}
          {!(r.rows ?? []).length ? <Notice tone="info" message="Nothing to report for this period." /> : null}
        </>
      )}
    </DetailFrame>
  );
}
