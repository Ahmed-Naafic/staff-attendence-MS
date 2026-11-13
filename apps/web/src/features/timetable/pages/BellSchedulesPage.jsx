import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { BellRing, Plus } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmModal,
  ErrorState,
  Select,
  Skeleton,
  Table,
  TableActions,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableLoading,
  TableRow,
} from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { formatFullDay } from '../../../lib/format.js';
import { loadOwnerSchoolStatus } from '../../academic-years';
import { useSession } from '../../auth';
import { loadOwnerBranches } from '../../classes/data/classesApi.js';
import { WEEK, WEEKDAY_SHORT } from '../../academic-calendar/utils/calendarRules.js';
import { BellScheduleModal, BellTimesModal } from '../components/BellModals.jsx';
import { cancelBellTimes, loadBellSchedule, loadBellSchedules, setBellScheduleActive } from '../data/timetableApi.js';
import { summaryText, VERSION_STATES } from '../utils/timetableRules.js';

/** One version's lessons and breaks, by weekday. */
function TimesTable({ version }) {
  const days = WEEK.filter((d) => version.periods.some((p) => p.days.includes(d)));
  return (
    <div role="region" aria-label="Times by weekday" tabIndex={0} className="overflow-x-auto">
      <table className="text-small">
        <tbody>
          {days.map((d) => (
            <tr key={d} className="border-t border-border first:border-t-0">
              <th scope="row" className="py-2 pr-3 text-left font-medium text-fg">
                {WEEKDAY_SHORT[d]}
              </th>
              <td className="py-2">
                <ul className="flex flex-wrap gap-1.5">
                  {version.periods
                    .filter((p) => p.days.includes(d))
                    .sort((a, b) => a.start.localeCompare(b.start))
                    .map((p) => (
                      <li
                        key={`${p.kind}${p.number}${p.start}`}
                        className={`rounded px-2 py-1 tabular-nums ${p.kind === 'lesson' ? 'bg-muted/50 text-fg' : p.mainBreak ? 'bg-warning-soft text-warning-fg' : 'bg-info-soft text-info-fg'}`}
                      >
                        {p.kind === 'lesson' ? `P${p.number}` : p.name || 'Break'} {p.start}–{p.end}
                        {p.mainBreak ? ' · main' : ''}
                      </li>
                    ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Bell schedules: the times of a school day's lessons and breaks. School Owner: school-wide schedules
 * (every branch can use them) and each branch's own. Manager: reads the school-wide ones, manages
 * their branch's own. Times change from a date; days already under way keep theirs.
 */
export default function BellSchedulesPage() {
  const { user } = useSession();
  const role = user.role === 'OWNER' ? 'OWNER' : 'MANAGER';
  const owner = role === 'OWNER';
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('bell') ?? '';
  const select = (id) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (id) next.set('bell', id);
    else next.delete('bell');
    return next;
  });
  const [status, setStatus] = useState('active');
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const [warnings, setWarnings] = useState([]);

  const list = useApiData(() => loadBellSchedules(role, { status }), `bells|${role}|${status}|${version}`);
  const detail = useApiData(() => (selectedId ? loadBellSchedule(role, selectedId) : Promise.resolve(null)), `bell|${selectedId}|${version}`);
  const branches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `branches|${role}`);
  const school = useApiData(() => (owner ? loadOwnerSchoolStatus() : Promise.resolve(null)), `school|${version}`);
  const unavailable = school.data === 'suspended' ? 'Your school is suspended.' : undefined;
  const bell = detail.data?.bellSchedule.id === selectedId ? detail.data.bellSchedule : null;
  const done = (message, extra = []) => {
    setDialog(null);
    setNotice(message);
    setWarnings(extra);
    setVersion((n) => n + 1);
  };
  const items = list.data?.items ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Bell Schedules"
        description={
          owner
            ? 'The times of the school day: lessons, breaks and the main break that splits the day into two halves. School-wide schedules can be used by every branch; a branch can also have its own.'
            : 'The times of the school day. Your School Owner’s school-wide schedules can be used by your sections; you can also make your branch’s own.'
        }
        primaryAction={
          <Button leftIcon={Plus} onClick={() => setDialog({ type: 'create' })} unavailableReason={unavailable}>
            Add Bell Schedule
          </Button>
        }
      />
      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert variant="warning" title="Some lessons will not take place" onDismiss={() => setWarnings([])}>
          <ul className="list-disc pl-5">
            {warnings.map((w) => (
              <li key={w.sectionId}>{w.message}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-card-title text-fg">Schedules</h2>
          <Select
            label="Show"
            fieldClassName="w-48"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
              { value: 'all', label: 'All' },
            ]}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          />
        </div>
        {list.status === 'error' && !list.data ? (
          <ErrorState title="Bell schedules could not be loaded" description="Check your connection and try again." onRetry={list.retry} />
        ) : (
          <div role="region" aria-label="Bell schedules" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
            <Table caption="Bell schedules">
              <TableHead>
                <TableRow interactive={false}>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>For</TableHeaderCell>
                  <TableHeaderCell>Times now</TableHeaderCell>
                  <TableHeaderCell>Sections</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell align="right">Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {!list.data && <TableLoading columns={6} />}
                {list.data && !items.length && <TableEmpty columns={6} icon={BellRing} title="No bell schedules yet" description="Add one, then set its lessons and breaks." />}
                {items.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">
                      <button type="button" className="text-interactive underline-offset-2 hover:underline" onClick={() => select(b.id)}>
                        {b.name}
                      </button>
                      {b.description && <span className="block text-caption font-normal text-fg-muted">{b.description}</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-fg-secondary">{b.branch ? b.branch.name : 'Whole school'}</TableCell>
                    <TableCell className="text-fg-secondary">
                      {b.current ? summaryText(b.current.summary) : <span className="text-warning-fg">No times yet</span>}
                      {b.current && b.current.state === 'scheduled' && <span className="block text-caption">From {formatFullDay(b.current.effectiveFrom)}</span>}
                      {b.scheduledChanges > 0 && b.current?.state === 'current' && <span className="block text-caption">A change is scheduled</span>}
                    </TableCell>
                    <TableCell className="tabular-nums text-fg-secondary">{b.sectionsUsing ?? 0}</TableCell>
                    <TableCell>
                      <Badge variant={b.status === 'active' ? 'success' : 'neutral'}>{b.status === 'active' ? 'Active' : 'Inactive'}</Badge>
                    </TableCell>
                    <TableCell align="right">
                      {b.canManage ? (
                        <TableActions>
                          <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'edit', bell: b })} unavailableReason={unavailable}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDialog({ type: b.status === 'active' ? 'deactivate' : 'reactivate', bell: b })} unavailableReason={unavailable}>
                            {b.status === 'active' ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        </TableActions>
                      ) : (
                        <span className="text-small text-fg-muted">Managed by your School Owner</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {selectedId && !bell && detail.status !== 'error' && <Skeleton className="h-48" />}
      {selectedId && detail.status === 'error' && !bell && (
        <Card>
          <ErrorState title="The bell schedule could not be loaded" description="It may not exist, or not be part of your school." onRetry={detail.retry} />
        </Card>
      )}
      {bell && (
        <Card as="section" aria-labelledby="bell-detail" className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="bell-detail" className="text-card-title text-fg">
                {bell.name}
              </h2>
              <p className="text-small text-fg-secondary">{bell.branch ? `${bell.branch.name}’s own schedule.` : 'School-wide: every branch can use it.'}</p>
            </div>
            <div className="flex gap-2">
              {bell.canManage && bell.status === 'active' && (
                <Button onClick={() => setDialog({ type: 'times' })} unavailableReason={unavailable}>
                  {bell.versions.length ? 'Change Times' : 'Set Times'}
                </Button>
              )}
              <Button variant="outline" onClick={() => select('')}>
                Close
              </Button>
            </div>
          </div>
          {!bell.versions.length && <Alert variant="info">No times yet. Set the lessons and breaks before sections use this schedule.</Alert>}
          {bell.current && <TimesTable version={bell.current} />}
          {bell.versions.length > 0 && (
            <div role="region" aria-label="Changes of times" tabIndex={0} className="overflow-x-auto">
              <Table caption={`Changes of ${bell.name}'s times`}>
                <TableHead>
                  <TableRow interactive={false}>
                    <TableHeaderCell>From</TableHeaderCell>
                    <TableHeaderCell>Times</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell align="right">Actions</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {[...bell.versions].reverse().map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="whitespace-nowrap">{formatFullDay(v.effectiveFrom)}</TableCell>
                      <TableCell className="text-fg-secondary">{summaryText(v.summary)}</TableCell>
                      <TableCell>
                        <Badge variant={VERSION_STATES[v.state].variant}>{VERSION_STATES[v.state].label}</Badge>
                      </TableCell>
                      <TableCell align="right">
                        {bell.canManage && v.state === 'scheduled' && (
                          <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'cancel-times', version: v })} unavailableReason={unavailable}>
                            Cancel
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      )}

      <BellScheduleModal
        role={role}
        bell={dialog?.type === 'edit' ? dialog.bell : null}
        branches={branches.data}
        open={dialog?.type === 'create' || dialog?.type === 'edit'}
        onClose={() => setDialog(null)}
        onSaved={(b) => {
          done(dialog?.type === 'create' ? `${b.name} was added. Set its times next.` : `${b.name} was saved.`);
          if (dialog?.type === 'create') select(b.id);
        }}
      />
      {dialog?.type === 'times' && bell && (
        <BellTimesModal
          role={role}
          bell={bell}
          start={[...bell.versions].reverse().find((v) => v.state !== 'cancelled' && v.state !== 'past') ?? bell.current}
          earliest={detail.data.firstEditableDate}
          open
          onClose={() => setDialog(null)}
          onSaved={(res) => done(`Times of ${bell.name} saved.`, res.warnings ?? [])}
        />
      )}
      <ConfirmModal
        open={dialog?.type === 'deactivate' || dialog?.type === 'reactivate'}
        onClose={() => setDialog(null)}
        title={dialog?.type === 'deactivate' ? `Deactivate ${dialog?.bell?.name}?` : `Reactivate ${dialog?.bell?.name}?`}
        description={dialog?.type === 'deactivate' ? 'It can then not be chosen for timetables. A schedule still used by a section’s timetable cannot be deactivated.' : 'It can then be chosen for timetables again.'}
        confirmLabel={dialog?.type === 'deactivate' ? 'Deactivate' : 'Reactivate'}
        run={() => setBellScheduleActive(role, dialog.bell.id, dialog.type === 'reactivate')}
        onDone={(b) => done(`${b.name} is now ${b.status}.`)}
      />
      <ConfirmModal
        open={dialog?.type === 'cancel-times'}
        onClose={() => setDialog(null)}
        title="Cancel this change of times?"
        description={dialog?.version ? `The times from ${formatFullDay(dialog.version.effectiveFrom)} are cancelled; the times before them continue. It is kept as cancelled.` : ''}
        confirmLabel="Cancel change"
        run={() => cancelBellTimes(role, bell.id, dialog.version.id)}
        onDone={() => done('The change of times was cancelled.')}
      />
    </PageContainer>
  );
}
