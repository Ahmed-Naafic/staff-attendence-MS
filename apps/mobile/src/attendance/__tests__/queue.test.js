/*
 * Offline queue and upload: persistence across a restart, a stable clientEventId across retries,
 * the outcome decided by the server's answer, and upload order.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError } from '../../api/client';
import { migrate } from '../../db/database';
import { countPending, enqueue, getItem, outstandingFor, pendingFor } from '../queue';
import { isFinalRefusal, syncPending } from '../sync';

const USER = 'user-1';
const position = { latitude: 2.046934, longitude: 45.318162, accuracy: 12 };
const event = (id, type = 'CHECK_IN', occurredAt = '2026-10-27T05:00:00.000Z') => ({ clientEventId: id, type, occurredAt, position, distanceEstimate: 20 });

const serverEvent = (body, extra = {}) => ({
  id: `srv-${body.clientEventId}`,
  clientEventId: body.clientEventId,
  type: body.type,
  occurredAt: body.occurredAt,
  receivedAt: body.sentAt,
  workDate: '2026-10-27',
  shift: { key: 'k', name: 'Main Shift', start: '08:00', end: '16:00' },
  status: body.type === 'CHECK_IN' ? 'PRESENT' : null,
  distanceMeters: 20,
  checkInEventId: null,
  ...extra,
});

/** A fake API: each call is answered by the next handler; requests are recorded. */
function fakeApi(...answers) {
  const calls = [];
  return {
    calls,
    request: jest.fn(async (path, { body }) => {
      calls.push({ path, body });
      const answer = answers.shift();
      if (!answer) throw new Error('unexpected request');
      return answer(body);
    }),
  };
}
const ok = (status = 201) => (body) => ({ status, data: { event: serverEvent(body) } });
const fail = (error) => () => {
  throw error;
};
const offline = () => new ApiError({ kind: 'network', message: 'No connection' });
const refused = (status, code) => new ApiError({ kind: 'http', status, code, message: `refused ${code}` });

async function freshDb(file) {
  const db = global.__openTestDatabase(file);
  await migrate(db);
  return db;
}

test('a queued event survives an app restart and is uploaded later with the same id', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'edutrack-')), 'queue.db');
  let db = await freshDb(file);
  await enqueue(db, USER, event('e-1'));
  await db.closeAsync();

  // "Restart": open the same file again.
  db = await freshDb(file);
  expect(await countPending(db, USER)).toBe(1);
  const api = fakeApi(ok());
  const result = await syncPending({ db, api, userId: USER });
  expect(result.recorded).toHaveLength(1);
  expect(api.calls[0].body.clientEventId).toBe('e-1');
  expect((await getItem(db, 'e-1')).state).toBe('recorded');
  expect(await countPending(db, USER)).toBe(0);
});

test('retries use the same clientEventId and event time; only the sent time changes', async () => {
  const db = await freshDb();
  await enqueue(db, USER, event('e-2'));
  const api = fakeApi(fail(offline()), fail(new ApiError({ kind: 'timeout', message: 't' })), fail(refused(503, 'INTERNAL_ERROR')), ok(200));
  let clock = new Date('2026-10-27T05:01:00Z');
  const tick = () => {
    clock = new Date(clock.getTime() + 60000);
    return clock;
  };
  for (let i = 0; i < 3; i += 1) {
    const r = await syncPending({ db, api, userId: USER, clock: tick });
    expect(r.stoppedBy).toBeTruthy();
    expect((await getItem(db, 'e-2')).state).toBe('pending');
  }
  const last = await syncPending({ db, api, userId: USER, clock: tick });
  expect(last.recorded).toHaveLength(1);
  const ids = new Set(api.calls.map((c) => c.body.clientEventId));
  const times = new Set(api.calls.map((c) => c.body.occurredAt));
  const sent = new Set(api.calls.map((c) => c.body.sentAt));
  expect([...ids]).toEqual(['e-2']);
  expect([...times]).toEqual(['2026-10-27T05:00:00.000Z']);
  expect(sent.size).toBe(4);
  const item = await getItem(db, 'e-2');
  expect(item.attempts).toBe(4);
  expect(item.state).toBe('recorded');
});

test('a refusal is final: rejected, kept with its reason, never sent again', async () => {
  const db = await freshDb();
  await enqueue(db, USER, event('e-3'));
  const api = fakeApi(fail(refused(422, 'OUTSIDE_SHIFT_WINDOW')));
  const result = await syncPending({ db, api, userId: USER });
  expect(result.rejected).toHaveLength(1);
  const item = await getItem(db, 'e-3');
  expect(item.state).toBe('rejected');
  expect(item.errorCode).toBe('OUTSIDE_SHIFT_WINDOW');
  expect(await outstandingFor(db, USER)).toHaveLength(1);
  await syncPending({ db, api, userId: USER });
  expect(api.calls).toHaveLength(1);
});

test('a wrong phone clock leaves the event waiting (it is sent again once the clock is fixed)', async () => {
  const db = await freshDb();
  await enqueue(db, USER, event('e-4'));
  const api = fakeApi(fail(refused(422, 'CLOCK_SKEW')), ok());
  await syncPending({ db, api, userId: USER });
  const waiting = await getItem(db, 'e-4');
  expect(waiting.state).toBe('pending');
  expect(waiting.errorCode).toBe('CLOCK_SKEW');
  await syncPending({ db, api, userId: USER });
  expect((await getItem(db, 'e-4')).state).toBe('recorded');
});

test('upload is oldest first and stops at the first unanswered event (a check-out never goes before its check-in)', async () => {
  const db = await freshDb();
  await enqueue(db, USER, event('out', 'CHECK_OUT', '2026-10-27T13:00:00.000Z'));
  await enqueue(db, USER, event('in', 'CHECK_IN', '2026-10-27T05:00:00.000Z'));
  const api = fakeApi(fail(offline()));
  await syncPending({ db, api, userId: USER });
  expect(api.calls.map((c) => c.body.clientEventId)).toEqual(['in']);
  expect((await pendingFor(db, USER)).map((i) => i.clientEventId)).toEqual(['in', 'out']);
});

test('the session ending or a password change keeps events waiting; other accounts’ events are not sent', async () => {
  const db = await freshDb();
  await enqueue(db, USER, event('mine'));
  await enqueue(db, 'someone-else', event('theirs'));
  for (const error of [refused(401, 'UNAUTHENTICATED'), refused(403, 'PASSWORD_CHANGE_REQUIRED'), refused(429, 'TOO_MANY_REQUESTS')]) {
    expect(isFinalRefusal(error)).toBe(false);
    const api = fakeApi(fail(error));
    await syncPending({ db, api, userId: USER });
    expect(api.calls.map((c) => c.body.clientEventId)).toEqual(['mine']);
    expect((await getItem(db, 'mine')).state).toBe('pending');
  }
  expect((await getItem(db, 'theirs')).state).toBe('pending');
});

test('simultaneous uploads share one run (no event is sent twice at once)', async () => {
  const db = await freshDb();
  await enqueue(db, USER, event('e-5'));
  const api = fakeApi(ok());
  const [a, b] = await Promise.all([syncPending({ db, api, userId: USER }), syncPending({ db, api, userId: USER })]);
  expect(a).toBe(b);
  expect(api.calls).toHaveLength(1);
});

test('the same clientEventId cannot be queued twice', async () => {
  const db = await freshDb();
  await enqueue(db, USER, event('dup'));
  await expect(enqueue(db, USER, event('dup'))).rejects.toThrow();
});
