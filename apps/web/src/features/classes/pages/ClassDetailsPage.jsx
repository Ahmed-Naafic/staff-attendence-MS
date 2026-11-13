import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { Layers, Plus } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import {
  Alert,
  Button,
  Card,
  Drawer,
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
  TableRow,
} from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { ClassSubjectsCard } from '../../teaching';
import { formatDateTime } from '../../../lib/format.js';
import { loadAcademicYears, loadOwnerSchoolStatus } from '../../academic-years';
import { useSession } from '../../auth';
import { ClassFormModal, SectionFormModal, StatusBadge, StatusModal } from '../components/ClassModals.jsx';
import { loadClass, loadOwnerBranches } from '../data/classesApi.js';
import { pickYear } from '../utils/classRules.js';

const YEAR_SUFFIX = { current: ' (current)', planned: ' (planned)', closed: ' (closed)' };

function Detail({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body text-fg">{children || <span className="text-fg-muted">Not set</span>}</dd>
    </div>
  );
}

/**
 * One class with its sections in the chosen academic year. School Owner: every branch (or one), edit
 * or deactivate the class, and manage sections of any branch. Manager: their own branch's sections
 * (add, edit, deactivate). Sections of a closed year, and anything while the school or branch is
 * suspended, are read only (the API decides; the page explains).
 */
