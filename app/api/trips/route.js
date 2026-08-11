import { NextResponse } from "next/server";
import { apiError } from "../../../lib/api-response";
import { requireOwner } from "../../../lib/auth";
import { createTrip } from "../../../lib/itinerary-repository";
import { expireTravelPlansCache, listCachedTrips } from "../../../lib/trip-cache";
import { parseTripInput, readJsonBody } from "../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try { return NextResponse.json({ trips: await listCachedTrips() }); }
  catch (error) { return apiError(error); }
}

export async function POST(request) {
  const unauthorized = await requireOwner();
  if (unauthorized) return unauthorized;
  try {
    const input = parseTripInput(await readJsonBody(request));
    const trip = await createTrip(input);
    expireTravelPlansCache();
    return NextResponse.json(trip, { status: 201 });
  } catch (error) { return apiError(error); }
}
