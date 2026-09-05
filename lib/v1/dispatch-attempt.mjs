// Starting can succeed remotely even when its acknowledgement is lost. The
// database fences failure against worker claim; reconnect never starts a retry.
export async function dispatchAttempt(turnId, { store, start, timeoutMs = 15_000 }) {
  if (!await store.beginDispatch(turnId)) return;
  let timer;
  try {
    const run = await Promise.race([
      start(turnId),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Dispatch timeout")), timeoutMs); }),
    ]);
    await store.dispatched(turnId, run.runId);
  } catch {
    await store.failDispatch(turnId);
  } finally { clearTimeout(timer); }
}
