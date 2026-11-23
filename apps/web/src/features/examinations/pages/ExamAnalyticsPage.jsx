import { useSearchParams } from 'react-router';
import { Award, ChartColumnBig, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { BarChart, DonutChart } from '../../../components/charts';
import { Alert, Card, CardHeader, EmptyState, ErrorState, KpiCard, LoadingState, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadOwnerBranches } from '../../classes/data/classesApi.js';
import { NoScheduledExams } from '../components/NoScheduledExams.jsx';
import { ExamPage, useExamRole } from '../components/ExamGate.jsx';
import { loadExamAnalytics, loadExaminations } from '../data/examApi.js';
import { pctText } from '../utils/examRules.js';

const GRADE_COLORS = ['var(--color-success)', 'var(--color-chart-2)', 'var(--color-info)', 'var(--color-warning)', 'var(--color-accent)', 'var(--color-error)'];
const percent = (v) => (v === null || v === undefined ? '—' : `${pctText(v)}%`);

function FiguresTable({ caption, rows, first }) {
  return (
    <div className="overflow-x-auto">
      <Table caption={caption}>
        <TableHead>
          <TableRow interactive={false}>
            <TableHeaderCell>{first}</TableHeaderCell>
            <TableHeaderCell align="right">Students</TableHeaderCell>
            <TableHeaderCell align="right">Average</TableHeaderCell>
            <TableHeaderCell align="right">Pass rate</TableHeaderCell>
            <TableHeaderCell align="right">Highest</TableHeaderCell>
            <TableHeaderCell align="right">Lowest</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key} interactive={false}>
              <TableCell className="font-medium">{r.label}</TableCell>
              <TableCell align="right">{r.students}</TableCell>
              <TableCell align="right">{percent(r.average)}</TableCell>
              <TableCell align="right">{percent(r.passRate)}</TableCell>
              <TableCell align="right">{percent(r.highest)}</TableCell>
              <TableCell align="right">{percent(r.lowest)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Examinations → Analytics: how an examination went (pass rates, grades, classes, subjects, branches). */
export default function ExamAnalyticsPage() {
  const role = useExamRole();
  const owner = role === 'OWNER';
  const [params, setParams] = useSearchParams();
  const exams = useApiData(() => loadExaminations(role, {}), `analytics-exams|${role}`);
  const choices = (exams.data?.items ?? []).filter((e) => e.status === 'scheduled');
  const examId = params.get('exam') || choices.find((e) => e.state === 'completed')?.id || choices[0]?.id || '';
  const branches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `branches|${role}`);
  const branch = params.get('branch') || '';
  const set = (k, v) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (v) next.set(k, v); else next.delete(k);
    return next;
  });
  const data = useApiData(() => (examId ? loadExamAnalytics(role, examId, branch) : Promise.resolve(null)), `analytics|${examId}|${branch}`);
  const a = data.data;

  return (
    <ExamPage title="Analytics" description="Pass rates, grades and comparisons between classes, subjects and branches.">
      {() => (
        <>
          <Card as="section" aria-label="Choose the examination" className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
            <Select label="Examination" placeholder={choices.length ? undefined : 'No scheduled examinations'} options={choices.map((e) => ({ value: e.id, label: e.name }))} value={examId} onChange={(e) => set('exam', e.target.value)} disabled={!choices.length} />
            {owner && <Select label="Branch" options={[{ value: '', label: 'All branches' }, ...(branches.data ?? []).map((b) => ({ value: b.id, label: b.name }))]} value={branch} onChange={(e) => set('branch', e.target.value)} />}
          </Card>
          {!examId && exams.data ? (
            <NoScheduledExams items={exams.data.items} icon={ChartColumnBig} description="Analytics come from the results of scheduled examinations." />
          ) : data.status === 'error' && !a ? (
            <ErrorState title="Analytics could not be loaded" description="Check your connection and try again." onRetry={data.retry} />
          ) : !a ? (
            <LoadingState label="Loading analytics…" />
          ) : !a.overall.withResult ? (
            <Card className="p-2"><EmptyState icon={ChartColumnBig} title="No results yet" description="Analytics appear once marks are entered." /></Card>
          ) : (
            <>
              {a.provisional && <Alert variant="info">Some classes’ results are not published yet: their figures are provisional.</Alert>}
              <ul className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="Examination in numbers">
                <li><KpiCard label="Students" value={a.overall.students} icon={Users} note={`${a.overall.withResult} with a result`} /></li>
                <li><KpiCard label="Pass rate" value={percent(a.overall.passRate)} icon={TrendingUp} tone="success" note={`${a.overall.passed} passed`} /></li>
                <li><KpiCard label="Average" value={percent(a.overall.average)} icon={Award} tone="info" /></li>
                <li><KpiCard label="Failure rate" value={percent(a.overall.failureRate)} icon={TrendingDown} tone="error" note={`${a.overall.failed} not passed`} /></li>
              </ul>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card as="section" aria-labelledby="grades-title">
                  <CardHeader title={<span id="grades-title">Results by grade</span>} />
                  <div className="flex flex-wrap items-center gap-6 px-5 pb-5">
                    <DonutChart segments={a.grades.map((g, i) => ({ key: g.grade, value: g.count, color: GRADE_COLORS[i % GRADE_COLORS.length] }))} centerValue={a.overall.withResult} centerLabel="Students" />
                    <ul className="flex flex-col gap-1.5 text-small">
                      {a.grades.map((g, i) => (
                        <li key={g.grade} className="flex items-center gap-2">
                          <span aria-hidden="true" className="inline-block size-3 rounded-sm" style={{ background: GRADE_COLORS[i % GRADE_COLORS.length] }} />
                          <span className="font-medium">{g.grade}</span>
                          <span className="text-fg-secondary">{g.count} ({percent(g.percent)})</span>
                        </li>
                      ))}
                      {!a.grades.length && <li className="text-fg-muted">No grading scale: grades are not given.</li>}
                    </ul>
                  </div>
                </Card>
                <Card as="section" aria-labelledby="classes-chart">
                  <CardHeader title={<span id="classes-chart">Pass rate by class</span>} />
                  <div className="px-5 pb-5">
                    <BarChart data={a.classes.map((c) => ({ label: c.section.name, value: c.passRate ?? 0 }))} label="Pass rate by class (%)" color="var(--color-success)" showValues formatValue={(v) => `${Math.round(v)}%`} />
                  </div>
                </Card>
              </div>
              <Card as="section" aria-labelledby="subjects-title" className="overflow-hidden">
                <CardHeader title={<span id="subjects-title">Subjects</span>} description="Average and pass rate of each subject’s papers." />
                <div className="px-5 pb-4">
                  <BarChart data={a.subjects.map((s) => ({ label: s.subject, value: s.average ?? 0 }))} label="Average by subject (%)" showValues formatValue={(v) => `${Math.round(v)}%`} />
                </div>
                <FiguresTable caption="Subjects" first="Subject" rows={a.subjects.map((s) => ({ key: s.subject, label: s.subject, students: s.sat, average: s.average, passRate: s.passRate, highest: null, lowest: null }))} />
              </Card>
              <Card as="section" aria-labelledby="classes-title" className="overflow-hidden">
                <CardHeader title={<span id="classes-title">Classes</span>} />
                <FiguresTable caption="Classes" first="Class" rows={a.classes.map((c) => ({ key: c.section.id, label: owner ? `${c.section.name} · ${c.section.branch.name}` : c.section.name, ...c }))} />
              </Card>
              {a.level === 'advanced' ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {a.branches?.length > 1 && (
                    <Card as="section" aria-labelledby="branches-title" className="overflow-hidden lg:col-span-2">
                      <CardHeader title={<span id="branches-title">Branches compared</span>} />
                      <FiguresTable caption="Branches" first="Branch" rows={a.branches.map((b) => ({ key: b.branch.id, label: b.branch.name, ...b }))} />
                    </Card>
                  )}
                  <Card as="section" aria-labelledby="spread-title">
                    <CardHeader title={<span id="spread-title">Spread of results</span>} description="Students in each band of 10 %." />
                    <div className="px-5 pb-5">
                      <BarChart data={a.spread.map((b) => ({ label: `${b.from}`, fullLabel: `${b.from}–${Math.floor(b.to)} %`, value: b.count }))} label="Students by percent band" />
                    </div>
                  </Card>
                  <Card as="section" aria-labelledby="top-title" className="overflow-hidden">
                    <CardHeader title={<span id="top-title">Best results</span>} />
                    <Table caption="The ten best results">
                      <TableHead>
                        <TableRow interactive={false}>
                          <TableHeaderCell>Student</TableHeaderCell>
                          <TableHeaderCell>Class</TableHeaderCell>
                          <TableHeaderCell align="right">%</TableHeaderCell>
                          <TableHeaderCell>Grade</TableHeaderCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {a.top.map((t) => (
                          <TableRow key={t.student.id} interactive={false}>
                            <TableCell>{t.student.name}</TableCell>
                            <TableCell>{t.section.name}</TableCell>
                            <TableCell align="right">{pctText(t.percent)}</TableCell>
                            <TableCell>{t.grade ?? '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Card>
                </div>
              ) : (
                <p className="text-small text-fg-muted">Branch comparison, the spread of results and the best students are shown when Settings → Analytics is set to Advanced.</p>
              )}
            </>
          )}
        </>
      )}
    </ExamPage>
  );
}
