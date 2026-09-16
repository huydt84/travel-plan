import { NextResponse } from "next/server";
import { apiError } from "../../../lib/api-response";
import { getViewer, requireAuthenticated } from "../../../lib/auth";
import { createOwnedTrip, listVisibleTrips } from "../../../lib/trip-access-repository";
import { expireTravelPlansCache } from "../../../lib/trip-cache";
import { parseTripInput, readJsonBody } from "../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Bạn cần đăng nhập bằng Google" }, { status: 401 });
  try { return NextResponse.json({ trips: await listVisibleTrips(viewer) }); }
  catch (error) { return apiError(error); }
}

export async function POST(request) {
  const { viewer, response } = await requireAuthenticated();
  if (response) return response;
  try {
    const input = parseTripInput(await readJsonBody(request));
    const trip = await createOwnedTrip(viewer, input);
    expireTravelPlansCache();
    return NextResponse.json(trip, { status: 201 });
  } catch (error) { return apiError(error); }
}
