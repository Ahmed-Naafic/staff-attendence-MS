/*
 * 6 and 8. Checked in / Checked out: shown only after the server recorded the event (its time,
 * shift, status and distance come from the server's answer). An event still waiting to upload is
 * shown as saved, never as a success.
 */
import { ScrollView, StyleSheet, View } from 'react-native';
import { useAttendance } from '../../attendance/AttendanceProvider';
import { STATUS_LABEL, STATUS_TONE } from '../../components/attendance';
import { AppText, Badge, Button, Card, Icon, InfoRow, Notice, Screen } from '../../components/ui';
import { formatDay, formatDuration, formatMeters, formatTime, localDate } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function AttendanceResultScreen({ navigation, route }) {
  const { colors } = useTheme();
  const { today, profile } = useAttendance();
  const now = useNow();
  const { outcome, type, event, occurredAt, accuracy, distance, message } = route.params ?? {};
  const zone = today?.timeZone ?? 'UTC';
  const checkIn = type === 'CHECK_IN';
  const recorded = outcome === 'recorded' && event;
  const time = recorded ? event.occurredAt : occurredAt;
  const home = () => navigation.navigate('Tabs', { screen: 'Home' });

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={[styles.hero, { backgroundColor: recorded ? colors.successSoft : colors.infoSoft }]}>
          <View style={[styles.mark, { backgroundColor: recorded ? colors.success : colors.info }]}>
            <Icon name={recorded ? 'checkmark' : 'cloud-upload-outline'} size={48} color="#FFFFFF" />
          </View>
          <AppText variant="title" style={{ marginTop: space(4) }} accessibilityRole="header">
            {recorded ? (checkIn ? 'Checked in' : 'Checked out') : 'Saved on this phone'}
          </AppText>
          {time ? (
            <AppText variant="display" style={{ marginTop: space(1) }}>
              {formatTime(time, zone)}
            </AppText>
          ) : null}
          {time ? (
            <AppText variant="small" color={colors.fgSecondary}>
              {formatDay(localDate(time, zone))}
            </AppText>
          ) : null}
          {recorded && event.status ? (
            <View style={{ marginTop: space(2) }}>
              <Badge label={STATUS_LABEL[event.status]} tone={STATUS_TONE[event.status]} />
            </View>
          ) : null}
        </View>

        <View style={{ padding: space(5) }}>
          {!recorded ? (
            <View style={{ marginBottom: space(4) }}>
              <Notice
                tone="info"
                title="Waiting to upload"
                message={`Your ${checkIn ? 'check-in' : 'check-out'} is saved on this phone and will be sent automatically when you’re online. It must reach the server within 24 hours (${formatDuration(Date.parse(occurredAt) + DAY_MS - now)} left). It is not recorded until then.${message ? ` Last attempt: ${message}` : ''}`}
              />
            </View>
          ) : null}
          <Card>
            {recorded && event.shift?.name ? <InfoRow icon="calendar-outline" label="Shift" value={event.shift.start ? `${event.shift.start} – ${event.shift.end} (${event.shift.name})` : event.shift.name} /> : null}
            {profile ? <InfoRow icon="location-outline" label="Location" value={profile.branch.code} /> : null}
            <InfoRow icon="navigate-outline" label="Distance" value={formatMeters(recorded ? event.distanceMeters : distance)} />
            <InfoRow icon="locate-outline" label="Accuracy" value={formatMeters(accuracy)} last />
          </Card>
          {!recorded ? <Button title="View sync status" variant="secondary" onPress={() => navigation.replace('Sync')} style={{ marginTop: space(5) }} /> : null}
          <Button testID="back-home" title="Back to home" onPress={home} style={{ marginTop: space(recorded ? 6 : 3) }} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingTop: space(16), paddingBottom: space(8) },
  mark: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
});
