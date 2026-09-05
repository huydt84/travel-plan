import { NextResponse } from "next/server";
import { apiError } from "../../../../../../lib/api-response";
import { getViewer, requireAdmin } from "../../../../../../lib/auth";
import { attachTripRequest, detachTripRequest } from "../../../../../../lib/trip-request-repository";
import { parseTripRequestFulfillment, readJsonBody, ValidationError } from "../../../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestIdFrom = (value) => {
  if (!/^\d+$/.test(value) || Number(value) <= 0) throw new ValidationError("requestId must be a positive integer");
  return value;
};

export async function PUT(request, context) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  try {
    const viewer = await getViewer();
    const { requestId } = await context.params;
    const { tripSlug } = parseTripRequestFulfillment(await readJsonBody(request));
    return NextResponse.json(await attachTripRequest({
      requestId: requestIdFrom(requestId),
      tripSlug,
      actor: viewer,
    }));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request, context) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  try {
    const { requestId } = await context.params;
    return NextResponse.json(await detachTripRequest({ requestId: requestIdFrom(requestId) }));
  } catch (error) {
    return apiError(error);
  }
}
