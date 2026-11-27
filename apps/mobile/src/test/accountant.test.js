/*
 * Workspaces and the Accountant workspace with a mocked API: which workspaces an account gets, the
 * switch warning for waiting records, the fee dashboard, an online payment with its request key,
 * and that payments are never recorded or queued offline. UI tests with mocked responses: the fee
 * rules themselves are tested on the server (backend/test/fees.test.js).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { getDatabase, resetDatabaseForTests } from '../db/database';
import { createServer, networkDown, renderApp, STAFF, storeSession } from './harness';

const ACCOUNTANT = { id: 'acc-1', name: 'Hodan Ali', role: 'ACCOUNTANT', mustChangePassword: false, theme: 'light' };
const overview = () => ({
  currency: 'USD',
  academicYear: { id: 'y1', name: '2026-2027' },
  today: '2026-11-27',
  kpis: { expected: 100000, collected: 60000, outstanding: 40000, overdue: 15000, rate: 6000, discounts: 0, students: 20, receivedToday: 2500, paymentsToday: 2 },
  overdueStudents: [{ id: 'st1', name: 'Amina Hassan', studentNumber: 'S1', class: 'Grade 7A', overdue: 15000, oldestDue: '2026-10-05', daysOverdue: 53 }],
});
const closing = () => ({ currency: 'USD', today: '2026-11-27', open: { since: null, paymentsCount: 2, reversalsCount: 0, recordedAmount: 2500, reversedAmount: 0, expectedAmount: 2500, payments: [], reversals: [] }, closedToday: false, recent: [] });
const payable = () => ({
  currency: 'USD',
  policy: { allowPartial: true, minimumPartial: 0 },
  student: { id: 'st1', name: 'Amina Hassan', studentNumber: 'S1' },
  items: [
    { id: 'o1', kind: 'monthly', title: 'October', period: 'October 2026', dueDate: '2026-10-05', netAmount: 5000, paidAmount: 0, balance: 5000, overdue: true },
    { id: 'o2', kind: 'monthly', title: 'November', period: 'November 2026', dueDate: '2026-11-05', netAmount: 5000, paidAmount: 0, balance: 5000, overdue: false },
  ],
  totals: { outstanding: 10000, overdue: 5000, partlyPaid: 0 },
});
const feeRoutes = (base, extra = {}) => ({
  [`GET ${base}/overview`]: () => [200, overview()],
  [`GET ${base}/closings/mine`]: () => [200, closing()],
  [`GET ${base}/students/st1/payable`]: () => [200, payable()],
  [`GET ${base}/payments`]: () => [200, { items: [], total: 0 }],
  ...extra,
});

beforeEach(() => {
  global.__secureStore.clear();
  resetDatabaseForTests();
});

test('an Accountant gets the Accountant workspace only, with the fee dashboard', async () => {
  storeSession(ACCOUNTANT);
  const server = createServer({ 'GET /api/auth/session': () => [200, { user: ACCOUNTANT }], 'GET /api/accountant/branch': () => [200, { branch: { id: 'b1', code: 'B1', name: 'Main Campus' } }], ...feeRoutes('/api/accountant/fees') });
  await renderApp(server);
  expect(await screen.findByText('Received today (2)')).toBeOnTheScreen();
  expect(screen.getByText('$600.00')).toBeOnTheScreen();
  expect(screen.getByText(/Live · Updated/)).toBeOnTheScreen();
  expect(screen.getByTestId('workspace-picker')).toBeDisabled();
  expect(screen.getByText('Main Campus')).toBeOnTheScreen();
  // No staff attendance for an Accountant account.
  expect(server.count('GET /api/attendance/today')).toBe(0);
});

test('a payment is recorded online with one request key; offline nothing is recorded or queued', async () => {
  storeSession(ACCOUNTANT);
  let up = true;
  const posts = [];
  const server = createServer({
    'GET /api/auth/session': () => [200, { user: ACCOUNTANT }],
    'GET /api/accountant/branch': () => [200, { branch: { id: 'b1', code: 'B1', name: 'Main Campus' } }],
    ...feeRoutes('/api/accountant/fees', {
      'POST /api/accountant/fees/payments': ({ body }) => {
        posts.push(body);
        if (!up) return networkDown();
        return [201, { payment: { id: 'p1', amount: body.amount, receipt: { number: 'RC-0001' }, status: 'recorded' }, repeated: false }];
      },
    }),
  });
  await renderApp(server);
  await fireEvent.press(await screen.findByTestId('action-pay'));
  await screen.findByTestId('fee-students');
  server.routes['GET /api/accountant/fees/students'] = () => [200, { currency: 'USD', items: [{ student: { id: 'st1', name: 'Amina Hassan', studentNumber: 'S1' }, section: { displayName: 'Grade 7A' }, totals: { balance: 10000, overdue: 5000 }, status: 'overdue' }], total: 1 }];
  await fireEvent.changeText(screen.getByTestId('fee-students-search'), 'Amina');
  await fireEvent.press(await screen.findByTestId('fee-student-st1'));
  await fireEvent.press(await screen.findByTestId('record-payment'));
  await fireEvent.changeText(await screen.findByTestId('payment-amount'), '70');
  expect(await screen.findByText('November 2026: $20.00 (part)')).toBeOnTheScreen();

  // The answer is lost: not recorded, and a second try sends the same request key.
  up = false;
  await fireEvent.press(screen.getByTestId('confirm-payment'));
  expect(await screen.findByText(/can never be recorded twice/)).toBeOnTheScreen();
  up = true;
  await fireEvent.press(screen.getByTestId('confirm-payment'));
  expect(await screen.findByText('Receipt RC-0001')).toBeOnTheScreen();
  expect(posts).toHaveLength(2);
  expect(posts[0].requestKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(posts[1].requestKey).toBe(posts[0].requestKey);
  expect(posts[1]).toMatchObject({ student: 'st1', amount: 7000, method: 'cash', allocations: [{ obligation: 'o1', amount: 5000 }, { obligation: 'o2', amount: 2000 }] });
  // Payments never go to the phone's outbox.
  const db = await getDatabase();
  expect(await db.getAllAsync('SELECT * FROM outbox')).toEqual([]);
});

test('staff with Fee Management access switch between Teacher and Accountant; waiting records are named first', async () => {
  const staff = { ...STAFF, feeAccess: true };
  storeSession(staff);
  const server = createServer({ 'GET /api/auth/session': () => [200, { user: staff }], 'GET /api/accountant/branch': () => [200, { branch: { id: 'b1', code: 'B1', name: 'Main Campus' } }], ...feeRoutes('/api/accountant/fees') });
  await renderApp(server);
  const db = await getDatabase();
  await db.runAsync("INSERT INTO lesson_mark_queue (client_mark_id, user_id, section_id, lesson_date, period, student_id, status, occurred_at, state, created_at) VALUES ('m1', 'staff-1', 's', '2026-11-27', 1, 'st', 'present', '2026-11-27T05:00:00Z', 'pending', '2026-11-27T05:00:00Z')");
  await fireEvent.press(await screen.findByText('Attendance'));
  await fireEvent.press(screen.getByText('Home'));
  await fireEvent.press(await screen.findByTestId('workspace-picker'));
  await fireEvent.press(await screen.findByTestId('workspace-accountant'));
  await waitFor(() => expect(screen.getByText('Open Accountant?')).toBeOnTheScreen());
  expect(screen.getByText(/1 lesson mark is still waiting to upload/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('Switch'));
  expect(await screen.findByText('Received today (2)')).toBeOnTheScreen();
  // The waiting mark is still there, for this account.
  expect((await db.getFirstAsync("SELECT state FROM lesson_mark_queue WHERE client_mark_id = 'm1'")).state).toBe('pending');
});
