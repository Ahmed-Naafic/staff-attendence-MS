/* One notification or announcement in full (Somali text as stored), with the guide link of an announcement. */
import { Image, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { AppText, Badge, Button, Card, Screen, ScreenHeader } from '../../components/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

const CATEGORY = {
  MISSING_CHECK_OUT: 'Missing check-out',
  ASSIGNMENT: 'Shift assignment',
  SCHEDULE: 'Schedule change',
  STATUS: 'School or branch status',
  ANNOUNCEMENT: 'EduTrack announcement',
  TRANSFER: 'Branch transfer',
};

export default function NotificationDetailScreen({ navigation, route }) {
  const { colors } = useTheme();
  const item = route.params?.item;
  if (!item) return null;
  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Notification" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={{ gap: space(3) }}>
          <View style={{ flexDirection: 'row' }}>
            <Badge label={CATEGORY[item.category] ?? 'Notification'} tone={item.category === 'STATUS' ? 'warning' : 'info'} />
          </View>
          <AppText variant="section">{item.title}</AppText>
          {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.image} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
          <AppText variant="body">{item.body}</AppText>
          <AppText variant="caption" color={colors.fgMuted}>
            {new Date(item.createdAt).toISOString().replace('T', ' ').slice(0, 16)} UTC
          </AppText>
          {item.linkUrl ? <Button title="Open the guide" variant="secondary" icon="open-outline" onPress={() => Linking.openURL(item.linkUrl)} /> : null}
        </Card>
        {item.category === 'MISSING_CHECK_OUT' ? (
          <AppText variant="small" color={colors.fgSecondary} style={{ marginTop: space(3) }}>
            This notice changes nothing in your attendance record. Speak to your Manager if something is wrong.
          </AppText>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space(5), paddingTop: 0 },
  image: { width: '100%', height: 180, borderRadius: 12 },
});
