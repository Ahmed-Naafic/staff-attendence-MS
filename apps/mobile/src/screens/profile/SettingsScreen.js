/*
 * 13. Settings: appearance (system, light, dark; saved on this phone), location access, about
 * and sign out. Notifications, help, privacy and terms pages from the reference image are not
 * approved or written yet, so they are not shown.
 */
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText, Card, Divider, Icon, ListRow, Screen, ScreenHeader } from '../../components/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { space, TOUCH } from '../../theme/tokens';
import { useSignOut } from './useSignOut';

const APPEARANCE = [
  ['system', 'Use phone setting', 'phone-portrait-outline'],
  ['light', 'Light', 'sunny-outline'],
  ['dark', 'Dark', 'moon-outline'],
];

export default function SettingsScreen({ navigation }) {
  const { colors, preference, setPreference } = useTheme();
  const { requestSignOut, dialog } = useSignOut();
  const [location, setLocation] = useState(null);

  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then((p) => setLocation(p.granted ? 'Allowed' : 'Not allowed'))
      .catch(() => setLocation('Unknown'));
  }, []);

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Settings" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <AppText variant="label" color={colors.fgSecondary} style={styles.groupLabel}>
          Appearance
        </AppText>
        <Card style={styles.list} accessibilityRole="radiogroup">
          {APPEARANCE.map(([key, label, icon], index) => {
            const selected = preference === key;
            return (
              <View key={key}>
                {index ? <Divider /> : null}
                <Pressable testID={`theme-${key}`} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => setPreference(key)} style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.muted }]}>
                  <Icon name={icon} size={22} />
                  <AppText variant="body" style={{ flex: 1, marginLeft: space(4) }}>
                    {label}
                  </AppText>
                  <Icon name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.accent : colors.fgMuted} />
                </Pressable>
              </View>
            );
          })}
        </Card>

        <AppText variant="label" color={colors.fgSecondary} style={styles.groupLabel}>
          Privacy
        </AppText>
        <Card style={styles.list}>
          <ListRow icon="location-outline" label="Location access" value={location ?? '…'} onPress={() => Linking.openSettings()} />
        </Card>

        <AppText variant="label" color={colors.fgSecondary} style={styles.groupLabel}>
          App
        </AppText>
        <Card style={styles.list}>
          <ListRow icon="information-circle-outline" label="About EduTrack" onPress={() => navigation.navigate('About')} />
        </Card>
        <Card style={[styles.list, { marginTop: space(5) }]}>
          <ListRow icon="log-out-outline" label="Sign out" tone="danger" onPress={requestSignOut} />
        </Card>
      </ScrollView>
      {dialog}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space(5), paddingTop: 0, paddingBottom: space(8) },
  groupLabel: { marginTop: space(4), marginBottom: space(2), marginLeft: space(1) },
  list: { padding: 0, overflow: 'hidden' },
  option: { flexDirection: 'row', alignItems: 'center', minHeight: TOUCH + 8, paddingHorizontal: space(4) },
});
