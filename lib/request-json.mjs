// One transport policy for browser JSON requests; feature callers own messages.
export async function requestJson(path, options = {}, fallbackMessage = null) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...options, headers });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || fallbackMessage || `Request failed (${response.status})`);
  return payload;
}
