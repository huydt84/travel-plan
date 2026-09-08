import { failureDiagnostic } from "./failure-diagnostics.mjs";
import { batchSchema } from "./batch-schema.mjs";
import { retryProvider } from "./provider-call.mjs";
import { AssistantFault } from "./errors.mjs";
import { contextRefSchema, validateSchema } from "./schemas.mjs";
import { refKey } from "./context.mjs";
import { safeEvidence } from "./evidence.mjs";
import { askQuestionSchema } from "./question-schema.mjs";

const waypointSchema = { oneOf: [
  { type: "object", additionalProperties: false, required: ["address"], properties: { address: { type: "string", minLength: 2, maxLength: 500 } } },
  { type: "object", additionalProperties: false, required: ["placeId"], properties: { placeId: { type: "string", minLength: 5, maxLength: 300 } } },
] };

const researchCall = retryProvider;

export const toolDefinitions = [
  {
    type: "function",
    name: "ask_question",
    description: "Pause and ask the user 1 to 3 essential single-choice questions. Each question needs 2 to 4 choices with exactly one recommended choice. The interface always adds a separate custom-answer choice. Use only when the answer materially changes the result and cannot be discovered from available context.",
    parameters: askQuestionSchema,
  },
  {
    type: "function", name: "search_context", description: "Find trips, activities, sources, saved places, and contributions across the accessible planning library. Use returned references to read details.",
    parameters: { type: "object", additionalProperties: false, properties: {
      query: { type: "string", maxLength: 300 }, kind: { enum: ["trip", "activity", "source", "contribution", "place"] },
      tripId: { type: "string", pattern: "^[1-9][0-9]*$" }, cursor: { type: "string", pattern: "^[0-9]{1,6}$" },
    } },
  },
  {
    type: "function", name: "read_context", description: "Read canonical context by reference. A trip read includes its schedule. Context may be unavailable or explicitly truncated.",
    parameters: { type: "object", additionalProperties: false, required: ["ref"], properties: { ref: contextRefSchema } },
  },
  {
    type: "function",
    name: "search_web",
    description: "Research current or obscure travel facts on the web. Prefer official sources.",
    parameters: {
      type: "object", additionalProperties: false, required: ["query"],
      properties: { query: { type: "string", minLength: 2, maxLength: 500 } },
    },
  },
  {
    type: "function",
    name: "search_places",
    description: "Find real places and return structured Google Maps identity, hours, and ratings.",
    parameters: {
      type: "object", additionalProperties: false, required: ["query"],
      properties: {
        query: { type: "string", minLength: 2, maxLength: 300 },
        latitude: { type: "number", minimum: -90, maximum: 90 },
        longitude: { type: "number", minimum: -180, maximum: 180 },
        openNow: { type: "boolean" },
      },
    },
  },
  {
    type: "function",
    name: "get_place_details",
    description: "Get fresh hours, rating, and review context for a Google place ID.",
    parameters: {
      type: "object", additionalProperties: false, required: ["placeId"],
      properties: { placeId: { type: "string", minLength: 5, maxLength: 300 } },
    },
  },
  {
    type: "function",
    name: "compute_route",
    description: "Compare a fresh route between two places or addresses.",
    parameters: {
      type: "object", additionalProperties: false, required: ["origin", "destination"],
      properties: {
        origin: waypointSchema,
        destination: waypointSchema,
        travelMode: { enum: ["TRANSIT", "WALK", "DRIVE", "BICYCLE"] },
        departureTime: { type: "string", maxLength: 80 },
        timezone: { type: "string", minLength: 1, maxLength: 80 },
      },
    },
  },
  {
    type: "function", name: "apply_changes",
    description: "Request approval for an atomic batch of up to 24 create/update operations across trips, activities, sources, and saved places. This call pauses BEFORE execution for the user to approve the entire batch. References use {id} for existing resources or {draftId} for resources created in this batch. Activity sources use source IDs, not source numbers. Include explicit trip references. Never use this for deletion.",
    parameters: batchSchema,
  },
];

