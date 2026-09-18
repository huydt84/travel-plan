export const ASSISTANT_RUNS_CHANGED_EVENT = "assistant-runs-changed";

export function notifyAssistantRunsChanged() {
  window.dispatchEvent(new Event(ASSISTANT_RUNS_CHANGED_EVENT));
}

export async function apiJson(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || "assistantExtra.error.load"), { code: data.code, status: response.status, details: data.details });
  return data;
}

export async function observeRun(runId, onEvent, signal) {
  let cursor = 0, failures = 0;
  const nextPaint = () => typeof requestAnimationFrame === "function"
    ? new Promise((resolve) => requestAnimationFrame(resolve))
    : Promise.resolve();
  while (!signal.aborted) {
    try {
      const response = await fetch(`/api/v1/assistant/runs/${runId}/events?after=${cursor}`, { signal });
      if (!response.ok) throw Object.assign(new Error("assistantExtra.error.connect"), { status: response.status });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          pending += decoder.decode(value || new Uint8Array(), { stream: !done });
          const lines = pending.split("\n"); pending = lines.pop() || "";
          if (done && pending.trim()) lines.push(pending);
          const events = [];
          let parseFailure = null;
          for (const line of lines.filter((line) => line.trim())) {
            try {
              const event = JSON.parse(line);
              if (event.runId !== runId || !Number.isSafeInteger(event.seq)) throw new Error("assistantExtra.error.invalidResponse");
              if (event.seq <= cursor) continue;
              if (event.seq !== cursor + 1) throw new Error("assistantExtra.error.missingResponse");
              cursor = event.seq; failures = 0;
              events.push(event);
            } catch (error) {
              parseFailure = error;
              break;
            }
          }
          for (let index = 0; index < events.length;) {
            const event = events[index];
            if (event.type !== "answer-delta") {
              onEvent(event);
              if (["completed", "failed", "cancelled", "awaiting_approval", "awaiting_input"].includes(event.type)) return;
              index++;
              continue;
            }
            const burst = [event];
            while (events[index + burst.length]?.type === "answer-delta" && !events[index + burst.length].reset) {
              burst.push(events[index + burst.length]);
            }
            const groupSize = Math.ceil(burst.length / Math.min(8, burst.length));
            for (let offset = 0; offset < burst.length; offset += groupSize) {
              const group = burst.slice(offset, offset + groupSize);
              onEvent({ ...group.at(-1), reset: Boolean(group[0].reset), text: group.map((item) => item.text || "").join("") });
              if (offset + groupSize < burst.length || index + burst.length < events.length) await nextPaint();
            }
            index += burst.length;
          }
          if (parseFailure) throw parseFailure;
          if (done) break;
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch (error) {
      if (signal.aborted) return;
      if ([401, 403, 404].includes(error.status) || ++failures > 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, failures * 1000));
    }
  }
}
