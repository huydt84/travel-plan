import { requireV1Actor, assistantErrorResponse } from "../../../../../lib/v1/http.mjs";
import { defaultContextService } from "../../../../../lib/v1/context-default.mjs";
export const dynamic = "force-dynamic";
export async function GET(request) {
  try {
    const actor = await requireV1Actor();
    const params = new URL(request.url).searchParams;
    const service = defaultContextService();
    if (params.has("slug")) return Response.json(await service.read(actor, await service.tripRef(actor, params.get("slug"))));
    if (params.has("id")) return Response.json(await service.read(actor, { kind: params.get("kind"), id: params.get("id") }));
    return Response.json(await service.search(actor, { query: params.get("q") || "", kind: params.get("kind"), tripId: params.get("tripId"), cursor: params.get("cursor") }, { signal: request.signal }));
  } catch (error) { return assistantErrorResponse(error); }
}
