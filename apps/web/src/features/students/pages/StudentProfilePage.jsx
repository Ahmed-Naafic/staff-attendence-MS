import { useState } from 'react';
import { useParams } from 'react-router';
import { History } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { formatDate } from '../../../lib/format.js';
import { useSession } from '../../auth';
import { EnrollModal, EnrollmentModal, StudentFormModal, TransferOutModal } from '../components/StudentModals.jsx';
import { loadStudent } from '../data/studentsApi.js';
import { DECISION, ENROLLMENT_STATUS, ENTRY, RESULT, STUDENT_STATUS } from '../utils/studentRules.js';

function Detail({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body break-words text-fg">{children || <span className="text-fg-muted">Not provided</span>}</dd>
    </div>
  );
}

/**
 * One student: the permanent profile, the enrollment history (one row per academic year, with how the
 * student arrived and what was decided at the end), and — for the branch's Manager — enroll, update the
 * current enrollment (section or year-end result) and transfer out. Owners view and edit profiles.
 */
export default function StudentProfilePage() {
  const { studentId } = useParams();
  const { user } = useSession();
  const role = user.role === 'OWNER' ? 'OWNER' : 'MANAGER';
  const manager = role === 'MANAGER';
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const { status, data: student, error, retry } = useApiData(() => loadStudent(role, studentId), `${studentId}|${version}`);
  const done = (message) => (result) => {
    setDialog(null);
    setNotice(message(result));
    setVersion((n) => n + 1);
  };

  if (status === 'error') {
    const missing = error?.status === 404;
    return (
      <PageContainer>
        <PageHeader title="Student" breadcrumbs={[{ label: 'Students', to: '/students' }, { label: 'Student' }]} />
        <Card>
          <ErrorState
            title={missing ? 'Student not found' : 'The student could not be loaded'}
            description={missing ? 'This student does not exist or is not part of your scope.' : 'Check your connection and try again.'}
            onRetry={missing ? undefined : retry}
          />
        </Card>
      </PageContainer>
    );
  }
  if (!student) {
    return (
      <PageContainer>
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </PageContainer>
    );
  }

  const active = student.enrollments.find((e) => e.status === 'active');
  const canEnroll = manager && student.status !== 'graduated';
  const canTransfer = manager && ['enrolled', 'pending_enrollment'].includes(student.status);
  const statusInfo = STUDENT_STATUS[student.status];

  return (
    <PageContainer>
      <PageHeader
        title={student.fullName}
        breadcrumbs={[{ label: 'Students', to: '/students' }, { label: student.fullName }]}
        description={`Student ID ${student.studentNumber} · ${student.branch?.name ?? ''} · registered ${formatDate(student.registeredAt)}`}
        secondaryActions={
          <>
            <Button variant="outline" onClick={() => setDialog({ type: 'edit' })}>
              Edit Profile
            </Button>
            {canTransfer && (
              <Button variant="ghost" onClick={() => setDialog({ type: 'transfer' })}>
                Transfer Out
              </Button>
            )}
          </>
        }
        primaryAction={canEnroll && <Button onClick={() => setDialog({ type: 'enroll' })}>Enroll</Button>}
      />

      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}
      {student.statusReason && (
        <Alert variant="info" title={statusInfo?.label}>
          {student.statusReason}
        </Alert>
      )}

      <Card as="section" aria-labelledby="student-profile" className="p-6">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <h2 id="student-profile" className="text-card-title text-fg">
            Profile
          </h2>
          <Badge variant={statusInfo?.variant ?? 'neutral'}>{statusInfo?.label ?? student.status}</Badge>
          {active && <Badge variant="accent">{`${active.section.displayName} · ${active.academicYear.name}`}</Badge>}
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Gender">{student.gender === 'male' ? 'Male' : 'Female'}</Detail>
          <Detail label="Date of birth">{student.dateOfBirth}</Detail>
          <Detail label="Phone">{student.phone}</Detail>
          <Detail label="Address">{student.address}</Detail>
          <Detail label="Guardian">{`${student.guardianName}${student.guardianRelationship ? ` (${student.guardianRelationship})` : ''}`}</Detail>
          <Detail label="Guardian phone">{student.guardianPhone}</Detail>
          <Detail label="Emergency contact">{[student.emergencyContactName, student.emergencyContactPhone].filter(Boolean).join(' · ')}</Detail>
        </dl>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-6 pt-5">
          <h2 className="text-card-title text-fg">Enrollment history</h2>
        </div>
        <div role="region" aria-label="Enrollment history" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
          <Table caption="Enrollment history, oldest academic year first">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Academic year</TableHeaderCell>
                <TableHeaderCell>Class</TableHeaderCell>
                <TableHeaderCell>Section</TableHeaderCell>
                <TableHeaderCell>Entry</TableHeaderCell>
                <TableHeaderCell>Result</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Year-end decision</TableHeaderCell>
                {manager && <TableHeaderCell align="right">Actions</TableHeaderCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {student.enrollments.length === 0 && (
                <TableEmpty
                  columns={manager ? 8 : 7}
                  icon={History}
                  title="Not enrolled yet"
                  description={canEnroll ? 'Enroll the student in a section of a planned or current academic year.' : 'The branch’s Manager enrolls students.'}
                />
              )}
              {student.enrollments.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap">{e.academicYear.name}</TableCell>
                  <TableCell className="whitespace-nowrap">{e.class.name}</TableCell>
                  <TableCell className="font-medium whitespace-nowrap">{e.section.displayName}</TableCell>
                  <TableCell className="whitespace-nowrap text-fg-secondary">{ENTRY[e.entry]}</TableCell>
                  <TableCell className="text-fg-secondary">{RESULT[e.result] ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={ENROLLMENT_STATUS[e.status]?.variant ?? 'neutral'}>{ENROLLMENT_STATUS[e.status]?.label ?? e.status}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-fg-secondary">
                    {e.decision ? `${DECISION[e.decision.decision.toUpperCase()]?.label ?? e.decision.decision}${e.decision.status === 'excluded' ? ' (excluded)' : ` → ${e.decision.toYear}`}` : '—'}
                  </TableCell>
                  {manager && (
                    <TableCell align="right">
                      {e.status === 'active' && (
                        <Button size="sm" variant="outline" onClick={() => setDialog({ type: 'enrollment', enrollment: e })}>
                          Update
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <StudentFormModal role={role} mode="edit" student={student} open={dialog?.type === 'edit'} onClose={() => setDialog(null)} onSaved={done((s) => `${s.fullName} was saved.`)} />
      {manager && (
        <>
          <EnrollModal student={student} open={dialog?.type === 'enroll'} onClose={() => setDialog(null)} onDone={done((e) => `Enrolled in ${e.section.displayName} for ${e.academicYear.name}.`)} />
          <EnrollmentModal enrollment={dialog?.enrollment} open={dialog?.type === 'enrollment'} onClose={() => setDialog(null)} onDone={done(() => 'The enrollment was updated.')} />
          <TransferOutModal student={student} open={dialog?.type === 'transfer'} onClose={() => setDialog(null)} onDone={done((s) => `${s.fullName} was transferred out.`)} />
        </>
      )}
    </PageContainer>
  );
}
