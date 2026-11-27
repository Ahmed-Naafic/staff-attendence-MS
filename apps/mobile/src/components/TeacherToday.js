/*
 * The Teacher dashboard block on Home (below staff check-in, which stays as it was): today's
 * lessons, how many have their attendance taken, upcoming invigilation duties and unread
 * notifications, with quick actions. Read from the server, kept on the phone for offline use and
 * marked with its freshness (src/components/dashboard.js). Only the branch chosen in the header.
 */
import { View } from 'react-native';
import { fetchExamDuties, fetchLessons } from '../api/endpoints';
import { useCachedResource } from '../lib/useCachedResource';
import { useNotifications } from '../notifications/NotificationsProvider';
import { space } from '../theme/tokens';
import { inBranch } from '../workspace/workspaces';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { Freshness, QuickActions, SectionTitle, SkeletonGrid, StatGrid } from './dashboard';

const optional = (promise) => promise.catch((e) => (e?.kind === 'http' && e.status !== 401 ? null : Promise.reject(e)));

/** Today's teaching figures from the lessons and duties answers (null parts: the feature is off). */
export function teacherFigures({ lessons, duties }, branchId, multiBranch) {
  const mine = (lessons?.lessons ?? []).filter((l) => !multiBranch || inBranch(l, branchId));
  const taken = mine.filter((l) => l.students.length > 0 && l.students.every((s) => s.status !== null)).length;
  return {
    lessons: lessons ? mine.length : null,
    taken: lessons ? taken : null,
    duties: duties ? duties.duties.length : null,
  };
}

export function TeacherToday({ navigation }) {
  const { branchId, branches } = useWorkspace();
  const { unreadCount } = useNotifications();
  const resource = useCachedResource('teacher-today', async (api) => ({
    lessons: await optional(fetchLessons(api)),
    duties: await optional(fetchExamDuties(api)),
  }));
  const f = resource.data ? teacherFigures(resource.data, branchId, branches.length > 1) : null;
  const stats = f
    ? [
        ...(f.lessons !== null ? [{ key: 'lessons', label: 'Lessons today', value: String(f.lessons), icon: 'book-outline' }] : []),
        ...(f.taken !== null ? [{ key: 'taken', label: 'Attendance taken', value: `${f.taken}/${f.lessons}`, icon: 'checkbox-outline', tone: f.taken < f.lessons ? 'warning' : 'success' }] : []),
        ...(f.duties !== null ? [{ key: 'duties', label: 'Exam duties (2 weeks)', value: String(f.duties), icon: 'clipboard-outline' }] : []),
        { key: 'unread', label: 'Unread notifications', value: String(unreadCount ?? 0), icon: 'notifications-outline' },
      ]
    : [];
  const actions = [
    { key: 'attendance', label: 'Take attendance', icon: 'checkbox-outline', onPress: () => navigation.navigate('Attendance') },
    { key: 'timetable', label: 'Timetable', icon: 'calendar-outline', onPress: () => navigation.navigate('Timetable') },
    { key: 'marks', label: 'Marks entry', icon: 'create-outline', onPress: () => navigation.navigate('ExamMarks') },
  ];
  if (!resource.data && !resource.loading) return null;
  return (
    <View testID="teacher-today" style={{ marginTop: space(2) }}>
      <SectionTitle>Today’s teaching</SectionTitle>
      {resource.data ? (
        <View style={{ gap: space(3) }}>
          <Freshness resource={resource} />
          <StatGrid items={stats} />
          <QuickActions items={actions} />
        </View>
      ) : (
        <SkeletonGrid />
      )}
    </View>
  );
}
