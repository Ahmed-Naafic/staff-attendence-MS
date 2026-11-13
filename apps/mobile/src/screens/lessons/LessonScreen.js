/*
 * One lesson's attendance: the class list with Present / Absent for each student. Saving stores the
 * marks on the phone with the time they were taken, then uploads them (now, or when back online).
 * Late and excused are the Manager's; a student a Manager has marked cannot be changed here. After
 * the lesson's deadline the list is read only (the Manager corrects it).
 */
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { fetchLessons } from '../../api/endpoints';
import { useAttendance } from '../../attendance/AttendanceProvider';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Badge, Button, Notice, Screen, ScreenHeader } from '../../components/ui';
import { readValue, writeValue } from '../../db/database';
import { allPresent, changedMarks, countText, lessonState, STATUS_LABELS, STATUS_TONES, withPhoneMarks } from '../../lessons/lessonRules';
import { enqueueMarks, lessonOutstanding } from '../../lessons/lessonQueue';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space, TOUCH } from '../../theme/tokens';

export default function LessonScreen({ navigation, route }) {
  const { api, user } = useSession();
  const { online, syncNow, openDatabase, clock, reloadQueue } = useAttendance();
  const { colors } = useTheme();
  const [lesson, setLesson] = useState(route.params.lesson);
  const [outstanding, setOutstanding] = useState([]);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const ref = { sectionId: lesson.section.id, date: lesson.date, period: lesson.period };

  const reload = useCallback(
    async (fromServer) => {
      const db = await openDatabase();
      if (fromServer) {
        try {
          const day = await fetchLessons(api, lesson.date);
          const fresh = day.lessons.find((l) => l.key === lesson.key);
          if (fresh) setLesson(fresh);
          const saved = await readValue(db, `lessons:${user.id}`);
          if (saved?.date === day.date) await writeValue(db, `lessons:${user.id}`, day);
        } catch {
          // Offline: keep what is shown.
        }
      }
      setOutstanding(await lessonOutstanding(db, user.id, ref));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, lesson.key, lesson.date, openDatabase, user.id],
  );

  useEffect(() => {
    // State is set only after the device database answers (asynchronously).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload(false).catch(() => {});
  }, [reload]);

  const students = useMemo(() => withPhoneMarks(lesson.students, outstanding), [lesson.students, outstanding]);
  const state = lessonState(lesson, clock());
  const editable = state === 'open';
  const changes = changedMarks(students, draft);

  async function save() {
    if (!changes.length) return;
    setSaving(true);
    setMessage(null);
    try {
      const db = await openDatabase();
      await enqueueMarks(db, user.id, ref, changes.map((c) => ({ ...c, clientMarkId: Crypto.randomUUID() })), clock());
      setDraft({});
      await syncNow();
      await reloadQueue();
      await reload(true);
      const db2 = await openDatabase();
      const left = await lessonOutstanding(db2, user.id, ref);
      const waiting = left.filter((m) => m.state === 'pending').length;
      const refused = left.filter((m) => m.state === 'rejected').length;
      if (refused) setMessage({ tone: 'error', text: `${refused} mark${refused === 1 ? ' was' : 's were'} not accepted. See the students marked below.` });
      else if (waiting) setMessage({ tone: 'warning', text: `Saved on this phone. ${waiting} mark${waiting === 1 ? '' : 's'} will upload when you’re back online.` });
      else setMessage({ tone: 'success', text: 'Attendance saved.' });
    } catch {
      setMessage({ tone: 'error', text: 'The marks could not be saved on this phone. Try again.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={`${lesson.subject.name} · ${lesson.section.displayName}`} subtitle={`${lesson.start}–${lesson.end} · Period ${lesson.period}`} onBack={() => navigation.goBack()} />
      <FlatList
        data={students}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: space(5), paddingTop: 0, flexGrow: 1 }}
        ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />}
        ListHeaderComponent={
          <View style={{ gap: space(3), marginBottom: space(3) }}>
            {!online ? <Notice tone="warning" icon="wifi" title="You’re offline" message="Marks are saved on this phone with the time you take them, and uploaded later." /> : null}
            {state === 'upcoming' ? <Notice tone="info" message="Attendance for this lesson is not open yet." /> : null}
            {state === 'closed' ? <Notice tone="info" message="This lesson’s attendance is closed. Ask your Manager to correct it." /> : null}
            {message ? <Notice tone={message.tone} message={message.text} /> : null}
            <View style={styles.row}>
              <AppText variant="small" color={colors.fgSecondary}>
                {countText(students, draft)}
              </AppText>
              {editable ? <Button title="All present" variant="ghost" onPress={() => setDraft((d) => allPresent(students, d))} /> : null}
            </View>
          </View>
        }
        renderItem={({ item }) => {
          const shown = draft[item.id] ?? item.status;
          return (
            <View style={{ paddingVertical: space(3) }}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <AppText variant="cardTitle">{item.name}</AppText>
                  <AppText variant="caption" color={colors.fgMuted}>
                    {item.number}
                  </AppText>
                </View>
                {!editable || item.setByManager ? <Badge label={STATUS_LABELS[item.waiting ? item.status : item.effective] ?? 'Not marked'} tone={STATUS_TONES[item.waiting ? item.status : item.effective] ?? 'neutral'} /> : null}
              </View>
              {editable && !item.setByManager ? (
                <View style={[styles.row, { marginTop: space(2), gap: space(2) }]} accessibilityRole="radiogroup" accessibilityLabel={`Attendance of ${item.name}`}>
                  {['present', 'absent'].map((status) => {
                    const on = shown === status;
                    const tone = status === 'present' ? 'success' : 'error';
                    return (
                      <Pressable
                        key={status}
                        testID={`${status}-${item.id}`}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${STATUS_LABELS[status]}: ${item.name}`}
                        onPress={() => setDraft((d) => ({ ...d, [item.id]: status }))}
                        style={[styles.choice, { borderColor: on ? colors[tone] : colors.border, backgroundColor: on ? colors[`${tone}Soft`] : colors.surface }]}
                      >
                        <AppText variant="label" color={on ? colors[`${tone}Fg`] : colors.fgSecondary} style={{ fontWeight: '600' }}>
                          {STATUS_LABELS[status]}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              {item.waiting ? <AppText variant="caption" color={colors.warningFg} style={{ marginTop: space(1) }}>Waiting to upload</AppText> : null}
              {item.refused ? <AppText variant="caption" color={colors.errorFg} style={{ marginTop: space(1) }}>Not accepted: {item.refused}</AppText> : null}
              {item.setByManager ? <AppText variant="caption" color={colors.fgMuted} style={{ marginTop: space(1) }}>Set by {item.markedBy ?? 'a Manager'}</AppText> : null}
              {item.excuse ? <AppText variant="caption" color={colors.infoFg} style={{ marginTop: space(1) }}>Excused: {item.excuse.reason}</AppText> : null}
            </View>
          );
        }}
        ListFooterComponent={
          editable ? (
            <Button testID="save-lesson" title={changes.length ? `Save ${changes.length} mark${changes.length === 1 ? '' : 's'}` : 'Save attendance'} icon="checkmark" onPress={save} loading={saving} disabled={!changes.length} style={{ marginTop: space(5) }} />
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  choice: { flex: 1, minHeight: TOUCH, borderWidth: 1.5, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
