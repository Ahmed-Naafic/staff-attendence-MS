/*
 * Examination marks: the papers this teacher marks (their subjects in their sections) with the deadline
 * and progress; a sheet opens once the paper has been sat. Needs a connection.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { fetchMarkSheets } from '../../api/endpoints';
import { userMessage } from '../../api/errors';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Badge, Card, EmptyState, LoadingView, Notice, Screen, ScreenHeader } from '../../components/ui';
import { SHEET_LABELS, SHEET_TONES } from '../../exams/examRules';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

export default function ExamMarksScreen({ navigation }) {
  const { api } = useSession();
  const { colors } = useTheme();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchMarkSheets(api));
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
  if (!data && loading) return <LoadingView label="Loading your marks…" />;
  return (
    <Screen>
      <ScreenHeader title="Examination marks" subtitle="Your papers" onBack={() => navigation.goBack()} />
      <FlatList
        testID="mark-sheets"
        data={data?.items ?? []}
        keyExtractor={(i) => `${i.paper.id}|${i.section.id}`}
        refreshing={loading}
        onRefresh={load}
        contentContainerStyle={{ padding: space(5), paddingTop: 0, gap: space(3), flexGrow: 1 }}
        ListHeaderComponent={error ? <Notice title="Your marks could not be loaded" message={userMessage(error)} onRetry={load} /> : null}
        ListEmptyComponent={data ? <EmptyState icon="create-outline" title="No papers to mark" message="Papers of your subjects in your classes appear here." /> : null}
        renderItem={({ item }) => (
          <Pressable
            testID={`sheet-${item.paper.id}-${item.section.id}`}
            accessibilityRole="button"
            disabled={!item.opened}
            onPress={() => navigation.navigate('ExamMarkSheet', { paperId: item.paper.id, sectionId: item.section.id })}
          >
            <Card>
              <View style={styles.row}>
                <AppText variant="cardTitle">{item.paper.subject.name} · {item.section.name}</AppText>
                <Badge tone={item.opened ? SHEET_TONES[item.status] : 'neutral'} label={item.opened ? SHEET_LABELS[item.status] : 'Not sat yet'} />
              </View>
              <AppText variant="small" color={colors.fgSecondary} style={{ marginTop: space(1) }}>{item.examination.name} · out of {item.paper.maxMarks}</AppText>
              <AppText variant="caption" color={item.canEdit ? colors.fgMuted : colors.fgSecondary} style={{ marginTop: space(1) }}>
                {item.entered}/{item.students} entered · due {item.deadline}
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
