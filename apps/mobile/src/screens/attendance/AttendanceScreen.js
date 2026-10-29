/*
 * 5 and 7. Check in / check out: location permission (13), the phone's position, the on-device
 * check against the branch location, then "Confirm". The event is saved on the phone first and
 * sent; the result screen is shown only when the server has recorded it (or it is waiting to
 * upload, shown as such — never as a success).
 */
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { refusalTitle } from '../../api/errors';
import { useAttendance } from '../../attendance/AttendanceProvider';
import { branchLocationAt, checkPosition, POSITION_MESSAGES } from '../../attendance/geo';
import { GeofenceDiagram, LocationCard } from '../../components/attendance';
import { AppText, Button, Card, Icon, LoadingView, Notice, Screen, ScreenHeader } from '../../components/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

const FRESH_MS = 60 * 1000;

export default function AttendanceScreen({ navigation, route }) {
  const type = route.params?.type === 'CHECK_OUT' ? 'CHECK_OUT' : 'CHECK_IN';
  const label = type === 'CHECK_IN' ? 'Check in' : 'Check out';
  const { today, record } = useAttendance();
  const [phase, setPhase] = useState('checking');
  const [position, setPosition] = useState(null);
  const [problem, setProblem] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);

  const locate = useCallback(async () => {
    setPhase('locating');
    setProblem(null);
    try {
      if (!(await Location.hasServicesEnabledAsync())) return setPhase('servicesOff');
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      setPosition({ latitude: fix.coords.latitude, longitude: fix.coords.longitude, accuracy: fix.coords.accuracy ?? null, readAt: Date.now() });
      setPhase('ready');
    } catch {
      setPosition(null);
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    (async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.granted) locate();
      else setPhase(permission.canAskAgain === false ? 'denied' : 'permission');
    })().catch(() => setPhase('error'));
  }, [locate]);

  async function allow() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.granted) locate();
    else setPhase(permission.canAskAgain === false ? 'denied' : 'permission');
  }

  if (phase === 'permission' || phase === 'denied') {
    return <LocationPermission denied={phase === 'denied'} onAllow={phase === 'denied' ? () => Linking.openSettings() : allow} onNotNow={() => navigation.goBack()} />;
  }

  const branch = branchLocationAt(today, new Date());
  const check = position ? checkPosition(position, branch) : null;

  async function confirm() {
    if (busy.current) return;
    busy.current = true;
    setSubmitting(true);
    setProblem(null);
    try {
      let current = position;
      // A position older than a minute is read again so the event time and place belong together.
      if (!current || Date.now() - current.readAt > FRESH_MS) {
        const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
        current = { latitude: fix.coords.latitude, longitude: fix.coords.longitude, accuracy: fix.coords.accuracy ?? null, readAt: Date.now() };
        setPosition(current);
      }
      const result = await record(type, current);
      if (result.outcome === 'recorded' || result.outcome === 'pending') {
        navigation.replace('AttendanceResult', { outcome: result.outcome, type, event: result.event ?? null, occurredAt: result.item.occurredAt, accuracy: current.accuracy, distance: result.item.distanceEstimate, message: result.message ?? null });
        return;
      }
      if (result.outcome === 'rejected') setProblem({ title: refusalTitle(result.code), message: result.message });
      else if (result.outcome === 'blocked') setProblem({ title: 'Location not accepted', message: result.message });
    } catch {
      setProblem({ title: 'Location not available', message: POSITION_MESSAGES.no_position });
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={label} onBack={() => navigation.goBack()} subtitle="We’ll verify your location to record your attendance." />
      <ScrollView contentContainerStyle={styles.content}>
        {phase === 'checking' || phase === 'locating' ? (
          <View style={{ height: 220 }}>
            <LoadingView label="Finding your location…" />
          </View>
        ) : (
          <GeofenceDiagram position={position} branch={branch} distance={check?.distanceMeters ?? null} />
        )}
        {phase === 'servicesOff' ? <Notice tone="warning" title="Location is off" message="Turn on location services on your phone, then try again." onRetry={locate} /> : null}
        {phase === 'error' ? <Notice tone="error" title="Location not available" message="Your location could not be read. Move to an open spot and try again." onRetry={locate} /> : null}
        {phase === 'ready' ? <LocationCard position={position} distance={check?.distanceMeters ?? null} ok={check?.ok} message={check && !check.ok ? POSITION_MESSAGES[check.reason] : null} /> : null}
        {problem ? (
          <View style={{ marginTop: space(4) }}>
            <Notice tone="error" title={problem.title} message={problem.message} />
          </View>
        ) : null}
        <View style={{ marginTop: space(5) }}>
          <Button testID="confirm" title={`Confirm ${label.toLowerCase()}`} onPress={confirm} loading={submitting} disabled={phase !== 'ready' || !check?.ok} />
          {phase === 'ready' && !check?.ok ? <Button title="Refresh location" variant="secondary" icon="refresh" onPress={locate} style={{ marginTop: space(3) }} /> : null}
          <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} disabled={submitting} style={{ marginTop: space(2) }} />
        </View>
      </ScrollView>
    </Screen>
  );
}

/** 13. Location permission: why the app needs it, before the system prompt. */
export function LocationPermission({ denied, onAllow, onNotNow }) {
  const { colors } = useTheme();
  const points = [
    ['shield-checkmark-outline', 'Used only for attendance'],
    ['lock-closed-outline', 'Read only when you check in or out, not tracked'],
    ['location-outline', 'Required for check-in and check-out'],
  ];
  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={[styles.content, { flexGrow: 1, justifyContent: 'center' }]}>
        <View style={{ alignItems: 'center' }}>
          <View style={[styles.permissionIcon, { backgroundColor: colors.interactiveSoft }]}>
            <Icon name="location" size={56} color={colors.info} />
          </View>
          <AppText variant="title" style={{ marginTop: space(5), textAlign: 'center' }} accessibilityRole="header">
            Allow location access
          </AppText>
          <AppText variant="body" color={colors.fgSecondary} style={{ marginTop: space(2), textAlign: 'center' }}>
            EduTrack needs your location to verify that you are at your school when checking in and out.
          </AppText>
        </View>
        <Card style={{ marginTop: space(6), backgroundColor: colors.interactiveSoft, borderColor: 'transparent' }}>
          {points.map(([icon, text]) => (
            <View key={text} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space(1) }}>
              <Icon name={icon} size={18} color={colors.fgSecondary} />
              <AppText variant="small" style={{ marginLeft: space(2) }}>
                {text}
              </AppText>
            </View>
          ))}
        </Card>
        {denied ? (
          <View style={{ marginTop: space(4) }}>
            <Notice tone="warning" message="Location access was turned off for EduTrack. Open the app settings and allow location." />
          </View>
        ) : null}
        <Button testID="allow-location" title={denied ? 'Open settings' : 'Allow location access'} onPress={onAllow} style={{ marginTop: space(6) }} />
        <Button title="Not now" variant="ghost" onPress={onNotNow} style={{ marginTop: space(2) }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space(5), paddingTop: space(1) },
  permissionIcon: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center' },
});
