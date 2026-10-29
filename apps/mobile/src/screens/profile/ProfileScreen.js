/*
 * 12. Profile (read only, GET /api/attendance/profile): name, job title, phone, Staff ID, branch
 * and school; sync status, settings, about and sign out. There is no account editing and no
 * voluntary password change in the app (not approved); a forgotten password is reset by the
 * branch Manager.
 */
import { ScrollView, StyleSheet, View } from 'react-native';
import { userMessage } from '../../api/errors';
import { useAttendance } from '../../attendance/AttendanceProvider';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Card, Divider, ListRow, Notice, Screen } from '../../components/ui';
import { APP_VERSION } from '../../config';
import { initials } from '../../lib/format';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { useSignOut } from './useSignOut';

export default function ProfileScreen({ navigation }) {
  const { colors } = useTheme();
  const { user } = useSession();
  const { profile, pendingCount, loadError, refresh } = useAttendance();
  const { requestSignOut, dialog } = useSignOut();
  const name = profile?.name ?? user?.name ?? '';

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="section" accessibilityRole="header">
          Profile
        </AppText>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.identity}>
          <View style={[styles.avatar, { backgroundColor: colors.interactive }]} importantForAccessibility="no-hide-descendants">
            <AppText variant="section" color="#FFFFFF">
              {initials(name)}
            </AppText>
          </View>
          <View style={{ marginLeft: space(4), flex: 1 }}>
            <AppText variant="section">{name}</AppText>
            {profile?.jobTitle ? (
              <AppText variant="small" color={colors.fgSecondary}>
                {profile.jobTitle}
              </AppText>
            ) : null}
          </View>
        </Card>

        {!profile && loadError ? (
          <View style={{ marginTop: space(3) }}>
            <Notice tone="error" message={`Your profile couldn’t be loaded. ${userMessage(loadError)}`} onRetry={refresh} />
          </View>
        ) : null}

        {profile ? (
          <Card style={styles.list}>
            <ListRow icon="call-outline" label="Phone number" value={profile.phone ?? '—'} />
            <Divider />
            <ListRow icon="id-card-outline" label="Staff ID" value={profile.staffId ?? '—'} />
            <Divider />
            <ListRow icon="office-building" family="mci" label="Branch" value={`${profile.branch.code} · ${profile.branch.name}`} />
            <Divider />
            <ListRow icon="school-outline" label="School" value={profile.school.name} />
            {profile.email ? (
              <>
                <Divider />
                <ListRow icon="mail-outline" label="Email" value={profile.email} />
              </>
            ) : null}
          </Card>
        ) : null}

        <Card style={styles.list}>
          <ListRow testID="open-sync" icon="sync" label="Sync status" value={pendingCount ? `${pendingCount} pending` : 'All uploaded'} onPress={() => navigation.navigate('Sync')} />
          <Divider />
          <ListRow testID="open-settings" icon="settings-outline" label="Settings" onPress={() => navigation.navigate('Settings')} />
          <Divider />
          <ListRow icon="information-circle-outline" label="About EduTrack" value={`v${APP_VERSION}`} onPress={() => navigation.navigate('About')} />
        </Card>

        <Card style={styles.list}>
          <ListRow testID="sign-out" icon="log-out-outline" label="Sign out" tone="danger" onPress={requestSignOut} />
        </Card>
      </ScrollView>
      {dialog}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space(5), paddingVertical: space(3) },
  content: { padding: space(5), paddingTop: 0, paddingBottom: space(8) },
  identity: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 60, height: 60, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  list: { marginTop: space(3), padding: 0, overflow: 'hidden' },
});
