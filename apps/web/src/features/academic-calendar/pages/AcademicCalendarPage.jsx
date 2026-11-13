import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { CalendarDays, Plus } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmModal,
  ErrorState,
  Select,
  Skeleton,
  Switch,
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
import { loadAcademicYears, loadOwnerSchoolStatus } from '../../academic-years';
import { useSession } from '../../auth';
import { loadOwnerBranches } from '../../classes/data/classesApi.js';
import { pickYear } from '../../classes/utils/classRules.js';
import { branchWeekdaysAction, cancelEntryAction, cancelWeekdaysAction, EntryModal, WeekdaysModal } from '../components/CalendarModals.jsx';
import { MonthView } from '../components/MonthView.jsx';
import { loadCalendar } from '../data/calendarApi.js';
import { addDays, canManageEntry, daysText, earliestWeekdaysDate, ENTRY_TYPES, entryActions, WEEKDAY_NAMES } from '../utils/calendarRules.js';

const YEAR_SUFFIX = { current: ' (current)', planned: ' (planned)', closed: ' (closed)' };
const COLUMNS = 6;

/** Scheduled and past versions of one level's school days, newest first. */
function VersionList({ versions, onCancel, canChange }) {
  const shown = versions.filter((v) => v.state !== 'cancelled').reverse();
  if (!shown.length) return null;
  return (
    <ul className="flex flex-col gap-1.5 text-small">
      {shown.map((v) => (
        <li key={v.id} className="flex flex-wrap items-center gap-2">
          <Badge variant={v.state === 'current' ? 'success' : v.state === 'scheduled' ? 'info' : 'neutral'}>
            {v.state === 'current' ? 'In effect' : v.state === 'scheduled' ? 'Scheduled' : 'Earlier'}
          </Badge>
          <span className="text-fg">{v.followsSchool ? 'Follows the school’s days' : daysText(v.days)}</span>
          <span className="text-fg-muted">from {formatFullDay(v.effectiveFrom)}</span>
          {v.state === 'scheduled' && canChange && (
            <Button variant="ghost" size="sm" onClick={() => onCancel(v)}>
              Cancel change
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The year's weekly school days: the school's, the branch permission, and the branches' own days. */
function SchoolDaysCard({ role, cal, writable, onChange, onCancel, onPolicy }) {
  const owner = role === 'OWNER';
  const school = cal.weekdays.school;
  const own = cal.weekdays.branches[0];
  return (
    <Card as="section" aria-labelledby="school-days" className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="school-days" className="text-card-title text-fg">
            School days
          </h2>
          <p className="text-body text-fg-secondary">
            {school.days ? `The school: ${daysText(school.days)}.` : 'Not set yet: no day counts as a school day until they are.'}{' '}
            <span className="text-fg-muted">Independent of staff shifts.</span>
          </p>
        </div>
        {owner && (
          <Button size="sm" variant="outline" onClick={() => onChange('school')} unavailableReason={writable ? undefined : 'This calendar cannot be changed now.'}>
            Change school days
          </Button>
        )}
      </div>
      <VersionList versions={school.versions} canChange={owner && writable} onCancel={(v) => onCancel(v)} />

      {owner ? (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <Switch
            label="Branches may set their own school days"
            description="When on, each branch’s Manager may choose different days for their branch. Turning it off returns every branch to the school’s days from tomorrow."
            checked={cal.branchWeekdaysAllowed}
            disabled={!writable}
            onChange={(next) => onPolicy(next)}
          />
          {cal.weekdays.branches.length > 0 && (
            <ul className="flex flex-col gap-3">
              {cal.weekdays.branches.map((b) => (
                <li key={b.branch.id} className="flex flex-col gap-1.5">
                  <span className="text-small font-medium text-fg">
                    {b.branch.name}: {b.source === 'branch' ? `own days (${daysText(b.days)})` : 'the school’s days'}
                  </span>
                  <VersionList versions={b.versions} canChange={false} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-body text-fg-secondary">
              Your branch: {own?.source === 'branch' ? `its own days (${daysText(own.days)})` : 'follows the school’s days'}.
              {!cal.branchWeekdaysAllowed && ' Your School Owner has not allowed branches to set their own days.'}
            </p>
            {cal.branchWeekdaysAllowed && (
              <Button size="sm" variant="outline" onClick={() => onChange('branch')} unavailableReason={writable ? undefined : 'This calendar cannot be changed now.'}>
                Set branch school days
              </Button>
            )}
          </div>
          {own && <VersionList versions={own.versions} canChange={writable && cal.branchWeekdaysAllowed} onCancel={(v) => onCancel(v)} />}
        </div>
      )}
    </Card>
  );
}

/**
 * Academic calendar. School Owner: the school's weekly school days per academic year, whether
 * branches may set their own, school holidays, and closures and reopenings of any branch. Manager:
 * the school calendar (read), their branch's own school days (when allowed), closures and
 * reopenings. A month view shows each day as the attendance features will see it. The school and a
 * Manager's branch come from the account; days before today are fixed.
 */
export default function AcademicCalendarPage() {
  const { user } = useSession();
  const role = user.role === 'OWNER' ? 'OWNER' : 'MANAGER';
  const owner = role === 'OWNER';
  const [params, setParams] = useSearchParams();
  const set = (name, value) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(name, value);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );

  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);

  const years = useApiData(() => loadAcademicYears(role), `years|${role}`);
  const year = pickYear(years.data?.items ?? [], params.get('year'));
  const branches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `branches|${role}`);
  const school = useApiData(() => (owner ? loadOwnerSchoolStatus() : Promise.resolve(null)), `school|${version}`);
  const cal = useApiData(() => (year ? loadCalendar(role, year.id) : Promise.resolve(null)), `calendar|${role}|${year?.id}|${version}`);
  const data = cal.data && cal.data.academicYear.id === year?.id ? cal.data : null;

  const branchList = branches.data ?? [];
  const viewBranch = owner ? (params.get('branch') ?? branchList[0]?.id ?? '') : null;
  const month = params.get('month') ?? (data ? (data.today < data.academicYear.startDate ? data.academicYear.startDate : data.today).slice(0, 7) : null);

  const suspended = school.data === 'suspended';
  const writable = Boolean(data) && data.academicYear.status !== 'closed' && !suspended;
  const done = (message) => {
    setDialog(null);
    setNotice(message);
    setVersion((n) => n + 1);
  };

  const entries = (data?.entries ?? []).filter((e) => showCancelled || e.status === 'active');
  const reopenable = (data?.entries ?? []).filter((e) => e.type === 'holiday' && e.status === 'active' && e.allowBranchReopening && e.endDate >= data.firstEditableDate);
  const context = data && {
    firstEditable: data.firstEditableDate,
    yearStart: data.academicYear.startDate,
    yearEnd: data.academicYear.endDate,
    branches: branchList,
    holidays: reopenable,
  };
  const weekdayLimits = (level) => {
    if (!data) return null;
    const ownLevel = level === 'school' ? data.weekdays.school.versions : (data.weekdays.branches[0]?.versions ?? []);
    const inEffectToday = (versions) => versions.some((v) => v.state !== 'cancelled' && v.effectiveFrom <= data.today);
    const appliesToday = level === 'school' ? inEffectToday(ownLevel) : inEffectToday(ownLevel) || inEffectToday(data.weekdays.school.versions);
    return { earliest: earliestWeekdaysDate({ today: data.today, yearStart: data.academicYear.startDate, appliesToday }), yearStart: data.academicYear.startDate, yearEnd: data.academicYear.endDate };
  };

  return (
    <PageContainer>
      <PageHeader
        title="Academic Calendar"
        description={
          owner
            ? 'When students have school: weekly school days for each academic year, school holidays, and branch closures. Student attendance follows this calendar.'
            : 'When students have school at your branch: the school’s days and holidays, your branch’s closures and reopenings. Student attendance follows this calendar.'
        }
        primaryAction={
          data && (
            <Button leftIcon={Plus} onClick={() => setDialog({ type: 'entry' })} unavailableReason={writable ? undefined : 'This calendar cannot be changed now.'}>
              Add to calendar
            </Button>
          )
        }
      />

      {suspended && (
        <Alert variant="warning" title="Your school is suspended">
          You can view the calendar but not change it until the school is reactivated.
        </Alert>
      )}
      {data?.academicYear.status === 'closed' && (
        <Alert variant="info" title={`${data.academicYear.name} is closed`}>
          Its calendar is kept as it is and cannot be changed.
        </Alert>
      )}
      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      <Card as="section" aria-label="Calendar filters" className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label="Academic year"
            options={(years.data?.items ?? []).length ? years.data.items.map((y) => ({ value: y.id, label: `${y.name}${YEAR_SUFFIX[y.status] ?? ''}` })) : [{ value: '', label: 'No academic years yet' }]}
            value={year?.id ?? ''}
            onChange={(event) => {
              set('year', event.target.value);
              set('month', '');
            }}
          />
          {owner && (
            <Select
              label="Branch (month view)"
              options={branchList.length ? branchList.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` })) : [{ value: '', label: 'No branches yet' }]}
              value={viewBranch}
              onChange={(event) => set('branch', event.target.value)}
            />
          )}
        </div>
      </Card>

      {years.data && !year && (
        <Alert variant="info" title="No academic year yet">
          The calendar belongs to an academic year. {owner ? 'Plan one under Academic Years first.' : 'Your School Owner has not planned an academic year yet.'}
        </Alert>
      )}
      {(cal.status === 'error' || years.status === 'error') && (
        <Card>
          <ErrorState title="The calendar could not be loaded" description="Check your connection and try again." onRetry={cal.status === 'error' ? cal.retry : years.retry} />
        </Card>
      )}
      {year && !data && cal.status !== 'error' && (
        <div aria-busy="true" aria-label="Loading the calendar" className="flex flex-col gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-72" />
        </div>
      )}

      {data && (
        <>
          <SchoolDaysCard
            role={role}
            cal={data}
            writable={writable}
            onChange={(level) => setDialog({ type: 'weekdays', level })}
            onCancel={(v) => setDialog({ type: 'cancel-weekdays', version: v })}
            onPolicy={(next) => (next ? setDialog({ type: 'policy', allowed: true }) : setDialog({ type: 'policy', allowed: false }))}
          />
          {month && <MonthView role={role} branch={viewBranch} month={month} onMonthChange={(m) => set('month', m)} version={version} />}

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h2 className="text-card-title text-fg">Holidays, closures, reopenings and extra school days</h2>
              <Checkbox label="Show cancelled" checked={showCancelled} onChange={(event) => setShowCancelled(event.target.checked)} />
            </div>
            <div role="region" aria-label="Calendar entries" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
              <Table caption={`Calendar entries of ${data.academicYear.name}, by first day`}>
                <TableHead>
                  <TableRow interactive={false}>
                    <TableHeaderCell>Name</TableHeaderCell>
                    <TableHeaderCell>Type</TableHeaderCell>
                    <TableHeaderCell>Branch</TableHeaderCell>
                    <TableHeaderCell>Dates</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell align="right">Actions</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {entries.length === 0 && (
                    <TableEmpty
                      columns={COLUMNS}
                      icon={CalendarDays}
                      title="Nothing on the calendar"
                      description={owner ? 'Add school holidays, and closures of a branch.' : 'School holidays and your branch’s closures appear here.'}
                    />
                  )}
                  {entries.map((entry) => {
                    const actions = entryActions(entry, data.firstEditableDate, { canManage: writable && canManageEntry(entry, role) });
                    return (
                      <TableRow key={entry.id}>
                        <TableCell className="font-medium">
                          <span className="flex flex-col">
                            {entry.name}
                            {entry.note && <span className="text-caption font-normal text-fg-muted">{entry.note}</span>}
                            {entry.holiday && <span className="text-caption font-normal text-fg-muted">Reopens {entry.holiday.name}</span>}
                            {entry.type === 'holiday' && entry.allowBranchReopening && <span className="text-caption font-normal text-fg-muted">Branches may reopen</span>}
                            {entry.timetableDay && <span className="text-caption font-normal text-fg-muted">Follows {WEEKDAY_NAMES[entry.timetableDay]}’s timetable</span>}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={ENTRY_TYPES[entry.type].tone}>{ENTRY_TYPES[entry.type].label}</Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-fg-secondary">{entry.branch ? entry.branch.name : 'All branches'}</TableCell>
                        <TableCell className="whitespace-nowrap text-fg-secondary">
                          {entry.startDate === entry.endDate ? formatFullDay(entry.startDate) : `${formatFullDay(entry.startDate)} – ${formatFullDay(entry.endDate)}`}
                          <span className="text-fg-muted"> · {entry.days} day{entry.days === 1 ? '' : 's'}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={entry.status === 'active' ? (entry.endDate < data.today ? 'neutral' : 'success') : 'neutral'}>
                            {entry.status === 'cancelled' ? 'Cancelled' : entry.endDate < data.today ? 'Past' : entry.startDate <= data.today ? 'Now' : 'Upcoming'}
                          </Badge>
                        </TableCell>
                        <TableCell align="right">
                          <TableActions>
                            {actions.rename && (
                              <Button variant="ghost" size="sm" onClick={() => setDialog({ type: 'entry', entry })}>
                                Edit
                              </Button>
                            )}
                            {actions.cancel && (
                              <Button variant="ghost" size="sm" onClick={() => setDialog({ type: 'cancel-entry', entry, mode: actions.cancel })}>
                                {actions.cancel === 'end' ? 'End early' : 'Cancel'}
                              </Button>
                            )}
                            {!actions.rename && !actions.cancel && <span className="text-small text-fg-muted">{canManageEntry(entry, role) ? 'Read only' : 'Set by your School Owner'}</span>}
                          </TableActions>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>

          <EntryModal
            role={role}
            year={data.academicYear}
            entry={dialog?.type === 'entry' ? dialog.entry : null}
            context={context}
            open={dialog?.type === 'entry'}
            onClose={() => setDialog(null)}
            onSaved={(entry) => done(`${entry.name} was saved.`)}
          />
          {dialog?.type === 'weekdays' && (
            <WeekdaysModal
              role={role}
              year={data.academicYear}
              branchName={data.weekdays.branches[0]?.branch.name ?? 'your branch'}
              current={dialog.level === 'school' ? (data.weekdays.school.days ?? []) : (data.weekdays.branches[0]?.days ?? data.weekdays.school.days ?? [])}
              schoolDays={data.weekdays.school.days ?? []}
              limits={weekdayLimits(dialog.level)}
              open
              onClose={() => setDialog(null)}
              onSaved={() => done('School days were saved.')}
            />
          )}
          <ConfirmModal
            open={dialog?.type === 'cancel-entry'}
            onClose={() => setDialog(null)}
            title={dialog?.mode === 'end' ? `End ${dialog?.entry?.name} early?` : `Cancel ${dialog?.entry?.name}?`}
            description={
              dialog?.mode === 'end'
                ? `Its last day becomes ${formatFullDay(addDays(data.firstEditableDate, -1))}. Days that have passed stay as they were.`
                : 'It is kept in the history as cancelled.'
            }
            confirmLabel={dialog?.mode === 'end' ? 'End early' : 'Cancel entry'}
            run={dialog?.type === 'cancel-entry' ? cancelEntryAction(role, dialog.entry) : () => null}
            onDone={() => done(dialog?.mode === 'end' ? `${dialog.entry.name} now ends earlier.` : `${dialog.entry.name} was cancelled.`)}
          >
            {dialog?.entry?.type === 'holiday' && <p className="text-body text-fg-secondary">Branch reopenings of this holiday lose the same days.</p>}
          </ConfirmModal>
          <ConfirmModal
            open={dialog?.type === 'cancel-weekdays'}
            onClose={() => setDialog(null)}
            title="Cancel this scheduled change?"
            description={dialog?.version ? `${dialog.version.followsSchool ? 'Following the school’s days' : daysText(dialog.version.days)} from ${formatFullDay(dialog.version.effectiveFrom)} will not apply.` : ''}
            confirmLabel="Cancel change"
            run={dialog?.type === 'cancel-weekdays' ? cancelWeekdaysAction(role, data.academicYear.id, dialog.version) : () => null}
            onDone={() => done('The scheduled change was cancelled.')}
          />
          <ConfirmModal
            open={dialog?.type === 'policy'}
            onClose={() => setDialog(null)}
            title={dialog?.allowed ? 'Let branches set their own school days?' : 'Stop branches setting their own school days?'}
            description={
              dialog?.allowed
                ? `Managers may then choose different school days for their branch in ${data.academicYear.name}.`
                : 'Every branch with its own days follows the school’s days from tomorrow; their scheduled changes are cancelled. Days that have passed stay as they were.'
            }
            confirmLabel={dialog?.allowed ? 'Allow' : 'Stop'}
            variant={dialog?.allowed ? 'primary' : 'danger'}
            run={dialog?.type === 'policy' ? branchWeekdaysAction(data.academicYear.id, dialog.allowed) : () => null}
            onDone={() => done(dialog?.allowed ? 'Branches may now set their own school days.' : 'Every branch follows the school’s days from tomorrow.')}
          />
        </>
      )}
    </PageContainer>
  );
}
