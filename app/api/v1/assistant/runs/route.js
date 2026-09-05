import { assistantErrorResponse, requireV1Actor } from "../../../../../lib/v1/http.mjs";
import { createBackgroundStore } from "../../../../../lib/v1/background-store.mjs";
export async function GET() {
  try { const actor = await requireV1Actor(); return Response.json(await createBackgroundStore().summaries(actor.email), { headers: { "cache-control": "no-store" } }); }
  catch (error) { return assistantErrorResponse(error); }
}
