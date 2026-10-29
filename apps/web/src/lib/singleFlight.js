/**
 * Runs at most one call of an async task at a time. A call made while another is still running is
 * ignored: the task is not started and the call resolves to undefined. Save forms use it so that
 * pressing Enter or clicking Save again during a save sends one request, not several (a later
 * duplicate could otherwise fail and replace the success message although the save worked).
 *
 *   const saveOnce = createSingleFlight();
 *   await saveOnce(async () => { ... });
 */
export function createSingleFlight() {
  let running = false;
  return async function runOnce(task) {
    if (running) return undefined;
    running = true;
    try {
      return await task();
    } finally {
      running = false;
    }
  };
}
