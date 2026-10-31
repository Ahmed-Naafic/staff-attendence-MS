/*
 * Staff notification centre (N4): the staff member's own notifications and the announcements for
 * staff of their school, newest first, with unread marks, "Mark all as read" and history of the
 * last 90 days. Texts are in Somali. Opening one marks it read. Nothing here can be deleted.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { userMessage } from '../../api/errors';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Button, EmptyState, Icon, LoadingView, Notice, Screen, ScreenHeader } from '../../components/ui';
import { fetchNotifications, markAllRead, markRead } from '../../notifications/api';
import { useNotifications } from '../../notifications/NotificationsProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';

const ICONS = {
  MISSING_CHECK_OUT: 'log-out-outline',
  ASSIGNMENT: 'calendar-outline',
  SCHEDULE: 'time-outline',
  STATUS: 'alert-circle-outline',
  ANNOUNCEMENT: 'megaphone-outline',
  TRANSFER: 'swap-horizontal-outline',
};
const PAGE = 30;

/** Relative day text for a timestamp (English app labels; the notification text itself is Somali). */
function when(iso, now = Date.now()) {
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

export default function NotificationsScreen({ navigation }) {
  const { colors } = useTheme();
  const { api } = useSession();
  const { setUnreadCount } = useNotifications();
  const [state, setState] = useState({ status: 'loading', items: [], total: 0, page: 1, error: null });
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (page = 1) => {
      try {
        const data = await fetchNotifications(api, { page, pageSize: PAGE });
        setUnreadCount(data.unreadCount);
        setState((s) => ({ status: 'ready', items: page === 1 ? data.items : [...s.items, ...data.items], total: data.total, page, error: null }));
      } catch (error) {
        setState((s) => ({ ...s, status: s.items.length ? 'ready' : 'error', error }));
      }
    },
    [api, setUnreadCount],
  );

  useFocusEffect(
    useCallback(() => {
      load(1);
    }, [load]),
  );

  async function open(item) {
    navigation.navigate('NotificationDetail', { item });
    if (item.readAt) return;
    try {
      const read = await markRead(api, item);
      setState((s) => ({ ...s, items: s.items.map((i) => (i.source === item.source && i.id === item.id ? { ...i, readAt: read.readAt } : i)) }));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // Stays unread; the details still open.
    }
  }

  async function readAll() {
    setBusy(true);
    try {
      const { unreadCount } = await markAllRead(api);
      setUnreadCount(unreadCount);
      const at = new Date().toISOString();
      setState((s) => ({ ...s, items: s.items.map((i) => (i.readAt ? i : { ...i, readAt: at })) }));
    } catch (error) {
      setState((s) => ({ ...s, error }));
    } finally {
      setBusy(false);
    }
  }

  const unread = state.items.some((i) => !i.readAt);
  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Notifications" onBack={() => navigation.goBack()} right={<Pressable accessibilityRole="button" accessibilityLabel="Notification settings" onPress={() => navigation.navigate('ReminderSettings')} hitSlop={8} style={styles.headerButton}><Icon name="settings-outline" /></Pressable>} />
      {state.status === 'loading' ? <LoadingView label="Loading notifications…" /> : null}
      {state.status === 'error' ? (
        <View style={styles.padded}>
          <Notice tone="error" title="Notifications couldn’t be loaded" message={userMessage(state.error)} onRetry={() => load(1)} />
        </View>
      ) : null}
      {state.status === 'ready' ? (
        <FlatList
          data={state.items}
          keyExtractor={(i) => `${i.source}:${i.id}`}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => load(1)} tintColor={colors.accent} colors={[colors.accent]} />}
          ListHeaderComponent={
            <View style={{ gap: space(3), marginBottom: space(3) }}>
              {state.error ? <Notice tone="warning" message={userMessage(state.error)} /> : null}
              {unread ? <Button title="Mark all as read" variant="secondary" icon="checkmark-done-outline" onPress={readAll} loading={busy} testID="mark-all-read" /> : null}
            </View>
          }
          ListEmptyComponent={<EmptyState icon="notifications-outline" title="No notifications" message="Changes to your shifts, your branch and messages from EduTrack appear here." />}
          ListFooterComponent={state.items.length < state.total ? <Button title="Show older" variant="ghost" onPress={() => load(state.page + 1)} /> : null}
          renderItem={({ item }) => (
            <Pressable
              testID={`notification-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${item.readAt ? '' : 'Unread. '}${item.title}`}
              onPress={() => open(item)}
              style={({ pressed }) => [styles.row, { backgroundColor: item.readAt ? colors.surface : colors.accentSoft, borderColor: colors.border }, pressed && { opacity: 0.85 }]}
            >
              <Icon name={ICONS[item.category] ?? 'notifications-outline'} size={22} color={item.readAt ? colors.fgMuted : colors.accent} />
              <View style={{ flex: 1, marginLeft: space(3), gap: space(1) }}>
                <AppText variant="body" style={{ fontWeight: item.readAt ? '500' : '700' }}>
                  {item.title}
                </AppText>
                <AppText variant="small" color={colors.fgSecondary} numberOfLines={2}>
                  {item.body}
                </AppText>
                <AppText variant="caption" color={colors.fgMuted}>
                  {when(item.createdAt)}
                </AppText>
              </View>
              {item.readAt ? null : <View style={[styles.dot, { backgroundColor: colors.accent }]} accessibilityElementsHidden />}
            </Pressable>
          )}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  padded: { padding: space(5) },
  list: { padding: space(5), paddingTop: 0, gap: space(2) },
  row: { flexDirection: 'row', alignItems: 'flex-start', padding: space(4), borderRadius: radius.md, borderWidth: 1 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: space(1), marginLeft: space(2) },
  headerButton: { padding: space(2) },
});
