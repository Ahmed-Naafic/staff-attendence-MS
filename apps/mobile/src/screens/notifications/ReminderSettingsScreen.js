/*
 * Notifications and reminders settings (N1, N5, N12). What the staff member can choose is limited
 * by the platform and their branch (the server computes it): reminders can be turned on or off and
 * their timing adjusted within the limits; optional notification categories can be turned off;
 * mandatory ones (suspensions, reactivations, announcements) cannot.
 *
 * Check-in reminders use the phone's geofencing: they need the staff member's explicit agreement
 * here and the system's "Allow all the time" location permission. EduTrack does not track or store
 * location history; a reminder never records attendance.
 */
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { userMessage } from '../../api/errors';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Card, ConfirmDialog, Divider, Icon, LoadingView, Notice, Screen, ScreenHeader } from '../../components/ui';
import { backgroundPermission } from '../../notifications/geofence';
import { notificationPermission } from '../../notifications/local';
import { useNotifications } from '../../notifications/NotificationsProvider';
import { enablePush } from '../../notifications/push';
import { useTheme } from '../../theme/ThemeProvider';
import { space, TOUCH } from '../../theme/tokens';

const CATEGORY_LABELS = {
  MISSING_CHECK_OUT: 'Missing check-outs',
  ASSIGNMENT: 'Shift assignment changes',
  SCHEDULE: 'Branch schedule changes',
  STATUS: 'School and branch suspensions',
  ANNOUNCEMENT: 'EduTrack announcements',
  TRANSFER: 'Branch transfers',
};

function Row({ label, description, value, onChange, disabled, testID }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, marginRight: space(3) }}>
        <AppText variant="body">{label}</AppText>
        {description ? (
          <AppText variant="small" color={colors.fgSecondary}>
            {description}
          </AppText>
        ) : null}
      </View>
      <Switch testID={testID} accessibilityLabel={label} accessibilityState={{ disabled: Boolean(disabled), checked: value }} value={value} onValueChange={onChange} disabled={Boolean(disabled)} trackColor={{ true: colors.accent }} />
    </View>
  );
}

function Minutes({ label, value, min, max, onChange, disabled }) {
  const { colors } = useTheme();
  const step = (d) => onChange(Math.min(max, Math.max(min, value + d)));
  return (
    <View style={styles.row}>
      <AppText variant="body" style={{ flex: 1 }}>
        {label}
      </AppText>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: fewer minutes`} disabled={disabled || value <= min} onPress={() => step(-5)} style={styles.stepper}>
        <Icon name="remove" color={disabled || value <= min ? colors.fgDisabled : colors.fg} />
      </Pressable>
      <AppText variant="body" accessibilityLabel={`${value} minutes`} style={{ minWidth: 64, textAlign: 'center' }}>
        {value} min
      </AppText>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: more minutes`} disabled={disabled || value >= max} onPress={() => step(5)} style={styles.stepper}>
        <Icon name="add" color={disabled || value >= max ? colors.fgDisabled : colors.fg} />
      </Pressable>
    </View>
  );
}

