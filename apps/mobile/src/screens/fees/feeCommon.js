/*
 * Shared pieces of the Fee Management screens (Accountant workspace, and Fee Management for
 * Managers): the API base of the open workspace, the online-only guard for money actions and a
 * simple searchable, paged list loaded from the server (nothing financial is kept on the phone
 * except the short-lived dashboard copy).
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { userMessage } from '../../api/errors';
import { useAttendance } from '../../attendance/AttendanceProvider';
import { useSession } from '../../auth/SessionProvider';
import { Button, EmptyState, LoadingView, Notice } from '../../components/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { useWorkspace } from '../../workspace/WorkspaceProvider';

/** The fee API workspace of the open workspace ('accountant' | 'manager'). */
export function useFeeWorkspace() {
  const { workspace } = useWorkspace();
  return workspace === 'manager' ? 'manager' : 'accountant';
}

/**
 * Money actions (payments, cash closing) need a connection and an account the server has just
 * confirmed (fail closed). → async () => null when allowed, else the message to show.
 */
export function useOnlineOnly() {
  const { online } = useAttendance();
  const { verified, refreshAccount } = useSession();
  return useCallback(async () => {
    if (!online) return 'You’re offline. Payments and cash closing need a connection; nothing was recorded.';
    if (!verified && !(await refreshAccount())) return 'Your account could not be confirmed with the server. Nothing was recorded; try again when you’re connected.';
    return null;
  }, [online, verified, refreshAccount]);
}

/** A search box. */
export function SearchBox({ value, onChangeText, placeholder, testID }) {
  const { colors } = useTheme();
  return (
    <TextInput
      testID={testID}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.fgMuted}
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="search"
      accessibilityLabel={placeholder}
      style={[styles.search, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.fg }]}
    />
  );
}

/**
 * A server list with search and "Show more": load(api, ws, { q, page }) → { items, total? }.
 * Online only: when it cannot load, a notice explains it (no saved copy of financial lists).
 */
export function ServerList({ load, renderItem, keyOf, search, emptyTitle, emptyMessage, header, testID }) {
  const { api } = useSession();
  const ws = useFeeWorkspace();
  const { version } = useWorkspace();
  const [q, setQ] = useState('');
  const [state, setState] = useState({ status: 'loading', items: [], total: 0, page: 1, error: null, meta: null });

  const fetchPage = useCallback(
    async (page = 1, text = q) => {
      try {
        const data = await load(api, ws, { q: text || undefined, page, pageSize: 20 });
        const items = data.items ?? [];
        const { items: _items, ...meta } = data;
        setState((s) => ({ status: 'ready', items: page === 1 ? items : [...s.items, ...items], total: data.total ?? items.length, page, error: null, meta }));
      } catch (error) {
        setState((s) => ({ ...s, status: s.items.length ? 'ready' : 'error', error }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, ws, load, q, version],
  );

  // Load on mount and when the inputs change; reload when the screen comes back into view.
  const mounted = useRef(false);
  useEffect(() => {
    fetchPage(1);
    // Only on mount and new inputs (the search box calls fetchPage itself).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, ws, version]);
  useFocusEffect(
    useCallback(() => {
      if (mounted.current) fetchPage(1);
      mounted.current = true;
    }, [fetchPage]),
  );

  return (
    <FlatList
      testID={testID}
      data={state.items}
      keyExtractor={keyOf}
      contentContainerStyle={{ padding: space(5), paddingTop: space(2), gap: space(2), flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => fetchPage(1)} />}
      ListHeaderComponent={
        <View style={{ gap: space(3), marginBottom: space(2) }}>
          {header}
          {search ? (
            <SearchBox
              testID={`${testID}-search`}
              value={q}
              onChangeText={(text) => {
                setQ(text);
                fetchPage(1, text);
              }}
              placeholder={search}
            />
          ) : null}
          {state.error ? <Notice tone={state.items.length ? 'warning' : 'error'} title="Could not load from the server" message={`${userMessage(state.error)} Fee information is not kept on this phone.`} onRetry={() => fetchPage(1)} /> : null}
        </View>
      }
      ListEmptyComponent={state.status === 'loading' ? <LoadingView /> : state.status === 'ready' ? <EmptyState icon="file-tray-outline" title={emptyTitle} message={emptyMessage} /> : null}
      ListFooterComponent={state.items.length < state.total ? <Button title="Show more" variant="ghost" onPress={() => fetchPage(state.page + 1)} /> : null}
      renderItem={(args) => renderItem({ ...args, meta: state.meta })}
    />
  );
}

const styles = StyleSheet.create({
  search: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space(4), minHeight: 48, fontSize: 16 },
});
