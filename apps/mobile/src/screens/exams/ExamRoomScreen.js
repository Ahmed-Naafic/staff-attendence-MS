/*
 * One examination room: its students by seat, each present, late, absent or excused. Taken on the day
 * of the paper by the room's invigilators; afterwards the Manager corrects it. Needs a connection.
 */
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { fetchExamRoom, putExamAttendance } from '../../api/endpoints';
import { userMessage } from '../../api/errors';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Badge, Button, LoadingView, Notice, Screen, ScreenHeader } from '../../components/ui';
import { attendanceChanges, attendanceCount, EXAM_STATUS_LABELS, EXAM_STATUS_TONES, EXAM_STATUSES, restPresent } from '../../exams/examRules';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space, TOUCH } from '../../theme/tokens';

export default function ExamRoomScreen({ navigation, route }) {
  const { api } = useSession();
  const { colors } = useTheme();
  const { sessionId, roomId } = route.params;
  const [room, setRoom] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    try {
      setRoom(await fetchExamRoom(api, sessionId, roomId));
    } catch (e) {
      setMessage({ tone: 'error', text: userMessage(e) });
    }
  }, [api, sessionId, roomId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(() => {});
  }, [load]);

  if (!room) return message ? <Screen><ScreenHeader title="Examination room" onBack={() => navigation.goBack()} /><View style={{ padding: space(5) }}><Notice title="This room could not be loaded" message={message.text} onRetry={load} /></View></Screen> : <LoadingView label="Loading the room…" />;
  const changes = attendanceChanges(room.seats, draft);
  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      setRoom(await putExamAttendance(api, { session: sessionId, room: roomId, marks: changes }));
      setDraft({});
      setMessage({ tone: 'success', text: 'Attendance saved.' });
    } catch (e) {
      setMessage({ tone: 'error', text: userMessage(e) });
    } finally {
      setSaving(false);
    }
  }
  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={`${room.room.name} · ${room.session.start}–${room.session.end}`} subtitle={room.examination.name} onBack={() => navigation.goBack()} />
      <FlatList
        testID="exam-room"
        data={room.seats}
        keyExtractor={(s) => s.student.id}
        contentContainerStyle={{ padding: space(5), paddingTop: 0, flexGrow: 1 }}
        ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />}
        ListHeaderComponent={
          <View style={{ gap: space(3), marginBottom: space(3) }}>
            {!room.canMark ? <Notice tone="info" message={`Attendance is taken on the day of the paper (${room.session.date}). Your Manager corrects it afterwards.`} /> : null}
            {message ? <Notice tone={message.tone} message={message.text} /> : null}
            <View style={styles.row}>
              <AppText variant="small" color={colors.fgSecondary}>{attendanceCount(room.seats, draft)}</AppText>
              {room.canMark ? <Button title="Rest present" variant="ghost" onPress={() => setDraft((d) => restPresent(room.seats, d))} /> : null}
            </View>
          </View>
        }
        renderItem={({ item }) => {
          const shown = draft[item.student.id] ?? item.attendance;
          return (
            <View style={{ paddingVertical: space(3) }}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <AppText variant="cardTitle">{item.seatNumber}. {item.student.name}</AppText>
                  <AppText variant="caption" color={colors.fgMuted}>{item.section.name} · {item.subject}</AppText>
                </View>
                {!room.canMark ? <Badge label={EXAM_STATUS_LABELS[shown] ?? 'Not taken'} tone={EXAM_STATUS_TONES[shown] ?? 'neutral'} /> : null}
              </View>
              {room.canMark ? (
                <View style={[styles.row, { marginTop: space(2), gap: space(1) }]} accessibilityRole="radiogroup" accessibilityLabel={`Attendance of ${item.student.name}`}>
                  {EXAM_STATUSES.map((status) => {
                    const on = shown === status;
                    const tone = EXAM_STATUS_TONES[status];
                    return (
                      <Pressable
                        key={status}
                        testID={`${status}-${item.student.id}`}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${EXAM_STATUS_LABELS[status]}: ${item.student.name}`}
                        onPress={() => setDraft((d) => ({ ...d, [item.student.id]: status }))}
                        style={[styles.choice, { borderColor: on ? colors[tone] : colors.border, backgroundColor: on ? colors[`${tone}Soft`] : colors.surface }]}
                      >
                        <AppText variant="caption" color={on ? colors[`${tone}Fg`] : colors.fgSecondary} style={{ fontWeight: '600' }}>{EXAM_STATUS_LABELS[status]}</AppText>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        }}
        ListFooterComponent={room.canMark ? <Button testID="save-exam-room" title={changes.length ? `Save ${changes.length}` : 'Save attendance'} icon="checkmark" onPress={save} loading={saving} disabled={!changes.length} style={{ marginTop: space(5) }} /> : null}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  choice: { flex: 1, minHeight: TOUCH, borderWidth: 1.5, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
