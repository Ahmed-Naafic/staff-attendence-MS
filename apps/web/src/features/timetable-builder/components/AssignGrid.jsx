import { useState } from 'react';
import { Alert, Card, ErrorState, Skeleton } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { assignTeaching, loadAssignments, loadCurriculum, loadTeachers } from '../../teaching/data/teachingApi.js';
import { loadBuilder } from '../data/builderApi.js';

/**
 * A teacher for every subject of every section (Timetable → Assign Teachers): per class, sections ×
 * its subjects. A cell shows who teaches it now or scheduled; an empty cell (no teacher) offers the
 * teachers to choose from — the same save and checks as "Assign Teaching" (from today, until the
 * year ends). To end or change an assignment, use the Teaching page. `onChanged(message)` after a save.
 */
export function AssignGrid({ role, academicYear, branch, onChanged }) {
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState('');
  const [errors, setErrors] = useState({});
  const ready = academicYear && (role !== 'OWNER' || branch);
  const key = `${academicYear}|${branch ?? ''}|${version}`;
  const builder = useApiData(() => (ready ? loadBuilder(role, { academicYear, branch }) : Promise.resolve(null)), `ag-builder|${key}`);
  const assignments = useApiData(() => (ready ? loadAssignments(role, { academicYear, branch, state: 'live' }) : Promise.resolve(null)), `ag-assign|${key}`);
  const teachers = useApiData(() => (academicYear ? loadTeachers(role, { academicYear, show: 'teachers' }) : Promise.resolve(null)), `ag-teachers|${academicYear}|${version}`);
  const sections = (builder.data?.sections ?? []).filter((s) => !s.excluded);
  const classIds = [...new Set(sections.map((s) => s.class.id))];
  const curricula = useApiData(() => (classIds.length ? Promise.all(classIds.map((id) => loadCurriculum(role, id))) : Promise.resolve([])), `ag-cur|${classIds.join(',')}|${version}`);

  if ([builder, assignments, teachers, curricula].some((d) => d.status === 'error')) {
    return <ErrorState title="The teaching could not be loaded" description="Check your connection and try again." onRetry={() => setVersion((n) => n + 1)} />;
  }
  if (!builder.data || !assignments.data || !teachers.data || !curricula.data) return <Skeleton className="h-64" />;
  if (!sections.length) return <Alert variant="info" title="No sections yet">Add sections in the step Classes & Sections first.</Alert>;

  const who = new Map();
  for (const a of assignments.data.items) {
    if (a.role !== 'subject' || !a.subject) continue;
    const k = `${a.section.id}|${a.subject.id}`;
    who.set(k, [...(who.get(k) ?? []), a]);
  }
  const options = teachers.data.items;
  const missing = sections.reduce((n, s) => n + (curricula.data.find((c) => c.class.id === s.class.id)?.items ?? []).filter((i) => !who.has(`${s.id}|${i.subject.id}`)).length, 0);

  async function assign(section, subject, teacherId) {
    const k = `${section.id}|${subject.id}`;
    setBusy(k);
    setErrors((e) => ({ ...e, [k]: undefined }));
    try {
      const a = await assignTeaching(role, { role: 'subject', teacher: teacherId, section: section.id, subject: subject.id });
      setVersion((n) => n + 1);
      onChanged?.(`${a.teacher.name} now teaches ${subject.name} in ${section.displayName}.`);
    } catch (error) {
      setErrors((e) => ({ ...e, [k]: error.message }));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert variant={missing ? 'warning' : 'success'} title={missing ? `${missing} subject${missing === 1 ? '' : 's'} without a teacher` : 'Every subject of every section has a teacher'}>
        Choose a teacher in each empty cell. The list shows staff with a teacher job title{role === 'MANAGER' ? ' (your branch’s staff; teachers from other branches are assigned by your School Owner)' : ''}. To end or change an assignment, use Teaching.
      </Alert>
      {classIds.map((classId) => {
        const cur = curricula.data.find((c) => c.class.id === classId);
        const subjects = (cur?.items ?? []).filter((i) => i.subject.status === 'active').map((i) => i.subject);
        const rows = sections.filter((s) => s.class.id === classId);
        return (
          <Card key={classId} className="overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-card-title text-fg">{cur?.class.name ?? rows[0].class.name}</h2>
              {!subjects.length && <p className="text-small text-warning-fg">No subjects yet: set them in Lessons per Week.</p>}
            </div>
            {subjects.length > 0 && (
              <div role="region" aria-label={`Teachers of ${cur?.class.name}`} tabIndex={0} className="overflow-x-auto">
                <table className="w-full text-small">
                  <thead>
                    <tr className="border-b border-border text-left text-fg-muted">
                      <th scope="col" className="sticky left-0 z-10 bg-surface px-3 py-2 font-medium">Section</th>
                      {subjects.map((s) => (
                        <th key={s.id} scope="col" className="min-w-40 px-2 py-2 font-medium">
                          {s.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((section) => (
                      <tr key={section.id} className="border-b border-border align-top last:border-0">
                        <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-medium whitespace-nowrap text-fg">
                          {section.displayName}
                        </th>
                        {subjects.map((subject) => {
                          const k = `${section.id}|${subject.id}`;
                          const current = who.get(k) ?? [];
                          return (
                            <td key={subject.id} className={`px-2 py-1.5 ${current.length ? '' : 'bg-warning-soft/40'}`}>
                              {current.length ? (
                                <span className="text-fg">
                                  {current.map((a) => a.teacher.name).join(', ')}
                                  {current.some((a) => a.state === 'scheduled') && <span className="block text-caption text-fg-muted">from {current.find((a) => a.state === 'scheduled').startDate}</span>}
                                </span>
                              ) : (
                                <select
                                  aria-label={`Teacher of ${subject.name} in ${section.displayName}`}
                                  className="w-full rounded-md border border-border bg-surface px-2 py-1"
                                  value=""
                                  disabled={busy === k}
                                  onChange={(e) => e.target.value && assign(section, subject, e.target.value)}
                                >
                                  <option value="">{busy === k ? 'Saving…' : 'Choose a teacher'}</option>
                                  {options.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name} · {t.staffId}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {errors[k] && <span className="mt-1 block text-caption text-error-fg">{errors[k]}</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
