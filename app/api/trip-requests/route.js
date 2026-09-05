import { NextResponse } from "next/server";
import { apiError } from "../../../lib/api-response";
import { requireAuthenticated } from "../../../lib/auth";
import { createTripRequest, listOwnTripRequests } from "../../../lib/trip-request-repository";
import { parseTripRequestInput, readJsonBody } from "../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const { viewer, response } = await requireAuthenticated();
  if (response) return response;
  try {
    return NextResponse.json({ requests: await listOwnTripRequests(viewer.email) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request) {
  const { viewer, response } = await requireAuthenticated();
  if (response) return response;
  try {
    const input = parseTripRequestInput(await readJsonBody(request));
    return NextResponse.json(await createTripRequest({ requesterEmail: viewer.email, input }), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
