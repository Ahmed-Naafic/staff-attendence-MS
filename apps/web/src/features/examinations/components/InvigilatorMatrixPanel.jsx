import { useState } from 'react';
import { CalendarDays, Grid3x3, List, UserCheck } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorState, LoadingState, Select, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableRow } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { downloadInvigilatorMatrix, loadInvigilatorMatrix } from '../data/examApi.js';
import { DownloadButton } from './DownloadButton.jsx';

/** One assignment: the room number as a chip (rooms of a day in session order). */
const Duty = ({ duty }) => (
  <li>
    <Badge variant="accent">{duty.room.name}</Badge>
  </li>
);

/**
 * Invigilators: staff names × examination days, each cell the room numbers of that day (one chip per room).
 * Filters (shift, session of the day, dates) apply to the page and to the PDF and Excel exports.
 * `editor`: the per-room list where invigilators are changed (kept as a second view).
 */
export function InvigilatorMatrixPanel({ role, examId, branch, version, editor, onNotice }) {
  const [view, setView] = useState('matrix');
  const [filters, setFilters] = useState({ shift: '', session: '', from: '', to: '' });
  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const data = useApiData(() => loadInvigilatorMatrix(role, examId, branch, filters), `inv|${examId}|${branch}|${JSON.stringify(filters)}|${version}`);
  const m = data.data;
  const o = m?.options;
  const any = (label) => [{ value: '', label }];

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div role="group" aria-label="View" className="inline-flex rounded-md border border-border p-0.5">
          <Button size="sm" variant={view === 'matrix' ? 'secondary' : 'ghost'} leftIcon={Grid3x3} aria-pressed={view === 'matrix'} onClick={() => setView('matrix')}>By staff and day</Button>
          <Button size="sm" variant={view === 'rooms' ? 'secondary' : 'ghost'} leftIcon={List} aria-pressed={view === 'rooms'} onClick={() => setView('rooms')}>By room (change)</Button>
        </div>
        {view === 'matrix' && m && (
          <div className="flex flex-wrap gap-2">
            <DownloadButton load={() => downloadInvigilatorMatrix(role, examId, branch, filters, 'pdf')} onError={onNotice} disabled={!m.rows.length}>PDF</DownloadButton>
            <DownloadButton load={() => downloadInvigilatorMatrix(role, examId, branch, filters, 'xlsx')} onError={onNotice} disabled={!m.rows.length}>Excel</DownloadButton>
          </div>
        )}
      </div>

      {view === 'rooms' ? (
        editor
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Select label="Shift" options={[...any('All shifts'), ...(o?.shifts ?? []).map((x) => ({ value: x, label: x }))]} value={filters.shift} onChange={set('shift')} disabled={!o} />
            <Select label="Session" options={[...any('All sessions'), ...(o?.sessions ?? []).map((x) => ({ value: String(x), label: `Session ${x}` }))]} value={filters.session} onChange={set('session')} disabled={!o} />
            <Select label="From" options={[...any('First day'), ...(o?.dates ?? []).filter((d) => !filters.to || d <= filters.to).map((d) => ({ value: d, label: d }))]} value={filters.from} onChange={set('from')} disabled={!o} />
            <Select label="To" options={[...any('Last day'), ...(o?.dates ?? []).filter((d) => !filters.from || d >= filters.from).map((d) => ({ value: d, label: d }))]} value={filters.to} onChange={set('to')} disabled={!o} />
          </div>
          {data.status === 'error' && !m ? (
            <ErrorState title="The invigilators could not be loaded" description="Check your connection and try again." onRetry={data.retry} />
          ) : !m ? (
            <LoadingState label="Loading the invigilators…" />
          ) : !m.days.length ? (
            <EmptyState icon={CalendarDays} title="No sessions for these filters" description="Choose another shift, session or dates." />
          ) : (
            <>
              <p className="text-small text-fg-secondary">
                {m.summary.staff} staff member{m.summary.staff === 1 ? '' : 's'} · {m.summary.duties} dut{m.summary.duties === 1 ? 'y' : 'ies'} · {m.summary.days} day{m.summary.days === 1 ? '' : 's'}
                {m.summary.roomsShort > 0 && <span className="text-error-fg"> · {m.summary.roomsShort} room{m.summary.roomsShort === 1 ? '' : 's'} without enough invigilators</span>}
              </p>
              <div role="region" aria-label="Invigilators by staff member and day" tabIndex={0} className="overflow-x-auto rounded-md border border-border">
                <Table caption="Rooms each staff member invigilates, by day">
                  <TableHead>
                    <TableRow interactive={false}>
                      <TableHeaderCell className="sticky left-0 z-10 bg-surface">Staff name</TableHeaderCell>
                      {m.days.map((d) => (
                        <TableHeaderCell key={d.date} className="whitespace-nowrap">
                          {d.weekday}
                          <span className="block text-caption font-normal text-fg-muted tabular-nums">{d.date}</span>
                        </TableHeaderCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {!m.rows.length && <TableEmpty columns={m.days.length + 1} icon={UserCheck} title="No invigilators assigned" description="Assign them in the By room view." />}
                    {m.rows.map((row) => (
                      <TableRow key={row.staff.id} interactive={false}>
                        <TableCell className="sticky left-0 z-10 bg-surface align-top font-medium text-fg">{row.staff.name}</TableCell>
                        {m.days.map((d) => {
                          const list = row.cells[d.date];
                          return (
                            <TableCell key={d.date} className="align-top">
                              {list?.length ? (
                                <ul className="flex flex-wrap gap-1.5" aria-label={`${row.staff.name} on ${d.weekday}`}>
                                  {list.map((x) => <Duty key={`${x.sessionId}-${x.room.id}`} duty={x} />)}
                                </ul>
                              ) : (
                                <span className="text-caption text-fg-muted">No duty</span>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
