import { useState } from 'react';
import { DoorOpen } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, LoadingState, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../../../components/ui';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { useApiData } from '../../../hooks/useApiData.js';
import { saveSessionAttendance, loadSessionAttendance } from '../data/examApi.js';
import { ATTENDANCE_OPTIONS } from '../utils/examRules.js';

const TONE = { present: 'success', late: 'warning', absent: 'error', excused: 'info' };

/** One room: its seats with each student's attendance, editable from the day of the session. */
function RoomAttendance({ role, examId, sessionId, room, canEdit, onSaved }) {
  const [changes, setChanges] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const value = (seat) => changes[seat.student.id] ?? seat.attendance ?? '';
  const dirty = Object.entries(changes).filter(([sid, v]) => v && v !== room.seats.find((s) => s.student.id === sid)?.attendance);
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await saveSessionAttendance(role, examId, sessionId, { room: room.room.id, marks: dirty.map(([student, status]) => ({ student, status })) });
      setChanges({});
      onSaved(`Attendance of ${room.room.name} saved.`);
    } catch (e) {
      setError(requestFailure(e));
    } finally {
      setSaving(false);
    }
  };
  const s = room.summary;
  return (
    <Card as="section" aria-label={`Attendance in ${room.room.name}`} className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-card-title text-fg">{room.room.name}</h3>
          <p className="text-caption text-fg-muted">
            {s.present} present · {s.late} late · {s.absent} absent · {s.excused} excused · {s.notTaken} not taken
            {room.invigilators.length ? ` · ${room.invigilators.map((i) => i.name).join(', ')}` : ''}
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setChanges(Object.fromEntries(room.seats.filter((x) => !x.attendance && !changes[x.student.id]).map((x) => [x.student.id, 'present']).concat(Object.entries(changes))))}>
              Rest Present
            </Button>
            <Button size="sm" loading={saving} disabled={!dirty.length} onClick={save}>
              Save{dirty.length ? ` (${dirty.length})` : ''}
            </Button>
          </div>
        )}
      </div>
      {error && <Alert variant="error" className="m-3">{error}</Alert>}
      <div className="overflow-x-auto">
        <Table caption={`Seats and attendance in ${room.room.name}`}>
          <TableHead>
            <TableRow interactive={false}>
              <TableHeaderCell>Seat</TableHeaderCell>
              <TableHeaderCell>Student</TableHeaderCell>
              <TableHeaderCell>Class · Paper</TableHeaderCell>
              <TableHeaderCell>Attendance</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {room.seats.map((seat) => (
              <TableRow key={seat.student.id} interactive={false}>
                <TableCell className="tabular-nums">{seat.seatNumber}</TableCell>
                <TableCell>
                  {seat.student.name}
                  <span className="block text-caption text-fg-muted">{seat.student.number}</span>
                </TableCell>
                <TableCell>
                  {seat.section.name}
                  <span className="block text-caption text-fg-muted">{seat.subject}</span>
                </TableCell>
                <TableCell>
                  {canEdit ? (
                    <Select
                      label={`Attendance of ${seat.student.name}`}
                      hideLabel
                      size="sm"
                      options={ATTENDANCE_OPTIONS.filter((o) => o.value || !seat.attendance)}
                      value={value(seat)}
                      onChange={(e) => setChanges((c) => ({ ...c, [seat.student.id]: e.target.value }))}
                    />
                  ) : seat.attendance ? (
                    <Badge variant={TONE[seat.attendance]}>{ATTENDANCE_OPTIONS.find((o) => o.value === seat.attendance)?.label}</Badge>
                  ) : (
                    <span className="text-fg-muted">Not taken</span>
                  )}
                  {seat.markedBy && <span className="block text-caption text-fg-muted">by {seat.markedBy}</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

/** Every room of a session with seats and attendance (School Owner and Manager). */
export function ExamAttendancePanel({ role, examId, sessionId, onNotice }) {
  const [version, setVersion] = useState(0);
  const data = useApiData(() => loadSessionAttendance(role, examId, sessionId), `exam-att|${examId}|${sessionId}|${version}`);
  if (data.status === 'error' && !data.data) return <ErrorState title="Attendance could not be loaded" description="Check your connection and try again." onRetry={data.retry} />;
  if (!data.data) return <LoadingState label="Loading seats…" />;
  if (!data.data.rooms.length) return <EmptyState icon={DoorOpen} title="No seats" description="Nobody is seated in this session." />;
  return (
    <div className="flex flex-col gap-4">
      {!data.data.canEdit && <Alert variant="info">Attendance is taken from the day of the session ({data.data.session.date}), by the room’s invigilators in the Staff app or here.</Alert>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {data.data.rooms.map((room) => (
          <RoomAttendance
            key={room.room.id}
            role={role}
            examId={examId}
            sessionId={sessionId}
            room={room}
            canEdit={data.data.canEdit}
            onSaved={(message) => {
              onNotice?.(message);
              setVersion((n) => n + 1);
            }}
          />
        ))}
      </div>
    </div>
  );
}
