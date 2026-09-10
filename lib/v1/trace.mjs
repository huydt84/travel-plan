const MAX_TRACE_BYTES = 64 * 1024;
const redactedKey = /(?:authorization|cookie|password|secret|tokenhash|confirmationtoken|apikey|api_key|signature|systemprompt|systeminstruction|rawprovider|rawbody|rawresponse|credentials?|chainofthought)/i;
const hiddenReasoningKey = /^(?:reasoning|thoughts?|thinking)$/i;
const sanitizeString = (value) => value
  .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
  .replace(/\b(authorization|password|secret|api[_-]?key|confirmation[_-]?token|token_hash|token)\s*[:=]\s*[^\s&,;]+/gi, "$1=[redacted]")
  .replace(/([?&](?:key|api_key|token|signature)=)[^&#\s]+/gi, "$1[redacted]");

const sanitize = (value, depth = 0) => {
  if (depth > 12) return "[depth limit]";
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !redactedKey.test(key) && !hiddenReasoningKey.test(key)).map(([key, nested]) => [key, sanitize(nested, depth + 1)]));
  }
  if (typeof value === "string") return sanitizeString(value);
  if (["number", "boolean"].includes(typeof value) || value === null) return value;
  return value === undefined ? undefined : String(value);
};

export function sanitizeTraceValue(value) {
  const safe = sanitize(value);
  const serialized = JSON.stringify(safe);
  if (!serialized || Buffer.byteLength(serialized) <= MAX_TRACE_BYTES) return safe;
  return {
    truncated: true,
    originalBytes: Buffer.byteLength(serialized),
    preview: serialized.slice(0, MAX_TRACE_BYTES - 200),
  };
}

export function normalizeTokenUsage(usage = {}) {
  const number = (...keys) => {
    const value = keys.map((key) => usage?.[key]).find((item) => typeof item === "number" && Number.isFinite(item));
    return value ?? null;
  };
  return {
    inputTokens: number("inputTokens", "total_input_tokens", "prompt_token_count", "promptTokenCount"),
    outputTokens: number("outputTokens", "total_output_tokens", "candidates_token_count", "responseTokenCount"),
    totalTokens: number("totalTokens", "total_tokens", "total_token_count", "totalTokenCount"),
    cachedTokens: number("cachedTokens", "total_cached_tokens", "cached_content_token_count", "cachedContentTokenCount"),
    thoughtTokens: number("thoughtTokens", "total_thought_tokens", "thoughts_token_count", "thoughtsTokenCount"),
    toolUseTokens: number("toolUseTokens", "total_tool_use_tokens", "tool_use_prompt_token_count", "toolUsePromptTokenCount"),
  };
}

export function summarizeTrace(trace = []) {
  const tokens = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, thoughtTokens: 0, toolUseTokens: 0 };
  let modelInteractions = 0, executedTools = 0;
  for (const step of trace) {
    if (step.kind === "model") modelInteractions++;
    else executedTools++;
    for (const key of Object.keys(tokens)) tokens[key] += step.usage?.[key] || 0;
  }
  return { modelInteractions, executedTools, tokens };
}
