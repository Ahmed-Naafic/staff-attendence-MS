/*
 * Home's attendance controls (reference: docs/design/references/staff-app/
 * "EduTrack Attendance Check-In Comparison.png"): the round fingerprint control, the location
 * card, the checked-in card and the check-out action. The fingerprint is only a picture of the
 * attendance action: no biometric is read or requested.
 */
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { ACCURACY_MAX_M, GEOFENCE_RADIUS_M, POSITION_MESSAGES } from '../attendance/geo';
import { formatMeters } from '../lib/format';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { AppText, Icon } from './ui';

/** Colours of each state: ready (gold), confirmed (green), pending (blue), complete and disabled (neutral). */
function looks(colors) {
  return {
    ready: { ring: colors.accent, halo: colors.accentSoft, glyph: colors.fg, label: colors.accentFg },
    busy: { ring: colors.accent, halo: colors.accentSoft, glyph: colors.fgMuted, label: colors.accentFg },
    confirmed: { ring: colors.success, halo: colors.successSoft, glyph: colors.success, label: colors.successFg, badge: colors.success, badgeIcon: 'checkmark' },
    pending: { ring: colors.info, halo: colors.infoSoft, glyph: colors.info, label: colors.infoFg, badge: colors.info, badgeIcon: 'cloud-upload' },
    complete: { ring: colors.secondary, halo: colors.muted, glyph: colors.secondary, label: colors.fgSecondary, badge: colors.secondary, badgeIcon: 'checkmark' },
    disabled: { ring: colors.border, halo: colors.muted, glyph: colors.fgDisabled, label: colors.fgMuted },
  };
}

/**
 * The round attendance control. state: 'ready' (tappable) | 'busy' (opening the check-in flow) |
 * 'disabled' | 'confirmed' (recorded by the server) | 'pending' (saved on the phone, not uploaded)
 * | 'complete' (checked out, recorded). Only 'ready' responds to a tap.
 */
export function FingerprintControl({ state, label, time, onPress, accessibilityLabel, testID }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const look = looks(colors)[state];
  const size = Math.round(Math.min(212, Math.max(156, width * 0.5)));
  const glyph = Math.round(size * 0.4);
  const tappable = state === 'ready';

  const face = (pressed) => (
    <View testID={testID ? `${testID}-face` : undefined} style={[styles.face, { width: size, height: size, borderRadius: size / 2, borderColor: look.ring, backgroundColor: pressed ? look.halo : colors.surface, shadowColor: look.ring, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
      <View>
        <Icon name="fingerprint" family="mci" size={glyph} color={look.glyph} />
        {look.badge ? (
          <View style={[styles.badge, { backgroundColor: look.badge, borderColor: colors.surface }]}>
            <Icon name={look.badgeIcon} size={16} color="#FFFFFF" />
          </View>
        ) : null}
      </View>
      {state === 'busy' ? (
        <ActivityIndicator color={look.label} style={{ marginTop: space(2), height: 28 }} accessibilityLabel="Opening" />
      ) : (
        <AppText variant="section" color={look.label} style={styles.label} numberOfLines={1} adjustsFontSizeToFit>
          {label}
        </AppText>
      )}
      {time ? (
        <AppText variant="small" color={colors.fgSecondary}>
          {time}
        </AppText>
      ) : null}
    </View>
  );

  const rings = (
    <>
      <View pointerEvents="none" style={[styles.ring, { width: size + 64, height: size + 64, borderRadius: (size + 64) / 2, backgroundColor: look.halo, opacity: 0.45 }]} />
      <View pointerEvents="none" style={[styles.ring, { width: size + 30, height: size + 30, borderRadius: (size + 30) / 2, backgroundColor: look.halo }]} />
    </>
  );

  return (
    <View style={[styles.stage, { height: size + 64 }]}>
      {rings}
      {tappable || state === 'busy' || state === 'disabled' ? (
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityState={{ disabled: !tappable, busy: state === 'busy' }}
          disabled={!tappable}
          onPress={onPress}
          style={{ borderRadius: size / 2, opacity: state === 'disabled' ? 0.75 : 1 }}
        >
          {({ pressed }) => face(pressed && tappable)}
        </Pressable>
      ) : (
        <View testID={testID} accessible accessibilityLabel={accessibilityLabel ?? label}>
          {face(false)}
        </View>
      )}
    </View>
  );
}

/**
 * Home's location card before check-in. "Location ready" only after the position passed the same
 * check the app applies before saving an event (accuracy and distance to the branch location).
 */
export function LocationStatusCard({ status, check, position, stale, onPress }) {
  const { colors } = useTheme();
  const accuracy = position?.accuracy ? `accuracy ${formatMeters(position.accuracy)}` : null;
  let view;
  if (status === 'idle' || status === 'locating') view = { tone: 'neutral', title: 'Checking your location…', message: 'This takes a few seconds.' };
  else if (status === 'permission') view = { tone: 'warning', icon: 'location-outline', title: 'Location permission needed', message: 'You’ll be asked when you tap Check In.' };
  else if (status === 'denied') view = { tone: 'error', icon: 'location-outline', title: 'Location access is off', message: 'Allow location for EduTrack in the phone’s settings.' };
  else if (status === 'servicesOff') view = { tone: 'warning', icon: 'location-outline', title: 'Location is off', message: 'Turn on location services on your phone.' };
  else if (status === 'error' || !check) view = { tone: 'error', icon: 'alert-circle', title: 'Location not available', message: 'Your location could not be read. Tap to try again.' };
  else if (stale) view = { tone: 'neutral', icon: 'refresh', title: 'Check your location again', message: 'The last reading is more than 2 minutes old. Tap to check again.' };
  else if (check.ok)
    view = { tone: 'success', icon: 'location', title: 'Location ready', message: `You are ${formatMeters(check.distanceMeters)} from your branch (within ${GEOFENCE_RADIUS_M} m)${accuracy ? ` · ${accuracy}` : ''}` };
  else if (check.reason === 'outside_geofence')
    view = { tone: 'error', icon: 'location', title: 'Outside your school', message: `You are ${formatMeters(check.distanceMeters)} from your branch; it must be ${GEOFENCE_RADIUS_M} m or less.${accuracy ? ` (${accuracy})` : ''}` };
  else if (check.reason === 'accuracy_too_low')
    view = { tone: 'warning', icon: 'locate-outline', title: 'Location not accurate enough', message: `${position?.accuracy ? `Accuracy ${formatMeters(position.accuracy)}; it` : 'It'} must be ${ACCURACY_MAX_M} m or better. Move to an open spot.` };
  else if (check.reason === 'no_branch_location') view = { tone: 'warning', icon: 'business-outline', title: 'Branch location unavailable', message: POSITION_MESSAGES.no_branch_location };
  else view = { tone: 'error', icon: 'alert-circle', title: 'Location not available', message: POSITION_MESSAGES[check.reason] ?? POSITION_MESSAGES.invalid_position };

  const tint = view.tone === 'neutral' ? colors.fgSecondary : colors[view.tone];
  const titleColor = view.tone === 'neutral' ? colors.fg : colors[`${view.tone}Fg`];
  const busy = status === 'idle' || status === 'locating';
  return (
    <Pressable
      testID="location-status"
      accessibilityRole="button"
      accessibilityLabel={`${view.title}. ${view.message}`}
      accessibilityHint="Checks your location again"
      accessibilityState={{ busy, disabled: busy }}
      accessibilityLiveRegion="polite"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.muted : colors.surface, borderColor: colors.borderSubtle }]}
    >
      <View style={[styles.cardIcon, { backgroundColor: view.tone === 'neutral' ? colors.muted : colors[`${view.tone}Soft`] }]}>
        {busy ? <ActivityIndicator color={colors.fgSecondary} /> : <Icon name={view.icon} size={24} color={tint} />}
      </View>
      <View style={{ flex: 1, marginLeft: space(3) }}>
        <AppText variant="cardTitle" color={titleColor}>
          {view.title}
        </AppText>
        <AppText variant="small" color={colors.fgSecondary}>
          {view.message}
        </AppText>
      </View>
      {busy ? null : <Icon name="chevron-forward" size={18} color={colors.fgMuted} />}
    </Pressable>
  );
}

