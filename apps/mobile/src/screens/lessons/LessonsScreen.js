/*
 * My lessons: the teacher's lessons of the day from the timetable, each with its time, class and
 * whether attendance has been taken. Kept on the phone so the list (and class lists) can be used
 * offline. Staff without lessons see an empty day; when the school has not switched Student
 * Attendance on, a plain notice.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { fetchLessons } from '../../api/endpoints';
import { userMessage } from '../../api/errors';
import { useAttendance } from '../../attendance/AttendanceProvider';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Badge, Card, EmptyState, Icon, LoadingView, Notice, Screen } from '../../components/ui';
import { readValue, writeValue } from '../../db/database';
import { formatDay } from '../../lib/format';
import { countText, lessonState, STATE_LABELS } from '../../lessons/lessonRules';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

const STATE_TONES = { upcoming: 'neutral', open: 'info', closed: 'neutral' };

export default function LessonsScreen({ navigation }) {
  const { api, user } = useSession();
  const { online, lessonPendingCount, openDatabase, clock } = useAttendance();
  const { colors } = useTheme();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [offlineCopy, setOfflineCopy] = useState(false);

  const load = useCallback(async () => {
    const db = await openDatabase();
    setLoading(true);
    try {
      const day = await fetchLessons(api);
      setData(day);
      setError(null);
      setOfflineCopy(false);
      await writeValue(db, `lessons:${user.id}`, day);
    } catch (e) {
      setError(e);
      const saved = await readValue(db, `lessons:${user.id}`);
      if (saved && e.code !== 'FEATURE_DISABLED') {
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

  if (!data && error?.code === 'FEATURE_DISABLED') {
    return (
      <Screen>
        <Header />
        <EmptyState icon="school-outline" title="Student attendance is not on" message="Your school has not switched on student attendance yet." />
      </Screen>
    );
  }
  if (!data && loading) return <LoadingView label="Loading your lessons…" />;
  const now = clock();
  return (
    <Screen>
      <FlatList
        data={data?.lessons ?? []}
        keyExtractor={(l) => l.key}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: space(5), paddingTop: 0, flexGrow: 1 }}
        ItemSeparatorComponent={() => <View style={{ height: space(3) }} />}
        ListHeaderComponent={
          <View style={{ gap: space(3), marginBottom: space(4) }}>
            <Header date={data?.date} onWeek={() => navigation.navigate('Timetable')} />
            {!data && error ? <Notice title="Lessons could not be loaded" message={userMessage(error)} onRetry={load} /> : null}
            {offlineCopy ? <Notice tone="warning" icon="wifi" title={online ? 'Showing saved lessons' : 'You’re offline'} message="Marks you take are saved on this phone and uploaded when you’re back online." /> : null}
            {lessonPendingCount ? (
              <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Sync')}>
                <Notice tone="info" icon="cloud-upload-outline" message={`${lessonPendingCount} lesson mark${lessonPendingCount === 1 ? '' : 's'} waiting to upload.`} />
              </Pressable>
            ) : null}
          </View>
        }
        ListEmptyComponent={data ? <EmptyState icon="book-outline" title="No lessons today" message="Lessons from your timetable appear here." /> : null}
        renderItem={({ item }) => {
          const state = lessonState(item, now);
          return (
            <Pressable testID={`lesson-${item.period}-${item.section.id}`} accessibilityRole="button" onPress={() => navigation.navigate('Lesson', { lesson: item })}>
              {({ pressed }) => (
                <Card style={pressed ? { opacity: 0.85 } : null}>
                  <View style={styles.row}>
                    <AppText variant="label" color={colors.fgSecondary}>
                      {item.start}–{item.end} · Period {item.period}
                    </AppText>
                    <Badge label={item.session && state !== 'upcoming' ? 'Taken' : STATE_LABELS[state]} tone={item.session ? 'success' : STATE_TONES[state]} />
                  </View>
                  <AppText variant="cardTitle" style={{ marginTop: space(1) }}>
                    {item.subject.name} · {item.section.displayName}
                  </AppText>
                  <View style={[styles.row, { marginTop: space(1) }]}>
                    <AppText variant="small" color={colors.fgSecondary}>
                      {countText(item.students)}
                    </AppText>
                    <Icon name="chevron-forward" size={18} color={colors.fgMuted} />
                  </View>
                </Card>
              )}
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

function Header({ date, onWeek }) {
  const { colors } = useTheme();
  return (
    <View style={{ paddingTop: space(4) }}>
      <View style={styles.row}>
        <AppText variant="title" accessibilityRole="header">
          My lessons
        </AppText>
        {onWeek ? (
          <Pressable testID="open-timetable" accessibilityRole="button" accessibilityLabel="My week" onPress={onWeek} hitSlop={8} style={styles.week}>
            <Icon name="calendar-outline" size={18} color={colors.interactive} />
            <AppText variant="label" color={colors.interactive}>
              My week
            </AppText>
          </Pressable>
        ) : null}
      </View>
      {date ? (
        <AppText variant="small" color={colors.fgSecondary}>
          {formatDay(date)}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  week: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
});
