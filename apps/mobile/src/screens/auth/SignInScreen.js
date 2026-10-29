/*
 * 2. Sign in with phone number and password (POST /api/auth/login, client 'mobile'). "Forgot
 * password?" explains the approved recovery: the branch Manager sets a new temporary password.
 */
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { userMessage } from '../../api/errors';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Button, ConfirmDialog, Icon, Logo, Notice, Screen, TextField } from '../../components/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

export default function SignInScreen() {
  const { colors } = useTheme();
  const { signIn, notice, configured } = useSession();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const passwordInput = useRef(null);

  async function submit() {
    if (busy) return;
    const problems = {};
    if (!phone.trim()) problems.phone = 'Enter your phone number.';
    if (!password) problems.password = 'Enter your password.';
    setErrors(problems);
    setFailure(null);
    if (Object.keys(problems).length) return;
    setBusy(true);
    try {
      await signIn({ phone: phone.trim(), password });
    } catch (error) {
      setFailure(userMessage(error));
      setBusy(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']} style={{ backgroundColor: colors.surface }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Logo size={72} />
            <AppText variant="display" color={colors.fg} style={{ marginTop: space(3), fontSize: 32 }}>
              EduTrack
            </AppText>
            <AppText variant="body" color={colors.fgSecondary}>
              Staff Attendance
            </AppText>
          </View>

          {!configured ? <Notice tone="error" title="Server not set" message="The app has no server address. Set EXPO_PUBLIC_API_URL and restart it." /> : null}
          {notice ? (
            <View style={{ marginBottom: space(4) }}>
              <Notice tone="info" message={notice} />
            </View>
          ) : null}
          {failure ? (
            <View style={{ marginBottom: space(4) }}>
              <Notice tone="error" message={failure} />
            </View>
          ) : null}

          <TextField
            testID="phone"
            label="Phone number"
            icon="phone-portrait-outline"
            value={phone}
            onChangeText={setPhone}
            placeholder="e.g. 0612345678"
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            returnKeyType="next"
            onSubmitEditing={() => passwordInput.current?.focus()}
            error={errors.phone}
          />
          <TextField
            testID="password"
            ref={passwordInput}
            label="Password"
            icon="lock-closed-outline"
            value={password}
            onChangeText={setPassword}
            secure
            textContentType="password"
            autoComplete="password"
            returnKeyType="go"
            onSubmitEditing={submit}
            error={errors.password}
          />
          <Button testID="sign-in" title="Sign in" onPress={submit} loading={busy} disabled={!configured} style={{ marginTop: space(2) }} />
          <Pressable accessibilityRole="button" onPress={() => setForgotOpen(true)} style={styles.forgot} hitSlop={8}>
            <AppText variant="label" color={colors.interactive} style={{ fontWeight: '600' }}>
              Forgot password?
            </AppText>
          </Pressable>

          <View style={styles.illustration} importantForAccessibility="no-hide-descendants">
            <Icon name="school-outline" size={120} color={colors.interactiveSoft} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <ConfirmDialog
        visible={forgotOpen}
        title="Forgot your password?"
        message="Ask your branch Manager to set a new temporary password for you. Then sign in with it and choose a new password."
        confirmLabel="OK"
        cancelLabel={null}
        onConfirm={() => setForgotOpen(false)}
        onCancel={() => setForgotOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: space(6), justifyContent: 'center' },
  brand: { alignItems: 'center', marginBottom: space(8) },
  forgot: { alignSelf: 'center', marginTop: space(4), minHeight: 40, justifyContent: 'center' },
  illustration: { alignItems: 'center', marginTop: space(8) },
});
