import { withAbort } from "./cancellation.mjs";

export function transientProviderError(error) {
  const status = Number(error?.status || error?.statusCode || error?.response?.status);
  return error?.retryable === true || status === 429 || status >= 500 || error instanceof TypeError;
}

export async function retryProvider(call, signal) {
  for (let attempt = 0; ; attempt += 1) {
    signal?.throwIfAborted();
    try { return await withAbort(call, signal); }
    catch (error) {
      if (signal?.aborted || attempt || !transientProviderError(error)) throw error;
    }
  }
}
