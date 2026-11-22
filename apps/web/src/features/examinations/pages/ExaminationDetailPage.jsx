import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, BookOpen, FileText, Grid3x3, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  ConfirmModal,
  EmptyState,
  ErrorState,
  LinkButton,
  LoadingState,
  Table,
  TableActions,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { ExamPage, ExamStateBadge, useExamRole } from '../components/ExamGate.jsx';
import { ExaminationModal, ExamStopModal, PaperModal } from '../components/ExaminationModals.jsx';
import { PaperFilesModal } from '../components/PaperFilesModal.jsx';
import { loadExamination, loadExaminationOptions, removePaper, scheduleExamination, unscheduleExamination } from '../data/examApi.js';
import { examScopeText, scheduleProblems } from '../utils/examRules.js';

const COUNTS_FOR = { branch: 'in its branch', your_branch: 'in your branch', school: 'in every branch' };

function Fact({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body text-fg">{children}</dd>
    </div>
  );
}

/** One examination: its details, what can be done next, and its papers by class. */
export default function ExaminationDetailPage() {
  const { examId } = useParams();
  const role = useExamRole();
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const detail = useApiData(() => loadExamination(role, examId), `exam|${role}|${examId}|${version}`);
  const yearId = detail.data?.examination.academicYear.id;
  const options = useApiData(() => (yearId ? loadExaminationOptions(role, { academicYear: yearId }) : Promise.resolve(null)), `exam-options|${role}|${yearId}`);
  const refresh = (message) => {
    setDialog(null);
    if (message) setNotice(message);
    setVersion((n) => n + 1);
  };
  const d = detail.data;
  const exam = d?.examination;
  const a = exam?.actions;
  const today = options.data?.today;
  const blockers = d && exam.status === 'draft' && today ? scheduleProblems(d, today) : [];

  return (
    <ExamPage title={exam?.name ?? 'Examination'} description={exam ? `${exam.examType.name} · ${exam.academicYear.name}` : 'An examination and its papers.'}>
      {() => (
        <>
          <Link to="/examinations/list" className="inline-flex w-fit items-center gap-1.5 text-small font-medium text-interactive underline-offset-2 hover:underline">
            <ArrowLeft aria-hidden="true" className="size-4" />
            All examinations
          </Link>
          {notice && (
            <Alert variant="success" onDismiss={() => setNotice('')}>
              {notice}
            </Alert>
          )}
          {detail.status === 'error' && !d ? (
            <ErrorState title="This examination could not be loaded" description="It may not exist, or it belongs to another branch." onRetry={detail.retry} />
          ) : !d ? (
            <LoadingState label="Loading the examination…" />
          ) : (
            <>
              <Card as="section" aria-labelledby="exam-summary" className="flex flex-col gap-5 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <h2 id="exam-summary" className="flex flex-wrap items-center gap-2 text-card-title text-fg">
                      {exam.name} <ExamStateBadge state={exam.state} />
                    </h2>
                    {exam.description && <p className="text-body text-fg-secondary">{exam.description}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {exam.state !== 'cancelled' && (
                      <LinkButton to={`/examinations/timetable?exam=${exam.id}`} size="sm" leftIcon={Grid3x3}>
                        Timetable
                      </LinkButton>
                    )}
                    {a.edit && (
                      <Button size="sm" variant="outline" leftIcon={Pencil} onClick={() => setDialog({ type: 'edit' })} unavailableReason={!options.data ? 'Loading…' : undefined}>
                        Edit
                      </Button>
                    )}
                    {a.unschedule && (
                      <Button size="sm" variant="outline" onClick={() => setDialog({ type: 'unschedule' })}>
                        Back to Draft
                      </Button>
                    )}
                    {a.cancel && (
                      <Button size="sm" variant="danger" onClick={() => setDialog({ type: 'stop', mode: a.cancel })}>
                        {a.cancel === 'end' ? 'End Early' : 'Cancel'}
                      </Button>
                    )}
                    {a.schedule && (
                      <Button size="sm" onClick={() => setDialog({ type: 'schedule' })} unavailableReason={blockers.length ? blockers.join(' ') : undefined}>
                        Schedule
                      </Button>
                    )}
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                  <Fact label="Type">{exam.examType.name}</Fact>
                  <Fact label="Period">{exam.period?.name ?? 'Whole year'}</Fact>
                  <Fact label="Held in">{exam.level === 'school' ? 'Every branch' : exam.branch?.name}</Fact>
                  <Fact label="Dates">
                    <span className="tabular-nums">
                      {exam.startDate} to {exam.endDate}
                    </span>
                    <span className="block text-caption text-fg-muted">{exam.days} day{exam.days === 1 ? '' : 's'}</span>
                  </Fact>
                  <Fact label="Normal lessons">{exam.stopsLessons ? 'Stop for its classes' : 'Go on'}</Fact>
                  <Fact label="Created by">{exam.createdBy ?? '—'}</Fact>
                </dl>
                {exam.state === 'draft' && (
                  <Alert variant={blockers.length ? 'warning' : 'info'} title={blockers.length ? 'Before it can be scheduled' : 'Ready to schedule'}>
                    {blockers.length ? (
                      <ul className="list-disc pl-5">
                        {blockers.map((b) => (
                          <li key={b}>{b}</li>
                        ))}
                      </ul>
                    ) : (
                      'A draft has no effect yet. Scheduling puts it on the academic calendar' + (exam.stopsLessons ? ' and stops its classes’ normal lessons on its days.' : '.')
                    )}
                  </Alert>
                )}
                {exam.state === 'cancelled' && <Alert variant="error" title="Cancelled">{exam.cancelReason ?? 'No reason given.'}</Alert>}
                {exam.state !== 'draft' && exam.state !== 'cancelled' && exam.stopsLessons && (
                  <p className="text-small text-fg-secondary">
                    On the academic calendar. From {exam.startDate} to {exam.endDate}, {exam.classes.map((c) => c.name).join(', ')} have no normal lessons {exam.level === 'school' ? 'in any branch' : `at ${exam.branch?.name}`}; daily attendance goes on.
                  </p>
                )}
              </Card>

              <Card as="section" aria-labelledby="exam-papers" className="overflow-hidden">
                <CardHeader
                  title={<span id="exam-papers">Classes and papers</span>}
                  description={`${exam.papers} paper${exam.papers === 1 ? '' : 's'} in ${d.classes.length} class${d.classes.length === 1 ? '' : 'es'}. Sections and students ${COUNTS_FOR[d.countsFor]}.`}
                  action={
                    a.papers &&
                    d.classes.length > 0 && (
                      <Button size="sm" leftIcon={Plus} onClick={() => setDialog({ type: 'paper' })} unavailableReason={!options.data ? 'Loading…' : undefined}>
                        Add Paper
                      </Button>
                    )
                  }
                />
                {!d.classes.length ? (
                  <EmptyState icon={BookOpen} title="No classes yet" description={a.edit ? 'Edit the examination to choose the classes sitting it.' : 'No classes sit this examination.'} />
                ) : (
                  <div role="region" aria-label="Papers by class" tabIndex={0} className="overflow-x-auto">
                    <Table caption="Papers of each class">
                      <TableHead>
                        <TableRow interactive={false}>
                          <TableHeaderCell>Class</TableHeaderCell>
                          <TableHeaderCell>Subject</TableHeaderCell>
                          <TableHeaderCell align="right">Marks out of</TableHeaderCell>
                          <TableHeaderCell align="right">Length</TableHeaderCell>
                          <TableHeaderCell align="right">{a.papers ? 'Actions' : ''}</TableHeaderCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {d.classes.flatMap((c) => {
                          const head = (
                            <TableCell rowSpan={Math.max(c.papers.length, 1)} className="align-top">
                              <span className="font-medium">{c.name}</span>
                              <span className="block text-caption text-fg-muted">
                                {c.sections} section{c.sections === 1 ? '' : 's'} · {c.students} student{c.students === 1 ? '' : 's'}
                              </span>
                            </TableCell>
                          );
                          if (!c.papers.length) {
                            return [
                              <TableRow key={c.id} interactive={false}>
                                {head}
                                <TableCell colSpan={3} className="text-fg-muted">No papers yet</TableCell>
                                <TableCell align="right">
                                  {a.papers && (
                                    <Button size="sm" variant="outline" onClick={() => setDialog({ type: 'paper', classId: c.id })} unavailableReason={!options.data ? 'Loading…' : undefined}>
                                      Add Paper
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>,
                            ];
                          }
                          return c.papers.map((p, i) => (
                            <TableRow key={p.id} interactive={false}>
                              {i === 0 && head}
                              <TableCell>
                                {p.subject.name}
                                {p.subject.status !== 'active' && <span className="text-caption text-fg-muted"> (inactive subject)</span>}
                              </TableCell>
                              <TableCell align="right" className="tabular-nums">{p.maxMarks}</TableCell>
                              <TableCell align="right" className="tabular-nums">{p.durationMinutes} min</TableCell>
                              <TableCell align="right">
                                <TableActions>
                                  <Button size="sm" variant="ghost" iconOnly leftIcon={FileText} aria-label={`Files of the ${p.subject.name} paper of ${c.name}`} onClick={() => setDialog({ type: 'files', paper: p, cls: c })} />
                                {a.papers && (
                                  <>
                                    <Button size="sm" variant="ghost" iconOnly leftIcon={Pencil} aria-label={`Change the ${p.subject.name} paper of ${c.name}`} onClick={() => setDialog({ type: 'paper', paper: p })} />
                                    <Button size="sm" variant="ghost" iconOnly leftIcon={Trash2} aria-label={`Remove the ${p.subject.name} paper of ${c.name}`} onClick={() => setDialog({ type: 'remove', paper: p, cls: c })} />
                                  </>
                                )}
                                </TableActions>
                              </TableCell>
                            </TableRow>
                          ));
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>

              <ExaminationModal role={role} options={options.data} detail={d} open={dialog?.type === 'edit'} onClose={() => setDialog(null)} onSaved={(r, changed) => refresh(changed ? `${r.examination.name} saved.` : '')} />
              <PaperModal
                role={role}
                examId={exam.id}
                classes={d.classes}
                options={options.data}
                paper={dialog?.paper ?? null}
                classId={dialog?.classId}
                open={dialog?.type === 'paper'}
                onClose={() => setDialog(null)}
                onSaved={() => refresh(dialog?.paper ? 'Paper changed.' : 'Paper added.')}
              />
              <PaperFilesModal role={role} paper={dialog?.type === 'files' ? dialog.paper : null} className={dialog?.cls?.name} open={dialog?.type === 'files'} onClose={() => setDialog(null)} />
              <ConfirmModal
                open={dialog?.type === 'remove'}
                onClose={() => setDialog(null)}
                title={`Remove the ${dialog?.paper?.subject.name ?? ''} paper`}
                description={`${dialog?.cls?.name ?? ''} will not sit ${dialog?.paper?.subject.name ?? ''} in this examination.`}
                confirmLabel="Remove Paper"
                run={() => removePaper(role, exam.id, dialog.paper.id)}
                onDone={() => refresh('Paper removed.')}
              />
              <ConfirmModal
                open={dialog?.type === 'schedule'}
                onClose={() => setDialog(null)}
                title={`Schedule ${exam.name}`}
                description={
                  exam.stopsLessons
                    ? `It goes on the academic calendar. From ${exam.startDate} to ${exam.endDate} its classes have no normal lessons ${exam.level === 'school' ? 'in any branch' : `at ${examScopeText(exam)}`}.`
                    : 'It goes on the academic calendar. Its classes keep their normal lessons.'
                }
                confirmLabel="Schedule"
                variant="primary"
                run={() => scheduleExamination(role, exam.id)}
                onDone={() => refresh(`${exam.name} is scheduled.`)}
              />
              <ConfirmModal
                open={dialog?.type === 'unschedule'}
                onClose={() => setDialog(null)}
                title={`Return ${exam.name} to Draft`}
                description="It comes off the calendar and its classes keep their normal lessons until you schedule it again."
                confirmLabel="Back to Draft"
                variant="primary"
                run={() => unscheduleExamination(role, exam.id)}
                onDone={() => refresh(`${exam.name} is a draft again.`)}
              />
              <ExamStopModal
                role={role}
                exam={exam}
                mode={dialog?.mode}
                open={dialog?.type === 'stop'}
                onClose={() => setDialog(null)}
                onDone={() => refresh(dialog?.mode === 'end' ? `${exam.name} ended early.` : `${exam.name} is cancelled.`)}
              />
            </>
          )}
        </>
      )}
    </ExamPage>
  );
}
