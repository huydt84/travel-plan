import { assistantErrorResponse, assertSameOrigin, readValidatedJson, requireV1Actor } from "../../../../../../../lib/v1/http.mjs";
import { confirmBodySchema } from "../../../../../../../lib/v1/schemas.mjs";
import { getDefaultTravelAssistant } from "../../../../../../../lib/v1/travel-assistant.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    const actor = await requireV1Actor();
    const body = await readValidatedJson(request, confirmBodySchema);
    const { proposalId } = await context.params;
    const receipt = await getDefaultTravelAssistant().confirmProposal({
      actor,
      proposalId,
      confirmationToken: body.confirmationToken,
    });
    return Response.json(receipt, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
