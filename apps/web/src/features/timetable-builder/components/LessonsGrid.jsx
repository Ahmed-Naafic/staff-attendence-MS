import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Alert, Badge, Button, Card, ErrorState, Skeleton } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadClasses } from '../../classes/data/classesApi.js';
import { CurriculumModal } from '../../teaching/components/TeachingModals.jsx';
import { loadCurriculum, loadSubjects, saveCurriculum } from '../../teaching/data/teachingApi.js';
import { loadBuilder } from '../data/builderApi.js';
import { classPeriods, lessonsFit, lessonsRowItems, periodsText, rowTotal } from '../utils/builderRules.js';

const FIT = {
  fit: { variant: 'success', text: () => 'Fits' },
  over: { variant: 'error', text: (by) => `${by} too many` },
  under: { variant: 'warning', text: (by) => `${by} short` },
  unknown: { variant: 'neutral', text: () => 'No periods yet' },
};

/**
 * Lessons per week of every class at once (Timetable → Lessons per Week): classes × subjects, each
 * row's total against its sections' lesson periods in this branch. A row is saved as the class's
 * subject list (the same save and checks as "Choose Subjects"; one list for the class in every
 * branch). "Subjects…" adds or removes subjects. `onChanged(message)` after a save.
 */
export function LessonsGrid({ role, academicYear, branch, onChanged }) {
  const context = { academicYear, branch };
  const [version, setVersion] = useState(0);
  const key = `${academicYear}|${branch ?? ''}|${version}`;
  const classes = useApiData(() => (academicYear ? loadClasses(role, { academicYear, branch, status: 'active' }) : Promise.resolve(null)), `lg-classes|${key}`);
  const subjects = useApiData(() => loadSubjects(role, {}), `lg-subjects|${version}`);
  const builder = useApiData(() => (academicYear && (role !== 'OWNER' || branch) ? loadBuilder(role, context) : Promise.resolve(null)), `lg-builder|${key}`);
  const list = classes.data?.items ?? [];
  const curricula = useApiData(
    () => (list.length ? Promise.all(list.map((c) => loadCurriculum(role, c.id))) : Promise.resolve([])),
    `lg-cur|${list.map((c) => c.id).join(',')}|${version}`,
  );
  const [cells, setCells] = useState({});
  const [saving, setSaving] = useState('');
  const [errors, setErrors] = useState({});
  const [editing, setEditing] = useState(null);

  // Cells from the saved lists: { classId: { subjectId: '5' | '' } } (only listed subjects).
  useEffect(() => {
    if (!curricula.data) return;
    setCells(Object.fromEntries(curricula.data.map((c) => [c.class.id, Object.fromEntries(c.items.map((i) => [i.subject.id, i.weeklyLessons == null ? '' : String(i.weeklyLessons)]))])));
    setErrors({});
  }, [curricula.data]);

  if ([classes, subjects, curricula].some((d) => d.status === 'error')) {
    return <ErrorState title="The lessons could not be loaded" description="Check your connection and try again." onRetry={() => setVersion((n) => n + 1)} />;
  }
  if (!classes.data || !subjects.data || !curricula.data) return <Skeleton className="h-64" />;
  if (!list.length) return <Alert variant="info" title="No classes yet">Add classes in the step Classes & Sections first.</Alert>;

  const byClass = new Map(curricula.data.map((c) => [c.class.id, c]));
  const listedIds = new Set(curricula.data.flatMap((c) => c.items.map((i) => i.subject.id)));
  const columns = subjects.data.items.filter((s) => s.status === 'active' || listedIds.has(s.id));
  const saved = (classId) => Object.fromEntries((byClass.get(classId)?.items ?? []).map((i) => [i.subject.id, i.weeklyLessons == null ? '' : String(i.weeklyLessons)]));
  // A row differs from its saved list (empty cells of unlisted subjects do not count).
  const norm = (row, listed) => JSON.stringify(Object.entries(row).filter(([k, v]) => v !== '' || k in listed).sort());
  const dirty = (classId) => norm(cells[classId] ?? {}, saved(classId)) !== norm(saved(classId), saved(classId));
  const changed = list.filter((c) => dirty(c.id));
  const setCell = (classId, subjectId, value) => {
    setCells((all) => ({ ...all, [classId]: { ...all[classId], [subjectId]: value } }));
    setErrors((e) => ({ ...e, [classId]: undefined }));
  };

  async function saveRow(cls) {
    const items = lessonsRowItems(cells[cls.id] ?? {}, (byClass.get(cls.id)?.items ?? []).map((i) => i.subject.id));
    if (items.error) return setErrors((e) => ({ ...e, [cls.id]: items.error }));
    setSaving(cls.id);
    try {
      await saveCurriculum(cls.id, items, role);
      return true;
    } catch (error) {
      setErrors((e) => ({ ...e, [cls.id]: error.message }));
      return false;
    } finally {
      setSaving('');
    }
  }
  async function saveRows(rows) {
    let ok = 0;
    for (const cls of rows) if (await saveRow(cls)) ok += 1;
    if (ok) {
      setVersion((n) => n + 1);
      onChanged?.(`Lessons per week saved for ${ok === 1 ? rows[0].name : `${ok} classes`}.`);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-card-title text-fg">Lessons per week</h2>
          <p className="text-small text-fg-muted">
            Type the lessons a week of each subject. A class’s total must equal its lesson periods (school days × lesson periods a day). Each class has one list for every branch.
          </p>
        </div>
        <Button leftIcon={Save} onClick={() => saveRows(changed)} disabled={!changed.length} loading={Boolean(saving) && changed.length > 1}>
          {changed.length ? `Save ${changed.length} Change${changed.length === 1 ? '' : 's'}` : 'All Saved'}
        </Button>
      </div>
      <div role="region" aria-label="Lessons per week by class and subject" tabIndex={0} className="overflow-x-auto">
        <table className="w-full text-small">
          <thead>
            <tr className="border-b border-border text-left text-fg-muted">
              <th scope="col" className="sticky left-0 z-10 bg-surface px-3 py-2 font-medium">Class</th>
              {columns.map((s) => (
                <th key={s.id} scope="col" className="px-2 py-2 text-center font-medium whitespace-nowrap">
                  {s.code || s.name}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Periods</th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((cls) => {
              const row = cells[cls.id] ?? {};
              const total = rowTotal(row);
              const periods = classPeriods(builder.data?.sections, cls.id);
              const fit = lessonsFit(total, periods);
              return (
                <tr key={cls.id} className="border-b border-border align-top last:border-0">
                  <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-medium whitespace-nowrap text-fg">
                    {cls.name}
                    {errors[cls.id] && <span className="block max-w-56 text-caption font-normal whitespace-normal text-error-fg">{errors[cls.id]}</span>}
                  </th>
                  {columns.map((s) => {
                    const listed = row[s.id] !== undefined;
                    return (
                      <td key={s.id} className="px-1 py-1.5 text-center">
                        <input
                          aria-label={`${cls.name}, ${s.name}: lessons per week`}
                          inputMode="numeric"
                          className={`w-12 rounded-md border px-1.5 py-1 text-center tabular-nums ${listed ? 'border-border bg-surface text-fg' : 'border-dashed border-border bg-transparent text-fg-muted'}`}
                          placeholder={listed ? '·' : '—'}
                          value={row[s.id] ?? ''}
                          onChange={(e) => setCell(cls.id, s.id, e.target.value.replace(/\D/g, '').slice(0, 2))}
                        />
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{total}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    <span className="mr-2 text-fg-secondary">{periodsText(periods)}</span>
                    <Badge variant={FIT[fit.state].variant}>{FIT[fit.state].text(fit.by)}</Badge>
                  </td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(cls.id)}>
                        Subjects…
                      </Button>
                      <Button size="sm" variant="outline" disabled={!dirty(cls.id)} loading={saving === cls.id} onClick={() => saveRows([cls])}>
                        Save
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-4 py-2 text-caption text-fg-muted">
        Periods: lesson periods a week of the class’s sections in this branch, from their bell schedule and school days. Dashed cells: subject not taught in the class (type a number to add it). “Subjects…” removes subjects.
      </p>
      {editing && (
        <CurriculumModal
          role={role}
          cls={byClass.get(editing)?.class}
          curriculum={byClass.get(editing)}
          subjects={subjects.data.items}
          open
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setVersion((n) => n + 1);
            onChanged?.('The class’s subjects were saved.');
          }}
        />
      )}
    </Card>
  );
}
