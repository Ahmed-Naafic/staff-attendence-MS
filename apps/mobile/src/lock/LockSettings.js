/*
 * Settings → App lock: set, change or remove a PIN (4 to 6 digits, typed twice) and turn
 * fingerprint / face unlock on or off (only when the phone has one enrolled). Biometrics alone need
 * no PIN; after three failed attempts the EduTrack password is asked for in any case.
 */
import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { useSession } from '../auth/SessionProvider';
import { AppText, Button, Card, Divider, ListRow, Notice, TextField } from '../components/ui';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';
import { biometricAvailable, useAppLock } from './AppLock';
import { clearLock, isValidPin, lockFor, setBiometric, setPin } from './lockStore';

export function LockSettings() {
  const { user } = useSession();
  const { reloadLock } = useAppLock();
  const { colors } = useTheme();
  const [lock, setLock] = useState(null);
  const [canBiometric, setCanBiometric] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pin, setPinText] = useState('');
  const [again, setAgain] = useState('');
  const [message, setMessage] = useState(null);

  const refresh = async () => {
    setLock(await lockFor(user.id));
    await reloadLock();
  };
  useEffect(() => {
    // State is set only after secure storage answers (asynchronously).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    biometricAvailable().then(setCanBiometric);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  async function savePin() {
    if (!isValidPin(pin)) return setMessage({ tone: 'error', text: 'A PIN is 4 to 6 digits.' });
    if (pin !== again) return setMessage({ tone: 'error', text: 'The two PINs are different.' });
    await setPin(user.id, pin);
    setEditing(false);
    setPinText('');
    setAgain('');
    setMessage({ tone: 'success', text: 'PIN saved. EduTrack locks after a minute in the background.' });
    await refresh();
  }

  return (
    <View style={{ gap: space(3) }}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <ListRow testID="lock-pin" icon="keypad-outline" label={lock?.pin ? 'Change PIN' : 'Unlock with a PIN'} value={lock?.pin ? 'On' : 'Off'} onPress={() => setEditing((e) => !e)} />
        <Divider />
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space(4), minHeight: 60 }}>
          <AppText variant="body" style={{ flex: 1 }} color={canBiometric ? colors.fg : colors.fgMuted}>
            Fingerprint or face unlock
          </AppText>
          <Switch
            testID="lock-biometric"
            accessibilityLabel="Fingerprint or face unlock"
            disabled={!canBiometric}
            value={Boolean(lock?.biometric)}
            onValueChange={async (on) => {
              await setBiometric(user.id, on);
              await refresh();
            }}
          />
        </View>
        {lock ? (
          <>
            <Divider />
            <ListRow
              testID="lock-off"
              icon="lock-open-outline"
              label="Turn the app lock off"
              tone="danger"
              onPress={async () => {
                await clearLock();
                setMessage({ tone: 'info', text: 'App lock is off.' });
                await refresh();
              }}
            />
          </>
        ) : null}
      </Card>
      {editing ? (
        <Card style={{ gap: space(3) }}>
          <TextField testID="new-pin" label="New PIN (4–6 digits)" icon="keypad-outline" value={pin} onChangeText={(t) => setPinText(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secure />
          <TextField testID="new-pin-again" label="Type it again" icon="keypad-outline" value={again} onChangeText={(t) => setAgain(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secure />
          <Button testID="save-pin" title="Save PIN" onPress={savePin} />
        </Card>
      ) : null}
      {!canBiometric ? (
        <AppText variant="caption" color={colors.fgMuted}>
          Fingerprint or face unlock needs one set up in the phone’s settings.
        </AppText>
      ) : null}
      {message ? <Notice tone={message.tone} message={message.text} /> : null}
    </View>
  );
}
