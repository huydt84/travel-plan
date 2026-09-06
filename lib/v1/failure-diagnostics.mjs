// Only allowlisted operational fields cross the diagnostic boundary. Provider
// messages, stacks, request bodies and headers can contain credentials or prompts.
const types = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "TimeoutError", "ApiError", "APIError", "AssistantFault"]);
const codes = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "RESOURCE_EXHAUSTED", "UNAVAILABLE", "INVALID_ARGUMENT", "PERMISSION_DENIED", "UNAUTHENTICATED", "TURN_DEADLINE_EXCEEDED", "MODEL_INCOMPLETE", "MODEL_UNAVAILABLE", "RESEARCH_UNAVAILABLE", "PROVIDER_CONFIG", "MODEL_EMPTY", "MODEL_BUDGET_EXCEEDED", "TOOL_BUDGET_EXCEEDED"]);
export function failureDiagnostic(error, phase, depth = 0) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? error?.code);
  return {
    phase,
    errorType: types.has(error?.name) ? error.name : "Error",
    ...(error?.name !== "AssistantFault" && Number.isInteger(status) && status >= 400 && status <= 599 ? { upstreamStatus: status } : {}),
    ...(codes.has(error?.code) ? { systemCode: error.code } : {}),
    ...(depth < 2 && error?.cause ? { cause: failureDiagnostic(error.cause, phase, depth + 1) } : {}),
  };
}
export function logTurnFailure(turnId, code, diagnostic) {
  console.error(JSON.stringify({ event: "assistant.turn.failed", turnId, code, ...diagnostic }));
}
