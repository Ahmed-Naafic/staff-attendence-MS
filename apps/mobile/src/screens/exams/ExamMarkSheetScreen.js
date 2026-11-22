/*
 * One paper's marks for one class: type each student's marks (or absent), save, then submit them for
 * approval. Students absent or excused in the examination attendance get no marks. After submitting,
 * or after the deadline, the sheet is read only (the Manager returns it or enters marks). Needs a connection.
 */
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { fetchMarkSheet, putMarks, submitMarks } from '../../api/endpoints';
import { userMessage } from '../../api/errors';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Badge, Button, LoadingView, Notice, Screen, ScreenHeader } from '../../components/ui';
import { markChanges, SHEET_LABELS, SHEET_TONES } from '../../exams/examRules';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space, TOUCH } from '../../theme/tokens';

export default function ExamMarkSheetScreen({ navigation, route }) {
  const { api } = useSession();
  const { colors } = useTheme();
  const { paperId, sectionId } = route.params;
  const [sheet, setSheet] = useState(null);
  const [typed, setTyped] = useState({});
  const [absent, setAbsent] = useState({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const load = useCallback(async () => {
    try {
      setSheet(await fetchMarkSheet(api, paperId, sectionId));
    } catch (e) {
      setMessage({ tone: 'error', text: userMessage(e) });
    }
  }, [api, paperId, sectionId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(() => {});
  }, [load]);
  if (!sheet) return message ? <Screen><ScreenHeader title="Marks" onBack={() => navigation.goBack()} /><View style={{ padding: space(5) }}><Notice title="These marks could not be loaded" message={message.text} onRetry={load} /></View></Screen> : <LoadingView label="Loading marks…" />;

  const max = sheet.paper.maxMarks;
  const { entries, errors } = markChanges(sheet.students, typed, absent, max);
  const edit = sheet.actions.edit;
  const run = async (name, fn, text) => {
    setBusy(name);
    setMessage(null);
    try {
      setSheet(await fn());
      setTyped({});
      setAbsent({});
      setMessage({ tone: 'success', text });
    } catch (e) {
      setMessage({ tone: 'error', text: userMessage(e) });
    } finally {
      setBusy('');
    }
  };
  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={`${sheet.paper.subject.name} · ${sheet.section.name}`} subtitle={`Out of ${max} · due ${sheet.deadline}`} onBack={() => navigation.goBack()} />
      <FlatList
        testID="mark-sheet"
        data={sheet.students}
        keyExtractor={(s) => s.student.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space(5), paddingTop: 0, flexGrow: 1 }}
        ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />}
        ListHeaderComponent={
          <View style={{ gap: space(3), marginBottom: space(3) }}>
            <View style={styles.row}>
              <Badge tone={SHEET_TONES[sheet.status]} label={SHEET_LABELS[sheet.status]} />
              <AppText variant="small" color={colors.fgSecondary}>{sheet.stats.entered}/{sheet.stats.students} entered</AppText>
            </View>
            {sheet.status === 'returned' && sheet.returnedReason ? <Notice tone="warning" title="Returned to you" message={sheet.returnedReason} /> : null}
            {!edit ? <Notice tone="info" message={sheet.status === 'submitted' ? 'Submitted for approval. Your Manager returns it if something needs correcting.' : sheet.status === 'approved' ? 'Approved.' : `The deadline (${sheet.deadline}) has passed. Your Manager enters these marks now.`} /> : null}
            {message ? <Notice tone={message.tone} message={message.text} /> : null}
          </View>
        }
        renderItem={({ item }) => {
          const id = item.student.id;
          const isAbsent = absent[id] ?? item.absent;
          return (
            <View style={[styles.row, { paddingVertical: space(3), gap: space(2) }]}>
              <View style={{ flex: 1 }}>
                <AppText variant="cardTitle">{item.student.name}</AppText>
                <AppText variant="caption" color={errors[id] ? colors.errorFg : colors.fgMuted}>{errors[id] ?? item.student.number}</AppText>
              </View>
              {item.lockedByAttendance ? (
                <Badge tone="warning" label={item.excused ? 'Excused' : 'Absent'} />
              ) : (
                <>
                  {edit && !isAbsent ? (
                    <TextInput
                      testID={`marks-${id}`}
                      accessibilityLabel={`Marks of ${item.student.name}`}
                      keyboardType="decimal-pad"
                      value={typed[id] ?? (item.marks === null ? '' : String(item.marks))}
                      onChangeText={(t) => setTyped((x) => ({ ...x, [id]: t }))}
                      style={[styles.input, { borderColor: errors[id] ? colors.error : colors.border, color: colors.fg, backgroundColor: colors.surface }]}
                    />
                  ) : (
                    <AppText variant="cardTitle">{isAbsent ? 'Absent' : (item.marks ?? '—')}</AppText>
                  )}
                  {edit ? (
                    <Pressable
                      testID={`absent-${id}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isAbsent }}
                      accessibilityLabel={`${item.student.name} absent`}
                      onPress={() => setAbsent((x) => ({ ...x, [id]: !isAbsent }))}
                      style={[styles.absent, { borderColor: isAbsent ? colors.error : colors.border, backgroundColor: isAbsent ? colors.errorSoft : colors.surface }]}
                    >
                      <AppText variant="caption" color={isAbsent ? colors.errorFg : colors.fgSecondary}>Absent</AppText>
                    </Pressable>
                  ) : null}
                </>
              )}
            </View>
          );
        }}
        ListFooterComponent={
          edit ? (
            <View style={{ gap: space(2), marginTop: space(5) }}>
              <Button testID="save-marks" title={entries.length ? `Save ${entries.length}` : 'Save marks'} icon="checkmark" loading={busy === 'save'} disabled={!entries.length || Object.keys(errors).length > 0} onPress={() => run('save', () => putMarks(api, paperId, sectionId, entries), 'Marks saved.')} />
              <Button testID="submit-marks" title="Submit for approval" variant="ghost" loading={busy === 'submit'} disabled={!sheet.actions.submit || entries.length > 0} onPress={() => run('submit', () => submitMarks(api, paperId, sectionId), 'Submitted for approval.')} />
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  input: { width: 72, minHeight: TOUCH, borderWidth: 1.5, borderRadius: radius.md, textAlign: 'center', fontSize: 16 },
  absent: { minHeight: TOUCH, paddingHorizontal: space(2), borderWidth: 1.5, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
