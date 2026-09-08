export async function readEvents(response, onEvent) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || `Request failed (${response.status})`), { code: data.code, definitive: true });
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("assistantExtra.error.readResponse");
  const decoder = new TextDecoder();
  let pending = "", sequence = 0, runId = null, terminal = false;
  const consume = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (terminal || !Number.isInteger(event.seq) || event.seq <= sequence || !event.runId ||
        (runId && runId !== event.runId) || (!runId && event.type !== "accepted") ||
        (runId && event.type === "accepted") ||
        (event.type === "accepted" && !event.conversationId) ||
        (event.type === "progress" && typeof event.label !== "string") ||
        (event.type === "completed" && (event.turn?.id !== event.runId || event.turn?.status !== "completed")) ||
        (event.type === "failed" && (!event.error?.code || event.turn?.id !== event.runId || event.turn?.status !== "failed")) ||
        !["accepted", "progress", "answer-delta", "evidence", "completed", "failed", "awaiting_approval", "awaiting_input", "cancelled", "checkpoint"].includes(event.type)) {
      throw new Error("assistantExtra.error.streamInterrupted");
    }
    sequence = event.seq;
    runId = event.runId;
    terminal = ["completed", "failed", "cancelled", "awaiting_approval", "awaiting_input"].includes(event.type);
    onEvent(event);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      for (const line of lines) consume(line);
      if (done) break;
    }
    consume(pending);
    if (!terminal) throw new Error("assistantExtra.error.streamDisconnected");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
