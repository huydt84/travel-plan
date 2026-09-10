import { resolveLocalAdminMode } from "../runtime-config.mjs";

const text = (value) => typeof value === "string" ? value.trim() : "";
export const MAX_TOOL_EXECUTIONS = 16;

export function resolveAgenticV1Config(env = process.env) {
  const localMode = resolveLocalAdminMode(env);
  return Object.freeze({
    enabled: text(env.AGENTIC_V1_ENABLED) === "true",
    localMode: localMode.enabled,
    maxModelRequests: localMode.enabled && text(env.AGENTIC_V1_SINGLE_REQUEST_SMOKE) === "true" ? 1 : undefined,
    realProviders: localMode.enabled && text(env.AGENTIC_V1_REAL_PROVIDERS) === "true",
    geminiApiKey: text(env.GEMINI_API_KEY),
    geminiModel: text(env.GEMINI_MODEL) || "gemini-3.6-flash",
    mapsApiKey: text(env.GOOGLE_MAPS_PLATFORM_API_KEY),
    confirmationSecret: text(env.AUTH_SECRET) || (localMode.enabled ? "local-agentic-v1-secret" : ""),
    // One background step can include multiple 40s provider calls plus research.
    // Reserve 30s for startup/finalization under the 300s Hobby Fluid limit.
    turnDeadlineMs: 270_000,
    maxToolExecutions: MAX_TOOL_EXECUTIONS,
    maxConcurrentTools: 2,
    maxTurnsPerHour: 30,
    recentTurnLimit: 8,
    contextMaxChars: 24000,
    proposalLifetimeMs: 30 * 60_000,
  });
}
