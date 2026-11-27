/*
 * Manager workspace (docs/mobile/workspaces.md): the Manager's existing modules adapted for the
 * phone, over the Manager API (/api/manager/...). The server scopes everything to the Manager's
 * branch and decides each permission; corrections are recorded and audited by the server.
 *
 * - Home: the branch dashboard (GET /dashboard), kept on the phone for offline viewing and marked
 *   with its freshness (fee figures as not live).
 * - Students: the branch's students (GET /students, /students/:id).
 * - Attendance: staff attendance of a day (GET /attendance/records, review only: staff attendance
 *   corrections do not exist on the server) and student attendance (GET /student-attendance/day,
 *   sessions and corrections with PUT /student-attendance/sessions/:id/marks; an excuse needs a reason).
 * - More: staff, classes and their timetables, examinations, Fee Management, staff devices.
 * Everything except the dashboard is online only.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { userMessage } from '../../api/errors';
import { useSession } from '../../auth/SessionProvider';
import { Freshness, QuickActions, SectionTitle, SkeletonGrid, StatGrid } from '../../components/dashboard';
import { AppText, Badge, Button, Card, EmptyState, LoadingView, Notice, Screen, ScreenHeader } from '../../components/ui';
import { formatMoney } from '../../fees/feeFormat';
import { useCachedResource } from '../../lib/useCachedResource';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { SearchBox, useOnlineOnly } from '../fees/feeCommon';

const M = '/api/manager';
const get = (api, path) => api.request(`${M}${path}`).then(({ data }) => data);

/** One online server answer for a screen: loads on mount, on focus and when the branch changes. */
function useManagerData(path) {
  const { api } = useSession();
  const { version } = useWorkspace();
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      setState({ data: await get(api, path), error: null, loading: false });
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, path, version]);
  const mounted = useRef(false);
  useEffect(() => {
    load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      if (mounted.current) load();
      mounted.current = true;
    }, [load]),
  );
  return { ...state, load };
}

const ServerError = ({ state }) => (state.error ? <Notice title="Could not load from the server" message={userMessage(state.error)} onRetry={state.load} /> : null);

// ---- Home ----

export function ManagerHomeScreen({ navigation }) {
  const { colors } = useTheme();
  const resource = useCachedResource('manager-dashboard', (api) => get(api, '/dashboard'), { maxAgeMs: 24 * 60 * 60 * 1000 });
  const d = resource.data;
  const k = d?.kpis;
  const att = d?.attendanceToday;
  const stats = k
    ? [
        { key: 'students', label: 'Students', value: String(k.students?.value ?? 0), icon: 'school-outline' },
        { key: 'staff', label: 'Staff', value: String(k.staff?.value ?? 0), icon: 'people-outline' },
        { key: 'classes', label: `Classes · ${k.sections?.value ?? 0} sections`, value: String(k.classes?.value ?? 0), icon: 'grid-outline' },
        ...(att ? [{ key: 'attendance', label: `Attendance taken${att.sessionsMissing ? ` · ${att.sessionsMissing} missing` : ''}`, value: `${att.sectionsTaken}/${att.sections}`, icon: 'checkbox-outline', tone: att.sessionsMissing ? 'warning' : 'success' }] : []),
        ...(k.fees ? [{ key: 'fees', label: 'Fees overdue', value: formatMoney(k.fees.overdue, k.fees.currency), icon: 'cash-outline', tone: k.fees.overdue ? 'error' : undefined }] : []),
      ]
    : [];
  const actions = [
    { key: 'staff-att', label: 'Staff attendance', icon: 'finger-print-outline', onPress: () => navigation.navigate('ManagerAttendanceTab', { view: 'staff' }) },
    { key: 'student-att', label: 'Student attendance', icon: 'checkbox-outline', onPress: () => navigation.navigate('ManagerAttendanceTab', { view: 'students' }) },
    { key: 'fees', label: 'Fee Management', icon: 'cash-outline', onPress: () => navigation.navigate('FeeOverview') },
  ];
  return (
    <ScrollView contentContainerStyle={{ padding: space(5), gap: space(3) }} refreshControl={<RefreshControl refreshing={resource.loading && Boolean(d)} onRefresh={resource.reload} />}>
      <AppText variant="section">Branch dashboard</AppText>
      {d ? <Freshness resource={resource} financial={Boolean(k?.fees)} /> : null}
      {!d && resource.error ? <Notice title="The dashboard could not be loaded" message={userMessage(resource.error)} onRetry={resource.reload} /> : null}
      {d ? <StatGrid items={stats} /> : resource.loading ? <SkeletonGrid count={5} /> : null}
      <QuickActions items={actions} />
      {d?.alerts?.length ? (
        <View>
          <SectionTitle>Needs attention</SectionTitle>
          <Card style={{ gap: space(2) }}>
            {d.alerts.map((a) => (
              <AppText key={a.key} variant="small" color={a.tone === 'error' ? colors.errorFg : colors.fg}>{`${a.title} (${a.count})`}</AppText>
            ))}
          </Card>
        </View>
      ) : null}
    </ScrollView>
  );
}

