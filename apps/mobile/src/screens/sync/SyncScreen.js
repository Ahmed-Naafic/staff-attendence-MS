/*
 * 11. Sync status and history (docs/mobile/offline-sync.md → Sync history): every record made on
 * this phone for this account (attendance events, lesson marks, examination mark drafts) with its
 * type, time, original branch and status: pending, syncing, failed (tried, will be sent again),
 * synced, rejected (with the server's reason). Synced and rejected records are kept for 90 days.
 *
 * "Sync now" sends waiting records again with their stored ids. A rejected record is final; it can
 * be dismissed from this list. Only where the server allows a correction (examination mark drafts)
 * is "Correct and resend" offered: it makes a new record with a new id, and the refused one stays
 * in the history. Attendance events and lesson marks the server refused cannot be resent; a Manager
 * can record attendance instead.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { refusalTitle } from '../../api/errors';
import { useAttendance } from '../../attendance/AttendanceProvider';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Badge, Button, Card, ConfirmDialog, EmptyState, Icon, Notice, Screen, ScreenHeader } from '../../components/ui';
import { formatDayTime, formatDuration } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import { dismissRecord, KEEP_DAYS, syncHistory } from '../../sync/history';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';

const DAY_MS = 24 * 60 * 60 * 1000;
const TABS = [
  ['waiting', 'Waiting'],
  ['synced', 'Synced'],
  ['rejected', 'Rejected'],
];
const STATUS = {
  pending: { label: 'Waiting to upload', tone: 'info', icon: 'cloud-upload-outline' },
  syncing: { label: 'Syncing…', tone: 'info', icon: 'sync-outline' },
  failed: { label: 'Not sent yet, will retry', tone: 'warning', icon: 'alert-circle-outline' },
  synced: { label: 'Synced', tone: 'success', icon: 'checkmark-circle-outline' },
  rejected: { label: 'Not accepted', tone: 'error', icon: 'close-circle' },
};
const inTab = (tab, status) => (tab === 'waiting' ? ['pending', 'syncing', 'failed'].includes(status) : tab === status);

export default function SyncScreen({ navigation }) {
  const { online, syncing, syncNow, today, lastSync, openDatabase, clock, reloadQueue, pendingCount, lessonPendingCount, draftPendingCount } = useAttendance();
  const { user } = useSession();
  const { colors } = useTheme();
  const [tab, setTab] = useState('waiting');
  const [rows, setRows] = useState([]);
  const [dismissing, setDismissing] = useState(null);
  const zone = today?.timeZone ?? 'UTC';

  const load = useCallback(async () => setRows(await syncHistory(await openDatabase(), user.id, { syncing })), [openDatabase, user.id, syncing]);
  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );
  useEffect(() => {
    // Counts change after an upload or a new record.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(() => {});
  }, [load, pendingCount, lessonPendingCount, draftPendingCount]);

  const shown = rows.filter((r) => inTab(tab, r.status));
  const counts = Object.fromEntries(TABS.map(([key]) => [key, rows.filter((r) => inTab(key, r.status)).length]));
  const clockProblem = rows.some((r) => r.status !== 'synced' && r.status !== 'rejected' && r.code === 'CLOCK_SKEW');
  const waiting = counts.waiting > 0;

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Sync status" onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined} />
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map(([key, label]) => {
          const selected = tab === key;
          return (
            <Pressable
              key={key}
              testID={`sync-tab-${key}`}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setTab(key)}
              style={[styles.tab, { borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accentSoft : colors.surface }]}
            >
              <AppText variant="small" style={{ fontWeight: selected ? '700' : '500' }}>
                {`${label}${counts[key] ? ` (${counts[key]})` : ''}`}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      <FlatList
        data={shown}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ padding: space(5), paddingTop: 0, flexGrow: 1 }}
        ItemSeparatorComponent={() => <View style={{ height: space(2) }} />}
        ListHeaderComponent={
          <View style={{ gap: space(3), marginBottom: space(4) }}>
            {!online ? <Notice tone="warning" icon="wifi" title="You’re offline" message="Records are saved on this phone and uploaded when you’re back online." /> : null}
            {clockProblem ? (
              <Notice tone="error" title="Check your phone’s clock" message="Your phone’s time differs from the server by more than 5 minutes. Set the date and time to automatic, then tap Sync now." />
            ) : null}
            {lastSync?.stopped && online && !clockProblem && tab === 'waiting' ? <Notice tone="warning" message={`Last upload stopped: ${lastSync.stopped}`} /> : null}
            {tab !== 'waiting' ? (
              <AppText variant="caption" color={colors.fgMuted}>
                {`Kept on this phone for ${KEEP_DAYS} days.`}
              </AppText>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          tab === 'waiting' ? (
            <EmptyState icon="cloud-done-outline" title="Everything is uploaded" message="Nothing is waiting on this phone." />
          ) : (
            <EmptyState icon="file-tray-outline" title={tab === 'synced' ? 'Nothing synced yet' : 'Nothing refused'} message={`Records of the last ${KEEP_DAYS} days appear here.`} />
          )
        }
        renderItem={({ item }) => (
          <HistoryRow
            item={item}
            zone={zone}
            onDismiss={() => setDismissing(item)}
            onCorrect={
              item.kind === 'exam-marks' && item.status === 'rejected' && !item.ref.replacedBy && item.code !== 'REPLACED'
                ? () => navigation.navigate('ExamMarkSheet', { paperId: item.ref.payload.paperId, sectionId: item.ref.payload.sectionId, replacesId: item.ref.id })
                : null
            }
          />
        )}
        ListFooterComponent={
          waiting && tab === 'waiting' ? <Button testID="sync-now" title="Sync now" icon="sync" variant="secondary" onPress={() => syncNow()} loading={syncing} disabled={!online} style={{ marginTop: space(5) }} /> : null
        }
      />
      <ConfirmDialog
        visible={Boolean(dismissing)}
        title="Dismiss this record?"
        message="The server did not accept it, so it is not recorded. Dismissing only removes it from this list; it stays saved on this phone until the 90-day clean-up."
        confirmLabel="Dismiss"
        destructive
        onConfirm={async () => {
          const item = dismissing;
          setDismissing(null);
          await dismissRecord(await openDatabase(), item.ref, clock());
          await reloadQueue();
          await load();
        }}
        onCancel={() => setDismissing(null)}
      />
    </Screen>
  );
}

function HistoryRow({ item, zone, onDismiss, onCorrect }) {
  const { colors } = useTheme();
  const now = useNow();
  const status = STATUS[item.status];
  const left = item.kind === 'attendance' ? Date.parse(item.at) + DAY_MS - now : null;
  const toneColor = { info: colors.info, warning: colors.warningFg, success: colors.success, error: colors.error }[status.tone];
  return (
    <Card style={styles.row}>
      <Icon name={status.icon} size={26} color={toneColor} />
      <View style={{ flex: 1, marginLeft: space(3), gap: 2 }} accessible>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), flexWrap: 'wrap' }}>
          <AppText variant="cardTitle">{item.count > 1 ? `${item.title} (${item.count})` : item.title}</AppText>
          <Badge label={status.label} tone={status.tone} />
        </View>
        <AppText variant="small" color={colors.fgSecondary}>
          {[item.detail, formatDayTime(item.at, zone)].filter(Boolean).join(' · ')}
        </AppText>
        {item.branch ? (
          <AppText variant="caption" color={colors.fgMuted}>
            {`Branch: ${item.branch}`}
          </AppText>
        ) : null}
        {item.status !== 'synced' && item.status !== 'rejected' && left !== null ? (
          <AppText variant="small" color={colors.warningFg}>
            {left > 0 ? `Waiting to upload… ${formatDuration(left)} left` : 'More than 24 hours old: the server will refuse it.'}
          </AppText>
        ) : null}
        {item.status === 'failed' && item.reason ? (
          <AppText variant="caption" color={colors.fgMuted}>
            {`Last attempt: ${item.reason}`}
          </AppText>
        ) : null}
        {item.status === 'rejected' ? (
          <AppText variant="small" color={colors.errorFg}>
            {`${refusalTitle(item.code)}: ${item.reason ?? 'Not accepted.'}`}
          </AppText>
        ) : null}
        {item.status === 'rejected' ? (
          <View style={{ flexDirection: 'row', gap: space(4) }}>
            {onCorrect ? <Button title="Correct and resend" variant="ghost" onPress={onCorrect} style={styles.inline} /> : null}
            <Button title="Dismiss" variant="ghost" onPress={onDismiss} style={styles.inline} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: space(2), paddingHorizontal: space(5), paddingBottom: space(3) },
  tab: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space(3), minHeight: 34, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  inline: { alignSelf: 'flex-start', paddingHorizontal: 0, minHeight: 40 },
});
