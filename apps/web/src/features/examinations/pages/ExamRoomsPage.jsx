import { useState } from 'react';
import { DoorOpen, Plus } from 'lucide-react';
import { Alert, Button, Card, ConfirmModal, ErrorState, Input, Select, Table, TableActions, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableLoading, TableRow } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { StatusBadge } from '../../classes/components/ClassModals.jsx';
import { loadOwnerBranches } from '../../classes/data/classesApi.js';
import { ExamPage, useExamRole } from '../components/ExamGate.jsx';
import { RoomModal } from '../components/ExamModals.jsx';
import { loadRooms, setRoomActive } from '../data/examApi.js';

/**
 * Examinations → Rooms: rooms used for examinations, with a name and a default capacity (no
 * location). A Manager manages their branch's rooms; the School Owner any branch's.
 */
export default function ExamRoomsPage() {
  const role = useExamRole();
  const owner = role === 'OWNER';
  const [filters, setFilters] = useState({ q: '', status: 'active', branch: '' });
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const branches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `branches|${role}`);
  const list = useApiData(() => loadRooms(role, filters), JSON.stringify([filters, version]), { delayMs: 200 });
  const done = (message) => (room) => {
    setDialog(null);
    setNotice(message(room));
    setVersion((n) => n + 1);
  };
  const items = list.data?.items ?? [];
  const columns = owner ? 5 : 4;

  return (
    <ExamPage
      title="Rooms"
      description={owner ? 'Examination rooms of every branch. Each examination can set its own capacity for a room.' : 'Your branch’s examination rooms. Each examination can set its own capacity for a room.'}
      primaryAction={
        <Button leftIcon={Plus} onClick={() => setDialog({ type: 'form' })}>
          Add Room
        </Button>
      }
    >
      {() => (
        <>
          {notice && (
            <Alert variant="success" onDismiss={() => setNotice('')}>
              {notice}
            </Alert>
          )}
          <Card as="section" aria-label="Room filters" className="p-4">
            <div className={`grid grid-cols-1 gap-3 ${owner ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
              <Input type="search" label="Search rooms" placeholder="Room name…" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
              {owner && (
                <Select
                  label="Branch"
                  options={[{ value: '', label: 'All branches' }, ...(branches.data ?? []).map((b) => ({ value: b.id, label: b.name }))]}
                  value={filters.branch}
                  onChange={(e) => setFilters((f) => ({ ...f, branch: e.target.value }))}
                />
              )}
              <Select
                label="Status"
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' },
                  { value: 'all', label: 'All statuses' },
                ]}
                value={filters.status}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              />
            </div>
          </Card>
          {list.data && (
            <p className="text-small text-fg-muted" aria-live="polite">
              {list.data.totals.rooms} active room{list.data.totals.rooms === 1 ? '' : 's'}, {list.data.totals.seats} seat{list.data.totals.seats === 1 ? '' : 's'} by default.
            </p>
          )}
          <Card className="overflow-hidden">
            {list.status === 'error' && !list.data ? (
              <ErrorState title="Rooms could not be loaded" description="Check your connection and try again." onRetry={list.retry} />
            ) : (
              <div role="region" aria-label="Rooms" tabIndex={0} className="overflow-x-auto">
                <Table caption="Examination rooms by name">
                  <TableHead>
                    <TableRow interactive={false}>
                      <TableHeaderCell>Room</TableHeaderCell>
                      {owner && <TableHeaderCell>Branch</TableHeaderCell>}
                      <TableHeaderCell>Default Capacity</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell align="right">Actions</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {!list.data && <TableLoading columns={columns} />}
                    {list.data && !items.length && (
                      <TableEmpty
                        columns={columns}
                        icon={DoorOpen}
                        title={filters.q || filters.status !== 'active' || filters.branch ? 'No rooms found' : 'No rooms yet'}
                        description="Add the rooms used for examinations, e.g. R1 with 40 seats."
                      />
                    )}
                    {items.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        {owner && <TableCell className="text-fg-secondary">{r.branch.name}</TableCell>}
                        <TableCell className="tabular-nums">{r.defaultCapacity}</TableCell>
                        <TableCell><StatusBadge status={r.status} /></TableCell>
                        <TableCell align="right">
                          <TableActions>
                            <Button size="sm" variant="outline" onClick={() => setDialog({ type: 'form', room: r })}>Edit</Button>
                            <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'status', room: r })}>{r.status === 'active' ? 'Deactivate' : 'Reactivate'}</Button>
                          </TableActions>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
          <RoomModal
            role={role}
            room={dialog?.room}
            branches={(branches.data ?? []).filter((b) => b.status === 'active' || !b.status)}
            defaultBranch={filters.branch}
            open={dialog?.type === 'form'}
            onClose={() => setDialog(null)}
            onSaved={done((r) => `${r.name} was saved.`)}
          />
          <ConfirmModal
            open={dialog?.type === 'status'}
            onClose={() => setDialog(null)}
            title={`${dialog?.room?.status === 'active' ? 'Deactivate' : 'Reactivate'} ${dialog?.room?.name ?? ''}?`}
            description={dialog?.room?.status === 'active' ? 'It is no longer offered for new examination timetables. Seating already planned is kept.' : 'It is offered for examination timetables again.'}
            confirmLabel={dialog?.room?.status === 'active' ? 'Deactivate' : 'Reactivate'}
            variant={dialog?.room?.status === 'active' ? 'danger' : 'secondary'}
            run={() => setRoomActive(role, dialog.room.id, dialog.room.status !== 'active')}
            onDone={done((r) => `${r.name} is now ${r.status}.`)}
          />
        </>
      )}
    </ExamPage>
  );
}
