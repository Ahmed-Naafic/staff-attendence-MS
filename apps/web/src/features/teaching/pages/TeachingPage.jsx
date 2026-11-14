import { useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Presentation, UserPlus, Users } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmModal,
  ErrorState,
  Input,
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
  TabPanel,
  Tabs,
} from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadAcademicYears, loadOwnerSchoolStatus } from '../../academic-years';
import { useSession } from '../../auth';
import { loadOwnerBranches, loadSections } from '../../classes/data/classesApi.js';
import { pickYear } from '../../classes/utils/classRules.js';
import { StaffFormModal } from '../../staff/components/StaffFormModal.jsx';
import { AssignModal, EndAssignmentModal } from '../components/TeachingModals.jsx';
import { cancelAssignment, loadAssignments, loadSectionTeaching, loadTeachers } from '../data/teachingApi.js';
import { ASSIGNMENT_STATES, assignmentActions, periodText, ROLE_LABELS } from '../utils/teachingRules.js';

const YEAR_SUFFIX = { current: ' (current)', planned: ' (planned)', closed: ' (closed)' };

function TeacherName({ a, showHome }) {
  return (
    <span className="flex flex-col">
      <span className="font-medium text-fg">{a.teacher.name}</span>
      <span className="text-caption text-fg-muted">
        {a.teacher.staffId}
        {showHome && a.teacher.homeBranch && a.teacher.homeBranch.id !== a.branch.id ? ` · home branch ${a.teacher.homeBranch.name}` : ''}
      </span>
    </span>
  );
}

/** Actions for one assignment: change the last day, cancel (not started), or why not. */
function AssignmentActions({ a, fe, writable, onEnd, onCancel }) {
  const actions = assignmentActions(a, fe, { writable });
  if (!actions.end && !actions.cancel) {
    return <span className="text-small text-fg-muted">{!a.canManage && a.state !== 'cancelled' ? 'Managed by your School Owner' : ''}</span>;
  }
  return (
    <TableActions>
      {actions.end && (
        <Button size="sm" variant="ghost" onClick={() => onEnd(a)}>
          Last day
        </Button>
      )}
      {actions.cancel && (
        <Button size="sm" variant="ghost" onClick={() => onCancel(a)}>
          Cancel
        </Button>
      )}
    </TableActions>
  );
}

/**
 * The teachers: active staff whose job title is a teaching one (Teacher, Head Teacher…), with their
 * live teaching in the year. They are ordinary staff accounts: Managers register them here or under
 * Staff, and they appear in both. School Owner: every branch (or the chosen one); Manager: their branch.
 */
