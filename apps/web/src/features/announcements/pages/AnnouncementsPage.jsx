import { useCallback, useEffect, useState } from 'react';
import { Megaphone, Plus } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import {
  Alert,
  Badge,
  Button,
  Card,
  DropdownMenu,
  Input,
  Modal,
  Pagination,
  Select,
  Table,
  TableActions,
  TableBody,
  TableCell,
  TableContainer,
  TableEmpty,
  TableError,
  TableHead,
  TableHeaderCell,
  TableLoading,
  TableRow,
} from '../../../components/ui';
import { formatDateTime } from '../../../lib/format.js';
import { AnnouncementFormModal } from '../components/AnnouncementFormModal.jsx';
import { loadAnnouncements, publishAnnouncement, withdrawAnnouncement } from '../data/announcementsApi.js';
import { actionsFor, audienceText, kindLabel, statusBadge, STATUS_FILTERS } from '../utils/announcementRules.js';

const PAGE_SIZE = 10;
const COLUMNS = 7;
const DONE = { publish: 'Announcement published.', schedule: 'Announcement scheduled.', draft: 'Draft saved.', edit: 'Announcement saved.' };

/**
 * Super Admin: platform announcements (N17). Create, edit, publish now or schedule, withdraw, with
 * the audience (School Owners, Managers, Staff; all or selected schools) and an expiry. Each action
 * is recorded in the audit log by the server.
 */
export default function AnnouncementsPage() {
  const [filters, setFilters] = useState({ status: '', q: '', page: 1 });
  const [state, setState] = useState({ status: 'loading', data: null });
  const [editing, setEditing] = useState(null); // null | 'new' | announcement
  const [confirm, setConfirm] = useState(null); // { kind: 'withdraw' | 'publish', announcement }
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const reload = useCallback(
    (signal) => {
      setState((s) => ({ ...s, status: 'loading' }));
      return loadAnnouncements({ status: filters.status || undefined, q: filters.q.trim() || undefined, page: filters.page, pageSize: PAGE_SIZE }, signal)
        .then((data) => setState({ status: 'ready', data }))
        .catch((error) => error.name !== 'AbortError' && setState({ status: 'error', data: null }));
    },
    [filters],
  );
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => reload(controller.signal), 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [reload]);

  async function runConfirmed() {
    setBusy(true);
    try {
      if (confirm.kind === 'withdraw') await withdrawAnnouncement(confirm.announcement.id);
      else await publishAnnouncement(confirm.announcement.id);
      setNotice({ variant: 'success', text: confirm.kind === 'withdraw' ? 'Announcement withdrawn. It is no longer shown.' : 'Announcement published.' });
      setConfirm(null);
      reload();
    } catch (error) {
      if (error.status !== 401) setNotice({ variant: 'error', text: error.details?.expiresAt ?? error.message });
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  const data = state.data;
  return (
    <PageContainer>
      <PageHeader
        title="Announcements"
        description="Messages to School Owners, Managers and Staff in their notification centres. Write them in Somali."
        primaryAction={
          <Button leftIcon={Plus} onClick={() => setEditing('new')}>
            New announcement
          </Button>
        }
      />
      {notice && (
        <Alert variant={notice.variant} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-border-subtle p-4 sm:flex-row sm:items-end">
          <Input label="Search" type="search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value, page: 1 })} fieldClassName="sm:w-72" />
          <Select label="Status" options={STATUS_FILTERS} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })} fieldClassName="sm:w-48" />
        </div>
        <TableContainer label="Announcements">
          <Table caption="Announcements">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Title</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Audience</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Publish</TableHeaderCell>
                <TableHeaderCell>Expires</TableHeaderCell>
                <TableHeaderCell align="right">
                  <span className="sr-only">Actions</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {state.status === 'loading' && !data && <TableLoading columns={COLUMNS} />}
              {state.status === 'error' && <TableError columns={COLUMNS} title="Announcements could not be loaded" onRetry={() => reload()} />}
              {data && state.status !== 'error' && data.items.length === 0 && (
                <TableEmpty columns={COLUMNS} icon={Megaphone} title="No announcements" description={filters.status || filters.q ? 'Nothing matches these filters.' : 'Create the first announcement.'} />
              )}
              {data &&
                state.status !== 'error' &&
                data.items.map((a) => {
                  const badge = statusBadge(a.status);
                  const can = actionsFor(a.status);
                  return (
                    <TableRow key={a.id} interactive={false}>
                      <TableCell>
                        <span lang={a.language} className="font-medium text-fg">
                          {a.title}
                        </span>
                      </TableCell>
                      <TableCell>{kindLabel(a.kind)}</TableCell>
                      <TableCell>{audienceText(a)}</TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{a.publishAt ? formatDateTime(a.publishAt) : '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDateTime(a.expiresAt)}</TableCell>
                      <TableCell align="right">
                        <TableActions>
                          <DropdownMenu
                            label={`Actions for ${a.title}`}
                            items={[
                              { label: 'Edit', onSelect: () => setEditing(a), disabled: !can.edit },
                              { label: 'Publish now', onSelect: () => setConfirm({ kind: 'publish', announcement: a }), disabled: !can.publish },
                              { type: 'separator' },
                              { label: 'Withdraw', destructive: true, onSelect: () => setConfirm({ kind: 'withdraw', announcement: a }), disabled: !can.withdraw },
                            ]}
                          />
                        </TableActions>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </TableContainer>
        {data && data.total > 0 && <Pagination page={data.page} pageSize={PAGE_SIZE} total={data.total} onPageChange={(page) => setFilters({ ...filters, page })} itemLabel="announcements" />}
      </Card>

      {editing && (
        <AnnouncementFormModal
          announcement={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, action) => {
            setEditing(null);
            setNotice({ variant: 'success', text: DONE[action] ?? 'Saved.' });
            reload();
          }}
        />
      )}
      {confirm && (
        <Modal
          open
          size="sm"
          onClose={() => setConfirm(null)}
          loading={busy}
          loadingLabel={confirm.kind === 'withdraw' ? 'Withdrawing…' : 'Publishing…'}
          title={confirm.kind === 'withdraw' ? 'Withdraw announcement?' : 'Publish announcement now?'}
          description={
            confirm.kind === 'withdraw'
              ? 'It disappears from every notification centre at once and cannot be shown again.'
              : 'It is shown at once to everyone in its audience until it expires.'
          }
          footer={
            <>
              <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant={confirm.kind === 'withdraw' ? 'danger' : 'primary'} onClick={runConfirmed} loading={busy}>
                {confirm.kind === 'withdraw' ? 'Withdraw' : 'Publish'}
              </Button>
            </>
          }
        >
          <p lang={confirm.announcement.language} className="text-body text-fg">
            {confirm.announcement.title}
          </p>
        </Modal>
      )}
    </PageContainer>
  );
}
