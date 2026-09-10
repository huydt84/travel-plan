export const ASSISTANT_TOOL_NAMES = Object.freeze([
  "ask_question",
  "search_context",
  "read_context",
  "search_web",
  "search_places",
  "get_place_details",
  "compute_route",
  "apply_changes",
]);

const toolNameSet = new Set(ASSISTANT_TOOL_NAMES);

export function normalizeAllowedTools(value) {
  if (value === undefined || value === null) return [...ASSISTANT_TOOL_NAMES];
  if (!Array.isArray(value) || new Set(value).size !== value.length || value.some((name) => !toolNameSet.has(name))) return null;
  return ASSISTANT_TOOL_NAMES.filter((name) => value.includes(name));
}

export const isAssistantTool = (name) => toolNameSet.has(name);
