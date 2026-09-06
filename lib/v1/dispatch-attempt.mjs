// Starting can succeed remotely even when its acknowledgement is lost. The
// database fences failure against worker claim; reconnect never starts a retry.
export async function dispatchAttempt(turnId, { store, start, timeoutMs = 15_000, segment = 0 }) {
  if (!await store.beginDispatch(turnId, segment)) return;
  let timer;
  try {
    const run = await Promise.race([
      start(turnId, segment),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Dispatch timeout")), timeoutMs); }),
    ]);
    await store.dispatched(turnId, run.runId, segment);
  } catch {
    await store.failDispatch(turnId, segment);
  } finally { clearTimeout(timer); }
}
