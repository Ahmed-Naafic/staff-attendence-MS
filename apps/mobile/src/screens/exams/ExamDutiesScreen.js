/*
 * My examination duties: the rooms this teacher invigilates today and in the next two weeks (published
 * or not, scheduled examinations). Today's rooms open the attendance list. Needs a connection.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { fetchExamDuties } from '../../api/endpoints';
import { userMessage } from '../../api/errors';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Badge, Card, EmptyState, LoadingView, Notice, Screen, ScreenHeader } from '../../components/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

export default function ExamDutiesScreen({ navigation }) {
  const { api } = useSession();
  const { colors } = useTheme();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchExamDuties(api));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  if (!data && loading) return <LoadingView label="Loading your duties…" />;
  return (
    <Screen>
      <ScreenHeader title="Examination duties" subtitle="Rooms you invigilate" onBack={() => navigation.goBack()} />
      <FlatList
        testID="exam-duties"
        data={data?.duties ?? []}
        keyExtractor={(d) => `${d.session.id}|${d.room.id}`}
        refreshing={loading}
        onRefresh={load}
        contentContainerStyle={{ padding: space(5), paddingTop: 0, gap: space(3), flexGrow: 1 }}
        ListHeaderComponent={error ? <Notice title="Your duties could not be loaded" message={userMessage(error)} onRetry={load} /> : null}
        ListEmptyComponent={data ? <EmptyState icon="clipboard-outline" title="No duties" message="Rooms you invigilate in the next two weeks appear here." /> : null}
        renderItem={({ item }) => (
          <Pressable
            testID={`duty-${item.session.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${item.examination.name}, ${item.room.name}, ${item.session.date} ${item.session.start}`}
            onPress={() => navigation.navigate('ExamRoom', { sessionId: item.session.id, roomId: item.room.id })}
          >
            <Card>
              <View style={styles.row}>
                <AppText variant="cardTitle">
                  {item.room.name} · {item.session.start}–{item.session.end}
                </AppText>
                {item.canMark ? <Badge tone="success" label="Today" /> : <Badge tone="neutral" label={item.session.date} />}
              </View>
              <AppText variant="small" color={colors.fgSecondary} style={{ marginTop: space(1) }}>
                {item.examination.name} · {item.branch?.name}
              </AppText>
              <AppText variant="small" color={colors.fgMuted} style={{ marginTop: space(1) }}>
                {item.papers.join(', ')}
              </AppText>
              <AppText variant="caption" color={colors.fgMuted} style={{ marginTop: space(1) }}>
                {item.summary.students} students{item.summary.notTaken < item.summary.students ? ` · ${item.summary.students - item.summary.notTaken} marked` : ''}
              </AppText>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
});
