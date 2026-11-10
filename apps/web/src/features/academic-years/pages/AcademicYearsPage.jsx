import { useState } from 'react';
import { CalendarCheck, CalendarClock, CalendarRange, Plus } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import {
  Alert,
  Button,
  Card,
  ErrorState,
  Skeleton,
  Table,
  TableActions,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { formatFullDay } from '../../../lib/format.js';
import { useSession } from '../../auth';
import { CloseAcademicYearModal, DeleteAcademicYearModal, StartAcademicYearModal } from '../components/AcademicYearActionModals.jsx';
import { AcademicYearFormModal } from '../components/AcademicYearFormModal.jsx';
import { AcademicYearStatusBadge } from '../components/AcademicYearStatusBadge.jsx';
import { loadAcademicYears, loadOwnerSchoolStatus } from '../data/academicYears.js';
import { yearProgress } from '../utils/academicYearRules.js';

const COLUMNS = 5;

/** The current year with how far through it the school is (by this device's date). */
function CurrentYearCard({ year, isOwner }) {
  if (!year) {
    return (
      <Card className="flex items-start gap-3 p-6">
        <CalendarClock aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-fg-muted" />
        <div className="flex flex-col gap-1">
          <h2 className="text-card-title text-fg">No current academic year</h2>
          <p className="text-body text-fg-secondary">
            {isOwner ? 'Plan a year and start it to make it current for every branch.' : 'Your School Owner has not started an academic year yet.'}
          </p>
        </div>
      </Card>
    );
  }
  const progress = yearProgress(year);
  const note =
    progress.phase === 'upcoming'
      ? `Starts in ${progress.startsIn} day${progress.startsIn === 1 ? '' : 's'}.`
      : progress.phase === 'ended'
        ? 'The end date has passed. The year stays current until it is closed.'
        : `${progress.daysLeft} day${progress.daysLeft === 1 ? '' : 's'} left.`;
  return (
    <Card as="section" aria-labelledby="current-year" className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <CalendarCheck aria-hidden="true" className="size-5 text-success" />
        <h2 id="current-year" className="text-card-title text-fg">
          {year.name}
        </h2>
        <AcademicYearStatusBadge status="current" />
      </div>
      <p className="text-body text-fg-secondary">
        {formatFullDay(year.startDate)} – {formatFullDay(year.endDate)} · {year.days} days
      </p>
      <div className="flex flex-col gap-2">
        <div
          role="progressbar"
          aria-label={`Progress through ${year.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-success" style={{ width: `${progress.percent}%` }} />
        </div>
        <p className="text-small text-fg-muted">
          {progress.percent}% through the year. {note}
        </p>
      </div>
    </Card>
  );
}

/**
 * Academic years of the signed-in user's school (school level: they apply to every branch).
 * School Owner: plans, edits, starts, closes and deletes planned years. Manager: reads them.
 * The school is decided by the server from the account. While the school is suspended the owner's
 * page is read only.
 */
export default function AcademicYearsPage() {
  const { user } = useSession();
  const isOwner = user.role === 'OWNER';
  const [version, setVersion] = useState(0);
  const { status, data, retry } = useApiData(() => loadAcademicYears(user.role), `academic-years:${version}`);
  // Only the owner's page can change anything, so only the owner needs the school's status.
  const school = useApiData(() => (isOwner ? loadOwnerSchoolStatus() : Promise.resolve(null)), `school:${version}`);
  const readOnly = school.data === 'suspended';

  // { type: 'create' | 'edit' | 'start' | 'close' | 'delete', year? }
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const open = (type, year) => {
    setNotice('');
    setDialog({ type, year });
  };
  const closeDialog = () => setDialog(null);
  const done = (message) => {
    setDialog(null);
    setNotice(message);
    setVersion((n) => n + 1);
  };

  const unavailable = readOnly ? 'Your school is suspended: academic years cannot be changed until it is reactivated.' : undefined;
  const years = data?.items ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Academic Years"
        description={
          isOwner
            ? 'Your school’s academic years. They apply to every branch; Branch Managers can see them.'
            : 'Your school’s academic years. They are managed by your School Owner and apply to every branch.'
        }
        primaryAction={
          isOwner && (
            <Button leftIcon={Plus} onClick={() => open('create')} unavailableReason={unavailable}>
              Plan Year
            </Button>
          )
        }
      />

      {readOnly && (
        <Alert variant="warning" title="Your school is suspended">
          You can view your academic years but not change them until the school is reactivated.
        </Alert>
      )}
      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      {status === 'error' && !data && (
        <Card>
          <ErrorState title="Academic years could not be loaded" description="Check your connection and try again." onRetry={retry} />
        </Card>
      )}
      {!data && status !== 'error' && (
        <div aria-busy="true" aria-label="Loading academic years" className="flex flex-col gap-4">
          <Skeleton className="h-36" />
          <Skeleton className="h-64" />
        </div>
      )}

      {data && (
        <>
          <CurrentYearCard year={data.current} isOwner={isOwner} />
          <Card className="overflow-hidden">
            <div role="region" aria-label="Academic years" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
              <Table caption="Academic years of your school, newest first">
                <TableHead>
                  <TableRow interactive={false}>
                    <TableHeaderCell>Name</TableHeaderCell>
                    <TableHeaderCell>Start date</TableHeaderCell>
                    <TableHeaderCell>End date</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell align="right">{isOwner ? 'Actions' : 'Days'}</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {years.length === 0 && (
                    <TableEmpty
                      columns={COLUMNS}
                      icon={CalendarRange}
                      title="No academic years yet"
                      description={isOwner ? 'Plan your school’s first academic year.' : 'Your School Owner has not planned any academic years yet.'}
                      action={
                        isOwner &&
                        !readOnly && (
                          <Button size="sm" onClick={() => open('create')}>
                            Plan Year
                          </Button>
                        )
                      }
                    />
                  )}
                  {years.map((year) => (
                    <TableRow key={year.id} selected={year.status === 'current'}>
                      <TableCell className="font-medium whitespace-nowrap">{year.name}</TableCell>
                      <TableCell className="whitespace-nowrap text-fg-secondary">{formatFullDay(year.startDate)}</TableCell>
                      <TableCell className="whitespace-nowrap text-fg-secondary">{formatFullDay(year.endDate)}</TableCell>
                      <TableCell>
                        <AcademicYearStatusBadge status={year.status} />
                      </TableCell>
                      <TableCell align="right">
                        {!isOwner ? (
                          <span className="tabular-nums text-fg-secondary">{year.days}</span>
                        ) : year.status === 'closed' ? (
                          <span className="text-small text-fg-muted">Read only</span>
                        ) : (
                          <TableActions>
                            <Button size="sm" variant="outline" onClick={() => open('edit', year)} unavailableReason={unavailable} aria-label={`Edit ${year.name}`}>
                              Edit
                            </Button>
                            {year.status === 'planned' && (
                              <>
                                <Button size="sm" variant="secondary" onClick={() => open('start', year)} unavailableReason={unavailable} aria-label={`Start ${year.name}`}>
                                  Start
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => open('delete', year)} unavailableReason={unavailable} aria-label={`Delete ${year.name}`}>
                                  Delete
                                </Button>
                              </>
                            )}
                            {year.status === 'current' && (
                              <Button size="sm" variant="danger" onClick={() => open('close', year)} unavailableReason={unavailable} aria-label={`Close ${year.name}`}>
                                Close
                              </Button>
                            )}
                          </TableActions>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}

      {isOwner && (
        <>
          <AcademicYearFormModal
            mode={dialog?.type === 'edit' ? 'edit' : 'create'}
            year={dialog?.year}
            open={dialog?.type === 'create' || dialog?.type === 'edit'}
            onClose={closeDialog}
            onSaved={(year) => done(dialog?.type === 'edit' ? `${year.name} was saved.` : `${year.name} was planned. Start it when it should become current.`)}
          />
          <StartAcademicYearModal
            year={dialog?.year}
            current={data?.current}
            open={dialog?.type === 'start'}
            onClose={closeDialog}
            onDone={(result) =>
              done(
                result.closed
                  ? `${result.academicYear.name} is now the current year; ${result.closed.name} was closed.`
                  : `${result.academicYear.name} is now the current year.`,
              )
            }
          />
          <CloseAcademicYearModal year={dialog?.year} open={dialog?.type === 'close'} onClose={closeDialog} onDone={(year) => done(`${year.name} was closed.`)} />
          <DeleteAcademicYearModal
            year={dialog?.year}
            open={dialog?.type === 'delete'}
            onClose={closeDialog}
            onDone={() => done(`${dialog?.year?.name ?? 'The planned year'} was deleted.`)}
          />
        </>
      )}
    </PageContainer>
  );
}