function TeachersPanel({ role, owner, year, branch, version, onView }) {
  const [q, setQ] = useState('');
  const teachers = useApiData(() => loadTeachers(role, { q, academicYear: year.id, show: 'teachers' }), `teachers|${role}|${q}|${year.id}|${version}`, { delayMs: 250 });
  const items = (teachers.data?.items ?? []).filter((t) => !owner || !branch || t.homeBranch?.id === branch);
  const columns = owner ? 5 : 4;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-card-title text-fg">Teachers</h2>
          <p className="text-small text-fg-muted">Staff whose job title is a teaching one. A teacher registered here is also a staff member under Staff, where job titles are changed.</p>
        </div>
        <Input type="search" label="Find a teacher" hideLabel placeholder="Name, Staff ID or phone" value={q} onChange={(e) => setQ(e.target.value)} fieldClassName="w-full sm:w-64" />
      </div>
      {teachers.status === 'error' && !teachers.data ? (
        <ErrorState title="Teachers could not be loaded" description="Check your connection and try again." onRetry={teachers.retry} />
      ) : (
        <div role="region" aria-label="Teachers" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
          <Table caption={`Teachers, with their teaching in ${year.name}`}>
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Teacher</TableHeaderCell>
                <TableHeaderCell>Job title</TableHeaderCell>
                {owner && <TableHeaderCell>Home branch</TableHeaderCell>}
                <TableHeaderCell>Teaching in {year.name}</TableHeaderCell>
                <TableHeaderCell align="right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!teachers.data && <TableLoading columns={columns} />}
              {teachers.data && !items.length && (
                <TableEmpty
                  columns={columns}
                  icon={Users}
                  title={q ? 'No teacher matches' : 'No teachers yet'}
                  description={owner ? 'Branch Managers register teachers, or give staff a teaching job title under Staff.' : 'Register a teacher, or give a staff member a teaching job title under Staff.'}
                />
              )}
              {items.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <span className="flex flex-col">
                      <span className="font-medium text-fg">{t.name}</span>
                      <span className="text-caption text-fg-muted">{t.staffId}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-fg-secondary">{t.jobTitle}</TableCell>
                  {owner && <TableCell className="text-fg-secondary">{t.homeBranch?.name ?? '—'}</TableCell>}
                  <TableCell className="tabular-nums text-fg-secondary">
                    {t.liveAssignments ? `${t.liveAssignments} assignment${t.liveAssignments === 1 ? '' : 's'}` : <span className="text-warning-fg">None yet</span>}
                  </TableCell>
                  <TableCell align="right">
                    <Button size="sm" variant="ghost" onClick={() => onView(t)}>
                      View teaching
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {teachers.data && teachers.data.total > teachers.data.items.length && (
            <p className="border-t border-border px-4 py-2 text-small text-fg-muted">
              Showing {teachers.data.items.length} of {teachers.data.total}. Search to find others.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * Teaching: who teaches what in each section (subject teachers) and each section's class teacher, per
 * academic year. School Owner: any staff of the school in any branch's sections. Manager: their own
 * staff in their branch's sections (and they see teachers the Owner brought from other branches).
 */
export default function TeachingPage() {
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
        if (name !== 'section') next.delete('section');
        return next;
      },
      { replace: true },
    );
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const [state, setState] = useState('live');
  // Assignments of one teacher ("View teaching" on the Teachers tab): { id, name } or null.
  const [teacher, setTeacher] = useState(null);
  const tabsId = useId();
  const tab = params.get('tab') === 'teachers' ? 'teachers' : 'assignments';

  const years = useApiData(() => loadAcademicYears(role), `years|${role}`);
  const year = pickYear(years.data?.items ?? [], params.get('year'));
  const branches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `branches|${role}`);
  const school = useApiData(() => (owner ? loadOwnerSchoolStatus() : Promise.resolve(null)), `school|${version}`);
  const branch = owner ? (params.get('branch') ?? '') : '';
  const sectionId = params.get('section') ?? '';
  const sections = useApiData(() => (year ? loadSections(role, { academicYear: year.id, branch, status: 'active' }) : Promise.resolve(null)), `sections|${year?.id}|${branch}`);
  const view = useApiData(() => (sectionId ? loadSectionTeaching(role, sectionId) : Promise.resolve(null)), `section|${sectionId}|${version}`);
  const list = useApiData(
    () => (year && !sectionId && tab === 'assignments' ? loadAssignments(role, { academicYear: year.id, branch, state, teacher: teacher?.id }) : Promise.resolve(null)),
    `list|${year?.id}|${branch}|${state}|${sectionId}|${tab}|${teacher?.id}|${version}`,
  );

  const suspended = school.data === 'suspended';
  const writable = Boolean(year) && year.status !== 'closed' && !suspended;
  const data = view.data && view.data.section.id === sectionId ? view.data : null;
  const fe = data?.firstEditableDate ?? list.data?.today;
  const done = (message) => {
    setDialog(null);
    setNotice(message);
    setVersion((n) => n + 1);
  };
  const assignContext = (extra) =>
    data && {
      role,
      section: data.section,
      subjects: data.subjects.filter((s) => s.subject.status === 'active' && !s.offList).map((s) => s.subject),
      earliest: data.firstEditableDate > data.section.academicYear.startDate ? data.firstEditableDate : data.section.academicYear.startDate,
      yearEnd: data.section.academicYear.endDate,
      ...extra,
    };
  const rowActions = (a) => (
    <AssignmentActions a={a} fe={fe} writable={writable} onEnd={(x) => setDialog({ type: 'end', assignment: x })} onCancel={(x) => setDialog({ type: 'cancel', assignment: x })} />
  );

  return (
    <PageContainer>
      <PageHeader
        title="Teaching"
        description={
          owner
            ? 'Who teaches each subject in each section, and each section’s class teacher. Any staff member of your school can teach in any branch; their home branch does not change.'
            : 'Who teaches in your branch’s sections. You assign your own staff; teachers from other branches are assigned by your School Owner.'
        }
        primaryAction={
          data ? (
            <Button leftIcon={UserPlus} onClick={() => setDialog({ type: 'assign', context: assignContext({}) })} unavailableReason={writable ? undefined : 'Teaching cannot be changed now.'}>
              Assign Teaching
            </Button>
          ) : (
            !owner &&
            tab === 'teachers' && (
              <Button leftIcon={UserPlus} onClick={() => setDialog({ type: 'register' })}>
                Register Teacher
              </Button>
            )
          )
        }
      />
      {suspended && <Alert variant="warning" title="Your school is suspended">You can view teaching but not change it until the school is reactivated.</Alert>}
      {year?.status === 'closed' && <Alert variant="info" title={`${year.name} is closed`}>Its teaching is kept as it was.</Alert>}
      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      <Card as="section" aria-label="Teaching filters" className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Academic year"
            options={(years.data?.items ?? []).length ? years.data.items.map((y) => ({ value: y.id, label: `${y.name}${YEAR_SUFFIX[y.status] ?? ''}` })) : [{ value: '', label: 'No academic years yet' }]}
            value={year?.id ?? ''}
            onChange={(e) => set('year', e.target.value)}
          />
          {owner && (
            <Select
              label="Branch"
              options={[{ value: '', label: 'All branches' }, ...(branches.data ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))]}
              value={branch}
              onChange={(e) => set('branch', e.target.value)}
            />
          )}
          <Select
            label="Section"
            options={[
              { value: '', label: 'All sections' },
              ...(sections.data?.items ?? []).map((s) => ({ value: s.id, label: owner && !branch ? `${s.displayName} · ${s.branch.name}` : s.displayName })),
            ]}
            value={sectionId}
            onChange={(e) => set('section', e.target.value)}
          />
          {!sectionId && tab === 'assignments' && (
            <Select
              label="Show"
              options={[
                { value: 'live', label: 'Teaching now and scheduled' },
                { value: 'ended', label: 'Ended' },
                { value: 'cancelled', label: 'Cancelled' },
                { value: 'all', label: 'Everything' },
              ]}
              value={state}
              onChange={(e) => setState(e.target.value)}
            />
          )}
        </div>
      </Card>

      {years.data && !year && <Alert variant="info" title="No academic year yet">Teaching belongs to an academic year and its sections.</Alert>}

      {sectionId && view.status === 'error' && !data && (
        <Card>
          <ErrorState title="The section could not be loaded" description="Check your connection and try again." onRetry={view.retry} />
        </Card>
      )}
      {sectionId && !data && view.status !== 'error' && <Skeleton className="h-64" />}

      {data && (
        <>
          <Card as="section" aria-labelledby="class-teacher" className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="class-teacher" className="text-card-title text-fg">
                Class teacher of {data.section.displayName}
              </h2>
              <Button size="sm" variant="outline" onClick={() => setDialog({ type: 'assign', context: assignContext({ fixedRole: 'class' }) })} unavailableReason={writable ? undefined : 'Teaching cannot be changed now.'}>
                Assign Class Teacher
              </Button>
            </div>
            {!data.classTeachers.length && <p className="text-body text-fg-secondary">No class teacher yet. A class teacher is responsible for the section as a whole; it does not by itself allow taking any lesson’s attendance.</p>}
            <ul className="flex flex-col gap-2">
              {data.classTeachers.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex flex-wrap items-center gap-3">
                    <TeacherName a={a} showHome />
                    <Badge variant={ASSIGNMENT_STATES[a.state].variant}>{ASSIGNMENT_STATES[a.state].label}</Badge>
                    <span className="text-small text-fg-muted">{periodText(a)}</span>
                  </span>
                  {rowActions(a)}
                </li>
              ))}
            </ul>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-card-title text-fg">Subjects and teachers</h2>
              <p className="text-small text-fg-muted">
                {data.curriculumSet ? `The subjects of ${data.section.class.name}.` : `${data.section.class.name} has no subject list: every active subject is shown. Your School Owner can choose them on the class page.`}
              </p>
            </div>
            <div role="region" aria-label="Subjects and teachers" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
              <Table caption={`Teaching in ${data.section.displayName}`}>
                <TableHead>
                  <TableRow interactive={false}>
                    <TableHeaderCell>Subject</TableHeaderCell>
                    <TableHeaderCell>Lessons / week</TableHeaderCell>
                    <TableHeaderCell>Teachers</TableHeaderCell>
                    <TableHeaderCell align="right">Assign</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {!data.subjects.length && <TableEmpty columns={4} icon={Presentation} title="No subjects" description="Your school has no active subjects yet." />}
                  {data.subjects.map((row) => (
                    <TableRow key={row.subject.id}>
                      <TableCell className="font-medium">
                        {row.subject.name}
                        {row.offList && <span className="block text-caption font-normal text-warning-fg">No longer on the class’s list</span>}
                      </TableCell>
                      <TableCell className="tabular-nums text-fg-secondary">{row.weeklyLessons ?? '—'}</TableCell>
                      <TableCell>
                        {!row.teachers.length && <span className="text-small text-warning-fg">No teacher</span>}
                        <ul className="flex flex-col gap-2">
                          {row.teachers.map((a) => (
                            <li key={a.id} className="flex flex-wrap items-center gap-3">
                              <TeacherName a={a} showHome />
                              <Badge variant={ASSIGNMENT_STATES[a.state].variant}>{ASSIGNMENT_STATES[a.state].label}</Badge>
                              <span className="text-small text-fg-muted">{periodText(a)}</span>
                              {rowActions(a)}
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                      <TableCell align="right">
                        {!row.offList && row.subject.status === 'active' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDialog({ type: 'assign', context: assignContext({ fixedRole: 'subject', fixedSubject: row.subject.id }) })}
                            unavailableReason={writable ? undefined : 'Teaching cannot be changed now.'}
                          >
                            Assign
                          </Button>
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

      {!sectionId && year && (
        <Tabs
          id={tabsId}
          label="Teaching views"
          tabs={[
            { value: 'assignments', label: 'Assignments' },
            { value: 'teachers', label: 'Teachers' },
          ]}
          value={tab}
          onChange={(next) => set('tab', next === 'teachers' ? next : '')}
        />
      )}
      {!sectionId && year && tab === 'teachers' && (
        <TabPanel tabsId={tabsId} value="teachers">
          <TeachersPanel
            role={role}
            owner={owner}
            year={year}
            branch={branch}
            version={version}
            onView={(t) => {
              setTeacher({ id: t.id, name: t.name });
              setState('all');
              set('tab', '');
            }}
          />
        </TabPanel>
      )}
      {!sectionId && year && tab === 'assignments' && teacher && (
        <Alert variant="info" title={`Teaching of ${teacher.name}`} onDismiss={() => setTeacher(null)}>
          Only this teacher’s assignments are shown. Close this to see everyone’s.
        </Alert>
      )}

      {!sectionId && year && tab === 'assignments' && (
        <Card className="overflow-hidden">
          {list.status === 'error' && !list.data ? (
            <ErrorState title="Teaching could not be loaded" description="Check your connection and try again." onRetry={list.retry} />
          ) : (
            <div role="region" aria-label="Teaching assignments" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
              <Table caption={`Teaching in ${year.name}, by class and section`}>
                <TableHead>
                  <TableRow interactive={false}>
                    <TableHeaderCell>Section</TableHeaderCell>
                    <TableHeaderCell>Teaches</TableHeaderCell>
                    <TableHeaderCell>Teacher</TableHeaderCell>
                    <TableHeaderCell>Dates</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell align="right">Actions</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {!list.data && <TableLoading columns={6} />}
                  {list.data && !list.data.items.length && (
                    <TableEmpty columns={6} icon={Presentation} title="No teaching yet" description="Choose a section to assign subject teachers and its class teacher." />
                  )}
                  {(list.data?.items ?? []).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="whitespace-nowrap">
                        <button type="button" className="font-medium text-interactive underline-offset-2 hover:underline" onClick={() => set('section', a.section.id)}>
                          {a.section.displayName}
                        </button>
                        {owner && <span className="block text-caption text-fg-muted">{a.branch.name}</span>}
                      </TableCell>
                      <TableCell>{a.role === 'class' ? ROLE_LABELS.class : a.subject.name}</TableCell>
                      <TableCell>
                        <TeacherName a={a} showHome />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-fg-secondary">{periodText(a)}</TableCell>
                      <TableCell>
                        <Badge variant={ASSIGNMENT_STATES[a.state].variant}>{ASSIGNMENT_STATES[a.state].label}</Badge>
                      </TableCell>
                      <TableCell align="right">{rowActions(a)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      )}

      {dialog?.type === 'assign' && dialog.context && (
        <AssignModal
          context={dialog.context}
          open
          onClose={() => setDialog(null)}
          onSaved={(a) => done(`${a.teacher.name} now teaches ${a.subject ? a.subject.name : 'as class teacher'} in ${a.section.displayName} from ${a.startDate}.`)}
          onRegister={owner ? undefined : (values) => setDialog({ type: 'register', back: { ...dialog.context, values } })}
        />
      )}
      {/* Registering a teacher creates an ordinary staff member of the Manager's branch (job title
          Teacher), listed under Staff too; from the Assign dialog, it returns there with them chosen. */}
      <StaffFormModal
        mode="create"
        open={dialog?.type === 'register'}
        jobTitle="Teacher"
        title="Register Teacher"
        description="A new staff member of your branch with the job title Teacher. They are also listed under Staff, where you give them their work shifts. Their Staff ID is generated automatically."
        submitLabel="Register Teacher"
        onClose={() => setDialog(dialog?.back ? { type: 'assign', context: dialog.back } : null)}
        onSaved={(staff) => {
          setNotice(`${staff.name} (${staff.staffId}) is registered as a teacher and is also listed under Staff. Give them their work shifts there.`);
          setVersion((n) => n + 1);
          setDialog(dialog?.back ? { type: 'assign', context: { ...dialog.back, teacher: staff.id, teacherQuery: staff.staffId } } : null);
        }}
      />
      <EndAssignmentModal
        role={role}
        assignment={dialog?.type === 'end' ? dialog.assignment : null}
        firstEditable={fe}
        yearEnd={year?.endDate}
        open={dialog?.type === 'end'}
        onClose={() => setDialog(null)}
        onSaved={(a) => done(`${a.teacher.name}'s last day is now ${a.endDate ?? 'the end of the year'}.`)}
      />
      <ConfirmModal
        open={dialog?.type === 'cancel'}
        onClose={() => setDialog(null)}
        title="Cancel this assignment?"
        description={dialog?.assignment ? `${dialog.assignment.teacher.name}: ${dialog.assignment.subject?.name ?? 'class teacher'} in ${dialog.assignment.section.displayName} (${periodText(dialog.assignment)}). It is kept as cancelled.` : ''}
        confirmLabel="Cancel assignment"
        run={() => cancelAssignment(role, dialog.assignment.id)}
        onDone={() => done('The assignment was cancelled.')}
      />
    </PageContainer>
  );
}
