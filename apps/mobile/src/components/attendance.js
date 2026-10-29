/*
 * Attendance components: today's shift card, the location diagram and verification card, and the
 * offline / sync status banner (reference: docs/design/references/staff-app/image.png, screens 4,
 * 5, 7, 10 and 14).
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { bearingDegrees, GEOFENCE_RADIUS_M } from '../attendance/geo';
import { formatCoordinates, formatMeters } from '../lib/format';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { AppText, Card, Icon, ValueRow } from './ui';

/** Today's shift: times, name, the staff member's job title and the branch (code, school and branch name). */
export function ShiftCard({ shift, profile, jobTitle, status }) {
  const { colors } = useTheme();
  return (
    <Card tone="success" style={{ padding: space(5) }}>
      <AppText variant="cardTitle">Today’s shift</AppText>
      <View style={[styles.row, { marginTop: space(3) }]}>
        <Icon name="time-outline" size={30} color={colors.accent} />
        <View style={{ marginLeft: space(3), flex: 1 }}>
          <AppText variant="title" accessibilityLabel={shift ? `${shift.start} to ${shift.end}` : 'No shift'}>
            {shift ? `${shift.start} – ${shift.end}` : 'No shift'}
          </AppText>
          <AppText variant="small" color={colors.fgSecondary}>
            {shift ? shift.name : 'You have no assigned shift today.'}
          </AppText>
          {jobTitle ? (
            <AppText variant="small" color={colors.fgSecondary}>
              {jobTitle}
            </AppText>
          ) : null}
        </View>
        {status}
      </View>
      {profile ? (
        <View style={[styles.row, { marginTop: space(4), alignItems: 'flex-start' }]}>
          <Icon name="office-building" family="mci" size={30} color={colors.fg} />
          <View style={{ marginLeft: space(3), flex: 1 }}>
            <AppText variant="cardTitle">{profile.branch.code}</AppText>
            <AppText variant="small" color={colors.fgSecondary}>
              {profile.school.name}
            </AppText>
            <AppText variant="small" color={colors.fgSecondary}>
              {profile.branch.name}
            </AppText>
          </View>
        </View>
      ) : null}
    </Card>
  );
}

/**
 * A schematic of the branch geofence (the 100 m circle) with the branch at the centre and the
 * phone's position placed by distance and bearing. Not a map: no map tiles or keys are needed.
 */
export function GeofenceDiagram({ position, branch, distance, size = 220 }) {
  const { colors } = useTheme();
  const circle = size * 0.62;
  const scale = circle / 2 / GEOFENCE_RADIUS_M; // px per metre
  let dot = null;
  if (position && branch && Number.isFinite(distance)) {
    const r = Math.min(distance * scale, size / 2 - 10);
    const angle = (bearingDegrees(branch, position) * Math.PI) / 180;
    dot = { left: size / 2 + r * Math.sin(angle) - 9, top: size / 2 - r * Math.cos(angle) - 9 };
  } else if (position) {
    dot = { left: size / 2 - 9, top: size / 2 + 26 };
  }
  const lines = [0.2, 0.45, 0.7];
  return (
    <View
      style={[styles.map, { height: size, backgroundColor: colors.mapBackground }]}
      accessible
      accessibilityLabel={distance !== null && distance !== undefined ? `You are ${Math.round(distance)} metres from your branch. The allowed radius is 100 metres.` : 'Location diagram'}
    >
      {lines.map((f) => (
        <View key={`h${f}`} style={[styles.road, { top: size * f, left: 0, right: 0, height: 6, backgroundColor: colors.mapLine }]} />
      ))}
      {lines.map((f) => (
        <View key={`v${f}`} style={[styles.road, { left: `${f * 100}%`, top: 0, bottom: 0, width: 6, backgroundColor: colors.mapLine }]} />
      ))}
      <View style={[styles.fence, { width: circle, height: circle, borderRadius: circle / 2, left: '50%', top: size / 2 - circle / 2, marginLeft: -circle / 2, backgroundColor: colors.geofence, borderColor: colors.geofenceBorder }]} />
      <View style={{ position: 'absolute', left: '50%', top: size / 2 - 16, marginLeft: -14 }}>
        <Icon name="office-building" family="mci" size={28} color={colors.interactive} />
      </View>
      {dot ? <View style={[styles.dot, { left: dot.left, top: dot.top, backgroundColor: colors.info, borderColor: colors.surface }]} /> : null}
    </View>
  );
}

/** "Your location" card: verdict, distance, accuracy and coordinates. */
export function LocationCard({ position, distance, ok, message }) {
  const { colors } = useTheme();
  return (
    <Card style={{ marginTop: space(4) }}>
      <View style={styles.row}>
        <Icon name={ok ? 'checkmark-circle' : 'alert-circle'} size={22} color={ok ? colors.success : colors.error} />
        <AppText variant="cardTitle" style={{ marginLeft: space(2) }}>
          {ok ? 'Your location' : 'Location not accepted'}
        </AppText>
      </View>
      {!ok && message ? (
        <AppText variant="small" color={colors.errorFg} style={{ marginTop: space(1) }} accessibilityLiveRegion="polite">
          {message}
        </AppText>
      ) : null}
      <View style={{ marginTop: space(2) }}>
        <ValueRow label="Distance to branch" value={formatMeters(distance)} />
        <ValueRow label="Location accuracy" value={position?.accuracy ? formatMeters(position.accuracy) : '—'} />
        <ValueRow label="Coordinates" value={formatCoordinates(position)} />
      </View>
    </Card>
  );
}

/** Offline and waiting-upload banner (Home); opens the sync screen. */
export function SyncBanner({ online, pendingCount, rejectedCount = 0, onPress }) {
  const { colors } = useTheme();
  if (online && !pendingCount && !rejectedCount) return null;
  const tone = !online ? 'warning' : rejectedCount ? 'error' : 'info';
  const title = !online ? 'You’re offline' : rejectedCount ? `${rejectedCount} event${rejectedCount > 1 ? 's' : ''} not accepted` : `${pendingCount} waiting to upload`;
  const message = !online
    ? pendingCount
      ? `${pendingCount} event${pendingCount > 1 ? 's' : ''} saved on this phone; they upload when you’re back online.`
      : 'Attendance is saved on this phone and uploaded when you’re back online.'
    : rejectedCount
      ? 'Open sync status to see why.'
      : 'Uploading…';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${message} Open sync status.`} onPress={onPress} style={[styles.banner, { backgroundColor: colors[`${tone}Soft`] }]}>
      <Icon name={!online ? 'cloud-offline-outline' : rejectedCount ? 'alert-circle-outline' : 'cloud-upload-outline'} size={24} color={colors[tone]} />
      <View style={{ flex: 1, marginLeft: space(3) }}>
        <AppText variant="cardTitle" color={colors[`${tone}Fg`]}>
          {title}
        </AppText>
        <AppText variant="small" color={colors[`${tone}Fg`]}>
          {message}
        </AppText>
      </View>
      <Icon name="chevron-forward" size={18} color={colors[`${tone}Fg`]} />
    </Pressable>
  );
}

export const STATUS_TONE = { PRESENT: 'success', LATE: 'warning' };
export const STATUS_LABEL = { PRESENT: 'Present', LATE: 'Late' };

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  map: { borderRadius: radius.lg, overflow: 'hidden' },
  road: { position: 'absolute', opacity: 0.9 },
  fence: { position: 'absolute', borderWidth: 2 },
  dot: { position: 'absolute', width: 18, height: 18, borderRadius: 9, borderWidth: 3, elevation: 3 },
});
