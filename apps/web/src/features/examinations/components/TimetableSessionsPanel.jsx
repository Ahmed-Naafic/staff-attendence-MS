import { useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Clock,
  DoorOpen,
  Download,
  Eye,
  FileDown,
  FileText,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Search,
  SlidersHorizontal,
  UserCheck,
  Users,
} from 'lucide-react';
import { Badge, Button, Card, Drawer, DropdownMenu, EmptyState, Input, Select, Skeleton } from '../../../components/ui';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { cn } from '../../../lib/cn.js';
import { saveFile } from '../../attendance-reports/utils/exportRules.js';
import { downloadExamDocument } from '../data/examApi.js';
import {
  activeFilterCount,
  EMPTY_TIMETABLE_FILTERS,
  filterTimetableSessions,
  groupPapersBySubject,
  groupSessionsByDate,
  longDate,
  SESSION_STATES,
  sectionsText,
  sessionState,
  timetableFilterOptions,
} from '../utils/examRules.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Prints a PDF (a blob) through the browser's print dialog; opens it in a new tab where printing a frame is not allowed. */
function printPdf(blob) {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.title = 'Print';
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.onload = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch {
      window.open(url, '_blank', 'noopener');
    }
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };
  frame.src = url;
  document.body.appendChild(frame);
}

/** Subjects with their grades: "Islamic Studies  [Grade 5] [Grade 6]". */
function PaperGroups({ papers, compact = false }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {groupPapersBySubject(papers).map((g) => (
        <li key={g.subject.id} className="flex flex-wrap items-center gap-1.5">
          <span className={cn('font-medium text-fg', compact ? 'text-small' : 'text-body')}>{g.subject.name}</span>
          {g.classes.map((c) => (
            <Badge key={c.id} variant="accent">{c.name}</Badge>
          ))}
        </li>
      ))}
    </ul>
  );
}

function Section({ icon: Icon, label, className, children }) {
  return (
    <div className={cn('flex min-w-0 gap-3 px-4 py-3', className)}>
      <span aria-hidden="true" className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-muted text-fg-secondary">
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="sr-only">{label}</span>
        {children}
      </div>
    </div>
  );
}

/** One session: time | papers | allocation | actions, side by side on wide screens and stacked on phones. */
function SessionCard({ session: s, canEdit, onView, onEdit, menu }) {
  const short = s.rooms.filter((r) => r.invigilators.length < r.need).length;
  const label = `Session ${s.sequence}, ${s.start} to ${s.end}`;
  return (
    <li aria-label={label} className="rounded-lg border border-border bg-surface shadow-subtle transition-shadow hover:shadow-medium">
      <div className="flex flex-col divide-y divide-border-subtle lg:flex-row lg:items-stretch lg:divide-x lg:divide-y-0">
        <Section icon={Clock} label="Time" className="lg:w-52 lg:shrink-0">
          <span className="text-body font-semibold tabular-nums text-fg">{s.start}–{s.end}</span>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant="info">{s.shiftName}</Badge>
            <span className="text-caption text-fg-muted">Session {s.sequence}</span>
          </span>
        </Section>
        <Section icon={FileText} label="Examination papers" className="lg:flex-1">
          <span className="text-caption text-fg-muted">
            {s.shown.length === s.papers.length ? plural(s.papers.length, 'paper') : `${s.shown.length} of ${plural(s.papers.length, 'paper')}`}
          </span>
          <PaperGroups papers={s.shown} compact />
        </Section>
        <Section icon={Users} label="Allocation" className="lg:w-48 lg:shrink-0">
          <span className="flex items-center gap-1.5 text-small text-fg">
            <Users aria-hidden="true" className="size-3.5 text-fg-muted" />
            <span className="font-semibold tabular-nums">{s.students}</span> {s.students === 1 ? 'student' : 'students'}
          </span>
          <span className="flex items-center gap-1.5 text-small text-fg">
            <DoorOpen aria-hidden="true" className="size-3.5 text-fg-muted" />
            <span className="font-semibold tabular-nums">{s.rooms.length}</span> {s.rooms.length === 1 ? 'room' : 'rooms'}
          </span>
          {short > 0 && <span className="text-caption text-error-fg">{plural(short, 'room')} short of invigilators</span>}
        </Section>
        <div className="flex items-center justify-end gap-2 px-4 py-3 lg:w-auto lg:shrink-0">
          <Button size="sm" variant="ghost" leftIcon={Eye} onClick={onView} aria-label={`View ${label}`}>
            View
          </Button>
          {canEdit && (
            <Button size="sm" variant="outline" leftIcon={Pencil} onClick={onEdit} aria-label={`Edit ${label}`} unavailableReason={s.past ? 'This session was sat on a day before today.' : undefined}>
              Edit
            </Button>
          )}
          <DropdownMenu label={`More actions for ${label}`} items={menu} />
        </div>
      </div>
    </li>
  );
}

