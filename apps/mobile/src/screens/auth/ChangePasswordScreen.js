/*
 * 3. First sign-in: replace the temporary password (POST /api/auth/password). Nothing else is
 * available until this is done (the API enforces it too). Requirements are the approved rule
 * (backend/src/features/auth/password.js): 12–128 characters, not only spaces, different from the
 * temporary password. The reference image's 8-character checklist is not the approved rule.
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { userMessage } from '../../api/errors';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Button, Card, Icon, Notice, Screen, ScreenHeader, TextField } from '../../components/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { passwordRules, validatePasswordChange } from './passwordRules';

export default function ChangePasswordScreen() {
  const { colors } = useTheme();
  const { changePassword, signOut } = useSession();
  const [values, setValues] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (text) => setValues((v) => ({ ...v, [key]: text }));

  async function submit() {
    if (busy) return;
    const problems = validatePasswordChange(values);
    setErrors(problems);
    setFailure(null);
    if (Object.keys(problems).length) return;
    setBusy(true);
    try {
      await changePassword({ currentPassword: values.currentPassword, newPassword: values.newPassword });
    } catch (error) {
      const fields = error?.details && typeof error.details === 'object' ? error.details : {};
      setErrors({ currentPassword: fields.currentPassword, newPassword: fields.newPassword });
      setFailure(fields.currentPassword || fields.newPassword ? null : userMessage(error));
      setBusy(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Change password" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.intro}>
            <Icon name="lock-closed" size={36} color={colors.interactive} />
            <AppText variant="section" style={{ marginTop: space(3), textAlign: 'center' }}>
              Create a new password
            </AppText>
            <AppText variant="small" color={colors.fgSecondary} style={{ textAlign: 'center', marginTop: space(1) }}>
              You’re using a temporary password. Please create a new password to continue.
            </AppText>
          </View>
          {failure ? (
            <View style={{ marginBottom: space(4) }}>
              <Notice tone="error" message={failure} />
            </View>
          ) : null}
          <TextField testID="current-password" label="Temporary password" icon="key-outline" value={values.currentPassword} onChangeText={set('currentPassword')} secure error={errors.currentPassword} />
          <TextField testID="new-password" label="New password" icon="lock-closed-outline" value={values.newPassword} onChangeText={set('newPassword')} secure textContentType="newPassword" error={errors.newPassword} />
          <TextField testID="confirm-password" label="Confirm new password" icon="lock-closed-outline" value={values.confirmPassword} onChangeText={set('confirmPassword')} secure error={errors.confirmPassword} />

          <Card style={{ backgroundColor: colors.interactiveSoft, borderColor: 'transparent', marginBottom: space(5) }}>
            <AppText variant="label" style={{ marginBottom: space(2) }}>
              Password requirements:
            </AppText>
            {passwordRules(values).map((rule) => (
              <View key={rule.label} style={styles.rule} accessible accessibilityLabel={`${rule.label}: ${rule.met ? 'met' : 'not met'}`}>
                <Icon name={rule.met ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={rule.met ? colors.success : colors.fgMuted} />
                <AppText variant="small" style={{ marginLeft: space(2) }}>
                  {rule.label}
                </AppText>
              </View>
            ))}
          </Card>
          <Button testID="update-password" title="Update password" onPress={submit} loading={busy} />
          <Button title="Sign out" variant="ghost" onPress={signOut} style={{ marginTop: space(2) }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space(5), paddingTop: 0 },
  intro: { alignItems: 'center', marginBottom: space(6) },
  rule: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
});
