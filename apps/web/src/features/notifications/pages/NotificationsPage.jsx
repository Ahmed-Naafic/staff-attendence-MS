import { useCallback, useEffect, useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Bell, CheckCheck } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Button, Card, EmptyState, ErrorState, LoadingState, Pagination, Select, TabPanel, Tabs } from '../../../components/ui';
import { useSession } from '../../auth/SessionProvider.jsx';
import { BranchRemindersPanel } from '../components/BranchRemindersPanel.jsx';
import { NotificationDetail } from '../components/NotificationDetail.jsx';
import { NotificationRow } from '../components/NotificationRow.jsx';
import { PreferencesPanel } from '../components/PreferencesPanel.jsx';
import { loadNotifications, loadPreferences, markAllNotificationsRead, markNotificationRead } from '../data/notificationsApi.js';
import { announceNotificationsChanged } from '../hooks/useUnreadCount.js';
import { allRead, categoryOptions, withRead } from '../utils/notificationRules.js';

const PAGE_SIZE = 20;
const SHOW = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
];

/**
 * Notification centre for School Owners and Managers: the history of the last 90 days (newest
 * first, filterable), details, mark read / mark all read, preferences and — for Managers — the
 * reminder settings of their branch. What appears is decided by the server (own notifications; a
 * Manager's current branch only; announcements for the role and school).
 */
export default function NotificationsPage() {
  const tabsId = useId();
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = ['inbox', 'preferences', 'reminders'].includes(params.get('tab')) ? params.get('tab') : 'inbox';
  const tabs = [
    { value: 'inbox', label: 'Notifications' },
    { value: 'preferences', label: 'Preferences' },
    ...(user.role === 'MANAGER' ? [{ value: 'reminders', label: 'Staff reminders' }] : []),
  ];
  const show = params.get('show') === 'unread' ? 'unread' : 'all';
  const category = params.get('category') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [state, setState] = useState({ status: 'loading', data: null });
  const [categories, setCategories] = useState([]);
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState(null);

  const update = useCallback(
    (changes) =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        for (const [k, v] of Object.entries(changes)) (v ? next.set(k, String(v)) : next.delete(k));
        if (!('page' in changes)) next.delete('page');
        return next;
      }),
    [setParams],
  );

  const reload = useCallback(
    (signal) => {
      setState((s) => ({ ...s, status: 'loading' }));
      return loadNotifications({ page, pageSize: PAGE_SIZE, unread: show === 'unread', category: category || undefined }, signal)
        .then((data) => setState({ status: 'ready', data }))
        .catch((error) => error.name !== 'AbortError' && setState({ status: 'error', data: null }));
    },
    [page, show, category],
  );

  useEffect(() => {
    if (tab !== 'inbox') return undefined;
    const controller = new AbortController();
    reload(controller.signal);
    return () => controller.abort();
  }, [reload, tab]);

  useEffect(() => {
    const controller = new AbortController();
    loadPreferences(controller.signal)
      .then((data) => setCategories(data.categories))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // ?item=source:id (from the bell) opens that item's details once the list has loaded.
  const itemParam = params.get('item');
  useEffect(() => {
    if (!itemParam || state.status !== 'ready') return;
    const [source, id] = itemParam.split(':');
    const found = state.data.items.find((i) => i.source === source && i.id === id);
    if (found) setSelected(found);
    update({ item: '', page: page > 1 ? page : '' });
    // Once per link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemParam, state.status]);

  async function open(item) {
    setSelected(item);
    if (item.readAt) return;
    try {
      const read = await markNotificationRead(item);
      setState((s) => ({ ...s, data: { ...s.data, items: withRead(s.data.items, read), unreadCount: Math.max(0, s.data.unreadCount - 1) } }));
      announceNotificationsChanged();
    } catch {
      // The details still open; the item stays unread.
    }
  }

  async function readAll() {
    setNotice(null);
    try {
      await markAllNotificationsRead();
      setState((s) => ({ ...s, data: { ...s.data, items: allRead(s.data.items), unreadCount: 0 } }));
      announceNotificationsChanged();
      setNotice({ variant: 'success', text: 'All notifications are marked as read.' });
    } catch (error) {
      if (error.status !== 401) setNotice({ variant: 'error', text: error.message });
    }
  }

  const data = state.data;
  return (
    <PageContainer>
      <PageHeader
        title="Notifications"
        description="Your notifications of the last 90 days. Notification texts are in Somali."
        primaryAction={
          tab === 'inbox' && (
            <Button variant="outline" leftIcon={CheckCheck} onClick={readAll} disabled={!data || data.unreadCount === 0}>
              Mark all as read
            </Button>
          )
        }
      />
      <Tabs id={tabsId} label="Notification sections" tabs={tabs} value={tab} onChange={(value) => setParams(value === 'inbox' ? {} : { tab: value })} />
      <TabPanel tabsId={tabsId} value={tab} className="flex flex-col gap-4">
        {tab === 'inbox' && (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Select label="Show" options={SHOW} value={show} onChange={(e) => update({ show: e.target.value === 'all' ? '' : e.target.value })} fieldClassName="sm:w-40" />
              <Select label="Category" options={categoryOptions(categories)} value={category} onChange={(e) => update({ category: e.target.value })} fieldClassName="sm:w-72" />
              {data && <p className="text-small text-fg-muted sm:ml-auto sm:pb-2">{data.unreadCount} unread</p>}
            </div>
            {notice && (
              <Alert variant={notice.variant} onDismiss={() => setNotice(null)}>
                {notice.text}
              </Alert>
            )}
            <Card className="overflow-hidden p-0">
              {state.status === 'loading' && !data && <LoadingState label="Loading notifications…" />}
              {state.status === 'error' && <ErrorState title="Notifications could not be loaded" description="Check your connection and try again." onRetry={() => reload()} />}
              {data && state.status !== 'error' && data.items.length === 0 && (
                <EmptyState icon={Bell} title={show === 'unread' ? 'No unread notifications' : 'No notifications'} description="New notifications will appear here." />
              )}
              {data && state.status !== 'error' && data.items.length > 0 && (
                <>
                  <ul className="divide-y divide-border-subtle" aria-busy={state.status === 'loading' || undefined}>
                    {data.items.map((item) => (
                      <li key={`${item.source}:${item.id}`}>
                        <NotificationRow item={item} onOpen={() => open(item)} />
                      </li>
                    ))}
                  </ul>
                  <Pagination page={data.page} pageSize={PAGE_SIZE} total={data.total} onPageChange={(p) => update({ page: p })} itemLabel="notifications" />
                </>
              )}
            </Card>
          </>
        )}
        {tab === 'preferences' && <PreferencesPanel />}
        {tab === 'reminders' && user.role === 'MANAGER' && <BranchRemindersPanel />}
      </TabPanel>
      <NotificationDetail item={selected} role={user.role} onClose={() => setSelected(null)} />
    </PageContainer>
  );
}
