import { NextResponse } from "next/server";
import { apiError } from "../../../../lib/api-response";
import { requireAuthenticated } from "../../../../lib/auth";
import { changeOwnTripRequest, updateTripRequest } from "../../../../lib/trip-request-repository";
import { parseTripRequestMutation, readJsonBody, ValidationError } from "../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestIdFrom = (value) => {
  if (!/^\d+$/.test(value) || Number(value) <= 0) throw new ValidationError("requestId must be a positive integer");
  return value;
};

export async function PATCH(request, context) {
  const { viewer, response } = await requireAuthenticated();
  if (response) return response;
  try {
    const { requestId } = await context.params;
    const mutation = parseTripRequestMutation(await readJsonBody(request));
    const id = requestIdFrom(requestId);
    const updated = mutation.action === "update"
      ? await updateTripRequest({ requestId: id, requesterEmail: viewer.email, input: mutation.request })
      : await changeOwnTripRequest({ requestId: id, requesterEmail: viewer.email, action: mutation.action });
    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error);
  }
}
