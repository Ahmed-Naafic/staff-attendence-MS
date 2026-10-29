/*
 * 11. Sync status: events waiting to upload (with the time left before the 24-hour limit) and
 * events the server did not accept (with its reason). "Sync now" sends waiting events again with
 * their stored ids. A not-accepted event is final; it can only be dismissed from this list (it is
 * kept on the phone).
 */
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { refusalTitle } from '../../api/errors';
import { useAttendance } from '../../attendance/AttendanceProvider';
import { AppText, Badge, Button, Card, ConfirmDialog, EmptyState, Icon, Notice, Screen, ScreenHeader } from '../../components/ui';
import { formatDayTime, formatDuration } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function SyncScreen({ navigation }) {
  const { online, outstanding, syncing, syncNow, dismiss, today, lastSync } = useAttendance();
  const [dismissing, setDismissing] = useState(null);
  const zone = today?.timeZone ?? 'UTC';
  const pending = outstanding.filter((i) => i.state === 'pending');
  const rejected = outstanding.filter((i) => i.state === 'rejected');
  const clockProblem = pending.some((i) => i.errorCode === 'CLOCK_SKEW');

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Sync status" onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined} />
      <FlatList
        data={[...pending, ...rejected]}
        keyExtractor={(i) => i.clientEventId}
        contentContainerStyle={{ padding: space(5), paddingTop: 0, flexGrow: 1 }}
        ItemSeparatorComponent={() => <View style={{ height: space(2) }} />}
        ListHeaderComponent={
          <View style={{ gap: space(3), marginBottom: space(4) }}>
            {!online ? (
              <Notice tone="warning" icon="wifi" title="You’re offline" message="Attendance will be saved and uploaded when you’re back online." />
            ) : null}
            {clockProblem ? (
              <Notice tone="error" title="Check your phone’s clock" message="Your phone’s time differs from the server by more than 5 minutes. Set the date and time to automatic, then tap Sync now." />
            ) : null}
            {lastSync?.stopped && online && !clockProblem ? <Notice tone="warning" message={`Last upload stopped: ${lastSync.stopped}`} /> : null}
            {pending.length ? (
              <View style={styles.sectionTitle}>
                <AppText variant="cardTitle">Pending uploads</AppText>
                <Badge label={String(pending.length)} tone="info" />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={<EmptyState icon="cloud-done-outline" title="Everything is uploaded" message="No attendance is waiting on this phone." />}
        renderItem={({ item }) => (item.state === 'pending' ? <PendingRow item={item} zone={zone} /> : <RejectedRow item={item} zone={zone} onDismiss={() => setDismissing(item)} />)}
        ListFooterComponent={
          pending.length ? (
            <Button testID="sync-now" title="Sync now" icon="sync" variant="secondary" onPress={() => syncNow()} loading={syncing} disabled={!online} style={{ marginTop: space(5) }} />
          ) : null
        }
      />
      <ConfirmDialog
        visible={Boolean(dismissing)}
        title="Dismiss this event?"
        message="The server did not accept it, so it is not part of your attendance. Dismissing only removes it from this list; it stays saved on this phone."
        confirmLabel="Dismiss"
        destructive
        onConfirm={() => {
          dismiss(dismissing.clientEventId);
          setDismissing(null);
        }}
        onCancel={() => setDismissing(null)}
      />
    </Screen>
  );
}

const typeLabel = (t) => (t === 'CHECK_IN' ? 'Check in' : 'Check out');

function PendingRow({ item, zone }) {
  const { colors } = useTheme();
  const now = useNow();
  const left = Date.parse(item.occurredAt) + DAY_MS - now;
  return (
    <Card style={styles.row}>
      <Icon name="cloud-upload-outline" size={26} color={colors.info} />
      <View style={{ flex: 1, marginLeft: space(3) }} accessible>
        <AppText variant="cardTitle">{typeLabel(item.type)}</AppText>
        <AppText variant="small" color={colors.fgSecondary}>
          {formatDayTime(item.occurredAt, zone)}
        </AppText>
        <AppText variant="small" color={colors.warningFg}>
          {left > 0 ? `Waiting to upload… ${formatDuration(left)} left` : 'More than 24 hours old: the server will refuse it.'}
        </AppText>
        {item.errorMessage ? (
          <AppText variant="caption" color={colors.fgMuted}>
            Last attempt: {item.errorMessage}
          </AppText>
        ) : null}
      </View>
    </Card>
  );
}

function RejectedRow({ item, zone, onDismiss }) {
  const { colors } = useTheme();
  return (
    <Card style={styles.row}>
      <Icon name="close-circle" size={26} color={colors.error} />
      <View style={{ flex: 1, marginLeft: space(3) }} accessible>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <AppText variant="cardTitle">{typeLabel(item.type)}</AppText>
          <Badge label="Not accepted" tone="error" />
        </View>
        <AppText variant="small" color={colors.fgSecondary}>
          {formatDayTime(item.occurredAt, zone)}
        </AppText>
        <AppText variant="small" color={colors.errorFg}>
          {refusalTitle(item.errorCode)}: {item.errorMessage}
        </AppText>
        <Button title="Dismiss" variant="ghost" onPress={onDismiss} style={{ alignSelf: 'flex-start', paddingHorizontal: 0, minHeight: 40 }} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
});
