import { assistantErrorResponse, requireV1Actor } from "../../../../../lib/v1/http.mjs";
import { getDefaultTravelAssistant } from "../../../../../lib/v1/travel-assistant.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  try {
    const actor = await requireV1Actor();
    const url = new URL(request.url);
    const workspace = await getDefaultTravelAssistant().loadWorkspace({
      actor,
      clientTurnId: url.searchParams.get("request"),
      before: url.searchParams.get("before"),
      historyBefore: url.searchParams.get("historyBefore"),
      allTrips: url.searchParams.get("allTrips") === "1",
      tripSlug: url.searchParams.get("trip"),
      conversationId: url.searchParams.get("conversation"),
    });
    return Response.json(workspace, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