/** "You are checked in" (recorded by the server) or the saved-on-phone notice. */
export function AttendanceStateCard({ tone, icon, title, message, right }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityLabel={`${title}. ${message}`} style={[styles.card, { backgroundColor: colors[`${tone}Soft`], borderColor: 'transparent' }]}>
      <View style={[styles.cardIcon, { backgroundColor: colors[tone] }]}>
        <Icon name={icon} size={22} color="#FFFFFF" />
      </View>
      <View style={{ flex: 1, marginLeft: space(3) }}>
        <AppText variant="cardTitle" color={colors[`${tone}Fg`]}>
          {title}
        </AppText>
        <AppText variant="small" color={colors[`${tone}Fg`]}>
          {message}
        </AppText>
      </View>
      {right}
    </View>
  );
}

/** "When you finish — Check Out": opens the existing check-out flow. */
export function CheckOutAction({ onPress, busy, testID }) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel="Check out"
      accessibilityHint="Verifies your location and records your check-out"
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles.checkOut, { borderColor: colors.accent, backgroundColor: pressed ? colors.accentSoft : colors.surface }]}
    >
      <Icon name="exit-outline" size={30} color={colors.fg} />
      <View style={{ flex: 1, marginLeft: space(4) }}>
        <AppText variant="small" color={colors.fgSecondary}>
          When you finish
        </AppText>
        <AppText variant="section">Check Out</AppText>
      </View>
      {busy ? <ActivityIndicator color={colors.accentFg} /> : <Icon name="chevron-forward" size={20} color={colors.fg} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute' },
  face: { alignItems: 'center', justifyContent: 'center', borderWidth: 3, elevation: 6, shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 4 } },
  badge: { position: 'absolute', right: -6, bottom: -2, width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  label: { marginTop: space(2), fontSize: 22, lineHeight: 28, fontWeight: '700' },
  card: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, padding: space(4), minHeight: 72 },
  cardIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  checkOut: { borderWidth: 1.5 },
});
