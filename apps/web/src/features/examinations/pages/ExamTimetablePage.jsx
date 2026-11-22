import { useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowRightLeft, CalendarClock, DoorOpen, Grid3x3, Sparkles, UserCheck, Users } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  ErrorState,
  KpiCard,
  LoadingState,
  Select,
  TabPanel,
  Table,
  TableActions,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tabs,
} from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadOwnerBranches } from '../../classes/data/classesApi.js';
import { ExamPage, ExamStateBadge, useExamRole } from '../components/ExamGate.jsx';
import { DownloadButton } from '../components/DownloadButton.jsx';
import { ExamAttendancePanel } from '../components/ExamAttendancePanel.jsx';
import { InvigilatorMatrixPanel } from '../components/InvigilatorMatrixPanel.jsx';
import { RoomAllocationPanel } from '../components/RoomAllocationPanel.jsx';
import { GenerateModal, InvigilatorModal, MoveModal } from '../components/TimetableModals.jsx';
import { clearTimetable, downloadExamDocument, loadExaminations, loadTimetable, loadTimetableOptions, publishTimetable } from '../data/examApi.js';
import { UNPLACED_REASONS } from '../utils/examRules.js';

const TABS = [
  { value: 'timetable', label: 'Timetable' },
  { value: 'rooms', label: 'Room Allocation' },
  { value: 'invigilators', label: 'Invigilators' },
  { value: 'students', label: 'Students & Attendance' },
];
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** Examinations → Timetable & Allocation: a branch's sessions, rooms, invigilators and seats for one examination. */
export default function ExamTimetablePage() {
  const role = useExamRole();
  const owner = role === 'OWNER';
  const tabsId = useId();
  const [params, setParams] = useSearchParams();
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(null);
  const [seatSession, setSeatSession] = useState('');

  const exams = useApiData(() => loadExaminations(role, {}), `tt-exams|${role}`);
  const choices = (exams.data?.items ?? []).filter((e) => e.state !== 'cancelled');
  const examId = params.get('exam') || choices.find((e) => e.state === 'active')?.id || choices.find((e) => e.state === 'planned')?.id || choices[0]?.id || '';
  const chosenExam = choices.find((e) => e.id === examId);
  const branchParam = params.get('branch') || '';
  // The open tab is in the address (?tab=rooms | invigilators | students), so each view can be linked to.
  const tab = TABS.some((x) => x.value === params.get('tab')) ? params.get('tab') : 'timetable';
  const set = (key, value) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === 'exam') next.delete('branch');
    if (key === 'tab' && value === 'timetable') next.delete('tab');
    return next;
  }, { replace: true });

  // The Owner picks the branch of a school-wide examination (the first active branch until chosen).
  const needsBranch = owner && chosenExam?.level === 'school';
  const ownerBranches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `branches|${role}`);
  const activeBranches = (ownerBranches.data ?? []).filter((x) => x.status === 'active');
  const branch = needsBranch ? branchParam || activeBranches[0]?.id || '' : '';
  const ready = Boolean(examId) && (!needsBranch || Boolean(branch));
  const data = useApiData(() => (ready ? loadTimetable(role, examId, branch || undefined) : Promise.resolve(null)), `tt|${role}|${examId}|${branch}|${ready}|${version}`);
  const t = data.data;
  const branchId = t?.branch.id;
  const options = useApiData(() => (t && (t.actions.generate || t.actions.edit) ? loadTimetableOptions(role, examId, needsBranch ? branchId : undefined) : Promise.resolve(null)), `tt-options|${examId}|${branchId}|${version}`);
  const done = (message) => (r) => {
    setDialog(null);
    setNotice(message ? { message, report: r?.report } : null);
    setVersion((n) => n + 1);
  };
  const b = needsBranch ? branchId : undefined;

  const primary = t?.actions.generate && (
    <Button leftIcon={Sparkles} onClick={() => setDialog({ type: 'generate' })} unavailableReason={!options.data ? 'Loading…' : undefined}>
      {t.timetable ? 'Generate Again' : 'Generate Timetable'}
    </Button>
  );

  return (
    <ExamPage title="Timetable & Allocation" description="Sessions, rooms, invigilators and seats of an examination, branch by branch." primaryAction={primary}>
      {() => (
        <>
          <Card as="section" aria-label="Choose the examination" className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Select
              label="Examination"
              placeholder={choices.length ? undefined : 'No examinations yet'}
              options={choices.map((e) => ({ value: e.id, label: `${e.name} (${e.startDate} to ${e.endDate})` }))}
              value={examId}
              onChange={(e) => set('exam', e.target.value)}
              disabled={!choices.length}
            />
            {needsBranch && (
              <Select label="Branch" options={activeBranches.map((x) => ({ value: x.id, label: x.name }))} value={branch} onChange={(e) => set('branch', e.target.value)} disabled={!activeBranches.length} />
            )}
            {t && (
              <div className="flex flex-col justify-end gap-1 text-small text-fg-secondary">
                <span className="flex items-center gap-2">
                  <ExamStateBadge state={t.examination.state} />
                  {t.timetable ? (t.timetable.publishedAt ? <Badge variant="success">Published</Badge> : <Badge variant="warning">Not published</Badge>) : <Badge variant="neutral">No timetable</Badge>}
                </span>
                {t.timetable && <span>Generated {when(t.timetable.generatedAt)}{t.timetable.generatedBy ? ` by ${t.timetable.generatedBy}` : ''}</span>}
              </div>
            )}
          </Card>

          {notice && (
            <Alert variant={notice.report && (notice.report.unplaced.length || notice.report.unseated || notice.report.shortfall) ? 'warning' : 'success'} onDismiss={() => setNotice(null)} title={notice.message}>
              {notice.report && (
                <ul className="list-disc pl-5">
                  {notice.report.unplaced.length > 0 && <li>{notice.report.unplaced.length} paper{notice.report.unplaced.length === 1 ? '' : 's'} could not be timetabled (see below).</li>}
                  {notice.report.unseated > 0 && <li>{notice.report.unseated} seat{notice.report.unseated === 1 ? '' : 's'} missing: rooms were taken by another examination at the same time.</li>}
                  {notice.report.shortfall > 0 && <li>{notice.report.shortfall} invigilator{notice.report.shortfall === 1 ? '' : 's'} missing: not enough staff free. Add them by hand or include more staff.</li>}
                  {!notice.report.unplaced.length && !notice.report.unseated && !notice.report.shortfall && <li>Every paper is timetabled, every student seated and every room staffed.</li>}
                </ul>
              )}
            </Alert>
          )}

          {!examId && exams.data ? (
            <Card className="p-2">
              <EmptyState icon={Grid3x3} title="No examinations yet" description="Create an examination first; its timetable is prepared here, branch by branch." />
            </Card>
          ) : data.status === 'error' && !data.data ? (
            <ErrorState title="The timetable could not be loaded" description="Check your connection and try again." onRetry={data.retry} />
          ) : needsBranch && ownerBranches.data && !activeBranches.length ? (
            <Card className="p-2">
              <EmptyState icon={Grid3x3} title="No active branches" description="A timetable is prepared for a branch." />
            </Card>
          ) : !t ? (
            <LoadingState label="Loading the timetable…" />
          ) : (
            <>
              {t.timetable?.changedSincePublish && <Alert variant="warning" title="Changed since it was published">Publish it again so the invigilators see their current duties.</Alert>}
              {t.unscheduled.length > 0 && (
                <Alert variant={t.timetable ? 'warning' : 'info'} title={t.timetable ? 'Papers not in the timetable' : 'Papers to timetable'}>
                  {t.unscheduled.map((u) => `${u.class.name} ${u.subject.name}${u.students ? '' : ' (no students here)'}`).join(', ')}
                  {notice?.report?.unplaced?.length > 0 && (
                    <span className="mt-1 block">
                      {notice.report.unplaced.map((u) => UNPLACED_REASONS[u.reason]).filter((x, i, a) => a.indexOf(x) === i).join('; ')}.
                    </span>
                  )}
                </Alert>
              )}
              <ul className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="Timetable in numbers">
                <li><KpiCard label="Sessions" value={t.summary.sessions} icon={CalendarClock} note={`${t.summary.days} day${t.summary.days === 1 ? '' : 's'}`} /></li>
                <li><KpiCard label="Papers timetabled" value={`${t.summary.timetabled}/${t.summary.papers}`} icon={Grid3x3} tone={t.summary.timetabled < t.summary.papers ? 'warning' : 'success'} /></li>
                <li><KpiCard label="Students" value={t.summary.students} icon={Users} note={t.branch.name} /></li>
                <li><KpiCard label="Invigilations" value={t.summary.invigilations} icon={UserCheck} tone={t.summary.roomsWithoutEnoughInvigilators ? 'error' : 'success'} note={t.summary.roomsWithoutEnoughInvigilators ? `${t.summary.roomsWithoutEnoughInvigilators} rooms short` : 'Every room staffed'} /></li>
              </ul>
              {t.timetable && (
                <div className="flex flex-wrap justify-end gap-2">
                  <DownloadButton load={() => downloadExamDocument(role, examId, 'timetable', { branch: b })} onError={(message) => setNotice({ message })}>Timetable PDF</DownloadButton>
                  <DownloadButton load={() => downloadExamDocument(role, examId, 'duties', { branch: b })} onError={(message) => setNotice({ message })}>Duties PDF</DownloadButton>
                  {t.actions.clear && <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'clear' })}>Clear Timetable</Button>}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!t.actions.edit}
                    onClick={() => setDialog({ type: 'publish' })}
                    unavailableReason={!t.actions.publish ? (t.examination.state === 'draft' ? 'Schedule the examination first.' : 'Every paper must be timetabled and every room staffed.') : undefined}
                  >
                    {t.timetable.publishedAt ? 'Publish Again' : 'Publish to Invigilators'}
                  </Button>
                </div>
              )}

              {!t.timetable ? (
                <Card className="p-2">
                  <EmptyState
                    icon={Sparkles}
                    title={`No timetable for ${t.branch.name} yet`}
                    description={t.actions.generate ? 'Generate it: papers are placed in sessions, students seated in rooms in proportion and invigilators given to every room. You can adjust it afterwards.' : 'This examination has started or is closed: its timetable can no longer be generated.'}
                  />
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  <div className="border-b border-border px-4 pt-3">
                    <Tabs id={tabsId} label="Timetable sections" tabs={TABS} value={tab} onChange={(v) => set('tab', v)} />
                  </div>
                  <TabPanel tabsId={tabsId} value={tab}>
                    {tab === 'timetable' && (
                      <div role="region" aria-label="Sessions" tabIndex={0} className="overflow-x-auto">
                        <Table caption="Sessions by date and time">
                          <TableHead>
                            <TableRow interactive={false}>
                              <TableHeaderCell>Date</TableHeaderCell>
                              <TableHeaderCell>Shift</TableHeaderCell>
                              <TableHeaderCell>Time</TableHeaderCell>
                              <TableHeaderCell>Papers</TableHeaderCell>
                              <TableHeaderCell align="right">Students</TableHeaderCell>
                              <TableHeaderCell>Rooms</TableHeaderCell>
                              <TableHeaderCell align="right">{t.actions.edit ? 'Actions' : ''}</TableHeaderCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {!t.sessions.length && <TableEmpty columns={7} icon={CalendarClock} title="No sessions" description="No paper could be timetabled." />}
                            {t.sessions.map((s) => (
                              <TableRow key={s.id}>
                                <TableCell className="tabular-nums whitespace-nowrap">{s.date}</TableCell>
                                <TableCell><Badge variant="info">{s.shiftName}</Badge></TableCell>
                                <TableCell className="tabular-nums whitespace-nowrap">{s.start}–{s.end}</TableCell>
                                <TableCell>
                                  <span className="flex flex-wrap gap-1">
                                    {s.papers.map((p) => (
                                      <Badge key={p.sittingId} variant="accent">{p.subject.name} · {p.class.name}</Badge>
                                    ))}
                                  </span>
                                </TableCell>
                                <TableCell align="right">{s.students}</TableCell>
                                <TableCell>{s.rooms.map((r) => r.room.name).join(', ') || '—'}</TableCell>
                                <TableCell align="right">
                                  {t.actions.edit && !s.past && (
                                    <TableActions>
                                      <Button size="sm" variant="ghost" leftIcon={ArrowRightLeft} onClick={() => setDialog({ type: 'move', session: s })}>Move</Button>
                                    </TableActions>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}

                    {tab === 'rooms' && (
                      <RoomAllocationPanel role={role} examId={examId} branch={b} sessions={t.sessions} today={t.today} version={version} onNotice={(message) => setNotice({ message })} />
                    )}

                    {tab === 'invigilators' && (
                      <InvigilatorMatrixPanel
                        role={role}
                        examId={examId}
                        branch={b}
                        version={version}
                        onNotice={(message) => setNotice({ message })}
                        editor={
                        <div role="region" aria-label="Invigilation duties" tabIndex={0} className="overflow-x-auto">
                          <Table caption="Invigilators of each room and session">
                            <TableHead>
                              <TableRow interactive={false}>
                                <TableHeaderCell>Session</TableHeaderCell>
                                <TableHeaderCell>Room</TableHeaderCell>
                                <TableHeaderCell>Invigilators</TableHeaderCell>
                                <TableHeaderCell align="right">Needed</TableHeaderCell>
                                <TableHeaderCell align="right">{t.actions.edit ? 'Actions' : ''}</TableHeaderCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {t.sessions.flatMap((s) =>
                                s.rooms.map((r) => (
                                  <TableRow key={`${s.id}-${r.room.id}`}>
                                    <TableCell className="tabular-nums whitespace-nowrap">{s.date} {s.start}–{s.end}</TableCell>
                                    <TableCell className="font-medium">{r.room.name}</TableCell>
                                    <TableCell>{r.invigilators.map((x) => x.name).join(', ') || <span className="text-error-fg">None</span>}</TableCell>
                                    <TableCell align="right" className={r.invigilators.length < r.need ? 'text-error-fg' : undefined}>{r.invigilators.length}/{r.need}</TableCell>
                                    <TableCell align="right">
                                      {t.actions.edit && !s.past && (
                                        <Button size="sm" variant="outline" onClick={() => setDialog({ type: 'invigilators', session: s, room: r })} unavailableReason={!options.data ? 'Loading…' : undefined}>
                                          Change
                                        </Button>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                )),
                              )}
                            </TableBody>
                          </Table>
                        </div>
                        }
                      />
                    )}

                    {tab === 'students' && (
                      <div className="flex flex-col gap-4 p-4">
                        {seatSession && (
                          <div className="flex flex-wrap gap-2">
                            <DownloadButton load={() => downloadExamDocument(role, examId, 'seating', { session: seatSession })} onError={(message) => setNotice({ message })}>Seating Lists PDF</DownloadButton>
                            <DownloadButton load={() => downloadExamDocument(role, examId, 'register', { session: seatSession })} onError={(message) => setNotice({ message })}>Attendance Registers PDF</DownloadButton>
                          </div>
                        )}
                        <Select
                          label="Session"
                          placeholder="Choose a session"
                          options={t.sessions.map((s) => ({ value: s.id, label: `${s.date} ${s.start}–${s.end} · ${s.papers.map((p) => p.subject.name).filter((x, j, a) => a.indexOf(x) === j).join(', ')}` }))}
                          value={seatSession}
                          onChange={(e) => setSeatSession(e.target.value)}
                          fieldClassName="sm:w-1/2"
                        />
                        {!seatSession ? (
                          <EmptyState icon={DoorOpen} title="Choose a session" description="Every student’s room and seat in that session, and their attendance from its day on." />
                        ) : (
                          <ExamAttendancePanel role={role} examId={examId} sessionId={seatSession} onNotice={(message) => setNotice({ message })} />
                        )}
                      </div>
                    )}
                  </TabPanel>
                </Card>
              )}

              <GenerateModal
                role={role}
                examId={examId}
                branchId={b}
                options={options.data}
                regenerate={Boolean(t.timetable)}
                open={dialog?.type === 'generate'}
                onClose={() => setDialog(null)}
                onDone={done('Timetable generated.')}
              />
              <MoveModal role={role} examId={examId} branchId={b} timetable={t} session={dialog?.session} open={dialog?.type === 'move'} onClose={() => setDialog(null)} onDone={done('Paper moved.')} />
              <InvigilatorModal
                role={role}
                examId={examId}
                branchId={b}
                session={dialog?.session}
                room={dialog?.room}
                staff={options.data?.staff}
                busyIds={dialog?.session ? new Set(dialog.session.rooms.filter((r) => r.room.id !== dialog.room?.room.id).flatMap((r) => r.invigilators.map((i) => i.id))) : null}
                open={dialog?.type === 'invigilators'}
                onClose={() => setDialog(null)}
                onDone={done('Invigilators saved.')}
              />
              <ConfirmModal
                open={dialog?.type === 'publish'}
                onClose={() => setDialog(null)}
                title={`Publish the ${t.branch.name} Timetable`}
                description="Invigilators are told their duties (when your settings say so). Later changes are shown as not published until you publish again."
                confirmLabel="Publish"
                variant="primary"
                run={() => publishTimetable(role, examId, b)}
                onDone={done('Timetable published.')}
              />
              <ConfirmModal
                open={dialog?.type === 'clear'}
                onClose={() => setDialog(null)}
                title={`Clear the ${t.branch.name} Timetable`}
                description="Its sessions, seats and invigilators are removed. The examination and its papers stay."
                confirmLabel="Clear Timetable"
                run={() => clearTimetable(role, examId, b)}
                onDone={done('Timetable cleared.')}
              />
            </>
          )}
        </>
      )}
    </ExamPage>
  );
}