const phaseByTool = {
  search_context: "reading-context",
  read_context: "reading-context",
  search_web: "searching-web",
  search_places: "checking-place",
  get_place_details: "checking-place",
  compute_route: "checking-route",
};

const toolSchema = new Map(toolDefinitions.map((tool) => [tool.name, tool.parameters]));

export const outputSteps = (interaction) => interaction.outputs || interaction.steps || [];
export const functionCalls = (interaction) => outputSteps(interaction).filter((output) => output.type === "function_call");

export const addEvidence = (state, evidence) => {
  if (!safeEvidence(evidence)) throw new AssistantFault("INVALID_EVIDENCE", "Nguồn phải có URL http/https hợp lệ", { status: 400 });
  const existing = state.evidence.find((item) => evidence.ref ? item.ref && refKey(item.ref) === refKey(evidence.ref) : item.url && item.url === evidence.url);
  if (existing) return existing;
  const next = Math.max(0, ...state.evidence.map((entry) => Number(entry.id?.slice(1)) || 0)) + 1;
  const item = { checkedAt: new Date().toISOString(), ...evidence, id: `E${next}` };
  state.evidence.push(item);
  return item;
};

const safeToolMetadata = (name, args) => {
  if (name === "search_web" || name === "search_places") return { query: String(args.query || "").slice(0, 160) };
  if (name === "get_place_details") return { placeId: String(args.placeId || "").slice(0, 160) };
  if (name === "compute_route") return { origin: String(args.origin?.address || args.origin?.placeId || "").slice(0, 120), destination: String(args.destination?.address || args.destination?.placeId || "").slice(0, 120), travelMode: args.travelMode || "TRANSIT" };
  return {};
};

