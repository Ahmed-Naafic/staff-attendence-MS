import { useMemo, useState } from 'react';
import { CalendarClock, DoorOpen, GraduationCap, Search, Users } from 'lucide-react';
import { Badge, Card, EmptyState, ErrorState, Input, KpiCard, LoadingState, Select } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { downloadExamDocument, loadSessionSeats } from '../data/examApi.js';
import { DownloadButton } from './DownloadButton.jsx';
import { pickSession, sessionChoices } from '../utils/examRules.js';

/** One room: its number, how many students and who they are (name and class only). */
function RoomCard({ room, query }) {
  const [all, setAll] = useState(false);
  const q = query.trim().toLowerCase();
  const seats = q ? room.seats.filter((s) => s.student.name.toLowerCase().includes(q) || s.section.name.toLowerCase().includes(q)) : room.seats;
  const LIMIT = 12;
  const shown = all || q ? seats : seats.slice(0, LIMIT);
  const headingId = `room-${room.room.id}`;
  return (
    <Card as="li" aria-labelledby={headingId} className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 id={headingId} className="flex items-center gap-2 text-card-title text-fg">
          <DoorOpen aria-hidden="true" className="size-4 text-fg-muted" />
          {room.room.name}
        </h3>
        <Badge variant="success">{room.seats.length} student{room.seats.length === 1 ? '' : 's'}</Badge>
      </div>
      <ol className="flex flex-col divide-y divide-border" aria-label={`Students in ${room.room.name}`}>
        {shown.map((s) => (
          <li key={s.student.id} className="flex items-center justify-between gap-3 px-4 py-2">
            <span className="min-w-0 truncate text-small font-medium text-fg" title={s.student.name}>{s.student.name}</span>
            <span className="shrink-0 text-caption text-fg-muted">{s.section.name}</span>
          </li>
        ))}
        {!shown.length && <li className="px-4 py-3 text-small text-fg-muted">No student matches.</li>}
      </ol>
      {!q && seats.length > LIMIT && (
        <button type="button" className="mt-auto border-t border-border px-4 py-2 text-left text-small font-medium text-interactive hover:bg-surface-hover" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${seats.length} students`}
        </button>
      )}
    </Card>
  );
}

/** Room Allocation: one session (date → shift → session) at a time, each room a card with its students. */
export function RoomAllocationPanel({ role, examId, branch, sessions, today, version, onNotice }) {
  const [choice, setChoice] = useState({});
  const [query, setQuery] = useState('');
  const { dates, shifts, list, session } = useMemo(() => sessionChoices(sessions, pickSession(sessions, choice, today)), [sessions, choice, today]);
  const seats = useApiData(() => (session ? loadSessionSeats(role, examId, branch, session.id) : Promise.resolve(null)), `rooms|${examId}|${branch}|${session?.id}|${version}`);
  const d = seats.data;
  const classes = session ? [...new Set(session.papers.map((p) => p.class.name))] : [];

  if (!sessions.length) return <EmptyState icon={DoorOpen} title="No sessions" description="Generate the timetable to allocate rooms." />;
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select label="Examination date" options={dates.map((x) => ({ value: x.date, label: x.label }))} value={session?.date ?? ''} onChange={(e) => setChoice({ date: e.target.value })} />
        <Select label="Shift" options={shifts.map((x) => ({ value: x, label: x }))} value={session?.shiftName ?? ''} onChange={(e) => setChoice({ date: session?.date, shift: e.target.value })} />
        <Select label="Session" options={list.map((s) => ({ value: s.id, label: `Session ${s.sequence} · ${s.start}–${s.end}` }))} value={session?.id ?? ''} onChange={(e) => setChoice({ id: e.target.value })} />
      </div>
      {session && (
        <ul className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="This session in numbers">
          <KpiCard label="Total rooms" value={session.rooms.length} icon={DoorOpen} />
          <KpiCard label="Total students" value={session.students} icon={Users} tone="success" />
          <KpiCard label="Classes" value={classes.length} icon={GraduationCap} note={classes.join(', ')} />
          <KpiCard label="Session time" value={`${session.start}–${session.end}`} icon={CalendarClock} tone="warning" note={`${session.shiftName} · session ${session.sequence}`} />
        </ul>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Input label="Find a student" leftIcon={Search} placeholder="Name or class" value={query} onChange={(e) => setQuery(e.target.value)} fieldClassName="w-full sm:w-72" />
        {session && (
          <DownloadButton load={() => downloadExamDocument(role, examId, 'seating', { session: session.id })} onError={(message) => onNotice(message)}>
            Seating Lists PDF
          </DownloadButton>
        )}
      </div>
      {seats.status === 'error' && !d ? (
        <ErrorState title="The rooms could not be loaded" description="Check your connection and try again." onRetry={seats.retry} />
      ) : !d ? (
        <LoadingState label="Loading the rooms…" />
      ) : !d.rooms.length ? (
        <EmptyState icon={DoorOpen} title="Nobody is seated in this session" />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label="Rooms">
          {d.rooms.map((r) => <RoomCard key={r.room.id} room={r} query={query} />)}
        </ul>
      )}
    </div>
  );
}
