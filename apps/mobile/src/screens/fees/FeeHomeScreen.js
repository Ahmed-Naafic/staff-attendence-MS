/*
 * The Accountant dashboard (also Fee Management for Managers): today's cash to close, the year's
 * fee figures, overdue students and quick actions. Read from GET /fees/overview and
 * /fees/closings/mine. A short-lived copy (24 hours) is kept for offline viewing and is always
 * labelled as saved, not live and not confirmed.
 */
import { RefreshControl, ScrollView, View } from 'react-native';
import { loadMyClosing, loadOverview } from '../../fees/feeApi';
import { formatMoney, formatRate } from '../../fees/feeFormat';
import { Freshness, QuickActions, SectionTitle, SkeletonGrid, StatGrid } from '../../components/dashboard';
import { AppText, Card, Notice, Screen, ScreenHeader } from '../../components/ui';
import { userMessage } from '../../api/errors';
import { useCachedResource } from '../../lib/useCachedResource';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { useFeeWorkspace } from './feeCommon';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function FeeHomeScreen({ navigation }) {
  const { colors } = useTheme();
  const ws = useFeeWorkspace();
  const resource = useCachedResource(
    `fees-home:${ws}`,
    async (api) => {
      const [overview, closing] = await Promise.all([loadOverview(api, ws), loadMyClosing(api, ws).catch(() => null)]);
      return { overview, closing };
    },
    { maxAgeMs: DAY_MS, deps: [ws] },
  );
  const d = resource.data?.overview;
  const closing = resource.data?.closing;
  const cur = d?.currency ?? closing?.currency ?? 'USD';
  const k = d?.kpis;
  const stats = [
    ...(closing ? [{ key: 'to-close', label: 'Cash to close', value: formatMoney(closing.open.expectedAmount, cur), icon: 'wallet-outline', tone: closing.open.paymentsCount ? 'warning' : undefined }] : []),
    ...(k
      ? [
          { key: 'today', label: `Received today (${k.paymentsToday})`, value: formatMoney(k.receivedToday, cur), icon: 'cash-outline' },
          { key: 'collected', label: `Collected · ${formatRate(k.rate)}`, value: formatMoney(k.collected, cur), icon: 'trending-up-outline', tone: 'success' },
          { key: 'outstanding', label: 'Outstanding', value: formatMoney(k.outstanding, cur), icon: 'hourglass-outline' },
          { key: 'overdue', label: 'Overdue', value: formatMoney(k.overdue, cur), icon: 'alert-circle-outline', tone: k.overdue ? 'error' : undefined },
        ]
      : []),
  ];
  const actions = [
    { key: 'pay', label: 'Record payment', icon: 'add-circle-outline', onPress: () => navigation.navigate('FeeStudents') },
    { key: 'close', label: 'Cash closing', icon: 'lock-closed-outline', onPress: () => navigation.navigate('CashClosing') },
    { key: 'reports', label: 'Reports', icon: 'bar-chart-outline', onPress: () => navigation.navigate('FeeReports') },
  ];
  return (
    <Screen>
      {navigation.getState?.().type === 'stack' ? <ScreenHeader title="Fee Management" onBack={() => navigation.goBack()} /> : null}
      <ScrollView contentContainerStyle={{ padding: space(5), gap: space(3) }} refreshControl={<RefreshControl refreshing={resource.loading && Boolean(resource.data)} onRefresh={resource.reload} />}>
        <AppText variant="section">Fee Management</AppText>
        {resource.data ? <Freshness resource={resource} financial /> : null}
        {!resource.data && resource.error ? <Notice title="Fee figures could not be loaded" message={userMessage(resource.error)} onRetry={resource.reload} /> : null}
        {resource.data ? <StatGrid items={stats} /> : resource.loading ? <SkeletonGrid count={5} /> : null}
        <QuickActions items={actions} />
        {d?.overdueStudents?.length ? (
          <View>
            <SectionTitle>Most overdue</SectionTitle>
            <Card style={{ gap: space(2) }}>
              {d.overdueStudents.slice(0, 5).map((s) => (
                <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(2) }}>
                  <AppText variant="small" style={{ flex: 1 }} numberOfLines={1}>
                    {`${s.name} · ${s.class ?? ''}`}
                  </AppText>
                  <AppText variant="small" color={colors.errorFg}>
                    {`${formatMoney(s.overdue, cur)} · ${s.daysOverdue}d`}
                  </AppText>
                </View>
              ))}
            </Card>
          </View>
        ) : null}
        {d && !d.academicYear ? <Notice tone="info" message="No academic year is current, so there are no fees to show yet." /> : null}
      </ScrollView>
    </Screen>
  );
}