export async function executeTool(name, args, state, context) {
  if (["apply_changes", "ask_question"].includes(name)) throw new AssistantFault("APPROVAL_REQUIRED", "Cần người dùng phản hồi trước khi tiếp tục", { status: 403 });
  const schema = toolSchema.get(name);
  if (!schema) throw new AssistantFault("TOOL_NOT_ALLOWED", `Tool ${name} không được phép`, { status: 400 });

  context.onProgress?.({ phase: phaseByTool[name], label: progressLabel(name) });
  const started = context.now();
  const auditId = await context.onToolStart?.({ name, metadata: safeToolMetadata(name, args) });
  try {

    validateSchema(schema, args, `Tham số ${name}`);
    context.signal?.throwIfAborted();
    let result;
    if (name === "search_context") {
      result = await context.contextService.search(context.actor, args, { signal: context.signal });
      const size = JSON.stringify(result).length;
      if (size > context.remainingChars) result = { items: [], omitted: true, note: "Context budget reached; narrow your search in another message." };
      else { context.remainingChars -= size; for (const item of result.items) await context.recordContext?.(item); }
    }
    if (name === "read_context") {
      result = await context.contextService.read(context.actor, args.ref, { full: false, signal: context.signal });
      const size = JSON.stringify(result).length;
      if (size > context.remainingChars) result = { ref: result.ref, label: result.label, available: result.available, omitted: true };
      else context.remainingChars -= size;
      await context.recordContext?.(result);
      if (result.available && !result.omitted) result = { ...result, evidenceId: addEvidence(state, { kind: result.ref.kind === "place" ? "place" : "context", ref: result.ref, title: result.label, url: result.href, checkedAt: result.checkedAt }).id };
    }
    if (name === "search_web") {
      const research = await researchCall(() => context.research.searchWeb(args, { signal: context.signal }), context.signal);
      const evidence = research.citations.map((citation) => addEvidence(state, { kind: "web", ...citation, checkedAt: research.checkedAt }));
      result = { summary: research.summary, evidence: evidence.map(({ id, title, url }) => ({ id, title, url })) };
    }
    let cached = false;
    if (name === "search_places") {
      const research = await researchCall(() => context.research.searchPlaces(args, { signal: context.signal }), context.signal);
      cached = Boolean(research._cached);
      result = {
        places: research.places.map((place) => {
          const evidence = addEvidence(state, { kind: "place", title: place.name, url: place.googleMapsUrl, publisher: "Google Maps", placeId: place.placeId, checkedAt: research.checkedAt });
          return { ...place, reviews: undefined, evidenceId: evidence.id };
        }),
        checkedAt: research.checkedAt,
      };
    }
    if (name === "get_place_details") {
      const research = await researchCall(() => context.research.getPlaceDetails(args, { signal: context.signal }), context.signal);
      cached = Boolean(research._cached);
      const evidence = addEvidence(state, { kind: "place", title: research.place.name, url: research.place.googleMapsUrl, publisher: "Google Maps", placeId: research.place.placeId, checkedAt: research.checkedAt });
      result = { ...research.place, evidenceId: evidence.id, checkedAt: research.checkedAt };
    }
    if (name === "compute_route") {
      if (args.departureTime && !args.timezone && !/(?:Z|[+-]\d{2}:\d{2})$/.test(args.departureTime))
        throw new AssistantFault("INVALID_INPUT", "Thời gian khởi hành cần múi giờ hoặc độ lệch UTC");
      const research = await researchCall(() => context.research.computeRoute({ ...args, timezone: args.timezone || "UTC" }, { signal: context.signal }), context.signal);
      cached = Boolean(research._cached);
      const evidence = addEvidence(state, { kind: "route", title: `${args.origin.address || args.origin.placeId} → ${args.destination.address || args.destination.placeId}`, url: research.googleMapsUrl, publisher: "Google Maps", checkedAt: research.checkedAt });
      result = { routes: research.routes, checkedAt: research.checkedAt, evidenceId: evidence.id, googleMapsUrl: research.googleMapsUrl };
    }
    if (name === "search_places" || name === "get_place_details") {
      for (const place of name === "search_places" ? result.places : [result]) {
        await context.recordContext?.({ ref: { kind: "place", id: `google:${place.placeId.replace(/^places\//, "")}` },
          label: place.name, href: place.googleMapsUrl, available: true, checkedAt: result.checkedAt || new Date().toISOString(), content: place });
      }
    }
    await context.onToolFinish?.(auditId, { status: "completed", durationMs: context.now() - started, metadata: resultMetadata(name, result, cached) });
    return result;
  } catch (error) {
    await context.onToolFinish?.(auditId, { status: "failed", durationMs: context.now() - started, errorCode: error.code || "TOOL_FAILED", metadata: { diagnostics: failureDiagnostic(error, name), ...(error.code === "INVALID_INPUT" ? { validation: error.details?.slice(0, 1600) } : {}) } });
    if (context.signal?.aborted) throw error;
    if (error instanceof AssistantFault) return { error: { code: error.code, message: error.message, details: error.details, retryable: error.retryable } };
    return { error: { code: "RESEARCH_UNAVAILABLE", message: "Tra cứu không hoàn tất; hãy nêu rõ dữ liệu còn thiếu", retryable: true } };
  }
}

const progressLabel = (name) => ({
  search_context: "Đang tìm ngữ cảnh",
  read_context: "Đang đọc ngữ cảnh",
  search_web: "Đang tìm nguồn trên web",
  search_places: "Đang tìm địa điểm trên Google Maps",
  get_place_details: "Đang kiểm tra giờ mở cửa và đánh giá",
  compute_route: "Đang so sánh tuyến đường",
})[name];

const resultMetadata = (name, result, cached) => ({
  resultCount: name === "search_places" ? result.places?.length || 0 : name === "compute_route" ? result.routes?.length || 0 : undefined,
  cited: name === "search_web" ? result.evidence?.length || 0 : undefined,
  cached: cached || undefined,
});
