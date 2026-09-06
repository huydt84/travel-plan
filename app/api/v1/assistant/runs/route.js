import { after } from "next/server";
import { dispatchAssistantJobs } from "../../../../../lib/v1/dispatch.js";
import { assistantErrorResponse, requireV1Actor } from "../../../../../lib/v1/http.mjs";
import { createBackgroundStore } from "../../../../../lib/v1/background-store.mjs";
export async function GET() {
  try { const actor = await requireV1Actor(); const store = createBackgroundStore();
    const pending = await store.pendingContinuations(actor.email);
    if (pending.length) after(() => Promise.all(pending.map((job) => dispatchAssistantJobs(job.id))));
    return Response.json(await store.summaries(actor.email), { headers: { "cache-control": "no-store" } }); }
  catch (error) { return assistantErrorResponse(error); }
}
