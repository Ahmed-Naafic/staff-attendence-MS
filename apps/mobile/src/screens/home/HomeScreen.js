/*
 * 4 and 9. Home: greeting, today's date and shift, the branch, and the round fingerprint control
 * for the one action that fits (check in, check out, or none), from the server's day plus events
 * waiting on this phone (reference: docs/design/references/staff-app/
 * "EduTrack Attendance Check-In Comparison.png"). Tapping it opens the existing check-in / check-out
 * flow (AttendanceScreen); Home never records an event itself. "Checked In" (green) is shown only
 * for an event the server recorded; an event still waiting to upload is shown as saved (blue).
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { userMessage } from '../../api/errors';
import { useAttendance } from '../../attendance/AttendanceProvider';
import { branchLocationAt, checkPosition } from '../../attendance/geo';
import { LOCATION_STALE_MS, useLocationStatus } from '../../attendance/useLocationStatus';
import { useSession } from '../../auth/SessionProvider';
import { ShiftCard, STATUS_LABEL, STATUS_TONE, SyncBanner } from '../../components/attendance';
import { AttendanceStateCard, CheckOutAction, FingerprintControl, LocationStatusCard } from '../../components/fingerprint';
import { AppText, Badge, Card, Icon, LoadingView, Logo, Notice, Screen } from '../../components/ui';
import { formatClock, formatDay, formatTime, greeting } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

export default function HomeScreen({ navigation }) {
  const { colors } = useTheme();
  const { user } = useSession();
  const { today, profile, loading, loadError, online, day, pendingCount, outstanding, refresh } = useAttendance();
  const zone = today?.timeZone ?? 'UTC';
  const rejectedCount = outstanding.filter((i) => i.state === 'rejected').length;
  const [opening, open] = useOpenAttendance(navigation);

  if (!today && loading) return <LoadingView label="Loading today’s shift…" />;

  const current = day.openCheckIn;
  const statusBadge = current ? <Badge label={current.source === 'pending' ? 'Waiting to upload' : (STATUS_LABEL[current.status] ?? 'Checked in')} tone={current.source === 'pending' ? 'info' : (STATUS_TONE[current.status] ?? 'success')} /> : null;
  const hello = greeting(new Date(), zone);
  // The timeline repeats what the control shows for a single event; it is listed when there is more.
  const showTimeline = day.timeline.length > 1;

  return (
    <Screen>
      <View style={styles.topBar}>
        <Logo size={30} />
        <AppText variant="section" style={{ marginLeft: space(2), fontWeight: '700' }}>
          EduTrack
        </AppText>
      </View>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading && Boolean(today)} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}>
        <View style={styles.helloRow}>
          <View style={{ flex: 1 }}>
            <AppText variant="body" color={colors.fgSecondary}>
              {hello},
            </AppText>
            <AppText variant="title">{profile?.name ?? user?.name}</AppText>
            {today && day.isCurrentDay ? (
              <AppText variant="body" color={colors.fgSecondary}>
                {formatDay(today.date)}
              </AppText>
            ) : null}
            <LiveClock zone={zone} />
          </View>
          <Icon name={hello === 'Good evening' ? 'moon-outline' : 'sunny-outline'} size={34} color={colors.accent} accessibilityElementsHidden importantForAccessibility="no" />
        </View>

        <View style={{ marginTop: space(4), gap: space(3) }}>
          <SyncBanner online={online} pendingCount={pendingCount} rejectedCount={rejectedCount} onPress={() => navigation.navigate('Sync')} />
          {!today && loadError ? <Notice tone="error" title="Today’s shift couldn’t be loaded" message={userMessage(loadError)} onRetry={refresh} /> : null}
          {today && loadError && online ? <Notice tone="warning" message={`Showing the last loaded details. ${userMessage(loadError)}`} onRetry={refresh} /> : null}
          {today && !day.isCurrentDay ? <Notice tone="warning" message="Today’s details are not loaded yet. Connect to the internet and pull down to refresh." /> : null}

          {today && day.isCurrentDay ? <ShiftCard shift={day.shift} profile={profile} jobTitle={profile?.jobTitle} status={statusBadge} /> : null}

          {today && day.isCurrentDay ? <AttendanceSection day={day} today={today} zone={zone} opening={opening} open={open} /> : null}

          {showTimeline ? (
            <Card>
              {day.timeline.map((entry) => (
                <View key={entry.clientEventId} style={styles.timelineRow} accessible>
                  <Icon name={entry.source === 'pending' ? 'cloud-upload-outline' : entry.type === 'CHECK_IN' ? 'log-in-outline' : 'log-out-outline'} size={20} color={entry.source === 'pending' ? colors.info : colors.success} />
                  <AppText variant="body" style={{ marginLeft: space(3), flex: 1 }}>
                    {entry.type === 'CHECK_IN' ? 'Checked in' : 'Checked out'} {formatTime(entry.occurredAt, zone)}
                  </AppText>
                  {entry.source === 'pending' ? <Badge label="Waiting to upload" tone="info" /> : entry.status ? <Badge label={STATUS_LABEL[entry.status]} tone={STATUS_TONE[entry.status]} /> : null}
                </View>
              ))}
            </Card>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

/**
 * The current time, ticking every second, in the same zone as the recorded check-in and check-out
 * times (the branch time zone from the API), so the clock and the recorded times always agree.
 * Its own component, so only the clock re-renders each second.
 */
