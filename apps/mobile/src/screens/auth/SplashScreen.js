/*
 * 1. Splash: shown while the stored session is checked. It continues the native splash (navy, the
 * full EduTrack logo, assets/logo-full.png) with a progress indicator and the gold wave.
 */
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { palette, space } from '../../theme/tokens';

const LOGO_FULL = require('../../../assets/logo-full.png');

export default function SplashScreen() {
  const { colors } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: palette.navy900 }]} accessibilityLabel="EduTrack Staff Attendance is starting">
      <View style={styles.center}>
        <Image source={LOGO_FULL} style={styles.logo} resizeMode="contain" accessible accessibilityRole="image" accessibilityLabel="EduTrack School Attendance" />
        <ActivityIndicator color={colors.accent} style={{ marginTop: space(8) }} />
      </View>
      <View style={[styles.wave, { backgroundColor: palette.navy800 }]} />
      <View style={[styles.waveGold, { borderTopColor: palette.gold500 }]} />
      <AppText variant="small" color="#E8EEF5" style={styles.footer}>
        Build a brighter tomorrow{'\n'}through better education
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: space(20) },
  logo: { width: 200, height: 200 },
  wave: { position: 'absolute', bottom: -220, left: -120, right: -120, height: 420, borderRadius: 400, transform: [{ rotate: '-8deg' }] },
  waveGold: { position: 'absolute', bottom: 70, left: -80, right: -160, height: 200, borderTopWidth: 10, borderRadius: 300, transform: [{ rotate: '-10deg' }] },
  footer: { position: 'absolute', bottom: space(12), left: 0, right: 0, textAlign: 'center' },
});