// ---- Students ----

export function ManagerStudentsScreen({ navigation }) {
  const { colors } = useTheme();
  const [q, setQ] = useState('');
  const state = useManagerData(`/students?pageSize=50${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  return (
    <FlatList
      testID="manager-students"
      data={state.data?.items ?? []}
      keyExtractor={(s) => s.id}
      contentContainerStyle={{ padding: space(5), gap: space(2), flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={state.load} />}
      ListHeaderComponent={
        <View style={{ gap: space(3), marginBottom: space(2) }}>
          <SearchBox testID="manager-students-search" value={q} onChangeText={setQ} placeholder="Search by name or student number" />
          <ServerError state={state} />
        </View>
      }
      ListEmptyComponent={state.loading ? <LoadingView /> : <EmptyState icon="school-outline" title="No students" message="Students of your branch appear here." />}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('ManagerStudent', { studentId: item.id })}>
          <Card>
            <AppText variant="cardTitle">{item.fullName}</AppText>
            <AppText variant="small" color={colors.fgSecondary}>{[item.studentNumber, item.enrollment?.section?.displayName ?? item.enrollment?.sectionName, item.status].filter(Boolean).join(' · ')}</AppText>
          </Card>
        </Pressable>
      )}
    />
  );
}

export function ManagerStudentScreen({ navigation, route }) {
  const { colors } = useTheme();
  const state = useManagerData(`/students/${encodeURIComponent(route.params.studentId)}`);
  const s = state.data?.student ?? state.data;
  return (
    <Screen>
      <ScreenHeader title={s?.fullName ?? 'Student'} subtitle={s?.studentNumber} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: space(5), paddingTop: 0, gap: space(3) }}>
        {!s && state.loading ? <LoadingView /> : null}
        <ServerError state={state} />
        {s ? (
          <Card style={{ gap: space(1) }}>
            {[
              ['Status', s.status],
              ['Gender', s.gender],
              ['Date of birth', s.dateOfBirth],
              ['Guardian', s.guardianName],
              ['Guardian phone', s.guardianPhone],
              ['Address', s.address],
            ]
              .filter(([, v]) => v)
              .map(([label, v]) => (
                <View key={label} style={styles.row}>
                  <AppText variant="small" color={colors.fgSecondary}>
                    {label}
                  </AppText>
                  <AppText variant="small">{String(v)}</AppText>
                </View>
              ))}
          </Card>
        ) : null}
        {s ? <Button title="Fee account" variant="secondary" icon="cash-outline" onPress={() => navigation.navigate('FeeStudent', { studentId: s.id, name: s.fullName })} /> : null}
      </ScrollView>
    </Screen>
  );
}

// ---- Attendance ----

export function ManagerAttendanceScreen({ navigation, route }) {
  // A quick action on Home opens a view (route param); a tap here chooses another until the next one.
  const asked = route.params?.view ?? 'staff';
  const [pick, setPick] = useState({ asked, view: null });
  const view = pick.asked === asked && pick.view ? pick.view : asked;
  const setView = (next) => setPick({ asked, view: next });
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.segments} accessibilityRole="tablist">
        {[
          ['staff', 'Staff'],
          ['students', 'Students'],
        ].map(([key, label]) => (
          <Pressable key={key} testID={`attendance-view-${key}`} accessibilityRole="tab" accessibilityState={{ selected: view === key }} onPress={() => setView(key)} style={[styles.segment, { borderColor: view === key ? colors.accent : colors.border, backgroundColor: view === key ? colors.accentSoft : colors.surface }]}>
            <AppText variant="small" style={{ fontWeight: view === key ? '700' : '500' }}>
              {label}
            </AppText>
          </Pressable>
        ))}
      </View>
      {view === 'staff' ? <StaffAttendance /> : <StudentAttendanceDay navigation={navigation} />}
    </View>
  );
}

const STAFF_TONE = { PRESENT: 'success', LATE: 'warning' };

function StaffAttendance() {
  const { colors } = useTheme();
  // Without dates the server answers for today in the branch's time.
  const state = useManagerData('/attendance/records?pageSize=100');
  return (
    <FlatList
      testID="staff-attendance"
      data={state.data?.items ?? []}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: space(5), paddingTop: 0, gap: space(2), flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={state.load} />}
      ListHeaderComponent={
        <View style={{ gap: space(2), marginBottom: space(2) }}>
          <ServerError state={state} />
          <AppText variant="caption" color={colors.fgMuted}>
            Check-ins and check-outs recorded today. Staff attendance cannot be corrected in the app.
          </AppText>
        </View>
      }
      ListEmptyComponent={state.loading ? <LoadingView /> : <EmptyState icon="finger-print-outline" title="No check-ins yet today" message="Staff check-ins of your branch appear here." />}
      renderItem={({ item }) => (
        <Card>
          <View style={styles.row}>
            <AppText variant="cardTitle" style={{ flex: 1 }}>
              {item.staff.name}
            </AppText>
            <Badge label={item.status === 'LATE' ? 'Late' : 'Present'} tone={STAFF_TONE[item.status] ?? 'neutral'} />
          </View>
          <AppText variant="small" color={colors.fgSecondary}>{`${item.shift?.name ?? 'Shift'} · in ${item.checkIn?.time ?? '—'}${item.checkOut ? ` · out ${item.checkOut.time}` : ''}`}</AppText>
        </Card>
      )}
    />
  );
}

function StudentAttendanceDay({ navigation }) {
  const { colors } = useTheme();
  const state = useManagerData('/student-attendance/day');
  const items = state.data?.items ?? [];
  return (
    <FlatList
      testID="student-attendance-day"
      data={items}
      keyExtractor={(i) => i.section.id}
      contentContainerStyle={{ padding: space(5), paddingTop: 0, gap: space(2), flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={state.load} />}
      ListHeaderComponent={
        <View style={{ gap: space(2), marginBottom: space(2) }}>
          <ServerError state={state} />
          {state.error?.code === 'FEATURE_DISABLED' ? <Notice tone="info" message="Student attendance is not switched on for your school." /> : null}
          {state.data ? <AppText variant="caption" color={colors.fgMuted}>{`${state.data.date} · ${state.data.totals?.taken ?? 0}/${state.data.totals?.sessions ?? 0} sessions taken`}</AppText> : null}
        </View>
      }
      ListEmptyComponent={state.loading ? <LoadingView /> : <EmptyState icon="checkbox-outline" title="No classes today" message="Classes with attendance today appear here." />}
      renderItem={({ item }) => {
        const sessions = [...(item.halves ?? []).map((h) => ({ key: `h-${h.half}`, label: h.half === 'whole' ? 'Day' : h.half === 'before' ? 'Morning' : 'Afternoon', session: h.session })), ...(item.lessons ?? []).map((l) => ({ key: `l-${l.period}`, label: `P${l.period} ${l.subject?.name ?? ''}`.trim(), session: l.session }))];
        return (
          <Card style={{ gap: space(2) }}>
            <AppText variant="cardTitle">{item.section.displayName ?? item.section.name}</AppText>
            {!item.schoolDay ? <AppText variant="small" color={colors.fgSecondary}>{item.reasonText ?? 'No school today'}</AppText> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
              {sessions.map((s) => (
                <Pressable
                  key={s.key}
                  disabled={!s.session?.id}
                  accessibilityRole="button"
                  onPress={() => navigation.navigate('SessionMarks', { sessionId: s.session.id, title: `${item.section.displayName ?? item.section.name} · ${s.label}` })}
                  style={[styles.chip, { borderColor: s.session ? colors.accent : colors.border, opacity: s.session ? 1 : 0.6 }]}
                >
                  <AppText variant="caption">{`${s.label}${s.session ? '' : ' · not taken'}`}</AppText>
                </Pressable>
              ))}
            </View>
          </Card>
        );
      }}
    />
  );
}

const MARKS = ['present', 'absent', 'late', 'excused'];

/** One student attendance session: review and correct marks (online; the server audits each change). */
export function SessionMarksScreen({ navigation, route }) {
  const { api } = useSession();
  const guard = useOnlineOnly();
  const { colors } = useTheme();
  const state = useManagerData(`/student-attendance/sessions/${encodeURIComponent(route.params.sessionId)}`);
  const [changes, setChanges] = useState({});
  const [reasons, setReasons] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const students = state.data?.students ?? [];
  const pending = Object.entries(changes);
  const missingReason = pending.some(([id, status]) => status === 'excused' && !(reasons[id] ?? '').trim());

  async function save() {
    setMessage(null);
    const blocked = await guard();
    if (blocked) return setMessage({ tone: 'error', text: blocked.replace('Payments and cash closing need', 'Corrections need') });
    setBusy(true);
    try {
      const marks = pending.map(([id, status]) => ({ student: id, status, ...(status === 'excused' ? { reason: reasons[id].trim() } : {}), version: students.find((s) => s.student.id === id)?.version }));
      await api.request(`${M}/student-attendance/sessions/${encodeURIComponent(route.params.sessionId)}/marks`, { method: 'PUT', body: { marks } });
      setChanges({});
      setReasons({});
      await state.load();
      setMessage({ tone: 'success', text: 'Saved. The server recorded the changes in the attendance history.' });
    } catch (e) {
      setMessage({ tone: 'error', text: userMessage(e) });
      if (e?.code === 'STALE_MARKS') state.load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={route.params.title ?? 'Attendance'} onBack={() => navigation.goBack()} />
      <FlatList
        data={students}
        keyExtractor={(s) => s.student.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space(5), paddingTop: 0, gap: space(2), flexGrow: 1 }}
        ListHeaderComponent={
          <View style={{ gap: space(2), marginBottom: space(2) }}>
            <ServerError state={state} />
            {message ? <Notice tone={message.tone} message={message.text} /> : null}
          </View>
        }
        ListEmptyComponent={state.loading ? <LoadingView /> : null}
        renderItem={({ item }) => {
          const id = item.student.id;
          const current = changes[id] ?? item.status;
          return (
            <Card style={{ gap: space(2) }}>
              <AppText variant="cardTitle">{item.student.name}</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
                {MARKS.map((m) => (
                  <Pressable
                    key={m}
                    testID={`mark-${id}-${m}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: current === m }}
                    onPress={() => setChanges((c) => (m === item.status ? Object.fromEntries(Object.entries(c).filter(([k]) => k !== id)) : { ...c, [id]: m }))}
                    style={[styles.chip, { borderColor: current === m ? colors.accent : colors.border, backgroundColor: current === m ? colors.accentSoft : colors.surface }]}
                  >
                    <AppText variant="caption">{m}</AppText>
                  </Pressable>
                ))}
              </View>
              {changes[id] === 'excused' ? (
                <TextInput testID={`reason-${id}`} value={reasons[id] ?? ''} onChangeText={(t) => setReasons((r) => ({ ...r, [id]: t }))} placeholder="Reason for the excuse (required)" placeholderTextColor={colors.fgMuted} style={[styles.reason, { borderColor: colors.border, color: colors.fg }]} />
              ) : null}
            </Card>
          );
        }}
        ListFooterComponent={pending.length ? <Button testID="save-session-marks" title={`Save ${pending.length} change${pending.length === 1 ? '' : 's'}`} loading={busy} disabled={busy || missingReason} onPress={save} style={{ marginTop: space(3) }} /> : null}
      />
    </Screen>
  );
}

