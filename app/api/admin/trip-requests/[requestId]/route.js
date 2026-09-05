import { NextResponse } from "next/server";
import { apiError } from "../../../../../lib/api-response";
import { getViewer, requireAdmin } from "../../../../../lib/auth";
import { changeAdminTripRequest } from "../../../../../lib/trip-request-repository";
import { parseAdminTripRequestMutation, readJsonBody, ValidationError } from "../../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestIdFrom = (value) => {
  if (!/^\d+$/.test(value) || Number(value) <= 0) throw new ValidationError("requestId must be a positive integer");
  return value;
};

export async function PATCH(request, context) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  try {
    const viewer = await getViewer();
    const { requestId } = await context.params;
    const mutation = parseAdminTripRequestMutation(await readJsonBody(request));
    return NextResponse.json(await changeAdminTripRequest({
      requestId: requestIdFrom(requestId),
      actorEmail: viewer.email,
      ...mutation,
    }));
  } catch (error) {
    return apiError(error);
  }
}
