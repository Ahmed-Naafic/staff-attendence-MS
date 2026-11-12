import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Plus, SearchX, Users } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  LinkButton,
  Pagination,
  Select,
  Table,
  TableActions,
  TableBody,
  TableCell,
  TableEmpty,
  TableError,
  TableHead,
  TableHeaderCell,
  TableLoading,
  TableRow,
} from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { apiRequest } from '../../../lib/api.js';
import { loadAcademicYears } from '../../academic-years';
import { useSession } from '../../auth';
import { StudentFormModal } from '../components/StudentModals.jsx';
import { loadStudents } from '../data/studentsApi.js';
import { STUDENT_STATUS } from '../utils/studentRules.js';

const PAGE_SIZE = 20;
const YEAR_SUFFIX = { current: ' (current)', planned: ' (planned)', closed: ' (closed)' };

/**
 * Student Directory. School Owner: every branch (or one); Manager: their branch. Search by name or
 * Student ID; filter by academic year, branch, class, section, status and enrollment. Each student
 * shows their section in the chosen year directly ("Grade 7A"). Filters live in the URL.
 */
export default function StudentsPage() {
  const { user } = useSession();
  const role = user.role === 'OWNER' ? 'OWNER' : 'MANAGER';
  const owner = role === 'OWNER';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const get = (name) => params.get(name) ?? '';
  const set = (changes) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [name, value] of Object.entries(changes)) value ? next.set(name, value) : next.delete(name);
        if (!('page' in changes)) next.delete('page');
        return next;
      },
      { replace: true },
    );
  const [registering, setRegistering] = useState(false);
  const [notice, setNotice] = useState('');

  const years = useApiData(() => loadAcademicYears(role), `years|${role}`);
  const yearList = years.data?.items ?? [];
  const branches = useApiData(() => (owner ? apiRequest('/owner/branches', { query: { pageSize: 100 } }).then((r) => r.items) : Promise.resolve([])), `branches|${role}`);
  const filters = {
    q: get('q'),
    academicYear: get('year') || undefined,
    branch: get('branch'),
    classId: get('class'),
    sectionId: get('section'),
    status: get('status'),
    enrollment: get('enrollment'),
    page: Number(get('page')) || 1,
    pageSize: PAGE_SIZE,
  };
  const students = useApiData(() => loadStudents(role, filters), JSON.stringify(filters), { delayMs: 200 });
  const year = students.data?.academicYear;
  const sections = useApiData(
    () => (year ? apiRequest(`/${owner ? 'owner' : 'manager'}/sections`, { query: { academicYear: year.id, branch: owner ? filters.branch || undefined : undefined } }) : Promise.resolve(null)),
    `sections|${year?.id}|${filters.branch}`,
  );
  const sectionList = sections.data?.items ?? [];
  const classList = [...new Map(sectionList.map((s) => [s.class.id, s.class])).values()];
  const filtered = Boolean(filters.q || filters.branch || filters.classId || filters.sectionId || filters.status || filters.enrollment);
  const columns = owner ? 6 : 5;

  return (
    <PageContainer>
      <PageHeader
        title="Students"
        description={owner ? 'Students of every branch of your school. Each student is registered once; enrollment is per academic year.' : 'Students of your branch. Register a student once, then enroll them in a section for each academic year.'}
        primaryAction={
          <Button leftIcon={Plus} onClick={() => setRegistering(true)}>
            Register Student
          </Button>
        }
      />
      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      <Card as="section" aria-label="Student filters" className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input type="search" label="Search" placeholder="Name or Student ID…" value={filters.q} onChange={(event) => set({ q: event.target.value })} />
          <Select
            label="Academic year"
            options={yearList.length ? yearList.map((y) => ({ value: y.id, label: `${y.name}${YEAR_SUFFIX[y.status] ?? ''}` })) : [{ value: '', label: 'No academic years yet' }]}
            value={year?.id ?? ''}
            onChange={(event) => set({ year: event.target.value, class: '', section: '' })}
          />
          {owner && (
            <Select
              label="Branch"
              options={[{ value: '', label: 'All branches' }, ...(branches.data ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))]}
              value={filters.branch}
              onChange={(event) => set({ branch: event.target.value, section: '' })}
            />
          )}
          <Select
            label="Class"
            options={[{ value: '', label: 'All classes' }, ...classList.map((c) => ({ value: c.id, label: c.name }))]}
            value={filters.classId}
            onChange={(event) => set({ class: event.target.value, section: '' })}
          />
          <Select
            label="Section"
            options={[
              { value: '', label: 'All sections' },
              ...sectionList.filter((s) => !filters.classId || s.class.id === filters.classId).map((s) => ({ value: s.id, label: owner ? `${s.displayName} · ${s.branch.code}` : s.displayName })),
            ]}
            value={filters.sectionId}
            onChange={(event) => set({ section: event.target.value })}
          />
          <Select
            label="Status"
            options={[{ value: '', label: 'All statuses' }, ...Object.entries(STUDENT_STATUS).map(([value, s]) => ({ value, label: s.label }))]}
            value={filters.status}
            onChange={(event) => set({ status: event.target.value })}
          />
          <Select
            label="Enrollment"
            options={[
              { value: '', label: year ? `Any (${year.name})` : 'Any' },
              { value: 'enrolled', label: 'Enrolled this year' },
              { value: 'not_enrolled', label: 'Not enrolled this year' },
            ]}
            value={filters.enrollment}
            onChange={(event) => set({ enrollment: event.target.value })}
          />
          <Button variant="outline" className="self-end" disabled={!filtered} onClick={() => setParams(year ? { year: year.id } : {}, { replace: true })}>
            Reset
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div role="region" aria-label="Students" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
          <Table caption={`Students${year ? `, sections in ${year.name}` : ''}`}>
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Student ID</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                {owner && <TableHeaderCell>Branch</TableHeaderCell>}
                <TableHeaderCell>{year ? `Section (${year.name})` : 'Section'}</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell align="right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {students.status === 'error' && <TableError columns={columns} title="Students could not be loaded" onRetry={students.retry} />}
              {!students.data && students.status !== 'error' && <TableLoading columns={columns} rows={6} />}
              {students.data?.items.length === 0 &&
                (filtered ? (
                  <TableEmpty columns={columns} icon={SearchX} title="No students found" description="No students match your search and filters." />
                ) : (
                  <TableEmpty
                    columns={columns}
                    icon={Users}
                    title="No students yet"
                    description="Register your first student. Enrollment in a section comes after registration."
                    action={
                      <Button size="sm" onClick={() => setRegistering(true)}>
                        Register Student
                      </Button>
                    }
                  />
                ))}
              {students.data?.items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="whitespace-nowrap tabular-nums text-fg-secondary">{s.studentNumber}</TableCell>
                  <TableCell className="font-medium whitespace-nowrap">{s.fullName}</TableCell>
                  {owner && <TableCell className="whitespace-nowrap text-fg-secondary">{s.branch?.name}</TableCell>}
                  <TableCell className="whitespace-nowrap">{s.enrollment ? s.enrollment.section.displayName : <span className="text-fg-muted">Not enrolled</span>}</TableCell>
                  <TableCell>
                    <Badge variant={STUDENT_STATUS[s.status]?.variant ?? 'neutral'}>{STUDENT_STATUS[s.status]?.label ?? s.status}</Badge>
                  </TableCell>
                  <TableCell align="right">
                    <TableActions>
                      <LinkButton to={`/students/${s.id}`} size="sm" variant="outline" aria-label={`View ${s.fullName}`}>
                        View
                      </LinkButton>
                    </TableActions>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {students.data?.total > 0 && <Pagination page={students.data.page} pageSize={PAGE_SIZE} total={students.data.total} onPageChange={(page) => set({ page: String(page) })} itemLabel="students" />}
      </Card>

      <StudentFormModal
        role={role}
        mode="create"
        branches={branches.data}
        open={registering}
        onClose={() => setRegistering(false)}
        onSaved={(student) => {
          setRegistering(false);
          setNotice(`${student.fullName} was registered with Student ID ${student.studentNumber}.`);
          navigate(`/students/${student.id}`);
        }}
      />
    </PageContainer>
  );
}
