import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTokenUsage, sanitizeTraceValue, summarizeTrace } from "../lib/v1/trace.mjs";

test("trace sanitizer removes secrets and hidden reasoning and marks truncation", () => {
  const safe = sanitizeTraceValue({
    authorization: "Bearer private", cookie: "private", confirmationToken: "private",
    reasoning: "hidden", systemPrompt: "hidden", nested: { apiKey: "private", visible: "Bearer private-token token=also-private" },
  });
  assert.deepEqual(safe, { nested: { visible: "Bearer [redacted] token=[redacted]" } });
  const long = sanitizeTraceValue({ visible: "x".repeat(70 * 1024) });
  assert.equal(long.truncated, true);
  assert.ok(long.originalBytes > 64 * 1024);
  assert.ok(long.preview.length < 64 * 1024);
});

test("token usage is normalized and aggregated without inventing unsupported values", () => {
  const usage = normalizeTokenUsage({
    promptTokenCount: 10, responseTokenCount: 5, totalTokenCount: 15,
    cachedContentTokenCount: 3, thoughtsTokenCount: 2, toolUsePromptTokenCount: 1,
  });
  assert.deepEqual(usage, {
    inputTokens: 10, outputTokens: 5, totalTokens: 15,
    cachedTokens: 3, thoughtTokens: 2, toolUseTokens: 1,
  });
  assert.deepEqual(summarizeTrace([{ kind: "model", usage }, { kind: "tool", usage: null }]), {
    modelInteractions: 1, executedTools: 1, tokens: usage,
  });
});
