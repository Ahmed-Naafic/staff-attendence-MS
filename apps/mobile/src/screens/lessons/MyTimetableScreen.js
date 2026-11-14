/*
 * My week: the teacher's timetable (every class and branch they teach), grouped by school day with
 * today first. Read from GET /api/teacher/timetable and kept on the phone, so it can be read offline.
 * A timetable is academic setup: it shows whether or not the school uses student attendance.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { fetchMyTimetable } from '../../api/endpoints';
import { userMessage } from '../../api/errors';
import { useAttendance } from '../../attendance/AttendanceProvider';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Card, EmptyState, LoadingView, Notice, Screen, ScreenHeader } from '../../components/ui';
import { readValue, writeValue } from '../../db/database';
import { weekSections, weekText } from '../../lessons/timetableRules';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

export default function MyTimetableScreen({ navigation }) {
  const { api, user } = useSession();
  const { online, openDatabase } = useAttendance();
  const { colors } = useTheme();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [offlineCopy, setOfflineCopy] = useState(false);

  const load = useCallback(async () => {
    const db = await openDatabase();
    setLoading(true);
    try {
      const week = await fetchMyTimetable(api);
      setData(week);
      setError(null);
      setOfflineCopy(false);
      await writeValue(db, `timetable:${user.id}`, week);
    } catch (e) {
      setError(e);
      const saved = await readValue(db, `timetable:${user.id}`);
      if (saved) {
        setData(saved);
        setOfflineCopy(true);
      }
    } finally {
      setLoading(false);
    }
  }, [api, openDatabase, user.id]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  const header = <ScreenHeader title="My week" subtitle={data ? weekText(data) : undefined} onBack={() => navigation.goBack()} />;
  if (!data && loading) return <LoadingView label="Loading your week…" />;
  const sections = data ? weekSections(data, data.date) : [];
  return (
    <Screen>
      {header}
      <SectionList
        testID="timetable-list"
        sections={sections}
        keyExtractor={(l) => `${l.weekday}-${l.start}-${l.section.id}`}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: space(5), paddingTop: 0, flexGrow: 1 }}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={{ gap: space(3), marginBottom: space(2) }}>
            {!data && error ? <Notice title="Your week could not be loaded" message={userMessage(error)} onRetry={load} /> : null}
            {offlineCopy ? <Notice tone="warning" icon="wifi" title={online ? 'Showing your saved week' : 'You’re offline'} message="Pull down to update when you’re back online." /> : null}
          </View>
        }
        ListEmptyComponent={data ? <EmptyState icon="calendar-outline" title="No lessons this week" message="Lessons from your school’s timetables appear here." /> : null}
        renderSectionHeader={({ section }) => (
          <View style={styles.dayHeader}>
            <AppText variant="cardTitle" accessibilityRole="header">
              {section.title}
            </AppText>
            <AppText variant="small" color={colors.fgSecondary}>
              {section.data.length ? `${section.data.length} lesson${section.data.length === 1 ? '' : 's'}` : 'Free'}
            </AppText>
          </View>
        )}
        renderItem={({ item }) => (
          <Card style={{ marginBottom: space(2) }}>
            <View style={styles.row}>
              <AppText variant="label" color={colors.fgSecondary}>
                {item.start}–{item.end} · Period {item.period}
              </AppText>
              {item.room ? (
                <AppText variant="small" color={colors.fgMuted}>
                  Room {item.room}
                </AppText>
              ) : null}
            </View>
            <AppText variant="cardTitle" style={{ marginTop: space(1) }}>
              {item.subject.name} · {item.section.displayName}
            </AppText>
            {item.section.branch?.name ? (
              <AppText variant="small" color={colors.fgSecondary}>
                {item.section.branch.name}
              </AppText>
            ) : null}
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: space(4), marginBottom: space(2) },
});
