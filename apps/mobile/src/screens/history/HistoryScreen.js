/*
 * 10. Attendance history: the staff member's recorded check-ins and check-outs this week or this
 * month (GET /api/attendance/history). Only recorded events are listed: ABSENT and EXCUSED are not
 * calculated yet, so a day without events is not shown as absent.
 */
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { fetchHistory } from '../../api/endpoints';
import { userMessage } from '../../api/errors';
import { historyRange, useAttendance } from '../../attendance/AttendanceProvider';
import { useSession } from '../../auth/SessionProvider';
import { STATUS_LABEL, STATUS_TONE } from '../../components/attendance';
import { AppText, Badge, Card, EmptyState, Icon, LoadingView, Notice, Screen } from '../../components/ui';
import { formatDay, formatTime } from '../../lib/format';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';

/** Events (newest first) → one row per work date with its check-ins and check-outs in time order. */
export function groupByDay(events) {
  const days = new Map();
  for (const e of events) {
    if (!days.has(e.workDate)) days.set(e.workDate, []);
    days.get(e.workDate).push(e);
  }
  return [...days.entries()].map(([date, list]) => ({ date, events: [...list].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)) }));
}

export default function HistoryScreen({ navigation }) {
  const { colors } = useTheme();
  const { api } = useSession();
  const { today, pendingCount } = useAttendance();
  const [tab, setTab] = useState('week');
  const [state, setState] = useState({ loading: true, error: null, days: [] });
  const zone = today?.timeZone;

  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const request = zone ? fetchHistory(api, historyRange(tab, new Date(), zone)) : Promise.reject(new Error('no-day'));
    request.then(
      (data) => !cancelled && setState({ loading: false, error: null, days: groupByDay(data.events) }),
      (error) => !cancelled && setState({ loading: false, error, days: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, tab, zone, attempt]);

  const selectTab = (key) => {
    if (key === tab) return;
    setState({ loading: true, error: null, days: [] });
    setTab(key);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="section" accessibilityRole="header">
          Attendance History
        </AppText>
      </View>
      <View style={[styles.segment, { backgroundColor: colors.muted }]} accessibilityRole="tablist">
        {[
          ['week', 'This Week'],
          ['month', 'This Month'],
        ].map(([key, label]) => {
          const selected = tab === key;
          return (
            <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => selectTab(key)} style={[styles.segmentItem, selected && { backgroundColor: colors.scheme === 'light' ? colors.primary : colors.interactive }]}>
              <AppText variant="label" color={selected ? '#FFFFFF' : colors.fgSecondary} style={{ fontWeight: '600' }}>
                {label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {pendingCount ? (
        <Pressable onPress={() => navigation.navigate('Sync')} accessibilityRole="button" style={{ marginHorizontal: space(5), marginBottom: space(2) }}>
          <Notice tone="info" message={`${pendingCount} event${pendingCount > 1 ? 's are' : ' is'} waiting to upload and not listed yet. Tap to see sync status.`} />
        </Pressable>
      ) : null}
      {state.loading && !state.days.length ? (
        <LoadingView label="Loading history…" />
      ) : state.error ? (
        <View style={{ padding: space(5) }}>
          <Notice tone="error" title="History couldn’t be loaded" message={state.error.message === 'no-day' ? 'Connect to the internet to load your history.' : userMessage(state.error)} onRetry={load} />
        </View>
      ) : (
        <FlatList
          data={state.days}
          keyExtractor={(d) => d.date}
          contentContainerStyle={{ padding: space(5), paddingTop: space(2), flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={state.loading} onRefresh={load} tintColor={colors.accent} colors={[colors.accent]} />}
          ItemSeparatorComponent={() => <View style={{ height: space(2) }} />}
          ListEmptyComponent={<EmptyState title="No attendance recorded" message={tab === 'week' ? 'You have no check-ins this week.' : 'You have no check-ins this month.'} />}
          renderItem={({ item }) => <DayRow day={item} zone={zone} />}
        />
      )}
    </Screen>
  );
}

function DayRow({ day, zone }) {
  const { colors } = useTheme();
  const checkIn = day.events.find((e) => e.type === 'CHECK_IN');
  const checkOut = [...day.events].reverse().find((e) => e.type === 'CHECK_OUT');
  const status = checkIn?.status;
  const tone = STATUS_TONE[status] ?? 'info';
  return (
    <Card style={styles.dayRow}>
      <Icon name={status === 'LATE' ? 'time' : 'checkmark-circle'} size={26} color={colors[tone]} />
      <View style={{ flex: 1, marginLeft: space(3) }} accessible>
        <AppText variant="cardTitle">{formatDay(day.date)}</AppText>
        <AppText variant="small" color={colors.fgSecondary}>
          {checkIn ? `Checked in ${formatTime(checkIn.occurredAt, zone)}` : 'No check-in'}
        </AppText>
        {checkOut ? (
          <AppText variant="small" color={colors.fgSecondary}>
            Checked out {formatTime(checkOut.occurredAt, zone)}
          </AppText>
        ) : null}
        {day.events.filter((e) => e.type === 'CHECK_IN').length > 1 ? (
          <AppText variant="caption" color={colors.fgMuted}>
            {day.events.filter((e) => e.type === 'CHECK_IN').length} shifts
          </AppText>
        ) : null}
      </View>
      {status ? <Badge label={STATUS_LABEL[status]} tone={tone} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space(5), paddingVertical: space(3) },
  segment: { flexDirection: 'row', marginHorizontal: space(5), marginBottom: space(3), borderRadius: radius.md, padding: 4 },
  segmentItem: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  dayRow: { flexDirection: 'row', alignItems: 'center' },
});