export default function ReminderSettingsScreen({ navigation }) {
  const { colors } = useTheme();
  const { api } = useSession();
  const { preferences, updatePreferences, backgroundGranted, refreshPermissions, setPushState } = useNotifications();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [consentAsk, setConsentAsk] = useState(false);

  if (!preferences) return <LoadingView label="Loading settings…" />;
  const r = preferences.reminders;

  async function save(values, after) {
    setSaving(true);
    setError(null);
    try {
      await updatePreferences(values);
      await after?.();
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function needNotifications() {
    const status = await notificationPermission({ ask: true }).catch(() => 'denied');
    if (status !== 'granted') setNotice('Notifications are turned off for EduTrack on this phone. Turn them on in the phone settings to receive reminders.');
    return status === 'granted';
  }

  // Turning on check-in reminders: explain first; then the system permission ("Allow all the time").
  async function agreeToLocation() {
    setConsentAsk(false);
    await needNotifications();
    const status = await backgroundPermission({ ask: true }).catch(() => ({ background: 'denied', canAskAgain: false }));
    await refreshPermissions();
    await save({ checkInReminder: true, locationConsent: true });
    if (status.background !== 'granted') {
      setNotice(
        status.canAskAgain
          ? 'Check-in reminders need location access set to “Allow all the time”. Without it the reminder cannot work; your check-ins are not affected.'
          : 'Location access “Allow all the time” is turned off or restricted for EduTrack. Open the phone settings to allow it, or keep check-in reminders off.',
      );
    }
  }

  const categories = preferences.categories.filter((c) => CATEGORY_LABELS[c.key]);
  const disabled = (key, on) => {
    const off = preferences.categories.filter((c) => !c.mandatory && !c.enabled).map((c) => c.key);
    return on ? off.filter((k) => k !== key) : [...new Set([...off, key])];
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Notifications and reminders" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Notice tone="error" message={error} /> : null}
        {notice ? (
          <Notice tone="warning" message={notice} onRetry={() => Linking.openSettings()} retryLabel="Open phone settings" />
        ) : null}

        {preferences.push.available ? (
          <>
            <AppText variant="label" color={colors.fgSecondary} style={styles.groupLabel}>
              Push notifications
            </AppText>
            <Card style={styles.card}>
              <Row
                testID="push-switch"
                label="Notify me on this phone"
                description="Shows “You have a new notification” on the lock screen. Details are only shown inside EduTrack."
                value={preferences.push.enabled}
                disabled={saving}
                onChange={(on) => save({ pushEnabled: on }, async () => on && (await needNotifications()) && setPushState(await enablePush(api, { ask: true })))}
              />
            </Card>
          </>
        ) : null}

        <AppText variant="label" color={colors.fgSecondary} style={styles.groupLabel}>
          Reminders
        </AppText>
        <Card style={styles.card}>
          {!preferences.branchOperating ? <Notice tone="info" message="Your branch or school is suspended, so there are no check-in reminders." /> : null}
          <Row
            testID="checkin-switch"
            label="Check-in reminder when I arrive"
            description={r.checkIn.available ? 'Uses your phone’s location only to notice you arrived at your branch. No location history is kept. A reminder does not check you in.' : 'Turned off by your platform or branch.'}
            value={r.checkIn.enabled && r.checkIn.consented}
            disabled={saving || !r.checkIn.available}
            onChange={(on) => (on ? setConsentAsk(true) : save({ checkInReminder: false, locationConsent: false }))}
          />
          {r.checkIn.enabled && r.checkIn.consented && !backgroundGranted ? (
            <AppText variant="small" color={colors.warningFg} style={{ paddingHorizontal: space(4), paddingBottom: space(3) }}>
              Location “Allow all the time” is not on, so this reminder is not active.
            </AppText>
          ) : null}
          {r.checkIn.adjustable && r.checkIn.enabled ? (
            <Minutes label="From (minutes before start)" value={r.checkIn.leadMinutes} min={r.checkIn.min} max={r.checkIn.max} disabled={saving} onChange={(m) => save({ checkInLeadMinutes: m })} />
          ) : null}
          <Divider />
          <Row
            testID="checkout-switch"
            label="Check-out reminder"
            description={r.checkOut.available ? 'Before your shift ends, after you checked in, on days your branch uses check-out.' : 'Turned off by your platform or branch.'}
            value={r.checkOut.enabled}
            disabled={saving || !r.checkOut.available}
            onChange={(on) => save({ checkOutReminder: on }, () => on && needNotifications())}
          />
          {r.checkOut.adjustable && r.checkOut.enabled ? (
            <Minutes label="Minutes before the end" value={r.checkOut.leadMinutes} min={r.checkOut.min} max={r.checkOut.max} disabled={saving} onChange={(m) => save({ checkOutLeadMinutes: m })} />
          ) : null}
          <Divider />
          <Row
            testID="upload-switch"
            label="Upload reminder"
            description="When an event saved without internet is close to the 24-hour upload limit."
            value={r.upload.enabled}
            disabled={saving || !r.upload.available}
            onChange={(on) => save({ uploadReminder: on }, () => on && needNotifications())}
          />
        </Card>

        <AppText variant="label" color={colors.fgSecondary} style={styles.groupLabel}>
          Notifications in the app
        </AppText>
        <Card style={styles.card}>
          {categories.map((c, i) => (
            <View key={c.key}>
              {i ? <Divider /> : null}
              <Row
                testID={`category-${c.key}`}
                label={CATEGORY_LABELS[c.key]}
                description={c.mandatory ? 'Always on.' : null}
                value={c.enabled}
                disabled={saving || c.mandatory}
                onChange={(on) => save({ disabledCategories: disabled(c.key, on) })}
              />
            </View>
          ))}
        </Card>
        <AppText variant="small" color={colors.fgMuted} style={{ marginTop: space(3) }}>
          Notifications are in Somali and kept for 90 days.
        </AppText>
      </ScrollView>
      <ConfirmDialog
        visible={consentAsk}
        title="Turn on check-in reminders?"
        message="Your phone will tell EduTrack when you arrive at your branch, so it can remind you to check in. Your location is not tracked or saved, and nothing is sent to the server. A reminder never checks you in. Next, allow location “All the time” for EduTrack."
        confirmLabel="Agree and continue"
        onConfirm={agreeToLocation}
        onCancel={() => setConsentAsk(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space(5), paddingTop: 0, paddingBottom: space(8) },
  groupLabel: { marginTop: space(4), marginBottom: space(2), marginLeft: space(1) },
  card: { padding: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: TOUCH + 8, paddingHorizontal: space(4), paddingVertical: space(2) },
  stepper: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
