/* About EduTrack: version and how attendance is handled on this phone. */
import { ScrollView, StyleSheet, View } from 'react-native';
import { AppText, Card, Logo, Screen, ScreenHeader, ValueRow } from '../../components/ui';
import { apiBaseUrl, APP_VERSION } from '../../config';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

export default function AboutScreen({ navigation }) {
  const { colors } = useTheme();
  let server = '—';
  try {
    server = new URL(apiBaseUrl()).host;
  } catch {
    server = 'Not set';
  }
  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="About EduTrack" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: space(5), paddingTop: 0 }}>
        <View style={styles.brand}>
          <Logo size={64} />
          <AppText variant="title" style={{ marginTop: space(2) }}>
            EduTrack
          </AppText>
          <AppText variant="body" color={colors.fgSecondary}>
            Staff Attendance
          </AppText>
        </View>
        <Card>
          <ValueRow label="Version" value={APP_VERSION} />
          <ValueRow label="Server" value={server} />
        </Card>
        <Card style={{ marginTop: space(3) }}>
          <AppText variant="small" color={colors.fgSecondary}>
            Your location is read only when you check in or out, and is sent with that event to verify that you are within 100 m of your branch. Attendance saved while offline stays on this phone until it is uploaded; the server decides whether each event is accepted. If you forget your password, ask your branch Manager to set a new temporary password.
          </AppText>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', marginVertical: space(6) },
});
