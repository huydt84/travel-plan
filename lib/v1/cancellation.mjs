// Race providers that ignore AbortSignal while observing late rejection. Callers
// still fence every subsequent write; abort cannot undo an accepted DB commit.
export function withAbort(work, signal) {
  signal?.throwIfAborted();
  if (!signal) return Promise.resolve().then(work);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new Error("Aborted"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(work).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
