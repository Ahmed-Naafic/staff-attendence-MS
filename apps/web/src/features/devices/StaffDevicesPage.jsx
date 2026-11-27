import { useState } from 'react';
import { History, Smartphone } from 'lucide-react';
import { useSession } from '../auth/SessionProvider.jsx';
import { PageContainer } from '../../components/layout/PageContainer.jsx';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert, Badge, Button, Card, CardHeader, ConfirmModal, ErrorState, Input, Modal, Table, TableActions, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableLoading, TableRow } from '../../components/ui';
import { useApiData } from '../../hooks/useApiData.js';
import { apiRequest } from '../../lib/api.js';

/*
 * Staff → Staff Devices (School Owner: every mobile account of the school; Manager: the staff and
 * Accountants of their branch; docs/mobile/devices.md). Each account uses at most three phones.
 * Approve or refuse a request for another phone, revoke a phone (signed out at once), or report it
 * lost or stolen: it is blocked and everything EduTrack keeps on it is deleted when it next connects
 * (requested → delivered → completed). One administrator decides; a wipe is never cancelled.
 * Every action needs a reason where it removes access, and is audited by the server.
 */
const STATUS = { active: ['Active', 'success'], revoked: ['Revoked', 'warning'], lost: ['Lost or stolen', 'error'] };
const WIPE = { requested: 'Wipe requested', delivered: 'Wipe delivered', completed: 'Wiped' };
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export default function StaffDevicesPage() {
  const { user } = useSession();
  const base = user.role === 'OWNER' ? '/owner' : '/manager';
  const [version, setVersion] = useState(0);
  const data = useApiData(() => apiRequest(`${base}/devices`), `devices|${base}|${version}`);
  const [dialog, setDialog] = useState(null); // { kind: 'revoke' | 'wipe' | 'approve' | 'reject', item }
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState(null);
  const [history, setHistory] = useState(null);
  const refresh = (text) => {
    setDialog(null);
    setReason('');
    setNotice(text);
    setVersion((n) => n + 1);
  };
  const openHistory = async (device) => {
    setHistory({ device, events: null });
    try {
      setHistory({ device, events: (await apiRequest(`${base}/devices/${device.id}/history`)).events });
    } catch {
      setHistory({ device, events: [] });
    }
  };

  const d = data.data;
  return (
    <PageContainer>
      <PageHeader
        title="Staff Devices"
        description={`Phones used for the EduTrack mobile app: at most ${d?.max ?? 3} per person. ${user.role === 'OWNER' ? 'Every branch of your school.' : 'Staff and Accountants of your branch.'}`}
      />
      <div className="flex flex-col gap-6">
        {notice && <Alert variant="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}
        {data.status === 'error' && !d && <ErrorState title="Devices could not be loaded" onRetry={data.retry} />}

        {d?.requests?.length > 0 && (
          <Card className="overflow-hidden">
            <CardHeader title="Requests for another phone" description="These accounts already use three phones and asked to use one more." />
            <div className="mt-3 overflow-x-auto">
              <Table caption="Requests for another phone">
                <TableHead>
                  <TableRow interactive={false}>
                    <TableHeaderCell>Person</TableHeaderCell>
                    <TableHeaderCell>Phone</TableHeaderCell>
                    <TableHeaderCell>Asked</TableHeaderCell>
                    <TableHeaderCell align="right">Actions</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {d.requests.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.user.name}<span className="block text-caption text-fg-muted">{r.user.staffId ?? r.user.role}</span></TableCell>
                      <TableCell>{[r.name, r.model].filter(Boolean).join(' · ')}</TableCell>
                      <TableCell>{when(r.requestedAt)}</TableCell>
                      <TableCell align="right">
                        <TableActions>
                          <Button size="sm" onClick={() => setDialog({ kind: 'approve', item: r })}>Approve</Button>
                          <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'reject', item: r })}>Refuse</Button>
                        </TableActions>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}

        <Card className="overflow-hidden">
          <CardHeader title="Registered phones" description="A phone is registered the first time someone signs in on it with the mobile app." />
          <div className="mt-3 overflow-x-auto">
            <Table caption="Registered phones">
              <TableHead>
                <TableRow interactive={false}>
                  <TableHeaderCell>Person</TableHeaderCell>
                  <TableHeaderCell>Phone</TableHeaderCell>
                  <TableHeaderCell>Registered</TableHeaderCell>
                  <TableHeaderCell>Last active</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell align="right">Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {!d && data.status !== 'error' && <TableLoading columns={6} />}
                {d && !d.devices.length && <TableEmpty columns={6} icon={Smartphone} title="No registered phones" description="Phones appear after their first sign-in in the mobile app." />}
                {d?.devices.map((dev) => {
                  const [label, tone] = STATUS[dev.status] ?? [dev.status, 'neutral'];
                  return (
                    <TableRow key={dev.id}>
                      <TableCell className="font-medium">{dev.user?.name}<span className="block text-caption text-fg-muted">{dev.user?.staffId ?? dev.user?.role}</span></TableCell>
                      <TableCell>{dev.name}<span className="block text-caption text-fg-muted">{[dev.platform, dev.model, dev.appVersion && `app ${dev.appVersion}`].filter(Boolean).join(' · ')}</span></TableCell>
                      <TableCell>{when(dev.registeredAt)}</TableCell>
                      <TableCell>{when(dev.lastSeenAt)}</TableCell>
                      <TableCell>
                        <Badge variant={tone}>{label}</Badge>
                        {dev.wipe && <span className="block text-caption text-error-fg">{WIPE[dev.wipe.state]}</span>}
                      </TableCell>
                      <TableCell align="right">
                        <TableActions>
                          <Button size="sm" variant="ghost" leftIcon={History} onClick={() => openHistory(dev)}>History</Button>
                          {dev.status === 'active' && <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'revoke', item: dev })}>Revoke</Button>}
                          {dev.status === 'active' && <Button size="sm" variant="danger" onClick={() => setDialog({ kind: 'wipe', item: dev })}>Lost or stolen</Button>}
                        </TableActions>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

      <ConfirmModal
        open={dialog?.kind === 'approve' || dialog?.kind === 'reject'}
        onClose={() => setDialog(null)}
        title={dialog?.kind === 'approve' ? `Approve another phone for ${dialog?.item.user.name}?` : `Refuse this phone for ${dialog?.item?.user.name ?? ''}?`}
        description={dialog?.kind === 'approve' ? 'The phone is registered the next time they sign in on it.' : 'They keep using their registered phones.'}
        confirmLabel={dialog?.kind === 'approve' ? 'Approve' : 'Refuse'}
        variant="primary"
        run={() => apiRequest(`${base}/device-requests/${dialog.item.id}/${dialog.kind}`, { method: 'POST', body: {} })}
        onDone={() => refresh(dialog?.kind === 'approve' ? 'Phone approved.' : 'Request refused.')}
      />

      <ConfirmModal
        open={dialog?.kind === 'revoke' || dialog?.kind === 'wipe'}
        onClose={() => setDialog(null)}
        title={dialog?.kind === 'wipe' ? `Report ${dialog?.item.name} lost or stolen?` : `Revoke ${dialog?.item?.name ?? ''}?`}
        description={
          dialog?.kind === 'wipe'
            ? 'The phone is signed out and blocked now. Everything EduTrack keeps on it, including records not yet uploaded, is deleted when it next connects. This cannot be cancelled.'
            : 'The phone is signed out now and cannot be used with this registration again.'
        }
        confirmLabel={dialog?.kind === 'wipe' ? 'Report and wipe' : 'Revoke'}
        run={() => {
          if (!reason.trim()) return Promise.reject(Object.assign(new Error('Give a reason.'), { status: 400 }));
          return apiRequest(`${base}/devices/${dialog.item.id}/${dialog.kind}`, { method: 'POST', body: { reason: reason.trim() } });
        }}
        onDone={() => refresh(dialog?.kind === 'wipe' ? 'Reported lost; the remote wipe is registered.' : 'Phone revoked.')}
      >
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmModal>

      <Modal open={Boolean(history)} onClose={() => setHistory(null)} title={`Security history · ${history?.device.name ?? ''}`} size="md">
        {!history?.events ? (
          <p className="text-fg-muted">Loading…</p>
        ) : history.events.length ? (
          <ul className="flex flex-col gap-3">
            {history.events.map((e) => (
              <li key={e.id} className="border-b border-border pb-2 last:border-0">
                <p className="font-medium">{e.description}</p>
                <p className="text-caption text-fg-muted">{`${when(e.at)}${e.by ? ` · ${e.by}` : ''}`}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-fg-muted">No events recorded.</p>
        )}
      </Modal>
    </PageContainer>
  );
}
