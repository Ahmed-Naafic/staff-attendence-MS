import { useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowLeft, Award, History, Trophy, Users } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  KpiCard,
  LoadingState,
  Modal,
  Select,
  TabPanel,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableLoading,
  TableRow,
  Tabs,
  Textarea,
} from '../../../components/ui';
import { requestFailure, useDialogForm } from '../../../hooks/useDialogForm.js';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadOwnerBranches } from '../../classes/data/classesApi.js';
import { DownloadButton } from '../components/DownloadButton.jsx';
import { ExamPage, useExamRole } from '../components/ExamGate.jsx';
import { downloadReportCards, handOverFinalResults, loadExaminations, loadFinalResults, loadResults, loadSectionResults, publishAllResults, resultsStep } from '../data/examApi.js';
import { pctText, RESULT_STATES } from '../utils/examRules.js';

const StateBadge = ({ status }) => <Badge variant={RESULT_STATES[status]?.variant}>{RESULT_STATES[status]?.label ?? status}</Badge>;
const PassBadge = ({ passed }) => (passed === null || passed === undefined ? <span className="text-fg-muted">—</span> : <Badge variant={passed ? 'success' : 'error'}>{passed ? 'Passed' : 'Not passed'}</Badge>);

function CorrectModal({ open, onClose, onSave }) {
  const formId = useId();
  const form = useDialogForm(open, { reason: '' }, (e) => requestFailure(e));
  const save = () => {
    const reason = form.values.reason.trim();
    return form.submit(reason.length < 3 || reason.length > 300 ? { reason: 'Say why (3–300 characters).' } : {}, ['reason'], () => onSave(reason), onClose);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Correct Published Results"
      description="The results go back to pending: reopen the marks that need correcting, approve them, then approve and publish the results again. The published version stays in the history."
      loading={form.saving}
      error={form.formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={form.saving}>Cancel</Button>
          <Button type="submit" form={formId} loading={form.saving} variant="danger">Reopen for Correction</Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Textarea label="Reason" required rows={3} maxLength={300} value={form.values.reason} error={form.errors.reason} onChange={(e) => form.set('reason', e.target.value)} />
      </form>
    </Modal>
  );
}

/** One class's results: students with each paper, total, grade, result, rank; the steps; the history. */
function SectionResults({ role, examId, sectionId, onBack, onChanged }) {
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [correcting, setCorrecting] = useState(false);
  const data = useApiData(() => loadSectionResults(role, examId, sectionId), `results|${examId}|${sectionId}|${version}`);
  const r = data.data;
  if (data.status === 'error' && !r) return <ErrorState title="Results could not be loaded" description="Check your connection and try again." onRetry={data.retry} />;
  if (!r) return <LoadingState label="Loading results…" />;
  const run = async (step, text) => {
    setBusy(step);
    setMessage(null);
    try {
      await resultsStep(role, examId, sectionId, step);
      setMessage({ variant: 'success', text });
      setVersion((n) => n + 1);
      onChanged();
    } catch (e) {
      setMessage({ variant: 'error', text: requestFailure(e) });
    } finally {
      setBusy('');
    }
  };
  const a = r.actions;
  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className="inline-flex w-fit items-center gap-1.5 text-small font-medium text-interactive underline-offset-2 hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" /> All classes
      </button>
      <Card as="section" aria-labelledby="results-title" className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="results-title" className="flex flex-wrap items-center gap-2 text-card-title text-fg">
              {r.section.name} · {r.examination.name} <StateBadge status={r.status} />
            </h2>
            <p className="text-small text-fg-secondary">
              {r.live ? `Calculated from the marks: ${r.sheets.approved} of ${r.sheets.total} papers approved.` : r.status === 'published' ? `Published${r.revision > 1 ? ` (correction ${r.revision - 1})` : ''} by ${r.publishedBy}; corrections until ${r.correctUntil}.` : `Approved by ${r.approvedBy}; waiting for publication.`}
              {r.scale ? ` Grades: ${r.scale}.` : ' No grading scale: grades are not shown.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <DownloadButton load={() => downloadReportCards(role, examId, sectionId)} onError={(text) => setMessage({ variant: 'error', text })}>Report Cards PDF</DownloadButton>
            {a.reopen && <Button size="sm" variant="outline" loading={busy === 'reopen'} onClick={() => run('reopen', 'Results reopened.')}>Reopen</Button>}
            {a.correct && <Button size="sm" variant="danger" onClick={() => setCorrecting(true)}>Correct</Button>}
            {a.approve && <Button size="sm" variant="secondary" loading={busy === 'approve'} onClick={() => run('approve', 'Results approved.')}>Approve Results</Button>}
            {a.publish && <Button size="sm" loading={busy === 'publish'} onClick={() => run('publish', 'Results published.')}>Publish Results</Button>}
          </div>
        </div>
        {r.live && !a.approve && <Alert variant="info">Results are approved once every paper’s marks of this class are approved (Marks Entry).</Alert>}
        {r.correctionReason && r.status !== 'published' && <Alert variant="warning" title="Being corrected">{r.correctionReason}</Alert>}
        {message && <Alert variant={message.variant} onDismiss={() => setMessage(null)}>{message.text}</Alert>}
        <ul className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="Class figures">
          <li><KpiCard label="Students" value={r.summary.students} icon={Users} /></li>
          <li><KpiCard label="Pass rate" value={r.summary.passRate === null ? '—' : `${pctText(r.summary.passRate)}%`} icon={Award} tone="success" note={`${r.summary.passed} passed`} /></li>
          <li><KpiCard label="Average" value={r.summary.average === null ? '—' : `${pctText(r.summary.average)}%`} icon={Trophy} tone="info" /></li>
          <li><KpiCard label="Highest · lowest" value={`${pctText(r.summary.highest)} · ${pctText(r.summary.lowest)}`} icon={Trophy} tone="warning" /></li>
        </ul>
        <div className="overflow-x-auto">
          <Table caption={`Results of ${r.section.name}`}>
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Rank</TableHeaderCell>
                <TableHeaderCell>Student</TableHeaderCell>
                {r.papers.map((p) => (
                  <TableHeaderCell key={p.id} align="right">{p.subject} %</TableHeaderCell>
                ))}
                <TableHeaderCell align="right">Total</TableHeaderCell>
                <TableHeaderCell align="right">%</TableHeaderCell>
                <TableHeaderCell>Grade</TableHeaderCell>
                <TableHeaderCell>Result</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!r.students.length && <TableEmpty columns={6 + r.papers.length} icon={Award} title="No students" />}
              {[...r.students]
                .sort((x, y) => (x.rank ?? 1e9) - (y.rank ?? 1e9) || x.student.name.localeCompare(y.student.name))
                .map((s) => (
                  <TableRow key={s.student.id} interactive={false}>
                    <TableCell className="tabular-nums">{s.rank ?? '—'}</TableCell>
                    <TableCell>
                      {s.student.name}
                      <span className="block text-caption text-fg-muted">{s.student.number}</span>
                    </TableCell>
                    {r.papers.map((p) => {
                      const x = s.papers.find((y) => y.paperId === p.id);
                      return (
                        <TableCell key={p.id} align="right" className={x?.passed === false ? 'text-error-fg' : undefined}>
                          {x?.status === 'absent' ? 'AB' : x?.status === 'excused' ? 'EX' : x?.status === 'missing' ? '—' : pctText(x?.percent)}
                        </TableCell>
                      );
                    })}
                    <TableCell align="right">{s.totalMarks}/{s.totalMax}</TableCell>
                    <TableCell align="right" className="font-medium">{pctText(s.percent)}</TableCell>
                    <TableCell>{s.grade ?? '—'}</TableCell>
                    <TableCell><PassBadge passed={s.passed} /></TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </Card>
      <Card as="section" aria-labelledby="revisions-title" className="overflow-hidden">
        <h3 id="revisions-title" className="flex items-center gap-2 border-b border-border px-4 py-3 text-card-title text-fg">
          <History aria-hidden="true" className="size-4" /> Revision history
        </h3>
        {!r.revisions.length ? (
          <p className="px-4 py-3 text-small text-fg-muted">Not published yet.</p>
        ) : (
          <Table caption="Publications of these results">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Revision</TableHeaderCell>
                <TableHeaderCell>Published</TableHeaderCell>
                <TableHeaderCell>By</TableHeaderCell>
                <TableHeaderCell>Reason</TableHeaderCell>
                <TableHeaderCell align="right">Pass rate</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {r.revisions.map((v) => (
                <TableRow key={v.revision} interactive={false}>
                  <TableCell>{v.revision === 1 ? 'First' : `Correction ${v.revision - 1}`}</TableCell>
                  <TableCell className="tabular-nums">{new Date(v.publishedAt).toLocaleString()}</TableCell>
                  <TableCell>{v.publishedBy}</TableCell>
                  <TableCell>{v.reason ?? '—'}</TableCell>
                  <TableCell align="right">{pctText(v.summary.passRate)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <CorrectModal
        open={correcting}
        onClose={() => setCorrecting(false)}
        onSave={async (reason) => {
          await resultsStep(role, examId, sectionId, 'correct', { reason });
          setMessage({ variant: 'success', text: 'Results reopened for a correction.' });
          setVersion((n) => n + 1);
          onChanged();
        }}
      />
    </div>
  );
}

/** The year's final results of a class and handing them to Promotion. */
function FinalResults({ role, sections }) {
  const [sectionId, setSectionId] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const section = sectionId || sections[0]?.id || '';
  const data = useApiData(() => (section ? loadFinalResults(role, { section }) : Promise.resolve(null)), `final|${section}|${version}`);
  const f = data.data;
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Class" options={sections.map((s) => ({ value: s.id, label: s.name }))} value={section} onChange={(e) => setSectionId(e.target.value)} fieldClassName="sm:w-64" />
        <Checkbox label="Replace results already recorded" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          disabled={!f}
          onClick={async () => {
            setBusy(true);
            setMessage(null);
            try {
              const r = await handOverFinalResults(role, { section, overwrite });
              setMessage({ variant: 'success', text: `Handed to Promotion: ${r.set} set, ${r.kept} kept (already recorded), ${r.none} without a result.` });
              setVersion((n) => n + 1);
            } catch (e) {
              setMessage({ variant: 'error', text: requestFailure(e) });
            } finally {
              setBusy(false);
            }
          }}
        >
          Hand to Promotion
        </Button>
      </div>
      {message && <Alert variant={message.variant} onDismiss={() => setMessage(null)}>{message.text}</Alert>}
      {f && (
        <p className="text-small text-fg-secondary">
          {f.academicYear.name}: {f.formula ? `calculated ${f.formula.method === 'weighted' ? 'by examination type weights' : f.formula.method === 'last' ? 'from the last examination' : 'as the average'}` : 'no result calculation set (the average is used)'} of {f.examinations.length} published examination{f.examinations.length === 1 ? '' : 's'}; passed from {f.passPercent}%. Promotion uses the year-end result.
        </p>
      )}
      {!f && data.status !== 'error' ? (
        section ? <LoadingState label="Loading final results…" /> : <EmptyState icon={Award} title="No classes" />
      ) : f ? (
        <div className="overflow-x-auto">
          <Table caption="Final results of the year">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Student</TableHeaderCell>
                {f.examinations.map((x) => (
                  <TableHeaderCell key={x.id} align="right">{x.name} %</TableHeaderCell>
                ))}
                <TableHeaderCell align="right">Final %</TableHeaderCell>
                <TableHeaderCell>Grade</TableHeaderCell>
                <TableHeaderCell>Final result</TableHeaderCell>
                <TableHeaderCell>Year-end result (Promotion)</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {f.students.map((s) => (
                <TableRow key={s.student.id} interactive={false}>
                  <TableCell>{s.student.name}</TableCell>
                  {f.examinations.map((x) => (
                    <TableCell key={x.id} align="right">{pctText(s.exams.find((e) => e.examId === x.id)?.percent)}</TableCell>
                  ))}
                  <TableCell align="right" className="font-medium">{pctText(s.percent)}</TableCell>
                  <TableCell>{s.grade ?? '—'}</TableCell>
                  <TableCell><PassBadge passed={s.passed} /></TableCell>
                  <TableCell>{s.enrollmentResult ? <Badge variant={s.enrollmentResult === 'passed' ? 'success' : 'error'}>{s.enrollmentResult === 'passed' ? 'Passed' : 'Failed'}</Badge> : <span className="text-fg-muted">Not set</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <ErrorState title="Final results could not be loaded" description="Check your connection and try again." onRetry={data.retry} />
      )}
    </div>
  );
}

const TABS = [
  { value: 'results', label: 'Results' },
  { value: 'final', label: 'Final Results of the Year' },
];

/** Examinations → Results & Report Cards. */
export default function ExamResultsPage() {
  const role = useExamRole();
  const owner = role === 'OWNER';
  const tabsId = useId();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('results');
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState(null);
  const exams = useApiData(() => loadExaminations(role, {}), `results-exams|${role}`);
  const choices = (exams.data?.items ?? []).filter((e) => e.status === 'scheduled');
  const examId = params.get('exam') || choices.find((e) => e.state === 'completed')?.id || choices[0]?.id || '';
  const branches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `branches|${role}`);
  const branch = params.get('branch') || '';
  const sectionId = params.get('section');
  const set = (changes) => setParams((p) => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(changes)) if (v) next.set(k, v); else next.delete(k);
    return next;
  });
  const list = useApiData(() => (examId ? loadResults(role, examId, branch) : Promise.resolve(null)), `results-list|${examId}|${branch}|${version}`);
  const items = list.data?.items ?? [];

  return (
    <ExamPage title="Results & Report Cards" description="Approve and publish results, print report cards and hand the year’s final results to Promotion.">
      {() =>
        sectionId && examId ? (
          <SectionResults role={role} examId={examId} sectionId={sectionId} onBack={() => set({ section: '' })} onChanged={() => setVersion((n) => n + 1)} />
        ) : (
          <>
            <Card as="section" aria-label="Choose the examination" className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
              <Select label="Examination" placeholder={choices.length ? undefined : 'No scheduled examinations'} options={choices.map((e) => ({ value: e.id, label: e.name }))} value={examId} onChange={(e) => set({ exam: e.target.value })} disabled={!choices.length} />
              {owner && <Select label="Branch" options={[{ value: '', label: 'All branches' }, ...(branches.data ?? []).map((b) => ({ value: b.id, label: b.name }))]} value={branch} onChange={(e) => set({ branch: e.target.value })} />}
            </Card>
            {notice && <Alert variant={notice.variant} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}
            {!examId && exams.data ? (
              <Card className="p-2"><EmptyState icon={Award} title="No scheduled examinations" description="Results come from the approved marks of scheduled examinations." /></Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 pt-3">
                  <Tabs id={tabsId} label="Results sections" tabs={TABS} value={tab} onChange={setTab} />
                  {tab === 'results' && items.some((i) => i.actions.publish) && (
                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          const r = await publishAllResults(role, examId, branch);
                          setNotice({ variant: 'success', text: `${r.published} class${r.published === 1 ? '' : 'es'} published.` });
                          setVersion((n) => n + 1);
                        } catch (e) {
                          setNotice({ variant: 'error', text: requestFailure(e) });
                        }
                      }}
                    >
                      Publish All Approved
                    </Button>
                  )}
                </div>
                <TabPanel tabsId={tabsId} value={tab}>
                  {tab === 'results' ? (
                    list.status === 'error' && !list.data ? (
                      <ErrorState title="Results could not be loaded" description="Check your connection and try again." onRetry={list.retry} />
                    ) : (
                      <div className="overflow-x-auto">
                        <Table caption="Results by class">
                          <TableHead>
                            <TableRow interactive={false}>
                              <TableHeaderCell>Class</TableHeaderCell>
                              <TableHeaderCell align="right">Students</TableHeaderCell>
                              <TableHeaderCell align="right">Average %</TableHeaderCell>
                              <TableHeaderCell align="right">Pass rate</TableHeaderCell>
                              <TableHeaderCell>Marks approved</TableHeaderCell>
                              <TableHeaderCell>Status</TableHeaderCell>
                              <TableHeaderCell align="right">Actions</TableHeaderCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {!list.data && examId && <TableLoading columns={7} />}
                            {list.data && !items.length && <TableEmpty columns={7} icon={Award} title="No classes" />}
                            {items.map((i) => (
                              <TableRow key={i.section.id}>
                                <TableCell className="font-medium">
                                  {i.section.name}
                                  {owner && <span className="block text-caption text-fg-muted">{i.section.branch.name}</span>}
                                </TableCell>
                                <TableCell align="right">{i.summary.students}</TableCell>
                                <TableCell align="right">{pctText(i.summary.average)}</TableCell>
                                <TableCell align="right">{i.summary.passRate === null ? '—' : `${pctText(i.summary.passRate)}%`}</TableCell>
                                <TableCell>{i.sheets ? `${i.sheets.approved}/${i.sheets.total}` : 'All'}</TableCell>
                                <TableCell><StateBadge status={i.status} /></TableCell>
                                <TableCell align="right">
                                  <Button size="sm" variant="outline" onClick={() => set({ section: i.section.id })}>Open</Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )
                  ) : (
                    <FinalResults role={role} sections={items.map((i) => i.section)} />
                  )}
                </TabPanel>
              </Card>
            )}
          </>
        )
      }
    </ExamPage>
  );
}
