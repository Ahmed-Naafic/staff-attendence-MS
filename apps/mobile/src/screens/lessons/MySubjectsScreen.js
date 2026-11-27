/*
 * My Subjects: the teacher's subjects with the classes each is taught in, from the same teaching
 * assignments as My classes (GET /api/teacher/teaching), readable offline from the copy on this
 * phone. Only the branch chosen in the header when the teacher works in more than one.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { fetchMyTeaching } from '../../api/endpoints';
import { userMessage } from '../../api/errors';
import { useAttendance } from '../../attendance/AttendanceProvider';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Card, EmptyState, LoadingView, Notice, Screen, ScreenHeader } from '../../components/ui';
import { readValue, writeValue } from '../../db/database';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { inBranch } from '../../workspace/workspaces';
import { useWorkspace } from '../../workspace/WorkspaceProvider';

/** Subject assignments grouped by subject: [{ key, name, classes: [displayName] }], by name. */
export function subjectGroups(items = []) {
  const groups = new Map();
  for (const a of items) {
    if (a.role !== 'subject' || !a.subject) continue;
    const key = a.subject.id ?? a.subject.name;
    if (!groups.has(key)) groups.set(key, { key, name: a.subject.name, classes: [] });
    const g = groups.get(key);
    if (!g.classes.includes(a.section.displayName)) g.classes.push(a.section.displayName);
  }
  return [...groups.values()].map((g) => ({ ...g, classes: g.classes.sort((x, y) => x.localeCompare(y, undefined, { numeric: true })) })).sort((x, y) => x.name.localeCompare(y.name));
}

export default function MySubjectsScreen({ navigation }) {
  const { api, user } = useSession();
  const { online, openDatabase } = useAttendance();
  const { colors } = useTheme();
  const { branchId, branches, version } = useWorkspace();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [offlineCopy, setOfflineCopy] = useState(false);

  const load = useCallback(async () => {
    const db = await openDatabase();
    setLoading(true);
    try {
      const teaching = await fetchMyTeaching(api);
      setData(teaching);
      setError(null);
      setOfflineCopy(false);
      await writeValue(db, `teaching:${user.id}`, teaching);
    } catch (e) {
      setError(e);
      const saved = await readValue(db, `teaching:${user.id}`);
      if (saved) {
        setData(saved);
        setOfflineCopy(true);
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, openDatabase, user.id, version]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  if (!data && loading) return <LoadingView label="Loading your subjects…" />;
  const items = (data?.items ?? []).filter((i) => branches.length < 2 || inBranch(i, branchId));
  const groups = subjectGroups(items);
  return (
    <Screen>
      <ScreenHeader title="My Subjects" subtitle={groups.length ? `${groups.length} subject${groups.length === 1 ? '' : 's'}` : undefined} onBack={() => navigation.goBack()} />
      <FlatList
        testID="subjects-list"
        data={groups}
        keyExtractor={(g) => g.key}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: space(5), paddingTop: 0, flexGrow: 1, gap: space(2) }}
        ListHeaderComponent={
          <View style={{ gap: space(3), marginBottom: space(2) }}>
            {!data && error ? <Notice title="Your subjects could not be loaded" message={userMessage(error)} onRetry={load} /> : null}
            {offlineCopy ? <Notice tone="warning" icon="wifi" title={online ? 'Showing your saved subjects' : 'You’re offline'} message="Pull down to update when you’re back online." /> : null}
          </View>
        }
        ListEmptyComponent={data ? <EmptyState icon="library-outline" title="No subjects yet" message="Your Manager assigns the subjects you teach. They appear here." /> : null}
        renderItem={({ item }) => (
          <Card>
            <AppText variant="cardTitle">{item.name}</AppText>
            <AppText variant="small" color={colors.fgSecondary} style={{ marginTop: space(1) }}>
              {item.classes.join(' · ')}
            </AppText>
          </Card>
        )}
      />
    </Screen>
  );
}
