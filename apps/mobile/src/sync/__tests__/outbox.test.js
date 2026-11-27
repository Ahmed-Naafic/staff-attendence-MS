/* global __openTestDatabase */
import { ApiError } from '../../api/client';
import { migrate } from '../../db/database';
import { enqueue } from '../../attendance/queue';
import { addToOutbox, countPendingOutbox, getOutboxItem, outboxHistory } from '../outbox';
import { syncOutbox } from '../outboxSync';
import { cleanUpHistory, statusOf, syncHistory, waitingCounts } from '../history';

const draft = (id, extra = {}) => ({ id, kind: 'exam-marks', label: 'Maths · Grade 7A', payload: { paperId: 'p1', sectionId: 's1', marks: [{ student: 'st1', score: 40 }] }, branch: { id: 'b1', name: 'Main' }, ...extra });

async function db() {
  const d = __openTestDatabase();
  await migrate(d);
  return d;
}

test('payments and cash closing can never be queued offline', async () => {
  const d = await db();
  await expect(addToOutbox(d, 'u1', { ...draft('x'), kind: 'fee-payment' })).rejects.toThrow(/Not an offline record kind/);
});

test('outbox upload: accepted → recorded; a refusal is final; no answer stops and keeps it pending', async () => {
  const d = await db();
  await addToOutbox(d, 'u1', draft('a'), new Date('2026-11-27T08:00:00Z'));
  await addToOutbox(d, 'u1', draft('b'), new Date('2026-11-27T08:01:00Z'));
  await addToOutbox(d, 'u1', draft('c'), new Date('2026-11-27T08:02:00Z'));
  await addToOutbox(d, 'u2', draft('other'), new Date('2026-11-27T08:00:00Z'));
  const calls = [];
  const handlers = {
    'exam-marks': async (_api, p) => {
      calls.push(p);
      if (calls.length === 1) return { status: 'DRAFT' };
      if (calls.length === 2) throw new ApiError({ kind: 'http', status: 409, code: 'SHEET_SUBMITTED', message: 'Already submitted.' });
      throw new ApiError({ kind: 'network', message: 'No connection to the server.' });
    },
  };
  const result = await syncOutbox({ db: d, api: {}, userId: 'u1', handlers });
  expect(result).toMatchObject({ recorded: 1, rejected: 1 });
  expect(result.stoppedBy.kind).toBe('network');
  expect((await getOutboxItem(d, 'a')).state).toBe('recorded');
  expect(await getOutboxItem(d, 'b')).toMatchObject({ state: 'rejected', errorCode: 'SHEET_SUBMITTED' });
  expect(await getOutboxItem(d, 'c')).toMatchObject({ state: 'pending', attempts: 1 });
  // Another account's record is never sent.
  expect((await getOutboxItem(d, 'other')).state).toBe('pending');
  expect(await countPendingOutbox(d, 'u1')).toBe(1);
});

test('a correction is a new record with a new id; the refused one stays', async () => {
  const d = await db();
  await addToOutbox(d, 'u1', draft('first'));
  await d.runAsync("UPDATE outbox SET state = 'rejected', error_code = 'INVALID' WHERE id = 'first'");
  await addToOutbox(d, 'u1', draft('second', { replacesId: 'first' }));
  const history = await outboxHistory(d, 'u1');
  expect(history.map((h) => [h.id, h.state, h.replacedBy, h.replacesId])).toEqual(
    expect.arrayContaining([
      ['first', 'rejected', 'second', null],
      ['second', 'pending', null, 'first'],
    ]),
  );
});

test('history: one list with status and original branch; 90-day clean-up never removes waiting records', async () => {
  const d = await db();
  const old = new Date('2026-07-01T08:00:00Z');
  const event = (id, at) => ({ clientEventId: id, type: 'CHECK_IN', occurredAt: at.toISOString(), position: { latitude: 2, longitude: 45, accuracy: 10 }, branch: { id: 'b1', name: 'Main' } });
  await enqueue(d, 'u1', event('old-synced', old), old);
  await d.runAsync("UPDATE attendance_queue SET state = 'recorded', last_attempt_at = ? WHERE client_event_id = 'old-synced'", [old.toISOString()]);
  await enqueue(d, 'u1', event('old-pending', old), old);
  await d.runAsync("UPDATE attendance_queue SET attempts = 3, error_code = 'NETWORK' WHERE client_event_id = 'old-pending'");
  await addToOutbox(d, 'u1', draft('new'));

  const rows = await syncHistory(d, 'u1');
  expect(rows.find((r) => r.key === 'event:old-synced')).toMatchObject({ status: 'synced', branch: 'Main', title: 'Check-in' });
  expect(rows.find((r) => r.key === 'event:old-pending').status).toBe('failed');
  expect(rows.find((r) => r.key === 'outbox:new').status).toBe('pending');

  expect(await cleanUpHistory(d, new Date('2026-11-27T08:00:00Z'))).toBe(1);
  const left = (await syncHistory(d, 'u1')).map((r) => r.key);
  expect(left).toEqual(expect.arrayContaining(['event:old-pending', 'outbox:new']));
  expect(left).not.toContain('event:old-synced');
  expect(await waitingCounts(d, 'u1')).toEqual({ events: 1, marks: 0, drafts: 1 });
  expect(statusOf({ state: 'pending', attempts: 0 }, true)).toBe('syncing');
});