function LiveClock({ zone }) {
  const { colors } = useTheme();
  const now = useNow(1000);
  const time = formatClock(now, zone);
  return (
    <View style={styles.clockRow} accessible accessibilityLabel={`Current time ${time.slice(0, 5)}`}>
      <Icon name="time-outline" size={18} color={colors.accent} accessibilityElementsHidden importantForAccessibility="no" />
      <AppText testID="home-clock" variant="section" style={styles.clock}>
        {time}
      </AppText>
    </View>
  );
}

/**
 * Opens the check-in / check-out flow once: further taps are ignored until Home is in view again,
 * so a quick double tap cannot open the flow twice. → [opening type or null, open(type)].
 */
function useOpenAttendance(navigation) {
  const [opening, setOpening] = useState(null);
  const lock = useRef(false);
  useFocusEffect(
    useCallback(() => {
      lock.current = false;
      // Back on Home: the flow was left (or finished), so the control is ready again.
      setOpening(null);
    }, []),
  );
  const open = (type) => {
    if (lock.current) return;
    lock.current = true;
    setOpening(type);
    navigation.navigate('Attendance', { type });
  };
  return [opening, open];
}

/** The fingerprint control and what goes with it, by today's state. */
function AttendanceSection({ day, today, zone, opening, open }) {
  const { colors } = useTheme();
  const { action, openCheckIn, lastCheckOut } = day;
  const canCheckIn = action.kind === 'CHECK_IN' && action.enabled;
  const location = useLocationStatus(canCheckIn);
  const now = useNow(15000);

  if (action.kind === 'NO_SHIFT') return <Notice tone="info" message={action.hint} />;

  if (action.kind === 'CHECK_IN') {
    const stale = location.position ? now - location.position.readAt > LOCATION_STALE_MS : false;
    const check = location.position ? checkPosition(location.position, branchLocationAt(today, new Date(location.position.readAt))) : null;
    const hint = canCheckIn ? null : action.hint;
    return (
      <View style={{ gap: space(3) }}>
        <FingerprintControl
          testID="fingerprint-action"
          state={!canCheckIn ? 'disabled' : opening ? 'busy' : 'ready'}
          label="Check In"
          onPress={() => open('CHECK_IN')}
          accessibilityLabel={canCheckIn ? 'Check in. Verifies your location, then records your check-in.' : `Check in, not available. ${hint ?? ''}`}
        />
        <View style={{ alignItems: 'center' }}>
          <AppText variant="body" style={{ fontWeight: '600' }}>
            {canCheckIn ? 'Tap to check in' : (hint ?? 'Check-in is not open')}
          </AppText>
          <AppText variant="small" color={colors.fgSecondary}>
            Make sure you are at the school.
          </AppText>
        </View>
        {canCheckIn ? <LocationStatusCard status={location.status} position={location.position} check={check} stale={stale} onPress={location.locate} /> : null}
      </View>
    );
  }

  // Checked in (CHECK_OUT, or DONE where check-out is not used), or checked out (DONE).
  const shown = openCheckIn ?? lastCheckOut;
  if (!shown) return action.hint ? <Notice tone="info" message={action.hint} /> : null;
  const isCheckIn = shown.type === 'CHECK_IN';
  const confirmed = shown.source === 'server';
  const time = formatTime(shown.occurredAt, zone);
  const state = !confirmed ? 'pending' : isCheckIn ? 'confirmed' : 'complete';
  const label = !confirmed ? 'Saved' : isCheckIn ? 'Checked In' : 'Checked Out';
  const what = isCheckIn ? 'check-in' : 'check-out';

  return (
    <View style={{ gap: space(3) }}>
      <FingerprintControl
        testID="fingerprint-status"
        state={state}
        label={label}
        time={time}
        accessibilityLabel={confirmed ? `${isCheckIn ? 'Checked in' : 'Checked out'} at ${time}. Recorded by the server.` : `Your ${what} at ${time} is saved on this phone and waiting to upload. It is not recorded yet.`}
      />
      {confirmed ? (
        <AttendanceStateCard
          tone="success"
          icon="checkmark"
          title={isCheckIn ? 'You are checked in' : 'You are checked out'}
          message={isCheckIn ? `Recorded at ${time}${shown.status ? ` · ${STATUS_LABEL[shown.status]}` : ''}. Have a great day!` : (action.hint ?? `Recorded at ${time}.`)}
        />
      ) : (
        <AttendanceStateCard tone="info" icon="cloud-upload" title="Waiting to upload" message={`Your ${what} at ${time} is saved on this phone. It counts once the server records it.`} />
      )}
      {action.kind === 'CHECK_OUT' ? <CheckOutAction testID="check-out" busy={opening === 'CHECK_OUT'} onPress={() => open('CHECK_OUT')} /> : null}
      {action.kind === 'DONE' && isCheckIn && action.hint ? <Notice tone="info" message={action.hint} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space(5), paddingVertical: space(3) },
  content: { padding: space(5), paddingTop: space(1), paddingBottom: space(8) },
  helloRow: { flexDirection: 'row', alignItems: 'flex-start' },
  clockRow: { flexDirection: 'row', alignItems: 'center', marginTop: space(1) },
  clock: { marginLeft: space(1), fontWeight: '700', fontVariant: ['tabular-nums'] },
  timelineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(2) },
});
