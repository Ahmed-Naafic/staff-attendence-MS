/*
 * My classes & subjects: the teacher's live teaching assignments (every class and branch), grouped
 * by class, with lessons a week and how many are in the published timetable. Read from
 * GET /api/teacher/teaching and kept on the phone, so it can be read offline. Academic setup: shown
 * whether or not the school uses student attendance. Assignments are made on the web (Teaching).
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { fetchMyTeaching } from '../../api/endpoints';
import { userMessage } from '../../api/errors';
import { useAttendance } from '../../attendance/AttendanceProvider';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Badge, Card, EmptyState, LoadingView, Notice, Screen, ScreenHeader } from '../../components/ui';
import { readValue, writeValue } from '../../db/database';
import { assignmentTitle, datesText, lessonsText, teachingSections, teachingSummary } from '../../lessons/teachingRules';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

import { inBranch } from '../../workspace/workspaces';
import { useWorkspace } from '../../workspace/WorkspaceProvider';

export default function MyTeachingScreen({ navigation }) {
  const { api, user } = useSession();
  const { online, openDatabase } = useAttendance();
  const { colors } = useTheme();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [offlineCopy, setOfflineCopy] = useState(false);
  const { branchId, branches, version } = useWorkspace();

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
    // A new branch chosen in the header reloads (version).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, openDatabase, user.id, version]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  const header = <ScreenHeader title="My classes & subjects" subtitle={data?.items?.length ? teachingSummary(data) : undefined} onBack={() => navigation.goBack()} />;
  if (!data && loading) return <LoadingView label="Loading your classes…" />;
  // The branch chosen in the header (when the teacher works in more than one).
  const view = data && branches.length > 1 ? { ...data, items: data.items.filter((i) => inBranch(i, branchId)) } : data;
  const sections = view ? teachingSections(view) : [];
  return (
    <Screen>
      {header}
      <SectionList
        testID="teaching-list"
        sections={sections}
        keyExtractor={(a) => a.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: space(5), paddingTop: 0, flexGrow: 1 }}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={{ gap: space(3), marginBottom: space(2) }}>
            {!data && error ? <Notice title="Your classes could not be loaded" message={userMessage(error)} onRetry={load} /> : null}
            {offlineCopy ? <Notice tone="warning" icon="wifi" title={online ? 'Showing your saved classes' : 'You’re offline'} message="Pull down to update when you’re back online." /> : null}
          </View>
        }
        ListEmptyComponent={data ? <EmptyState icon="people-outline" title="No classes yet" message="Your Manager assigns your classes and subjects. They appear here." /> : null}
        renderSectionHeader={({ section }) => (
          <View style={styles.classHeader}>
            <AppText variant="cardTitle" accessibilityRole="header">
              {section.title}
            </AppText>
            <AppText variant="small" color={colors.fgSecondary}>
              {[section.branch, section.year?.status === 'planned' ? section.year.name : ''].filter(Boolean).join(' · ')}
            </AppText>
          </View>
        )}
        renderItem={({ item }) => {
          const lessons = lessonsText(item);
          return (
            <Card style={{ marginBottom: space(2) }}>
              <View style={styles.row}>
                <AppText variant="cardTitle">{assignmentTitle(item)}</AppText>
                {item.state === 'scheduled' ? <Badge tone="info" label="Starts later" /> : null}
              </View>
              {lessons ? (
                <AppText variant="small" color={item.inTimetable === 0 ? colors.warningFg : colors.fgSecondary} style={{ marginTop: space(1) }}>
                  {lessons}
                </AppText>
              ) : null}
              <AppText variant="small" color={colors.fgMuted} style={{ marginTop: space(1) }}>
                {datesText(item)}
              </AppText>
            </Card>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  classHeader: { marginTop: space(4), marginBottom: space(2), gap: 2 },
});