// ---- More: staff, classes, timetables, examinations ----

function SimpleList({ navigation, title, path, keyOf, titleOf, subtitleOf, empty, onPress }) {
  const { colors } = useTheme();
  const state = useManagerData(path);
  const items = Array.isArray(state.data) ? state.data : (state.data?.items ?? state.data?.examinations ?? state.data?.sections ?? []);
  return (
    <Screen>
      <ScreenHeader title={title} onBack={() => navigation.goBack()} />
      <FlatList
        data={items}
        keyExtractor={keyOf}
        contentContainerStyle={{ padding: space(5), paddingTop: 0, gap: space(2), flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={state.load} />}
        ListHeaderComponent={<ServerError state={state} />}
        ListEmptyComponent={state.loading ? <LoadingView /> : <EmptyState icon="file-tray-outline" title={empty} message="" />}
        renderItem={({ item }) => (
          <Pressable disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} onPress={() => onPress?.(item)}>
            <Card>
              <AppText variant="cardTitle">{titleOf(item)}</AppText>
              {subtitleOf(item) ? <AppText variant="small" color={colors.fgSecondary}>{subtitleOf(item)}</AppText> : null}
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}

export const ManagerStaffScreen = ({ navigation }) => (
  <SimpleList navigation={navigation} title="Staff" path="/staff?pageSize=100" keyOf={(s) => s.id} titleOf={(s) => s.name} subtitleOf={(s) => [s.staffId, s.jobTitle, s.status].filter(Boolean).join(' · ')} empty="No staff" />
);

export const ManagerClassesScreen = ({ navigation }) => (
  <SimpleList
    navigation={navigation}
    title="Classes"
    path="/sections?pageSize=100"
    keyOf={(s) => s.id}
    titleOf={(s) => s.displayName ?? `${s.class?.name ?? ''}${s.name ?? ''}`}
    subtitleOf={(s) => [s.students !== undefined ? `${s.students} students` : null, s.classTeacher?.name ? `Class teacher: ${s.classTeacher.name}` : null, s.status].filter(Boolean).join(' · ')}
    empty="No classes"
    onPress={(s) => navigation.navigate('ManagerSectionTimetable', { sectionId: s.id, title: s.displayName ?? s.name })}
  />
);

export function ManagerSectionTimetableScreen({ navigation, route }) {
  const { colors } = useTheme();
  const state = useManagerData(`/sections/${encodeURIComponent(route.params.sectionId)}/timetable`);
  const slots = state.data?.slots ?? state.data?.lessons ?? state.data?.timetable?.slots ?? [];
  return (
    <Screen>
      <ScreenHeader title={route.params.title ?? 'Timetable'} subtitle="Published timetable" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: space(5), paddingTop: 0, gap: space(2) }}>
        <ServerError state={state} />
        {!state.data && state.loading ? <LoadingView /> : null}
        {state.data && !slots.length ? <Notice tone="info" message="No published timetable for this class." /> : null}
        {slots.map((l, i) => (
          <Card key={l.id ?? i}>
            <AppText variant="cardTitle">{`${l.weekday ?? l.day ?? ''} · P${l.period ?? l.periodNumber ?? ''}`}</AppText>
            <AppText variant="small" color={colors.fgSecondary}>{[l.subject?.name, l.teacher?.name].filter(Boolean).join(' · ')}</AppText>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

export const ManagerExamsScreen = ({ navigation }) => (
  <SimpleList
    navigation={navigation}
    title="Examinations"
    path="/exams/examinations"
    keyOf={(e) => e.id}
    titleOf={(e) => e.name}
    subtitleOf={(e) => [e.status, e.startDate && e.endDate ? `${e.startDate} – ${e.endDate}` : null].filter(Boolean).join(' · ')}
    empty="No examinations"
  />
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space(2) },
  segments: { flexDirection: 'row', gap: space(2), padding: space(5), paddingBottom: space(3) },
  segment: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space(4), minHeight: 36, justifyContent: 'center' },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space(3), minHeight: 32, justifyContent: 'center' },
  reason: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space(3), minHeight: 44 },
});
