import { NextResponse } from "next/server";
import { apiError } from "../../../../../../lib/api-response";
import { getViewer, requireAdmin } from "../../../../../../lib/auth";
import { expireTravelPlansCache } from "../../../../../../lib/trip-cache";
import { createTripForRequest } from "../../../../../../lib/trip-request-repository";
import { parseTripInput, readJsonBody, ValidationError } from "../../../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestIdFrom = (value) => {
  if (!/^\d+$/.test(value) || Number(value) <= 0) throw new ValidationError("requestId must be a positive integer");
  return value;
};

export async function POST(request, context) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  try {
    const viewer = await getViewer();
    const { requestId } = await context.params;
    const trip = parseTripInput(await readJsonBody(request));
    const created = await createTripForRequest({ requestId: requestIdFrom(requestId), trip, actor: viewer });
    expireTravelPlansCache();
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
