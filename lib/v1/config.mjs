import { resolveLocalAdminMode } from "../runtime-config.mjs";

const text = (value) => typeof value === "string" ? value.trim() : "";

export function resolveAgenticV1Config(env = process.env) {
  const localMode = resolveLocalAdminMode(env);
  return Object.freeze({
    enabled: text(env.AGENTIC_V1_ENABLED) === "true",
    localMode: localMode.enabled,
    realProviders: localMode.enabled && text(env.AGENTIC_V1_REAL_PROVIDERS) === "true",
    geminiApiKey: text(env.GEMINI_API_KEY),
    geminiModel: text(env.GEMINI_MODEL) || "gemini-3.6-flash",
    mapsApiKey: text(env.GOOGLE_MAPS_PLATFORM_API_KEY),
    confirmationSecret: text(env.AUTH_SECRET) || (localMode.enabled ? "local-agentic-v1-secret" : ""),
    turnDeadlineMs: 45_000,
    maxToolExecutions: 8,
    maxConcurrentTools: 2,
    maxTurnsPerHour: 30,
    recentTurnLimit: 12,
    contextMaxChars: 24000,
    proposalLifetimeMs: 30 * 60_000,
  });
}
