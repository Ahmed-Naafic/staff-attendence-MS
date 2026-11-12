import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ChevronRight, GraduationCap, Plus, SearchX } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Button, Card, EmptyState, ErrorState, Input, Select, Skeleton } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadAcademicYears, loadOwnerSchoolStatus } from '../../academic-years';
import { useSession } from '../../auth';
import { ClassFormModal, StatusBadge } from '../components/ClassModals.jsx';
import { loadClasses, loadOwnerBranches } from '../data/classesApi.js';
import { pickYear } from '../utils/classRules.js';

const YEAR_SUFFIX = { current: ' (current)', planned: ' (planned)', closed: ' (closed)' };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One class card: its name, order, status and its sections in the chosen year and scope. */
function ClassCard({ cls, to }) {
  return (
    <Link
      to={to}
      className="group flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 transition-colors hover:border-border-strong hover:bg-muted/40 focus-visible:outline-offset-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-card-title text-fg">{cls.name}</span>
          <span className="text-small text-fg-muted">Order {cls.sequence}</span>
        </div>
        <ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-small text-fg-secondary">
        <span className="font-medium text-fg">{plural(cls.sections, 'section')}</span>
        <span>· {plural(cls.students ?? 0, 'student')}</span>
        {cls.capacity ? <span>· {cls.capacity} places</span> : null}
        {cls.inactiveSections ? <span className="text-fg-muted">· {cls.inactiveSections} inactive</span> : null}
      </div>
      {cls.status !== 'active' && (
        <div>
          <StatusBadge status={cls.status} />
        </div>
      )}
    </Link>
  );
}

/**
 * Class Management. School Owner: the school's classes (add, edit, deactivate), each with its
 * sections in the chosen academic year across all branches or one. Manager: the same list for their
 * own branch (read only for classes; sections are managed on each class's page). Filters live in the URL.
 */
export default function ClassesPage() {
  const { user } = useSession();
  const role = user.role === 'OWNER' ? 'OWNER' : 'MANAGER';
  const owner = role === 'OWNER';
  const navigate = useNavigate();
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
  const [dialog, setDialog] = useState(false);
  const [notice, setNotice] = useState('');

  const years = useApiData(() => loadAcademicYears(role), `years|${role}`);
  const yearList = years.data?.items ?? [];
  const year = pickYear(yearList, params.get('year'));
  const branches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `branches|${role}`);
  const school = useApiData(() => (owner ? loadOwnerSchoolStatus() : Promise.resolve(null)), `school|${version}`);
  const readOnly = school.data === 'suspended';

  const filters = { academicYear: year?.id, branch: params.get('branch') ?? '', q: params.get('q') ?? '', status: owner ? (params.get('status') ?? '') : '' };
  const ready = years.status !== 'loading' || years.data;
  const classes = useApiData(() => (ready ? loadClasses(role, filters) : Promise.resolve(null)), JSON.stringify([ready, filters, version]), { delayMs: 200 });
  const items = classes.data?.items ?? [];
  const nextSequence = Math.max(0, ...items.map((c) => c.sequence)) + 1;
  const filtered = Boolean(filters.q || filters.status);
  const search = params.toString() ? `?${params.toString()}` : '';
  const scopeText = owner
    ? filters.branch
      ? `at ${(branches.data ?? []).find((b) => b.id === filters.branch)?.name ?? 'the chosen branch'}`
      : 'across all branches'
    : 'in your branch';

  return (
    <PageContainer>
      <PageHeader
        title="Class Management"
        description={
          owner
            ? 'Your school’s classes are created once and used every academic year. Sections belong to one academic year and one branch.'
            : 'Your school’s classes, with the sections of your branch. Classes are managed by your School Owner; you manage your branch’s sections.'
        }
        primaryAction={
          owner && (
            <Button leftIcon={Plus} onClick={() => setDialog(true)} unavailableReason={readOnly ? 'Your school is suspended: classes cannot be added until it is reactivated.' : undefined}>
              Add Class
            </Button>
          )
        }
      />

      {readOnly && (
        <Alert variant="warning" title="Your school is suspended">
          You can view classes and sections but not change them until the school is reactivated.
        </Alert>
      )}
      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      <Card as="section" aria-label="Class filters" className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              value={filters.branch}
              onChange={(event) => set('branch', event.target.value)}
            />
          )}
          <Input type="search" label="Search classes" placeholder="Class name…" value={filters.q} onChange={(event) => set('q', event.target.value)} />
          {owner && (
            <Select
              label="Status"
              options={[
                { value: '', label: 'All statuses' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
              value={filters.status}
              onChange={(event) => set('status', event.target.value)}
            />
          )}
        </div>
      </Card>

      {year && (
        <p className="text-small text-fg-muted">
          Sections in {year.name} {scopeText}.{year.status === 'closed' && ' This year is closed: its sections are kept as they are.'}
        </p>
      )}
      {!year && years.data && (
        <Alert variant="info" title="No academic year yet">
          Sections belong to an academic year. {owner ? 'Plan one under Academic Years to add sections.' : 'Your School Owner has not planned an academic year yet.'}
        </Alert>
      )}

      {classes.status === 'error' && (
        <Card>
          <ErrorState title="Classes could not be loaded" description="Check your connection and try again." onRetry={classes.retry} />
        </Card>
      )}
      {!classes.data && classes.status !== 'error' && (
        <div aria-busy="true" aria-label="Loading classes" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      )}
      {classes.data && items.length === 0 && (
        <Card>
          {filtered ? (
            <EmptyState
              icon={SearchX}
              title="No classes found"
              description="No classes match your search and filter."
              action={
                <Button variant="outline" size="sm" onClick={() => setParams(year ? { year: year.id } : {}, { replace: true })}>
                  Clear search and filter
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={GraduationCap}
              title="No classes yet"
              description={owner ? 'Add your school’s classes once, e.g. Grade 1 to Grade 8, in their order.' : 'Your School Owner has not added any classes yet.'}
              action={
                owner &&
                !readOnly && (
                  <Button size="sm" onClick={() => setDialog(true)}>
                    Add Class
                  </Button>
                )
              }
            />
          )}
        </Card>
      )}
      {items.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Classes">
          {items.map((cls) => (
            <li key={cls.id}>
              <ClassCard cls={cls} to={`/classes/${cls.id}${search}`} />
            </li>
          ))}
        </ul>
      )}

      {owner && (
        <ClassFormModal
          mode="create"
          nextSequence={nextSequence}
          open={dialog}
          onClose={() => setDialog(false)}
          onSaved={(cls) => {
            setDialog(false);
            setNotice(`${cls.name} was added.`);
            setVersion((n) => n + 1);
            navigate(`/classes/${cls.id}${search}`);
          }}
        />
      )}
    </PageContainer>
  );
}
