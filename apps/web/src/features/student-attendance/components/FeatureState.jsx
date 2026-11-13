import { Alert, Card, ErrorState } from '../../../components/ui';

/** The school's Student Attendance is switched off (403 FEATURE_DISABLED). */
export function FeatureOffNotice({ owner }) {
  return (
    <Alert variant="info" title="Student Attendance is not switched on for your school">
      {owner
        ? 'EduTrack support switches it on for your school. You can already prepare: the academic calendar, timetables and the attendance settings.'
        : 'Your School Owner can ask EduTrack support to switch it on. Timetables and the academic calendar can already be prepared.'}
    </Alert>
  );
}

/** A failed load: the feature switch, or a retry. */
export function LoadFailure({ error, onRetry, owner, what }) {
  if (error?.code === 'FEATURE_DISABLED') return <FeatureOffNotice owner={owner} />;
  if (error?.status === 404) {
    return (
      <Card>
        <ErrorState title={`${what} not found`} description="It does not exist, or is not part of your school or branch." />
      </Card>
    );
  }
  return (
    <Card>
      <ErrorState title={`${what} could not be loaded`} description={error?.status === 403 ? error.message : 'Check your connection and try again.'} onRetry={onRetry} />
    </Card>
  );
}
