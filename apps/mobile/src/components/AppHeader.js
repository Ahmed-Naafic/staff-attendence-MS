/*
 * The app header on every workspace tab: EduTrack brand, the workspace and branch pickers, the
 * shared notification bell (one unread count for every workspace) and the profile button.
 *
 * Switching (docs/mobile/workspaces.md):
 * - another workspace: asked first only when records are waiting to upload (they stay on this phone
 *   for this account and upload as before; nothing is lost or moved);
 * - another branch: always confirmed. Waiting records keep the branch they were made in and are
 *   never moved; the account's home branch does not change; the screens reload for the new branch.
 *   Allowed while offline or when an upload has not finished.
 */
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAttendance } from '../attendance/AttendanceProvider';
import { useSession } from '../auth/SessionProvider';
import { waitingCounts } from '../sync/history';
import { useNotifications } from '../notifications/NotificationsProvider';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { WORKSPACES } from '../workspace/workspaces';
import { AppText, ConfirmDialog, Icon, Logo } from './ui';

const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

/** "2 attendance events and 14 lesson marks" (or ''). */
export function waitingText({ events = 0, marks = 0, drafts = 0 }) {
  const parts = [];
  if (events) parts.push(`${events} attendance event${events === 1 ? '' : 's'}`);
  if (marks) parts.push(`${marks} lesson mark${marks === 1 ? '' : 's'}`);
  if (drafts) parts.push(`${drafts} examination mark draft${drafts === 1 ? '' : 's'}`);
  return parts.join(' and ');
}

export function AppHeader({ navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { unreadCount } = useNotifications();
  const { available, workspace, branches, branch, switchWorkspace, switchBranch, branchesOffline } = useWorkspace();
  const { openDatabase } = useAttendance();
  const [sheet, setSheet] = useState(null); // 'workspace' | 'branch'
  const [confirm, setConfirm] = useState(null); // { kind, value, title, message }
  // Waiting records are counted from the phone's database at the moment of switching.
  const waitingNow = async () => {
    const counts = await openDatabase()
      .then((db) => waitingCounts(db, user.id))
      .catch(() => ({ events: 0, marks: 0, drafts: 0 }));
    return { waiting: waitingText(counts), total: counts.events + counts.marks + counts.drafts };
  };

  async function chooseWorkspace(next) {
    setSheet(null);
    if (next === workspace) return;
    const { waiting, total } = await waitingNow();
    if (!waiting) return switchWorkspace(next);
    setConfirm({
      kind: 'workspace',
      value: next,
      title: `Open ${WORKSPACES[next].label}?`,
      message: `${waiting} ${total === 1 ? 'is' : 'are'} still waiting to upload. ${total === 1 ? 'It stays' : 'They stay'} on this phone and upload as usual.`,
    });
  }

  async function chooseBranch(next) {
    setSheet(null);
    if (next.id === branch?.id) return;
    const { waiting, total } = await waitingNow();
    setConfirm({
      kind: 'branch',
      value: next.id,
      title: `Switch to ${next.name}?`,
      message:
        `The screens will show ${next.name}. ` +
        (waiting ? `${waiting} waiting to upload keep${total === 1 ? 's' : ''} the branch ${total === 1 ? 'it was' : 'they were'} made in. ` : '') +
        'Your home branch does not change.',
    });
  }

  const pill = (testID, icon, label, onPress, enabled) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => [styles.pill, { borderColor: colors.border, backgroundColor: pressed ? colors.muted : colors.surface }]}
    >
      <Icon name={icon} size={16} color={colors.accent} />
      <AppText variant="small" numberOfLines={1} style={{ marginLeft: space(1), fontWeight: '600', flexShrink: 1 }}>
        {label}
      </AppText>
      {enabled ? <Icon name="chevron-down" size={14} color={colors.fgSecondary} style={{ marginLeft: 2 }} /> : null}
    </Pressable>
  );

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + space(1), backgroundColor: colors.page, borderBottomColor: colors.border }]}>
      <View style={styles.row}>
        <Logo size={28} />
        <AppText variant="section" style={{ marginLeft: space(2), fontWeight: '700', flex: 1 }}>
          EduTrack
        </AppText>
        <Pressable
          testID="notifications-bell"
          accessibilityRole="button"
          accessibilityLabel={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
          onPress={() => navigation.navigate('Notifications')}
          hitSlop={8}
          style={styles.round}
        >
          <Icon name="notifications-outline" size={24} />
          {unreadCount ? (
            <View style={[styles.badge, { backgroundColor: colors.error }]} accessibilityElementsHidden importantForAccessibility="no">
              <AppText variant="caption" color="#FFFFFF" style={{ fontWeight: '700', fontSize: 10, lineHeight: 12 }}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </AppText>
            </View>
          ) : null}
        </Pressable>
        <Pressable testID="header-profile" accessibilityRole="button" accessibilityLabel="Profile and settings" onPress={() => navigation.navigate('Profile')} hitSlop={8} style={[styles.avatar, { backgroundColor: colors.accentSoft }]}>
          <AppText variant="small" color={colors.accent} style={{ fontWeight: '700' }}>
            {initials(user?.name)}
          </AppText>
        </Pressable>
      </View>
      {workspace ? (
        <View style={[styles.row, { marginTop: space(2), gap: space(2) }]}>
          {pill('workspace-picker', WORKSPACES[workspace].icon, WORKSPACES[workspace].label, () => setSheet('workspace'), available.length > 1)}
          {branch ? pill('branch-picker', 'business-outline', branch.name + (branchesOffline ? ' (saved)' : ''), () => setSheet('branch'), branches.length > 1) : null}
        </View>
      ) : null}

      <Modal visible={Boolean(sheet)} transparent animationType="fade" onRequestClose={() => setSheet(null)}>
        <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={() => setSheet(null)}>
          <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + space(4) }]}>
            <AppText variant="cardTitle" style={{ marginBottom: space(2) }}>
              {sheet === 'workspace' ? 'Workspace' : 'Branch'}
            </AppText>
            <ScrollView>
              {sheet === 'workspace'
                ? available.map((key) => (
                    <Option key={key} testID={`workspace-${key}`} icon={WORKSPACES[key].icon} label={WORKSPACES[key].label} selected={key === workspace} onPress={() => chooseWorkspace(key)} />
                  ))
                : branches.map((b) => (
                    <Option key={b.id} testID={`branch-${b.id}`} icon="business-outline" label={b.name} hint={b.home ? 'Home branch' : null} selected={b.id === branch?.id} onPress={() => chooseBranch(b)} />
                  ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <ConfirmDialog
        visible={Boolean(confirm)}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel="Switch"
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c?.kind === 'workspace') switchWorkspace(c.value);
          if (c?.kind === 'branch') switchBranch(c.value);
        }}
        onCancel={() => setConfirm(null)}
      />
    </View>
  );
}

function Option({ icon, label, hint, selected, onPress, testID }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.muted }]}>
      <Icon name={icon} size={20} />
      <View style={{ flex: 1, marginLeft: space(3) }}>
        <AppText variant="body">{label}</AppText>
        {hint ? (
          <AppText variant="caption" color={colors.fgSecondary}>
            {hint}
          </AppText>
        ) : null}
      </View>
      <Icon name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.accent : colors.fgMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space(4), paddingBottom: space(2), borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center' },
  round: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  badge: { position: 'absolute', top: 6, right: 6, minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginLeft: space(1) },
  pill: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space(3), minHeight: 36, maxWidth: '60%' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space(5), maxHeight: '70%' },
  option: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderRadius: radius.md, paddingHorizontal: space(2) },
});
