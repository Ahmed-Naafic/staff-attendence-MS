/*
 * One paper's marks for one class: type each student's marks (or absent), save, then submit them for
 * approval. Students absent or excused in the examination attendance get no marks. After submitting,
 * or after the deadline, the sheet is read only (the Manager returns it or enters marks).
 *
 * Offline (docs/mobile/offline-sync.md): the sheet is kept on the phone, and Save always goes through
 * the outbox as a draft (a new record with its own id, uploaded at once when online, later when not;
 * the server checks it as usual). Submitting for approval is online only, and only once no draft of
 * this sheet is waiting. A refused draft can be corrected from the Sync screen (route param
 * `replacesId`): the correction is a new record that names the refused one.
 */
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { fetchMarkSheet, submitMarks } from '../../api/endpoints';
import { userMessage } from '../../api/errors';
import { useSession } from '../../auth/SessionProvider';
import { useAttendance } from '../../attendance/AttendanceProvider';
import { readValue, writeValue } from '../../db/database';
import { addToOutbox, getOutboxItem, pendingOutbox } from '../../sync/outbox';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { AppText, Badge, Button, LoadingView, Notice, Screen, ScreenHeader } from '../../components/ui';
import { markChanges, SHEET_LABELS, SHEET_TONES } from '../../exams/examRules';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space, TOUCH } from '../../theme/tokens';

export default function ExamMarkSheetScreen({ navigation, route }) {
  const { api, user } = useSession();
  const { openDatabase, syncNow, reloadQueue, online } = useAttendance();
  const { branch } = useWorkspace();
  const { colors } = useTheme();
  const { paperId, sectionId, replacesId = null } = route.params;
  const [saved, setSaved] = useState(false);
  const [waitingDrafts, setWaitingDrafts] = useState(0);
  const cacheKey = `marksheet:${user.id}:${paperId}:${sectionId}`;
  const [sheet, setSheet] = useState(null);
  const [typed, setTyped] = useState({});
  const [absent, setAbsent] = useState({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const countDrafts = useCallback(async () => {
    const mine = (await pendingOutbox(await openDatabase(), user.id)).filter((i) => i.kind === 'exam-marks' && i.payload.paperId === paperId && i.payload.sectionId === sectionId);
    setWaitingDrafts(mine.length);
    return mine;
  }, [openDatabase, user.id, paperId, sectionId]);

  const load = useCallback(async () => {
    const db = await openDatabase();
    try {
      const fresh = await fetchMarkSheet(api, paperId, sectionId);
      setSheet(fresh);
      setSaved(false);
      await writeValue(db, cacheKey, fresh);
    } catch (e) {
      const copy = await readValue(db, cacheKey);
      if (copy) {
        setSheet(copy);
        setSaved(true);
      } else setMessage({ tone: 'error', text: userMessage(e) });
    }
    await countDrafts().catch(() => {});
  }, [api, paperId, sectionId, openDatabase, cacheKey, countDrafts]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(() => {});
  }, [load]);
  if (!sheet) return message ? <Screen><ScreenHeader title="Marks" onBack={() => navigation.goBack()} /><View style={{ padding: space(5) }}><Notice title="These marks could not be loaded" message={message.text} onRetry={load} /></View></Screen> : <LoadingView label="Loading marks…" />;

  const max = sheet.paper.maxMarks;
  const { entries, errors } = markChanges(sheet.students, typed, absent, max);
  const edit = sheet.actions.edit;
  // Save: a draft record in the outbox, uploaded at once when online (src/sync/outboxSync.js).
  const saveDraft = async () => {
    setBusy('save');
    setMessage(null);
    try {
      const db = await openDatabase();
      const id = Crypto.randomUUID();
      await addToOutbox(db, user.id, { id, kind: 'exam-marks', label: `${sheet.paper.subject.name} · ${sheet.section.name}`, payload: { paperId, sectionId, marks: entries }, branch, replacesId });
      await reloadQueue();
      let result = await syncNow();
      let item = await getOutboxItem(db, id);
      if (item.state === 'pending' && !result?.stoppedBy) {
        result = await syncNow();
        item = await getOutboxItem(db, id);
      }
      if (item.state === 'recorded') {
        setTyped({});
        setAbsent({});
        await load();
        setMessage({ tone: 'success', text: replacesId ? 'Correction saved.' : 'Marks saved.' });
      } else if (item.state === 'rejected') {
        setMessage({ tone: 'error', text: item.errorMessage ?? 'The server did not accept these marks.' });
      } else {
        // Kept on the phone: show the typed marks on the saved sheet until the upload.
        const next = { ...sheet, students: sheet.students.map((s) => { const e = entries.find((x) => x.student === s.student.id); return e ? { ...s, marks: e.marks, absent: e.absent } : s; }) };
        setSheet(next);
        await writeValue(db, cacheKey, next);
        setTyped({});
        setAbsent({});
        await countDrafts();
        setMessage({ tone: 'warning', text: 'Saved on this phone. The marks upload when you’re back online; check them in Sync status.' });
      }
    } catch (e) {
      setMessage({ tone: 'error', text: userMessage(e) });
    } finally {
      setBusy('');
    }
  };
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
            {saved ? <Notice tone="warning" icon="wifi" title="Saved copy of this sheet" message="You’re working offline. Saved marks upload when you’re back online." /> : null}
            {replacesId ? <Notice tone="info" title="Correcting refused marks" message="Your correction is a new upload; the refused one stays in Sync status." /> : null}
            {waitingDrafts ? <Notice tone="info" icon="cloud-upload-outline" message={`${waitingDrafts} saved change${waitingDrafts === 1 ? ' is' : 's are'} waiting to upload. Submit once ${waitingDrafts === 1 ? 'it has' : 'they have'} uploaded.`} /> : null}
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
              <Button testID="save-marks" title={entries.length ? `Save ${entries.length}` : 'Save marks'} icon="checkmark" loading={busy === 'save'} disabled={!entries.length || Object.keys(errors).length > 0} onPress={saveDraft} />
              <Button testID="submit-marks" title="Submit for approval" variant="ghost" loading={busy === 'submit'} disabled={!sheet.actions.submit || entries.length > 0 || waitingDrafts > 0 || !online || saved} onPress={() => run('submit', () => submitMarks(api, paperId, sectionId), 'Submitted for approval.')} />
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
