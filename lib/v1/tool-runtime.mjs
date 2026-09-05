import { retryProvider } from "./provider-call.mjs";
import { AssistantFault } from "./errors.mjs";
import { planOperationsSchema, validatePlanOperations, validateSchema } from "./schemas.mjs";
import { compactSnapshot } from "./snapshot.mjs";
import { compilePlanProposal } from "./proposal.mjs";
import { safeSourceUrl } from "./evidence.mjs";

const waypointSchema = { oneOf: [
  { type: "object", additionalProperties: false, required: ["address"], properties: { address: { type: "string", minLength: 2, maxLength: 500 } } },
  { type: "object", additionalProperties: false, required: ["placeId"], properties: { placeId: { type: "string", minLength: 5, maxLength: 300 } } },
] };

const researchCall = retryProvider;

export const toolDefinitions = [
  {
    type: "function",
    name: "read_trip_context",
    description: "Read the canonical trip, complete schedule, branches, and cited sources.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
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
      },
    },
  },
  {
    type: "function",
    name: "stage_plan_changes",
    description: "Stage an explicit, reviewable set of changes to the existing plan. This never commits changes.",
    parameters: {
      type: "object", additionalProperties: false, required: ["operations"],
      properties: { operations: planOperationsSchema },
    },
  },
];

const phaseByTool = {
  read_trip_context: "reading-trip",
  search_web: "searching-web",
  search_places: "checking-place",
  get_place_details: "checking-place",
  compute_route: "checking-route",
  stage_plan_changes: "drafting-changes",
};

const toolSchema = new Map(toolDefinitions.map((tool) => [tool.name, tool.parameters]));

export const outputSteps = (interaction) => interaction.outputs || interaction.steps || [];
export const functionCalls = (interaction) => outputSteps(interaction).filter((output) => output.type === "function_call");

export const addEvidence = (state, evidence) => {
  if (!safeSourceUrl(evidence.url)) throw new AssistantFault("INVALID_EVIDENCE", "Nguồn phải có URL http/https hợp lệ", { status: 400 });
  const existing = state.evidence.find((item) => item.url && item.url === evidence.url);
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
  if (name === "stage_plan_changes") return { operationCount: args.operations?.length || 0 };
  return {};
};

export async function executeTool(name, args, state, context) {
  const schema = toolSchema.get(name);
  if (!schema) throw new AssistantFault("TOOL_NOT_ALLOWED", `Tool ${name} không được phép`, { status: 400 });

  context.onProgress?.({ phase: phaseByTool[name], label: progressLabel(name) });
  const started = context.now();
  const auditId = await context.onToolStart?.({ name, metadata: safeToolMetadata(name, args) });
  try {
    if (name === "stage_plan_changes") { state.operations = null; state.compiledProposal = null; }
    if (name === "stage_plan_changes") {
      validateSchema({ ...schema, properties: { operations: {} } }, args, `Tham số ${name}`);
      validatePlanOperations(args.operations);
    } else validateSchema(schema, args, `Tham số ${name}`);
    context.signal?.throwIfAborted();
    let result;
    if (name === "read_trip_context") result = compactSnapshot(context.snapshot);
    if (name === "search_web") {
      const research = await researchCall(() => context.research.searchWeb(args, { signal: context.signal }), context.signal);
      const evidence = research.citations.map((citation) => addEvidence(state, { kind: "web", ...citation, checkedAt: research.checkedAt }));
      result = { summary: research.summary, evidence: evidence.map(({ id, title, url }) => ({ id, title, url })) };
    }
    if (name === "search_places") {
      const research = await researchCall(() => context.research.searchPlaces(args, { signal: context.signal }), context.signal);
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
      const evidence = addEvidence(state, { kind: "place", title: research.place.name, url: research.place.googleMapsUrl, publisher: "Google Maps", placeId: research.place.placeId, checkedAt: research.checkedAt });
      result = { ...research.place, evidenceId: evidence.id, checkedAt: research.checkedAt };
    }
    if (name === "compute_route") {
      const research = await researchCall(() => context.research.computeRoute({ ...args, timezone: context.snapshot.trip.timezone }, { signal: context.signal }), context.signal);
      const evidence = addEvidence(state, { kind: "route", title: `${args.origin.address || args.origin.placeId} → ${args.destination.address || args.destination.placeId}`, url: research.googleMapsUrl, publisher: "Google Maps", checkedAt: research.checkedAt });
      result = { routes: research.routes, checkedAt: research.checkedAt, evidenceId: evidence.id, googleMapsUrl: research.googleMapsUrl };
    }
    if (name === "stage_plan_changes") {
      validatePlanOperations(args.operations);
      if (args.operations.some((operation) => operation.kind === "source.add" && !safeSourceUrl(operation.url))) {
        throw new AssistantFault("INVALID_EVIDENCE", "Nguồn phải có URL http/https hợp lệ");
      }
      const knownSources = new Set([...state.evidence, ...context.snapshot.sources].map((item) => item.url));
      if (args.operations.some((operation) => operation.kind === "source.add" && !knownSources.has(operation.url))) {
        throw new AssistantFault("INVALID_EVIDENCE", "Hãy tra cứu URL nguồn trước khi thêm vào lịch");
      }
      state.compiledProposal = compilePlanProposal(context.snapshot, args.operations);
      state.operations = args.operations;
      result = { staged: true, operationCount: args.operations.length, note: "The application will validate and show the full diff. This did not mutate the plan." };
    }
    await context.onToolFinish?.(auditId, { status: "completed", durationMs: context.now() - started, metadata: resultMetadata(name, result) });
    return result;
  } catch (error) {
    await context.onToolFinish?.(auditId, { status: "failed", durationMs: context.now() - started, errorCode: error.code || "TOOL_FAILED", metadata: error.code === "INVALID_INPUT" ? { validation: error.details?.slice(0, 1600) } : {} });
    if (context.signal?.aborted) throw error;
    if (error instanceof AssistantFault) return { error: { code: error.code, message: error.message, details: error.details, retryable: error.retryable } };
    return { error: { code: "RESEARCH_UNAVAILABLE", message: "Tra cứu không hoàn tất; hãy nêu rõ dữ liệu còn thiếu", retryable: true } };
  }
}

const progressLabel = (name) => ({
  read_trip_context: "Đang đọc lịch hiện tại",
  search_web: "Đang tìm nguồn trên web",
  search_places: "Đang tìm địa điểm trên Google Maps",
  get_place_details: "Đang kiểm tra giờ mở cửa và đánh giá",
  compute_route: "Đang so sánh tuyến đường",
  stage_plan_changes: "Đang kiểm tra bản thay đổi",
})[name];

const resultMetadata = (name, result) => ({
  resultCount: name === "search_places" ? result.places?.length || 0 : name === "compute_route" ? result.routes?.length || 0 : undefined,
  cited: name === "search_web" ? result.evidence?.length || 0 : undefined,
  staged: name === "stage_plan_changes" ? result.operationCount : undefined,
});

