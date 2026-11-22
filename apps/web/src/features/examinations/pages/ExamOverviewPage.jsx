import { Link } from 'react-router';
import { CalendarCheck, CalendarClock, CircleCheck, CircleDashed, ClipboardList, DoorOpen, Users } from 'lucide-react';
import { Card, CardHeader, KpiCard } from '../../../components/ui';
import { ExamPage, ExamStateBadge, useExamRole } from '../components/ExamGate.jsx';
import { EXAM_PROGRESS, examScopeText } from '../utils/examRules.js';

const PAGE_LINK = { 'academic-years': '/academic-years', types: '/examinations/setup', settings: '/examinations/settings', rooms: '/examinations/rooms' };

/** Examinations → Overview: what is set up, what is missing, and the steps of an examination. */
export default function ExamOverviewPage() {
  const role = useExamRole();
  return (
    <ExamPage title="Examinations" description={role === 'OWNER' ? 'Set up and follow your school’s examinations.' : 'Your branch’s examinations.'}>
      {(o) => {
        const done = o.setup.filter((s) => s.done).length;
        return (
          <>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Examination setup in numbers">
              <li><KpiCard label="Active examinations" value={o.examinations.active} icon={CalendarCheck} tone="success" note={o.academicYear?.name ?? 'No current year'} /></li>
              <li><KpiCard label="Planned examinations" value={o.examinations.planned} icon={CalendarClock} note={`${o.examinations.draft} draft${o.examinations.draft === 1 ? '' : 's'}`} /></li>
              <li><KpiCard label={role === 'OWNER' ? 'Rooms (all branches)' : 'Rooms'} value={o.counts.rooms} icon={DoorOpen} tone="warning" /></li>
              <li><KpiCard label="Seats" value={o.counts.seats} icon={Users} tone="info" note="Default capacity of active rooms" /></li>
            </ul>
            <Card as="section" aria-labelledby="exam-current-title" className="flex flex-col gap-3 p-5">
              <h2 id="exam-current-title" className="text-card-title text-fg">
                {o.current?.state === 'active' ? 'Current examination' : 'Next examination'}
              </h2>
              {o.current ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 text-section-title font-semibold text-fg">
                      {o.current.name} <ExamStateBadge state={o.current.state} />
                    </span>
                    <span className="text-small text-fg-secondary tabular-nums">
                      {o.current.startDate} to {o.current.endDate} · {o.current.period?.name ?? 'Whole year'} · {examScopeText(o.current)} · {o.current.classes.length} class{o.current.classes.length === 1 ? '' : 'es'}
                    </span>
                  </div>
                  <Link to={`/examinations/list/${o.current.id}`} className="text-small font-medium text-interactive underline-offset-2 hover:underline">
                    View details
                  </Link>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-body text-fg-secondary">
                  <ClipboardList aria-hidden="true" className="size-5 text-fg-muted" />
                  No examination is scheduled.{' '}
                  <Link to="/examinations/list" className="font-medium text-interactive underline-offset-2 hover:underline">
                    Go to Examinations
                  </Link>
                </p>
              )}
            </Card>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card as="section" className="lg:col-span-2" aria-labelledby="exam-setup-title">
                <CardHeader title={<span id="exam-setup-title">Setup checklist</span>} description={`${done} of ${o.setup.length} done. Examination types and periods are needed to create examinations; rooms and grading come into play later.`} />
                <ol className="flex flex-col divide-y divide-border px-5 pb-3 pt-2">
                  {o.setup.map((s) => (
                    <li key={s.key} className="flex items-center gap-3 py-3">
                      {s.done ? <CircleCheck aria-hidden="true" className="size-5 shrink-0 text-success-fg" /> : <CircleDashed aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-body font-medium text-fg">
                          {s.label}
                          <span className="sr-only">{s.done ? ' (done)' : ' (to do)'}</span>
                        </span>
                        <span className="text-small text-fg-muted">{s.note}</span>
                      </span>
                      {!s.done && PAGE_LINK[s.page] && (
                        <Link to={PAGE_LINK[s.page]} className="text-small font-medium text-interactive underline-offset-2 hover:underline">
                          Set up
                        </Link>
                      )}
                    </li>
                  ))}
                </ol>
              </Card>
              <Card as="section" aria-labelledby="exam-steps-title">
                <CardHeader title={<span id="exam-steps-title">Steps of an examination</span>} description="Every examination goes through these steps." />
                <ol className="flex flex-col gap-3 px-5 pb-5 pt-3">
                  {EXAM_PROGRESS.map((step, i) => (
                    <li key={step} className="flex items-center gap-3">
                      <span className="grid size-7 shrink-0 place-items-center rounded-pill bg-muted text-small font-semibold text-fg-secondary">{i + 1}</span>
                      <span className="text-body text-fg">{step}</span>
                    </li>
                  ))}
                </ol>
              </Card>
            </div>
          </>
        );
      }}
    </ExamPage>
  );
}
