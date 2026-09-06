export async function apiJson(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || "Không tải được dữ liệu. Hãy thử lại."), { code: data.code, status: response.status });
  return data;
}

export async function observeRun(runId, onEvent, signal) {
  let cursor = 0, failures = 0;
  while (!signal.aborted) {
    try {
      const response = await fetch(`/api/v1/assistant/runs/${runId}/events?after=${cursor}`, { signal });
      if (!response.ok) throw Object.assign(new Error("Không kết nối được với câu trả lời"), { status: response.status });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          pending += decoder.decode(value || new Uint8Array(), { stream: !done });
          const lines = pending.split("\n"); pending = lines.pop() || "";
          if (done && pending.trim()) lines.push(pending);
          for (const line of lines.filter((line) => line.trim())) {
            const event = JSON.parse(line);
            if (event.runId !== runId || !Number.isSafeInteger(event.seq)) throw new Error("Phản hồi không hợp lệ");
            if (event.seq <= cursor) continue;
            if (event.seq !== cursor + 1) throw new Error("Thiếu một phần phản hồi");
            cursor = event.seq; failures = 0;
            onEvent(event);
            if (["completed", "failed", "cancelled", "awaiting_approval"].includes(event.type)) return;
          }
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
