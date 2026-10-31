/*
 * Test harness: the app's providers and navigation (as in App.js) with a fake EduTrack API
 * (`server`) whose routes return the shapes of the real backend. These are UI tests with mocked
 * responses; they do not prove integration with the real backend.
 */
import { NavigationContainer } from '@react-navigation/native';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '../auth/SessionProvider';
import { localDate } from '../lib/format';
import RootNavigator from '../navigation/RootNavigator';
import { ThemeProvider } from '../theme/ThemeProvider';

export const ZONE = 'Africa/Mogadishu';
export const BRANCH = { latitude: 2.046934, longitude: 45.318162 };
export const STAFF = { id: 'staff-1', name: 'Ayaan Ahmed', role: 'STAFF', mustChangePassword: false };
export const TOKEN = 'tok_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';

export const profileBody = () => ({
  name: 'Ayaan Ahmed',
  staffId: 'CIT-001-B001-ST001',
  phone: '0612345678',
  jobTitle: 'Teaching Assistant',
  email: null,
  branch: { code: 'CIT-001-B001', name: 'Main Campus' },
  school: { code: 'CIT-001', name: 'City International School' },
});

export const todayBody = (extra = {}) => ({
  date: localDate(new Date(), ZONE),
  timeZone: ZONE,
  checkOutEnabled: true,
  // An all-day shift, so check-in is open whenever the tests run.
  shifts: [{ key: 'main', name: 'Main Shift', start: '00:00', end: '23:59', checkInOpensAt: '00:00', lateAfter: '23:58' }],
  events: [],
  branchLocation: { ...BRANCH, effectiveFrom: '2026-01-01T00:00:00.000Z' },
  scheduledBranchLocation: null,
  ...extra,
});

export const recordedEvent = (body, extra = {}) => ({
  id: `srv-${body.clientEventId}`,
  clientEventId: body.clientEventId,
  type: body.type,
  occurredAt: body.occurredAt,
  receivedAt: body.sentAt,
  workDate: localDate(new Date(body.occurredAt), ZONE),
  shift: { key: 'main', name: 'Main Shift', start: '00:00', end: '23:59' },
  status: body.type === 'CHECK_IN' ? 'PRESENT' : null,
  distanceMeters: 28.4,
  checkInEventId: null,
  ...extra,
});

/** The staff member's notification preferences as the server computes them (reminders within the limits). */
export const preferencesBody = (extra = {}) => ({
  categories: [
    { key: 'MISSING_CHECK_OUT', mandatory: false, enabled: true },
    { key: 'ASSIGNMENT', mandatory: false, enabled: true },
    { key: 'SCHEDULE', mandatory: false, enabled: true },
    { key: 'STATUS', mandatory: true, enabled: true },
    { key: 'ANNOUNCEMENT', mandatory: true, enabled: true },
  ],
  push: { available: true, enabled: true },
  reminders: {
    checkIn: { available: true, enabled: true, leadMinutes: 15, min: 0, max: 30, adjustable: true, consented: false },
    checkOut: { available: true, enabled: true, leadMinutes: 10, min: 0, max: 60, adjustable: true },
    upload: { available: true, enabled: true },
  },
  branchOperating: true,
  locationConsentAt: null,
  ...extra,
});

/**
 * A fake API. `routes` maps 'METHOD /path' (no query) to handler({ body, headers, url }) →
 * [status, body] or throws (network failure). Requests are recorded in `server.calls`.
 */
export function createServer(routes = {}) {
  const server = {
    calls: [],
    routes: {
      'GET /api/auth/session': () => [200, { user: STAFF }],
      'POST /api/auth/logout': () => [204],
      'GET /api/attendance/today': () => [200, todayBody()],
      'GET /api/attendance/profile': () => [200, profileBody()],
      'GET /api/attendance/history': () => [200, { from: '2026-10-26', to: '2026-10-27', events: [] }],
      'POST /api/attendance/events': ({ body }) => [201, { event: recordedEvent(body) }],
      'GET /api/notifications/unread-count': () => [200, { unreadCount: 0 }],
      'GET /api/notifications/preferences': () => [200, preferencesBody()],
      'GET /api/notifications': () => [200, { items: [], total: 0, page: 1, pageSize: 30, pageCount: 1, unreadCount: 0 }],
      'POST /api/notifications/devices': () => [201, { registered: true }],
      'DELETE /api/notifications/devices/current': () => [204],
      ...routes,
    },
  };
  server.fetch = jest.fn(async (url, init = {}) => {
    const path = url.replace('http://api.test', '').split('?')[0];
    const key = `${init.method ?? 'GET'} ${path}`;
    const body = init.body ? JSON.parse(init.body) : undefined;
    server.calls.push({ key, body, headers: init.headers, url });
    const handler = server.routes[key];
    if (!handler) return { ok: false, status: 404, text: async () => JSON.stringify({ error: 'Not found.', code: 'NOT_FOUND' }) };
    const [status, data] = await handler({ body, headers: init.headers, url });
    return { ok: status >= 200 && status < 300, status, text: async () => (data === undefined ? '' : JSON.stringify(data)) };
  });
  server.count = (key) => server.calls.filter((c) => c.key === key).length;
  return server;
}

export const networkDown = () => {
  throw new TypeError('Network request failed');
};

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

export function renderApp(server) {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <SessionProvider baseUrl="http://api.test" fetchImpl={server.fetch} timeoutMs={1000}>
          <NavigationContainer>
            <RootNavigator />
          </NavigationContainer>
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

/** A stored session, as after an earlier sign-in. */
export function storeSession(user = STAFF) {
  global.__secureStore.set('edutrack.session.token', TOKEN);
  global.__secureStore.set('edutrack.session.account', JSON.stringify(user));
}