/** Session details: date, shift, time, papers and grades, students, rooms with their invigilators, status. */
function SessionDrawer({ session: s, timetable: t, canEdit, onClose, onEdit }) {
  const open = Boolean(s);
  const state = s ? SESSION_STATES[sessionState(s, t.today)] : null;
  const grades = s ? [...new Map(s.papers.map((p) => [p.class.id, p.class])).values()] : [];
  const invigilators = s ? s.rooms.reduce((n, r) => n + r.invigilators.length, 0) : 0;
  const needed = s ? s.rooms.reduce((n, r) => n + r.need, 0) : 0;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="lg"
      title={s ? `Session ${s.sequence} · ${s.start}–${s.end}` : ''}
      description={s ? longDate(s.date) : undefined}
      header={
        s && (
          <>
            <Badge variant="info">{s.shiftName}</Badge>
            <Badge variant={state.variant} dot>{state.label}</Badge>
            {t.timetable?.publishedAt ? (
              <Badge variant={t.timetable.changedSincePublish ? 'warning' : 'success'}>{t.timetable.changedSincePublish ? 'Changed since published' : 'Published'}</Badge>
            ) : (
              <Badge variant="warning">Not published</Badge>
            )}
          </>
        )
      }
      footer={
        s && (
          <>
            <Button variant="outline" onClick={onClose}>Close</Button>
            {canEdit && (
              <Button leftIcon={Pencil} onClick={onEdit} unavailableReason={s.past ? 'This session was sat on a day before today.' : undefined}>
                Edit Session
              </Button>
            )}
          </>
        )
      }
    >
      {s && (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            {[
              ['Date', s.date],
              ['Shift', s.shiftName],
              ['Time', `${s.start}–${s.end}`],
              ['Students', s.students],
              ['Rooms', s.rooms.length],
              ['Invigilators', `${invigilators} of ${needed} needed`],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <dt className="text-caption text-fg-muted">{k}</dt>
                <dd className={cn('text-body font-medium tabular-nums', k === 'Invigilators' && invigilators < needed ? 'text-error-fg' : 'text-fg')}>{v}</dd>
              </div>
            ))}
          </dl>

          <section aria-labelledby="session-papers" className="flex flex-col gap-2">
            <h3 id="session-papers" className="text-card-title text-fg">Examination papers ({s.papers.length})</h3>
            <p className="text-small text-fg-muted">Grades: {grades.map((g) => g.name).join(', ') || 'None'}</p>
            <ul className="flex flex-col divide-y divide-border-subtle rounded-md border border-border">
              {s.papers.map((p) => (
                <li key={p.sittingId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-small font-medium text-fg">{p.subject.name}</span>
                    <span className="text-caption text-fg-muted">{p.class.name} · {p.durationMinutes} min</span>
                  </span>
                  <span className="shrink-0 text-caption text-fg-secondary tabular-nums">{plural(p.students, 'student')}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="session-rooms" className="flex flex-col gap-2">
            <h3 id="session-rooms" className="text-card-title text-fg">Rooms and invigilators ({s.rooms.length})</h3>
            {!s.rooms.length ? (
              <p className="text-small text-fg-muted">Nobody is seated in this session.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {s.rooms.map((r) => (
                  <li key={r.room.id} className="flex flex-col gap-1 rounded-md border border-border px-3 py-2">
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-small font-semibold text-fg">
                        <DoorOpen aria-hidden="true" className="size-4 text-fg-muted" />
                        {r.room.name}
                      </span>
                      <Badge variant="success">{plural(r.students, 'student')}</Badge>
                    </span>
                    {r.sections.length > 0 && <span className="text-caption text-fg-muted">{sectionsText(r.sections)}</span>}
                    <span className={cn('flex items-center gap-1.5 text-small', r.invigilators.length < r.need ? 'text-error-fg' : 'text-fg-secondary')}>
                      <UserCheck aria-hidden="true" className="size-3.5" />
                      {r.invigilators.map((x) => x.name).join(', ') || 'No invigilator'} ({r.invigilators.length}/{r.need})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

/** Placeholder of the Timetable tab while the timetable loads. */
export function TimetableSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Loading the timetable…</span>
      <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}
      </Card>
      {Array.from({ length: 2 }, (_, d) => (
        <div key={d} className="flex flex-col gap-3">
          <Skeleton className="h-6 w-64" />
          {Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
        </div>
      ))}
    </div>
  );
}

/**
 * The Timetable tab: sessions grouped by examination date as compact cards, with filters (dates, shift,
 * grade, subject, search), export / print of the existing PDFs and Add Session (a paper moved into a new
 * session, the existing move workflow). Works on `timetable` as loadTimetable returns it.
 */
export function TimetableSessionsPanel({ role, examId, branch, timetable: t, onAdd, onEdit, onOpenTab, onNotice }) {
  const [filters, setFilters] = useState(EMPTY_TIMETABLE_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [viewing, setViewing] = useState(null);
  const [busy, setBusy] = useState('');

  const options = useMemo(() => timetableFilterOptions(t.sessions), [t.sessions]);
  const shown = useMemo(() => filterTimetableSessions(t.sessions, filters), [t.sessions, filters]);
  const groups = useMemo(() => groupSessionsByDate(shown), [shown]);
  const filterCount = activeFilterCount(filters);
  const canEdit = Boolean(t.actions.edit);
  const open = t.sessions.filter((s) => !s.past);
  const viewed = viewing ? t.sessions.find((s) => s.id === viewing) : null;
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.date));
  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const toggle = (date) => setCollapsed((c) => {
    const next = new Set(c);
    if (next.has(date)) next.delete(date);
    else next.add(date);
    return next;
  });

  const run = async (key, load, use) => {
    setBusy(key);
    try {
      use(await load());
    } catch (e) {
      onNotice(requestFailure(e));
    } finally {
      setBusy('');
    }
  };
  const save = (key, kind, query) => run(key, () => downloadExamDocument(role, examId, kind, query), ({ blob, filename }) => saveFile(blob, filename));
  const menuFor = (s) => [
    { type: 'label', label: 'Documents' },
    { label: 'Seating Lists PDF', icon: FileDown, onSelect: () => save(`seating-${s.id}`, 'seating', { session: s.id }) },
    { label: 'Attendance Registers PDF', icon: FileDown, onSelect: () => save(`register-${s.id}`, 'register', { session: s.id }) },
    { type: 'separator' },
    { type: 'label', label: 'Open' },
    { label: 'Room Allocation', icon: DoorOpen, onSelect: () => onOpenTab('rooms') },
    { label: 'Invigilators', icon: UserCheck, onSelect: () => onOpenTab('invigilators') },
    { label: 'Students & Attendance', icon: ClipboardList, onSelect: () => onOpenTab('students', s.id) },
  ];

  const filterPanelId = 'timetable-filters';
  return (
    <div className="flex flex-col gap-4 bg-page p-4 sm:p-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-section-title text-fg">Examination Timetable</h2>
          <p className="text-small text-fg-muted">View and manage examination sessions, papers, students and room allocation.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu
            label="Export"
            items={[
              { label: 'Timetable PDF', icon: FileDown, onSelect: () => save('timetable', 'timetable', { branch }) },
              { label: 'Invigilation Duties PDF', icon: FileDown, onSelect: () => save('duties', 'duties', { branch }) },
            ]}
            renderTrigger={(props) => (
              <Button {...props} variant="outline" leftIcon={Download} rightIcon={ChevronDown} loading={busy === 'timetable' || busy === 'duties'}>
                Export
              </Button>
            )}
          />
          <Button variant="outline" leftIcon={Printer} loading={busy === 'print'} onClick={() => run('print', () => downloadExamDocument(role, examId, 'timetable', { branch }), ({ blob }) => printPdf(blob))}>
            Print
          </Button>
          {canEdit && (
            <Button leftIcon={Plus} onClick={onAdd} unavailableReason={!open.length ? 'Every session was sat on a day before today.' : undefined}>
              Add Session
            </Button>
          )}
        </div>
      </header>

      <Card as="section" aria-label="Filter the sessions" className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2 sm:hidden">
          <Button size="sm" variant="outline" leftIcon={SlidersHorizontal} aria-expanded={showFilters} aria-controls={filterPanelId} onClick={() => setShowFilters((v) => !v)}>
            Filters{filterCount ? ` (${filterCount})` : ''}
          </Button>
          {filterCount > 0 && <Button size="sm" variant="ghost" leftIcon={RotateCcw} onClick={() => setFilters(EMPTY_TIMETABLE_FILTERS)}>Clear</Button>}
        </div>
        <div id={filterPanelId} className={cn('grid-cols-1 gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6', showFilters ? 'grid' : 'hidden')}>
          <Input type="date" label="From" value={filters.from} min={t.examination.startDate} max={filters.to || t.examination.endDate} onChange={setFilter('from')} />
          <Input type="date" label="To" value={filters.to} min={filters.from || t.examination.startDate} max={t.examination.endDate} onChange={setFilter('to')} />
          <Select label="Shift" placeholder="All shifts" options={options.shifts.map((x) => ({ value: x, label: x }))} value={filters.shift} onChange={setFilter('shift')} />
          <Select label="Grade" placeholder="All grades" options={options.grades.map((x) => ({ value: x.id, label: x.name }))} value={filters.grade} onChange={setFilter('grade')} />
          <Select label="Subject / Paper" placeholder="All subjects" options={options.subjects.map((x) => ({ value: x.id, label: x.name }))} value={filters.subject} onChange={setFilter('subject')} />
          <Input label="Search papers" type="search" leftIcon={Search} placeholder="Subject or grade" value={filters.q} onChange={setFilter('q')} />
        </div>
        <div className={cn('flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3 sm:flex', showFilters || filterCount ? 'flex' : 'hidden')}>
          <p className="text-small text-fg-muted" aria-live="polite">
            {plural(shown.length, 'session')} on {plural(groups.length, 'day')}
            {filterCount ? ` (of ${t.sessions.length})` : ''}
          </p>
          <div className="flex items-center gap-2">
            {groups.length > 1 && (
              <Button size="sm" variant="ghost" onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.date)))}>
                {allCollapsed ? 'Expand all' : 'Collapse all'}
              </Button>
            )}
            <Button size="sm" variant="ghost" leftIcon={RotateCcw} disabled={!filterCount} onClick={() => setFilters(EMPTY_TIMETABLE_FILTERS)}>
              Clear filters
            </Button>
          </div>
        </div>
      </Card>

      {!t.sessions.length ? (
        <Card className="p-2">
          <EmptyState icon={CalendarDays} title="No sessions" description="No paper could be timetabled. Check the papers and generate the timetable again." />
        </Card>
      ) : !groups.length ? (
        <Card className="p-2">
          <EmptyState
            icon={Search}
            title="No session matches these filters"
            description="Change or clear the filters to see more sessions."
            action={<Button variant="outline" leftIcon={RotateCcw} onClick={() => setFilters(EMPTY_TIMETABLE_FILTERS)}>Clear filters</Button>}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => {
            const isOpen = !collapsed.has(g.date);
            const bodyId = `tt-day-${g.date}`;
            const state = SESSION_STATES[sessionState(g, t.today)];
            return (
              <section key={g.date} aria-label={longDate(g.date)} className="flex flex-col gap-3">
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={bodyId}
                    onClick={() => toggle(g.date)}
                    className="flex w-full items-center gap-3 rounded-md py-1 text-left hover:text-interactive"
                  >
                    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-fg">
                      <CalendarDays className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-card-title text-fg">{longDate(g.date)}</span>
                      <span className="text-caption text-fg-muted">
                        {plural(g.sessions.length, 'session')} · {plural(g.sessions.reduce((n, s) => n + s.shown.length, 0), 'paper')}
                      </span>
                    </span>
                    {state.label !== 'Upcoming' && <Badge variant={state.variant}>{state.label}</Badge>}
                    <ChevronDown aria-hidden="true" className={cn('size-5 shrink-0 text-fg-muted transition-transform', isOpen && 'rotate-180')} />
                  </button>
                </h3>
                {isOpen && (
                  <ul id={bodyId} className="flex flex-col gap-3">
                    {g.sessions.map((s) => (
                      <SessionCard key={s.id} session={s} canEdit={canEdit} onView={() => setViewing(s.id)} onEdit={() => onEdit(s)} menu={menuFor(s)} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      <SessionDrawer
        session={viewed}
        timetable={t}
        canEdit={canEdit}
        onClose={() => setViewing(null)}
        onEdit={() => {
          setViewing(null);
          onEdit(viewed);
        }}
      />
    </div>
  );
}