export default function ClassDetailsPage() {
  const { classId } = useParams();
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
  // { type: 'edit-class' | 'class-status' | 'add-section' | 'edit-section' | 'section-status', section? }
  const [dialog, setDialog] = useState(null);
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');

  const years = useApiData(() => loadAcademicYears(role), `years|${role}`);
  const yearList = years.data?.items ?? [];
  const year = pickYear(yearList, params.get('year'));
  const branchFilter = owner ? (params.get('branch') ?? '') : '';
  const branches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `branches|${role}`);
  const school = useApiData(() => (owner ? loadOwnerSchoolStatus() : Promise.resolve(null)), `school|${version}`);
  const ready = years.status !== 'loading' || years.data;
  const details = useApiData(
    () => (ready ? loadClass(role, classId, { academicYear: year?.id, branch: branchFilter }) : Promise.resolve(null)),
    JSON.stringify([ready, classId, year?.id, branchFilter, version]),
  );

  const cls = details.data?.class;
  const sections = details.data?.sections ?? [];
  const schoolSuspended = school.data === 'suspended';
  const yearClosed = year?.status === 'closed';
  const hasWritableYear = yearList.some((y) => y.status !== 'closed');
  const addReason = schoolSuspended
    ? 'Your school is suspended.'
    : cls?.status === 'inactive'
      ? `${cls.name} is inactive. Reactivate it to add sections.`
      : !hasWritableYear
        ? 'Plan an academic year first: sections belong to a planned or current year.'
        : undefined;
  const open = (type, section) => {
    setNotice('');
    setDialog({ type, section });
  };
  const done = (message) => (result) => {
    setDialog(null);
    setSelected(null);
    setNotice(message(result));
    setVersion((n) => n + 1);
  };
  const back = new URLSearchParams(params);

  if (details.status === 'error') {
    const missing = details.error?.status === 404;
    return (
      <PageContainer>
        <PageHeader title="Class" breadcrumbs={[{ label: 'Classes', to: `/classes?${back}` }, { label: 'Class' }]} />
        <Card>
          <ErrorState
            title={missing ? 'Class not found' : 'The class could not be loaded'}
            description={missing ? 'This class does not exist or is not part of your school.' : 'Check your connection and try again.'}
            onRetry={missing ? undefined : details.retry}
          />
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={cls?.name ?? 'Class'}
        breadcrumbs={[{ label: 'Classes', to: `/classes?${back}` }, { label: cls?.name ?? 'Class' }]}
        description={
          cls &&
          `Order ${cls.sequence}${cls.description ? ` · ${cls.description}` : ''}. ${owner ? 'Sections of every branch of your school.' : 'Sections of your branch.'}`
        }
        secondaryActions={
          owner &&
          cls && (
            <>
              <Button variant="outline" onClick={() => open('edit-class')} unavailableReason={schoolSuspended ? 'Your school is suspended.' : undefined}>
                Edit Class
              </Button>
              <Button variant={cls.status === 'active' ? 'ghost' : 'outline'} onClick={() => open('class-status')} unavailableReason={schoolSuspended ? 'Your school is suspended.' : undefined}>
                {cls.status === 'active' ? 'Deactivate' : 'Reactivate'}
              </Button>
            </>
          )
        }
        primaryAction={
          cls && (
            <Button leftIcon={Plus} onClick={() => open('add-section')} unavailableReason={addReason}>
              Add Section
            </Button>
          )
        }
      />

      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}
      {cls?.status === 'inactive' && (
        <Alert variant="warning" title={`${cls.name} is inactive`}>
          Its sections and history are kept, but no sections can be added or reactivated until the class is reactivated.
        </Alert>
      )}
      {yearClosed && (
        <Alert variant="info" title={`${year.name} is closed`}>
          Its sections are kept as they were and cannot be changed. Choose a planned or current year to manage sections.
        </Alert>
      )}

      {cls && (
        <ClassSubjectsCard role={role} classId={cls.id} readOnlyReason={schoolSuspended ? 'Your school is suspended.' : undefined} onSaved={setNotice} />
      )}

      <Card as="section" aria-label="Section filters" className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label="Academic year"
            options={yearList.length ? yearList.map((y) => ({ value: y.id, label: `${y.name}${YEAR_SUFFIX[y.status] ?? ''}` })) : [{ value: '', label: 'No academic years yet' }]}
            value={year?.id ?? ''}
            onChange={(event) => set('year', event.target.value)}
          />
          {owner && (
            <Select
              label="Branch"
              options={[{ value: '', label: 'All branches' }, ...(branches.data ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))]}
              value={branchFilter}
              onChange={(event) => set('branch', event.target.value)}
            />
          )}
        </div>
      </Card>

      {!details.data ? (
        <div aria-busy="true" aria-label="Loading sections">
          <Skeleton className="h-64" />
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div role="region" aria-label="Sections" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
            <Table caption={`Sections of ${cls.name}${year ? ` in ${year.name}` : ''}`}>
              <TableHead>
                <TableRow interactive={false}>
                  <TableHeaderCell>Section</TableHeaderCell>
                  {owner && <TableHeaderCell>Branch</TableHeaderCell>}
                  <TableHeaderCell>Students</TableHeaderCell>
                  <TableHeaderCell>Capacity</TableHeaderCell>
                  <TableHeaderCell>Room</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell align="right">Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sections.length === 0 && (
                  <TableEmpty
                    columns={owner ? 7 : 6}
                    icon={Layers}
                    title={year ? `No sections in ${year.name}` : 'No academic year yet'}
                    description={year ? `Add ${cls.name}’s sections for ${year.name}, e.g. A, B and C.` : 'Sections belong to an academic year.'}
                    action={
                      !addReason &&
                      !yearClosed && (
                        <Button size="sm" onClick={() => open('add-section')}>
                          Add Section
                        </Button>
                      )
                    }
                  />
                )}
                {sections.map((s) => {
                  const locked = s.readOnly || schoolSuspended;
                  const why = s.readOnly ? `${s.academicYear.name} is closed.` : schoolSuspended ? 'Your school is suspended.' : undefined;
                  return (
                    <TableRow key={s.id} selected={selected?.id === s.id}>
                      <TableCell className="font-medium whitespace-nowrap">{s.displayName}</TableCell>
                      {owner && <TableCell className="whitespace-nowrap text-fg-secondary">{`${s.branch.name} (${s.branch.code})`}</TableCell>}
                      <TableCell className="tabular-nums">{s.students ?? 0}</TableCell>
                      <TableCell className="tabular-nums text-fg-secondary">{s.capacity ?? '—'}</TableCell>
                      <TableCell className="text-fg-secondary">{s.room || '—'}</TableCell>
                      <TableCell>
                        <StatusBadge status={s.status} />
                      </TableCell>
                      <TableCell align="right">
                        <TableActions>
                          <Button size="sm" variant="ghost" onClick={() => setSelected(s)} aria-label={`View ${s.displayName}`}>
                            View
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => open('edit-section', s)} unavailableReason={locked ? why : undefined} aria-label={`Edit ${s.displayName}`}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant={s.status === 'active' ? 'ghost' : 'outline'}
                            onClick={() => open('section-status', s)}
                            unavailableReason={locked ? why : undefined}
                            aria-label={`${s.status === 'active' ? 'Deactivate' : 'Reactivate'} ${s.displayName}`}
                          >
                            {s.status === 'active' ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        </TableActions>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.displayName ?? ''} description={selected && `${selected.academicYear.name} · ${selected.branch.name}`}>
        {selected && (
          <dl className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2">
            <Detail label="Class">{selected.class.name}</Detail>
            <Detail label="Section name">{selected.name}</Detail>
            <Detail label="Academic year">{`${selected.academicYear.name} (${selected.academicYear.startDate} to ${selected.academicYear.endDate})`}</Detail>
            <Detail label="Branch">{`${selected.branch.name} (${selected.branch.code})`}</Detail>
            <Detail label="Students">{String(selected.students ?? 0)}</Detail>
            <Detail label="Capacity">{selected.capacity ? String(selected.capacity) : ''}</Detail>
            <Detail label="Room">{selected.room}</Detail>
            <Detail label="Status">
              <StatusBadge status={selected.status} />
            </Detail>
            <Detail label="Created">{formatDateTime(selected.createdAt)}</Detail>
          </dl>
        )}
      </Drawer>

      {cls && owner && (
        <>
          <ClassFormModal mode="edit" cls={cls} open={dialog?.type === 'edit-class'} onClose={() => setDialog(null)} onSaved={done((c) => `${c.name} was saved.`)} />
          <StatusModal role={role} kind="class" target={cls} open={dialog?.type === 'class-status'} onClose={() => setDialog(null)} onDone={done((c) => `${c.name} is now ${c.status}.`)} />
        </>
      )}
      {cls && (
        <>
          <SectionFormModal
            role={role}
            mode="create"
            cls={cls}
            years={yearList}
            defaultYearId={year?.id}
            branches={branches.data}
            defaultBranchId={branchFilter}
            open={dialog?.type === 'add-section'}
            onClose={() => setDialog(null)}
            onSaved={done((s) => `${s.displayName} was added for ${s.academicYear.name} at ${s.branch.name}.`)}
          />
          <SectionFormModal
            role={role}
            mode="edit"
            section={dialog?.section}
            open={dialog?.type === 'edit-section'}
            onClose={() => setDialog(null)}
            onSaved={done((s) => `${s.displayName} was saved.`)}
          />
          <StatusModal
            role={role}
            kind="section"
            target={dialog?.section}
            open={dialog?.type === 'section-status'}
            onClose={() => setDialog(null)}
            onDone={done((s) => `${s.displayName} is now ${s.status}.`)}
          />
        </>
      )}
    </PageContainer>
  );
}
