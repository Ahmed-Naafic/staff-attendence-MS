// Regression test for repeated saves (Branding and Authentication Settings forms): run with
// `npm test --workspace apps/web` (Node's built-in test runner; no browser needed).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSingleFlight } from './singleFlight.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

test('calls made while a save is running are ignored: one request for repeated Enter presses or clicks', async () => {
  const runOnce = createSingleFlight();
  const pending = deferred();
  let started = 0;
  const save = () => {
    started += 1;
    return pending.promise;
  };
  const first = runOnce(save);
  const repeats = [runOnce(save), runOnce(save), runOnce(save)];
  assert.equal(started, 1, 'only the first call starts a save');
  assert.deepEqual(await Promise.all(repeats), [undefined, undefined, undefined]);
  pending.resolve('saved');
  assert.equal(await first, 'saved', 'the first call gets the result');
});

test('after a save finishes (or fails), the next save runs', async () => {
  const runOnce = createSingleFlight();
  assert.equal(await runOnce(async () => 1), 1);
  assert.equal(await runOnce(async () => 2), 2);
  await assert.rejects(runOnce(async () => { throw new Error('network'); }), /network/);
  assert.equal(await runOnce(async () => 3), 3, 'a failure releases the guard');
});

test('each form has its own guard', async () => {
  const branding = createSingleFlight();
  const authentication = createSingleFlight();
  const pending = deferred();
  const running = branding(() => pending.promise);
  assert.equal(await authentication(async () => 'auth'), 'auth');
  pending.resolve('brand');
  assert.equal(await running, 'brand');
});
